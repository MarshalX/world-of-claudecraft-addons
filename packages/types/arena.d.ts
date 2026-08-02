// Where you stand in the rated brackets, and what you are queued for.
//
// Split from `match.d.ts` deliberately: the ladder churns whenever any rated
// player anywhere finishes a bout, and folding it into `match` would fire
// `world.on('match')` because a stranger won a game.

/** A rated bracket's record. */
export interface ArenaStanding {
  rating: number;
  wins: number;
  losses: number;
}

/** One row of the live ladder. */
export interface ArenaLadderRow {
  pid: number;
  name: string;
  cls: string;
  rating: number;
  wins: number;
  losses: number;
}

/** The five format ids. 'duel' is not one: a duel keeps no standing. */
export type ArenaFormat = '1v1' | '2v2' | 'fiesta' | 'yumi3' | 'yumi5';

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
export interface ArenaStandings {
  /** The bracket you are in or queued for, or null for neither. */
  format: ArenaFormat | null;
  queued: boolean;
  /** Players waiting in the selected bracket's queue, 0 when no bracket is selected. */
  queueSize: number;
  standings: Readonly<Record<ArenaFormat, ArenaStanding>>;
  /** Rated players currently ONLINE, best first, at most ten. Empty for the unranked formats. */
  ladders: Readonly<Record<ArenaFormat, readonly ArenaLadderRow[]>>;
}
