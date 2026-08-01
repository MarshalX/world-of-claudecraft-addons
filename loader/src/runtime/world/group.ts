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
    masterLoot: masterLootOf(fieldValue(world, 'partyInfo')),
    lockouts: lockoutsOf(world),
  };
}

export type { GroupInfo, LootRoll, MasterLoot };
export { readGroup };
