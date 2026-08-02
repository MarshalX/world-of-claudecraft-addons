// Where the player stands in the rated brackets, and what they are queued for.
//
// Split from `match.ts` deliberately: the ladder churns whenever any rated
// player anywhere finishes a bout, and folding it into `match` would fire
// `world.on('match')` because a stranger won a game.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

/** A rated bracket's record. */
interface ArenaStanding {
  rating: number;
  wins: number;
  losses: number;
}

/** One row of the live ladder. */
interface ArenaLadderRow {
  pid: number;
  name: string;
  cls: string;
  rating: number;
  wins: number;
  losses: number;
}

/** The five format ids. 'duel' is not one: a duel keeps no standing. */
type ArenaFormat = '1v1' | '2v2' | 'fiesta' | 'yumi3' | 'yumi5';

/**
 * Where you stand and what you are queued for.
 *
 * Present for every character, queued or not, so this being non-null says
 * nothing about whether you play.
 *
 * ONLY '1v1' AND '2v2' MEAN ANYTHING HERE. The three unranked formats keep no
 * standing of their own: the server fills their `standings` entries by copying
 * '2v2' and their `ladders` entries with an empty list, purely to satisfy the
 * record's shape. They are present so a lookup never needs a guard, and they are
 * not readings.
 *
 * Refreshed at 0.1 Hz, so a rating is up to ten seconds behind the bout that
 * changed it. `net.onEvent('arenaEnd')` is the moment.
 */
interface ArenaStandings {
  /** The bracket you are in or queued for, or null for neither. */
  format: ArenaFormat | null;
  queued: boolean;
  /** Players waiting in the selected bracket's queue, 0 when no bracket is selected. */
  queueSize: number;
  standings: Readonly<Record<ArenaFormat, ArenaStanding>>;
  /** Rated players currently ONLINE, best first, at most ten. Empty for the unranked formats. */
  ladders: Readonly<Record<ArenaFormat, readonly ArenaLadderRow[]>>;
}

/**
 * The five brackets, listed once.
 *
 * The record is walked rather than written out as an object literal because
 * every key here is a bracket id the GAME chose, and a literal would have to be
 * spelled the way this repo names things rather than the way the wire does.
 */
const FORMATS: readonly ArenaFormat[] = ['1v1', '2v2', 'fiesta', 'yumi3', 'yumi5'];

function formatOf(format: string | null): ArenaFormat | null {
  if (format === null) {
    return null;
  }
  return FORMATS.find((known) => known === format) ?? null;
}

function standingOf(standing: unknown): ArenaStanding {
  return {
    rating: fieldNumber(standing, 'rating') ?? 0,
    wins: fieldNumber(standing, 'wins') ?? 0,
    losses: fieldNumber(standing, 'losses') ?? 0,
  };
}

function ladderOf(rows: readonly unknown[]): readonly ArenaLadderRow[] {
  return rows.map((row) => ({
    pid: fieldNumber(row, 'pid') ?? 0,
    name: fieldString(row, 'name') ?? '',
    cls: fieldString(row, 'cls') ?? '',
    rating: fieldNumber(row, 'rating') ?? 0,
    wins: fieldNumber(row, 'wins') ?? 0,
    losses: fieldNumber(row, 'losses') ?? 0,
  }));
}

/**
 * A full record over the five brackets, whatever the wire carried.
 *
 * Every bracket gets an entry even when the wire sent none, so a lookup never
 * needs a guard. That is the same promise the server makes by mirroring the 2v2
 * record into the three unranked brackets, and it is why the type says those
 * three are not readings.
 */
function recordOf<T>(
  source: unknown,
  read: (source: unknown, key: string) => T,
): Readonly<Record<ArenaFormat, T>> {
  const entries = FORMATS.map((format) => [format, read(source, format)] as const);
  // `fromEntries` cannot know the key list is exhaustive; `FORMATS` is the union.
  return Object.fromEntries(entries) as Record<ArenaFormat, T>;
}

function standingsOf(source: unknown): Readonly<Record<ArenaFormat, ArenaStanding>> {
  return recordOf(source, (bracket, key) => standingOf(fieldValue(bracket, key)));
}

function laddersOf(source: unknown): Readonly<Record<ArenaFormat, readonly ArenaLadderRow[]>> {
  return recordOf(source, (bracket, key) => ladderOf(fieldArray(bracket, key)));
}

/**
 * Your standings, queue and ladders, or null before the arena key has arrived.
 *
 * Non-null for every character with a name, so this answering something says
 * nothing about whether they have ever queued. It also arrives at 0.1 Hz and is
 * delta-elided, so an idle session sees it once and then not again until a
 * standing or a ladder actually moves.
 */
function readArena(world: unknown): ArenaStandings | null {
  const arena = fieldValue(world, 'arenaInfo');
  if (arena === null) {
    return null;
  }
  return {
    format: formatOf(fieldString(arena, 'format')),
    queued: fieldValue(arena, 'queued') === true,
    queueSize: fieldNumber(arena, 'queueSize') ?? 0,
    standings: standingsOf(fieldValue(arena, 'standings')),
    ladders: laddersOf(fieldValue(arena, 'ladders')),
  };
}

export type { ArenaFormat, ArenaLadderRow, ArenaStanding, ArenaStandings };
export { readArena };
