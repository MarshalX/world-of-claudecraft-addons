// Where the player stands in the rated brackets, and what they are queued for.
//
// Split from `match.ts`: the ladder churns whenever anyone finishes a bout, and folding it in
// would fire `world.on('match')` for a stranger's game.

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
 * Where you stand and what you are queued for. Present for every character, queued or not.
 *
 * Only '1v1' and '2v2' are readings: the server fills the unranked formats' standings with a
 * copy of '2v2' and their ladders with an empty list.
 *
 * Refreshed at 0.1 Hz, so a rating can be ten seconds behind; `net.onEvent('arenaEnd')` is the
 * moment.
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

/** The five brackets. Walked rather than spelled as literal keys, which are the game's ids. */
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
 * A full record over the five brackets, whatever the wire carried, so a lookup never needs a
 * guard.
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
 * Your standings, queue and ladders, or null before the arena key has arrived. Delta-elided, so
 * an idle session sees it once and again only when something moves.
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
