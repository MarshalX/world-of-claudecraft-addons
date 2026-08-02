// The group's shared state: loot rolls, master loot, and raid lockouts.
//
// Three readings that all belong to the party rather than to the player, and
// that carry the surface's two awkward facts about time between them.
//
// A loot roll's deadline is on the SIM clock, seconds since the world started,
// which an addon has no way to read. It is published as seconds remaining, the
// way every other timer on this API is, and answers null until the first
// snapshot has given the loader a clock to measure against.
//
// A raid lockout is the other kind: an absolute epoch millisecond stamp, chosen
// by the server precisely so it survives a reconnect and a client's own clock
// drift. That one is published as it is sent, because it is directly comparable
// with `Date.now()` and turning it into a countdown would throw away the one
// property it was given for.
//
// A loot roll also carries `itemName`, which is worth knowing: an item id
// resolves to nothing on this API, and this is one of the few places the game
// hands over a readable name beside one.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { remainingFrom } from './sim-clock.ts';

const NO_ROLL_STATUS: readonly LootRollGroupStatus[] = [];

/** One candidate's live answer on an open roll. Never their number. */
interface LootRollVote {
  pid: number;
  /** 'Unknown' for a candidate the game no longer holds. */
  name: string;
  /** Null is UNDECIDED, never a pass. */
  choice: 'need' | 'greed' | 'pass' | null;
}

/**
 * One open roll as the whole group sees it, rather than as this player was asked it.
 *
 * `votes` covers the CANDIDATES rather than the party, so a member with no row
 * was never eligible for the item. The roll NUMBER is not here and is not
 * anywhere: it stays server-side until resolution.
 */
interface LootRollGroupStatus {
  rollId: number;
  itemId: string;
  itemName: string;
  quality: string;
  /** Seconds left, or null before the loader has the sim's clock. */
  remaining: number | null;
  votes: readonly LootRollVote[];
}

/** What a player is being asked to roll on. */
interface LootRoll {
  rollId: number;
  itemId: string;
  /** The readable name, which an item id alone cannot give you. */
  itemName: string;
  quality: string;
  /** Seconds left to answer, or null before the loader has the sim's clock. */
  remaining: number | null;
}

/** Who the master looter is, and from which quality upward they assign. */
interface MasterLoot {
  enabled: boolean;
  /** The looter's pid, or 0 meaning whoever currently leads. */
  looter: number;
  threshold: string;
}

interface GroupInfo {
  /** Rolls this player has been asked to answer. */
  rolls: readonly LootRoll[];
  /**
   * Every open roll in the party with each candidate's answer.
   *
   * `rolls` is what this player was asked; this is what the group is doing
   * about it, and the two overlap rather than nest. Empty when ungrouped.
   */
  rollStatus: readonly LootRollGroupStatus[];
  /** Master loot settings, or null when the group is not using it. */
  masterLoot: MasterLoot | null;
  /**
   * Dungeon id to when its lockout expires, in epoch milliseconds.
   *
   * Absolute rather than a countdown, which is how the server sends it and is
   * the point of it: compare against `Date.now()`.
   */
  lockouts: ReadonlyMap<string, number>;
}

function rollsOf(world: unknown, simNow: number | null): readonly LootRoll[] {
  return fieldArray(world, 'lootRollPrompts').map((roll) => ({
    rollId: fieldNumber(roll, 'rollId') ?? 0,
    itemId: fieldString(roll, 'itemId') ?? '',
    itemName: fieldString(roll, 'itemName') ?? '',
    quality: fieldString(roll, 'quality') ?? '',
    remaining: remainingFrom(fieldNumber(roll, 'expiresAt'), simNow),
  }));
}

/** An unrecognised answer reads as undecided: a future choice must not lie in the union. */
function choiceOf(choice: string | null): LootRollVote['choice'] {
  if (choice === 'need' || choice === 'greed' || choice === 'pass') {
    return choice;
  }
  return null;
}

function votesOf(entries: readonly unknown[]): readonly LootRollVote[] {
  return entries.map((entry) => ({
    pid: fieldNumber(entry, 'pid') ?? 0,
    name: fieldString(entry, 'name') ?? '',
    choice: choiceOf(fieldString(entry, 'choice')),
  }));
}

function statusRows(rows: unknown, simNow: number | null): readonly LootRollGroupStatus[] {
  if (!Array.isArray(rows)) {
    return NO_ROLL_STATUS;
  }
  return (rows as readonly unknown[]).map((row) => ({
    rollId: fieldNumber(row, 'rollId') ?? 0,
    itemId: fieldString(row, 'itemId') ?? '',
    itemName: fieldString(row, 'itemName') ?? '',
    quality: fieldString(row, 'quality') ?? '',
    remaining: remainingFrom(fieldNumber(row, 'expiresAt'), simNow),
    votes: votesOf(fieldArray(row, 'entries')),
  }));
}

/**
 * Every open roll in the party with each candidate's answer.
 *
 * THE ONE READ ON THIS API THAT IS A CALL. The client's mirror field is private
 * and is named by nothing the game tests, so it can be renamed without anything
 * noticing; the accessor is the member the game's own parity suite pins. The
 * call is safe in a way `drainEvents` is not: it walks the pending rolls and
 * allocates a result, and empties nothing the game is about to read.
 *
 * Guarded anyway, because a game update can leave something callable in place
 * that throws when called, and the cost of that has to be an empty list rather
 * than a dead world read.
 */
function rollStatusOf(world: unknown, simNow: number | null): readonly LootRollGroupStatus[] {
  const read = fieldValue(world, 'lootRollGroupStatus');
  if (typeof read !== 'function') {
    return NO_ROLL_STATUS;
  }
  try {
    return statusRows((read as () => unknown).call(world), simNow);
  } catch {
    return NO_ROLL_STATUS;
  }
}

/**
 * Master loot, or null when the group is not using it.
 *
 * Null rather than a record with `enabled: false`, because every consumer of
 * this asks "is master loot on" first and the flag would be a second way to
 * answer the same question.
 */
function masterLootOf(party: unknown): MasterLoot | null {
  const master = fieldValue(party, 'master');
  if (master === null || fieldValue(master, 'enabled') !== true) {
    return null;
  }
  return {
    enabled: true,
    looter: fieldNumber(master, 'looter') ?? 0,
    threshold: fieldString(master, 'threshold') ?? '',
  };
}

function lockoutsOf(world: unknown): ReadonlyMap<string, number> {
  const lockouts = fieldValue(world, 'selfLockouts');
  const out = new Map<string, number>();
  if (lockouts === null || typeof lockouts !== 'object') {
    return out;
  }
  for (const [dungeonId, until] of Object.entries(lockouts as Record<string, unknown>)) {
    if (typeof until === 'number') {
      out.set(dungeonId, until);
    }
  }
  return out;
}

/** The group reading, or null before there is a world to read it from. */
function readGroup(world: unknown, simNow: number | null): GroupInfo | null {
  if (world === null) {
    return null;
  }
  return {
    rolls: rollsOf(world, simNow),
    rollStatus: rollStatusOf(world, simNow),
    masterLoot: masterLootOf(fieldValue(world, 'partyInfo')),
    lockouts: lockoutsOf(world),
  };
}

export type { GroupInfo, LootRoll, LootRollGroupStatus, LootRollVote, MasterLoot };
export { readGroup };
