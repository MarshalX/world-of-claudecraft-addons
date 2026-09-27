// The two unranked bout formats, Fiesta and Protect Yumi, split from `match.ts` by subject. The
// import back from `match.ts` is type-only, so the cycle is erased from the bundle.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import type { BoutBase } from './match.ts';

/** The game's own fallback for a power-up whose catalogue id it does not know. */
const UNKNOWN_POWERUP_COLOR = 0xff_ff_ff;

/** The two team sizes the Protect Yumi brackets have. */
const SMALL_YUMI_SIZE = 3;
const LARGE_YUMI_SIZE = 5;

/** One fighter's line on a Fiesta scoreboard. */
interface FiestaScore {
  pid: number;
  name: string;
  cls: string;
  kills: number;
  /** Benched, awaiting respawn. */
  down: boolean;
}

/** A pending augment pick. */
interface AugmentOffer {
  tier: 'silver' | 'gold' | 'prismatic';
  wave: number;
  /** Augment ids. Nothing on this API resolves one to a name. */
  choices: readonly string[];
}

/** A ring power-up, in world coordinates. */
interface FiestaPowerup {
  id: number;
  /** The catalogue id, such as 'haste'. */
  defId: string;
  x: number;
  z: number;
  state: 'spawning' | 'ready';
  /**
   * TWO quantities behind one name: while 'spawning' it RISES 0 to 1 as the telegraph fills;
   * while 'ready' it FALLS 1 to 0 as the power-up expires.
   */
  frac: number;
  /** The game's own orb colour, as a 24-bit RGB integer. */
  color: number;
}

/** A Fiesta bout: waves, augments, a shrinking ring and a kill race. */
interface FiestaMatch extends BoutBase {
  format: 'fiesta';
  /** Your team's tally, against `theirScore` and `scoreLimit`. */
  myScore: number;
  theirScore: number;
  scoreLimit: number;
  wave: number;
  /** A constant on the server, not a per-match figure. */
  totalWaves: number;
  /** The hazard ring, in world coordinates. There is no y: the ground height is not sent. */
  ring: { x: number; z: number; radius: number };
  /** You are benched. */
  down: boolean;
  /** Whole seconds until you revive, 0 while alive. */
  respawnIn: number;
  /** The augment ids you have locked in this bout. */
  augments: readonly string[];
  /** A pick waiting on you, or null. */
  offer: AugmentOffer | null;
  /** Offers queued behind your next death. */
  augmentPending: number;
  /** Both sides' lines, already split so you never compare team letters. */
  scoreboard: { mine: readonly FiestaScore[]; theirs: readonly FiestaScore[] };
  powerups: readonly FiestaPowerup[];
}

/** One fighter's line on a Protect Yumi scoreboard. */
interface YumiScore {
  pid: number;
  name: string;
  cls: string;
  kills: number;
  deaths: number;
  down: boolean;
}

/**
 * One objective cat, sent for BOTH cats whatever your interest scope.
 *
 * `hp`, `x` and `z` can be ten seconds stale; the live paths are `net.onEvent('yumiStatus')`
 * (health, once a second) and `net.onEvent('yumiTeleport')` (position). A dead or missing cat
 * reports `alive: false` with `hp` 0 at the origin.
 */
interface YumiCat {
  entityId: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  alive: boolean;
}

/** A Protect Yumi bout: two objective cats, timed teleports and a bleed ramp. */
interface YumiMatch extends BoutBase {
  format: 'yumi3' | 'yumi5';
  /** 3 or 5, matching the format. */
  size: 3 | 5;
  /** Teleports have frozen and the bleed ramp has started. */
  suddenDeath: boolean;
  /** Whole seconds since the start, 0 during the countdown. */
  matchElapsed: number;
  /** Whole seconds to the next simultaneous teleport. 0 means frozen, not imminent. */
  teleportIn: number;
  /** Whole seconds to sudden death. 0 means latched, not imminent. */
  suddenDeathIn: number;
  /** The cats' damage-taken multiplier, 1 before sudden death. */
  damageTakenMult: number;
  down: boolean;
  /** Whole seconds until you revive. 0 for alive AND for a disconnected member with no ETA. */
  respawnIn: number;
  /** Both cats, already split so you never compare team letters. */
  cats: { mine: YumiCat; theirs: YumiCat };
  scoreboard: { mine: readonly YumiScore[]; theirs: readonly YumiScore[] };
}

/**
 * Which of the two sides is yours: the one place a team letter is compared. An unrecognised
 * letter takes A, the side the wire's `myScore` is computed for in that case.
 */
function sided<T>(team: string | null, teamA: T, teamB: T): { mine: T; theirs: T } {
  if (team === 'B') {
    return { mine: teamB, theirs: teamA };
  }
  return { mine: teamA, theirs: teamB };
}

function stringsOf(values: readonly unknown[]): readonly string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

function fiestaScores(rows: readonly unknown[]): readonly FiestaScore[] {
  return rows.map((row) => ({
    pid: fieldNumber(row, 'pid') ?? 0,
    name: fieldString(row, 'name') ?? '',
    cls: fieldString(row, 'cls') ?? '',
    kills: fieldNumber(row, 'kills') ?? 0,
    down: fieldValue(row, 'down') === true,
  }));
}

/** An unrecognised phase reads as 'ready', which is the state that draws no telegraph. */
function powerupState(state: string | null): FiestaPowerup['state'] {
  if (state === 'spawning') {
    return state;
  }
  return 'ready';
}

