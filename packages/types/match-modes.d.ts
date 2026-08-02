// The two unranked bout formats, split from `match.d.ts` by subject.
//
// Fiesta and Protect Yumi each carry a scoreboard, a clock and their own
// objectives. The split is the one `ui.d.ts` already established: by subject,
// with the split visible in the import rather than hidden behind a barrel.

import type { BoutBase } from './match.js';

/** One fighter's line on a Fiesta scoreboard. */
export interface FiestaScore {
  pid: number;
  name: string;
  cls: string;
  kills: number;
  /** Benched, awaiting respawn. */
  down: boolean;
}

/** A pending augment pick. */
export interface AugmentOffer {
  tier: 'silver' | 'gold' | 'prismatic';
  wave: number;
  /** Augment ids. Nothing on this API resolves one to a name. */
  choices: readonly string[];
}

/** A ring power-up, in world coordinates. */
export interface FiestaPowerup {
  id: number;
  /** The catalogue id, such as 'haste'. */
  defId: string;
  x: number;
  z: number;
  state: 'spawning' | 'ready';
  /**
   * TWO quantities behind one name, and the game's own type says so.
   *
   * While `state` is 'spawning' it RISES from 0 to 1 as the telegraph fills.
   * While `state` is 'ready' it FALLS from 1 to 0 as the power-up expires. A
   * display that treats it as one direction draws the telegraph backwards.
   */
  frac: number;
  /** The game's own orb colour, as a 24-bit RGB integer. */
  color: number;
}

/** A Fiesta bout: waves, augments, a shrinking ring and a kill race. */
export interface FiestaMatch extends BoutBase {
  format: 'fiesta';
  /** Your team's tally, against `theirScore` and `scoreLimit`. */
  myScore: number;
  theirScore: number;
  scoreLimit: number;
  wave: number;
  /** A constant on the server, not a per-match figure. */
  totalWaves: number;
  /** The hazard ring, in world coordinates. There is no y: ground height is not sent. */
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
export interface YumiScore {
  pid: number;
  name: string;
  cls: string;
  kills: number;
  deaths: number;
  down: boolean;
}

/**
 * One objective cat.
 *
 * Sent for BOTH cats whether or not either is near you, on the game's stated
 * fairness rule: enemy objective health is actionable and is never hidden. So an
 * objective display is complete rather than approximate.
 *
 * `hp`, `x` and `z` are AS OF THE LAST ARENA SEND, up to ten seconds ago. The
 * live paths are `net.onEvent('yumiStatus')`, a once-a-second heartbeat carrying
 * both cats' health, and `net.onEvent('yumiTeleport')`, which carries the new
 * position. The game's own renderer overrides this reading from those events, so
 * a health bar drawn from this alone reads stale beside the game's. A dead or
 * missing cat reports `alive: false` with `hp` 0 at the origin, which is "no
 * cat" and not a cat standing at 0, 0.
 */
export interface YumiCat {
  entityId: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  alive: boolean;
}

/** A Protect Yumi bout: two objective cats, timed teleports and a bleed ramp. */
export interface YumiMatch extends BoutBase {
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
