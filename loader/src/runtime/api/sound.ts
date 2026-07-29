// The woc.sound surface handed to addons. Mirrors packages/types/sound.d.ts.
//
// One engine and one AudioContext for the whole loader, with a per-addon facade
// over it: buffers are cached per cue and shared, so ten addons playing
// `ui_error` decode it once between them.
//
// Disabling an addon stops it starting new cues. Anything already sounding is
// allowed to finish rather than being cut: every cue is under two seconds, and
// a sample cut mid-waveform clicks, which is more noticeable than the sound the
// player was going to hear anyway.

import type { DisposalBag } from '../disposal.ts';
import type { PlayOpts, SoundEngine } from '../sound/engine.ts';

/** A neutral attention chime, the game's own ready-check cue. */
const ALERT_CUE = 'ui_ready_check';

interface SoundApi {
  play: (cue: string, opts?: PlayOpts) => void;
  /** Play the loader's standard attention cue. */
  alert: (opts?: PlayOpts) => void;
  /**
   * Every cue the deployed game ships, sorted. Empty until the pack has loaded.
   *
   * Readonly because that is what `packages/types` publishes to addon authors,
   * and the published surface is the contract. It is a fresh array per call, so
   * this costs nothing and only stops an addon sorting it in place and being
   * surprised on the next read.
   */
  cues: () => readonly string[];
  /** Warm the buffer cache. Resolves once the pack is read and each cue tried. */
  preload: (cues: readonly string[]) => Promise<void>;
}

function createSound(engine: SoundEngine, bag: DisposalBag): SoundApi {
  let live = true;
  bag.add(() => {
    live = false;
  });

  const play = (cue: string, opts?: PlayOpts): void => {
    if (live) {
      engine.play(cue, opts);
    }
  };

  return {
    play,
    alert: (opts) => {
      play(ALERT_CUE, opts);
    },
    cues: () => engine.cues(),
    preload: async (cues) => {
      if (live) {
        await engine.preload(cues);
      }
    },
  };
}

export type { SoundApi };
export { ALERT_CUE, createSound };
