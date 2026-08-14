// What competitive bout the player is in, across all seven formats.
//
// One union rather than seven reads, discriminated on `format`, because an addon
// asks "am I fighting anyone" before it asks what kind. A duel is a member of it
// for the same reason: it is a bout with an opponent and a countdown, and an
// addon that has to check two unrelated reads to answer one question will check
// one of them.
//
// THE THREE KEYS BEHIND IT REFRESH AT THREE DIFFERENT RATES, and the union hides
// that, so each member's own type says which it came from. The duel key rides
// every tick. The battleground key rides at 1 Hz and is forced fresh on every
// transition worth acting on. The arena key is gated to 0.1 Hz, so everything
// read from it is up to ten seconds old and is the game's own recoverable
// baseline rather than a live feed; the members whose live path is the event
// queue say which events those are.
//
// `match-modes.ts` holds the two unranked bout shapes and type-imports the two
// bases below back from here. `verbatimModuleSyntax` erases both directions, so
// there is no runtime cycle. `battleground.ts` needs nothing from here, because
// its match member deliberately does not extend `BoutBase`: see that module.

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
 * An unrecognised state reads as 'active'.
 *
 * The two named boundaries are both claims a display ACTS on: 'countdown' draws
 * a start timer and 'over' draws an aftermath. Guessing either from a value the
 * game has since added would draw a boundary that is not there, where the
 * neutral middle only fails to draw one.
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
 * What every arena bout carries, whatever its format.
 *
 * `returnIn` stays null rather than falling back to 0: the game sends the field
 * only once the bout is over, so a zero would say the aftermath has already
 * ended on every bout that is still being fought.
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
 * The bout the player is in, or null when they are in none.
 *
 * READ IN FALLING ORDER OF FRESHNESS, which is what decides the order rather
 * than taste: the three keys are mutually exclusive in the game, so any of them
 * answering is the answer, and where two could the fresher one should win. The
 * duel rides every tick, the battleground 1 Hz, the arena 0.1 Hz.
 *
 * THE ARENA AND BATTLEGROUND KEYS ARE PRESENT FOR EVERY CHARACTER, queued or
 * not. Only their `match` member says a bout is on, so a reader that answered a
 * bout whenever `arenaInfo` existed would tell the whole realm it is fighting.
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
