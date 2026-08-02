// What competitive bout you are in, across all six formats.
//
// One union rather than six reads, discriminated on `format`, because you ask
// "am I fighting anyone" before you ask what kind. A duel is a member of it for
// the same reason: it is a bout with an opponent and a countdown, and an addon
// that has to check two unrelated reads to answer one question will check one of
// them.
//
// EVERYTHING BUT THE DUEL IS UP TO TEN SECONDS OLD. The arena key is gated to
// 0.1 Hz on the server, so this reading is the game's own recoverable baseline
// rather than a live feed, and the members whose live path is the event queue
// say which events those are. The duel key rides every tick.

import type { FiestaMatch, YumiMatch } from './match-modes.js';

/** One fighter in a bout, on either side. */
export interface MatchCombatant {
  pid: number;
  name: string;
  /** The class id, such as 'hunter'. */
  cls: string;
  level: number;
}

/** What every arena bout carries, whatever its format. A duel carries none of it. */
export interface BoutBase {
  state: 'countdown' | 'active' | 'over';
  /**
   * The map this bout plays in, or null.
   *
   * Null on a server that predates the field, and reported as the default for
   * the Protect Yumi brackets, which play in their own maze band and never show
   * one.
   */
  map: string | null;
  /** Your side, excluding you. */
  allies: readonly MatchCombatant[];
  enemies: readonly MatchCombatant[];
  /** Seconds left in the aftermath, or null while the bout is still running. */
  returnIn: number | null;
}

/** A duel: an opponent and a state, and nothing else on the wire. */
export interface DuelMatch {
  format: 'duel';
  state: 'countdown' | 'active';
  otherPid: number;
  otherName: string;
}

/** A rated Ashen Coliseum bout. The only formats that keep a standing. */
export interface RankedMatch extends BoutBase {
  format: '1v1' | '2v2';
}

/** The bout in progress, whatever kind it is. Narrow on `format` first. */
export type MatchInfo = DuelMatch | RankedMatch | FiestaMatch | YumiMatch;
