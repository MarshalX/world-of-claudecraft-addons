// What competitive bout you are in, across all seven formats, as one union
// discriminated on `format`.
//
// THREE CADENCES SIT BEHIND IT, and the union hides that. A duel updates every
// tick. A battleground updates at 1 Hz and immediately on every transition worth
// acting on. The four arena formats update at 0.1 Hz, so a reading can be ten
// seconds old; the members whose live path is the event queue name those events.

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
   * Null on a server that predates the field. The Protect Yumi brackets report
   * the default map, since they play in their own maze and never show one.
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
 * `BattlegroundMatch` is the one member that does not extend `BoutBase`: its
 * roster carries no level, so it has one `fighters` list instead of
 * `allies`/`enemies`. It joined at API minor 6; the rest have been here since 2.
 */
export type MatchInfo = BattlegroundMatch | DuelMatch | RankedMatch | FiestaMatch | YumiMatch;