function powerupsOf(rows: readonly unknown[]): readonly FiestaPowerup[] {
  return rows.map((row) => ({
    id: fieldNumber(row, 'id') ?? 0,
    defId: fieldString(row, 'defId') ?? '',
    x: fieldNumber(row, 'x') ?? 0,
    z: fieldNumber(row, 'z') ?? 0,
    state: powerupState(fieldString(row, 'state')),
    frac: fieldNumber(row, 'frac') ?? 0,
    color: fieldNumber(row, 'color') ?? UNKNOWN_POWERUP_COLOR,
  }));
}

/** An unrecognised tier reads as the lowest, so a future one never draws as the rarest. */
function tierOf(tier: string | null): AugmentOffer['tier'] {
  if (tier === 'gold' || tier === 'prismatic') {
    return tier;
  }
  return 'silver';
}

function offerOf(offer: unknown): AugmentOffer | null {
  if (offer === null) {
    return null;
  }
  return {
    tier: tierOf(fieldString(offer, 'tier')),
    wave: fieldNumber(offer, 'wave') ?? 0,
    choices: stringsOf(fieldArray(offer, 'choices')),
  };
}

/** The wire names the centre `cx`/`cz`; every other coordinate on this API is `x`/`z`. */
function ringOf(ring: unknown): FiestaMatch['ring'] {
  return {
    x: fieldNumber(ring, 'cx') ?? 0,
    z: fieldNumber(ring, 'cz') ?? 0,
    radius: fieldNumber(ring, 'radius') ?? 0,
  };
}

/** A Fiesta bout, or null when the record is absent. */
function fiestaOf(fiesta: unknown, base: BoutBase): FiestaMatch | null {
  if (fiesta === null) {
    return null;
  }
  const team = fieldString(fiesta, 'team');
  return {
    ...base,
    format: 'fiesta',
    myScore: fieldNumber(fiesta, 'myScore') ?? 0,
    theirScore: fieldNumber(fiesta, 'theirScore') ?? 0,
    scoreLimit: fieldNumber(fiesta, 'scoreLimit') ?? 0,
    wave: fieldNumber(fiesta, 'wave') ?? 0,
    totalWaves: fieldNumber(fiesta, 'totalWaves') ?? 0,
    ring: ringOf(fieldValue(fiesta, 'ring')),
    down: fieldValue(fiesta, 'down') === true,
    respawnIn: fieldNumber(fiesta, 'respawnIn') ?? 0,
    augments: stringsOf(fieldArray(fiesta, 'augments')),
    offer: offerOf(fieldValue(fiesta, 'offer')),
    augmentPending: fieldNumber(fiesta, 'augmentPending') ?? 0,
    scoreboard: sided(
      team,
      fiestaScores(fieldArray(fiesta, 'teamA')),
      fiestaScores(fieldArray(fiesta, 'teamB')),
    ),
    powerups: powerupsOf(fieldArray(fiesta, 'powerups')),
  };
}

function yumiScores(rows: readonly unknown[]): readonly YumiScore[] {
  return rows.map((row) => ({
    pid: fieldNumber(row, 'pid') ?? 0,
    name: fieldString(row, 'name') ?? '',
    cls: fieldString(row, 'cls') ?? '',
    kills: fieldNumber(row, 'kills') ?? 0,
    deaths: fieldNumber(row, 'deaths') ?? 0,
    down: fieldValue(row, 'down') === true,
  }));
}

/**
 * One cat. `alive` is the server's flag, never inferred: a missing cat is sent as 0 health at
 * the world origin.
 */
function catOf(cat: unknown): YumiCat {
  return {
    entityId: fieldNumber(cat, 'entityId') ?? 0,
    hp: fieldNumber(cat, 'hp') ?? 0,
    maxHp: fieldNumber(cat, 'maxHp') ?? 0,
    x: fieldNumber(cat, 'x') ?? 0,
    z: fieldNumber(cat, 'z') ?? 0,
    alive: fieldValue(cat, 'alive') === true,
  };
}

function sizeOf(size: number | null): YumiMatch['size'] {
  if (size === LARGE_YUMI_SIZE) {
    return LARGE_YUMI_SIZE;
  }
  return SMALL_YUMI_SIZE;
}

/**
 * A Protect Yumi bout, or null when the record is absent. `suddenDeath` is the one bit of the
 * wire's `phase` that `state` does not already carry.
 */
function yumiOf(yumi: unknown, base: BoutBase, format: YumiMatch['format']): YumiMatch | null {
  if (yumi === null) {
    return null;
  }
  const team = fieldString(yumi, 'team');
  return {
    ...base,
    format,
    size: sizeOf(fieldNumber(yumi, 'size')),
    suddenDeath: fieldString(yumi, 'phase') === 'sudden',
    matchElapsed: fieldNumber(yumi, 'matchElapsed') ?? 0,
    teleportIn: fieldNumber(yumi, 'teleportIn') ?? 0,
    suddenDeathIn: fieldNumber(yumi, 'suddenDeathIn') ?? 0,
    damageTakenMult: fieldNumber(yumi, 'damageTakenMult') ?? 1,
    down: fieldValue(yumi, 'down') === true,
    respawnIn: fieldNumber(yumi, 'respawnIn') ?? 0,
    cats: sided(team, catOf(fieldValue(yumi, 'yumiA')), catOf(fieldValue(yumi, 'yumiB'))),
    scoreboard: sided(
      team,
      yumiScores(fieldArray(yumi, 'teamA')),
      yumiScores(fieldArray(yumi, 'teamB')),
    ),
  };
}

export type {
  AugmentOffer,
  FiestaMatch,
  FiestaPowerup,
  FiestaScore,
  YumiCat,
  YumiMatch,
  YumiScore,
};
export { fiestaOf, yumiOf };
