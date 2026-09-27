import type { KnownCue } from './cues.generated.js';

/**
 * A sound cue.
 *
 * The known names come from the deployed game's own pack, so they autocomplete.
 * The union stays open because a game release adds cues before these types catch
 * up: a name this list lacks is legal and plays, and a name the game has retired
 * is a silent miss.
 */
export type Cue = KnownCue | (string & Record<never, never>);

export interface PlayOpts {
  /** Your own 0 to 1 multiplier, on top of the player's SFX slider. */
  volume?: number;
  rate?: number;
  /** Milliseconds before this cue may play again. Defaults to 120. */
  cooldown?: number;
}

export interface SoundApi {
  /**
   * Play one of the game's own cues, e.g. 'ui_click'.
   *
   * A cue is not a file: a numbered family such as 'combat_block' is one cue
   * with several variants, and playing it picks one the way the game does. Each
   * plays at the gain the game normalized that clip to, times the player's SFX
   * slider, times your `volume`.
   *
   * A cue requested before the player has interacted with the page is dropped,
   * not queued: a browser will not start audio until then.
   */
  play: (cue: Cue, opts?: PlayOpts) => void;
  /** The loader's standard attention chime. */
  alert: (opts?: PlayOpts) => void;
  /** Every cue the deployed game ships, sorted. Empty until the pack has loaded. */
  cues: () => readonly string[];
  /** Warm the buffer cache. One unreachable cue does not fail the list. */
  preload: (cues: readonly Cue[]) => Promise<void>;
}
