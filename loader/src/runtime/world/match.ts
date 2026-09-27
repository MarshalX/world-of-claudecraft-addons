// What competitive bout the player is in, across all seven formats.
//
// One union discriminated on `format`, since an addon asks "am I fighting anyone" first.
//
// Three keys feed it at different rates: `duelInfo` every tick, `bgInfo` at 1 Hz plus every
// transition, `arenaInfo` at 0.1 Hz (up to ten seconds stale; see each member for its live
// events).

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { type BattlegroundMatch, battlegroundOf } from './battleground.ts';
import { type FiestaMatch, fiestaOf, type YumiMatch, yumiOf } from './match-modes.ts';

/** One fighter in a bout, on either side. */
interface MatchCombatant {
  pid: number;
  name: string;
  /** The class id, such as 'hunter'. */
  cls: string;
  level: number;
}

/** What every arena bout carries, whatever its format. A duel carries none of it. */
interface BoutBase {
  state: 'countdown' | 'active' | 'over';
  /**
   * The map this bout plays in, or null. The Protect Yumi brackets report the default, since
   * they play in their own maze.
   */
  map: string | null;
  /** Your side, excluding you. */
  allies: readonly MatchCombatant[];
  enemies: readonly MatchCombatant[];
  /** Seconds left in the aftermath, or null while the bout is still running. */
  returnIn: number | null;
}

/** A duel: an opponent and a state, and nothing else on the wire. */
interface DuelMatch {
  format: 'duel';
  state: 'countdown' | 'active';
  otherPid: number;
  otherName: string;
}

/** A rated Ashen Coliseum bout. The only formats that keep a standing. */
interface RankedMatch extends BoutBase {
  format: '1v1' | '2v2';
}

/** The bout in progress, whatever kind it is. */
type MatchInfo = BattlegroundMatch | DuelMatch | RankedMatch | FiestaMatch | YumiMatch;

/**
 * An unrecognised state reads as 'active', the neutral middle; guessing 'countdown' or 'over'
 * would draw a timer or an aftermath that is not there.
 */
function boutState(state: string | null): BoutBase['state'] {
  if (state === 'countdown' || state === 'over') {
    return state;
  }
  return 'active';
}

function combatantsOf(rows: readonly unknown[]): readonly MatchCombatant[] {
  return rows.map((row) => ({
    pid: fieldNumber(row, 'pid') ?? 0,
    name: fieldString(row, 'name') ?? '',
    cls: fieldString(row, 'cls') ?? '',
    level: fieldNumber(row, 'level') ?? 0,
  }));
}

/**
 * What every arena bout carries, whatever its format. `returnIn` stays null, not 0: it is sent
 * only once the bout is over.
 */
function boutBase(match: unknown): BoutBase {
  return {
    state: boutState(fieldString(match, 'state')),
    map: fieldString(match, 'map'),
    allies: combatantsOf(fieldArray(match, 'allies')),
    enemies: combatantsOf(fieldArray(match, 'enemies')),
    returnIn: fieldNumber(match, 'returnIn'),
  };
}

function duelOf(duel: unknown): DuelMatch | null {
  if (duel === null) {
    return null;
  }
  return {
    format: 'duel',
    state: duelState(fieldString(duel, 'state')),
    otherPid: fieldNumber(duel, 'otherPid') ?? 0,
    otherName: fieldString(duel, 'otherName') ?? '',
  };
}

function duelState(state: string | null): DuelMatch['state'] {
  if (state === 'countdown') {
    return state;
  }
  return 'active';
}

/**
 * The bout the player is in, or null when they are in none. Read in falling order of freshness.
 *
 * `arenaInfo` and `bgInfo` exist for every character; only their `match` member says a bout is
 * on.
 */
function readMatch(world: unknown): MatchInfo | null {
  const duel = duelOf(fieldValue(world, 'duelInfo'));
  if (duel !== null) {
    return duel;
  }
  const battleground = battlegroundOf(world);
  if (battleground !== null) {
    return battleground;
  }
  const match = fieldValue(fieldValue(world, 'arenaInfo'), 'match');
  if (match === null) {
    return null;
  }
  const format = fieldString(match, 'format');
  const base = boutBase(match);
  if (format === 'fiesta') {
    return fiestaOf(fieldValue(match, 'fiesta'), base);
  }
  if (format === 'yumi3' || format === 'yumi5') {
    return yumiOf(fieldValue(match, 'yumi'), base, format);
  }
  if (format === '1v1' || format === '2v2') {
    return { ...base, format };
  }
  return null;
}

export type { BoutBase, DuelMatch, MatchCombatant, MatchInfo, RankedMatch };
export { readMatch };
