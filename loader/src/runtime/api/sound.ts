// The woc.sound surface, mirroring packages/types/sound.d.ts: a per-addon facade over one engine.
// Disable stops new cues and lets a sounding one finish, since a cut mid-waveform clicks.

import type { DisposalBag } from '../disposal.ts';
import type { PlayOpts, SoundEngine } from '../sound/engine.ts';

/** A neutral attention chime, the game's own ready-check cue. */
const ALERT_CUE = 'ui_ready_check';

interface SoundApi {
  play: (cue: string, opts?: PlayOpts) => void;
  /** Play the loader's standard attention cue. */
  alert: (opts?: PlayOpts) => void;
  /** Every cue the deployed game ships, sorted; empty until the pack loads. */
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
