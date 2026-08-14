// What competitive bout you are in, across all seven formats.
//
// One union rather than seven reads, discriminated on `format`, because you ask
// "am I fighting anyone" before you ask what kind. A duel is a member of it for
// the same reason: it is a bout with an opponent and a countdown, and an addon
// that has to check two unrelated reads to answer one question will check one of
// them.
//
// THREE KEYS AT THREE CADENCES SIT BEHIND IT, and the union hides that, so read
// each member's own type for which. A duel rides every tick. A battleground
// rides at 1 Hz and is forced fresh on every transition worth acting on. The
// four arena formats are gated to 0.1 Hz, so anything read from one is up to ten
// seconds old and is the game's own recoverable baseline rather than a live
// feed; the members whose live path is the event queue say which events those
// are.

import type { BattlegroundMatch } from './battleground.js';
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

/**
 * The bout in progress, whatever kind it is. Narrow on `format` first.
 *
 * `BattlegroundMatch` is the one member that does not extend `BoutBase`, and
 * `battleground.d.ts` says why: its roster carries no level, so it publishes one
 * `fighters` list rather than an `allies`/`enemies` pair. It joined at API minor
 * 6; the rest have been here since 2.
 */
export type MatchInfo = BattlegroundMatch | DuelMatch | RankedMatch | FiestaMatch | YumiMatch;
