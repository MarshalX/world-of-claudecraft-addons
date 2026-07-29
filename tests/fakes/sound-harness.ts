// A sound engine over a fake sink, a manual clock, and a scripted variant picker.
//
// Shared by the playback and lifecycle suites, which both need a whole engine
// rather than a stub: the cooldown, the gesture gate, and disposal are all
// engine state, so the only way to assert on them is to drive a real one. The
// clock is manual because the cooldown is the thing under test, and the picker
// is scripted because a variant chosen at random is not an assertion.

import {
  type AudioSink,
  createSoundEngine,
  type SoundEngine,
} from '../../loader/src/runtime/sound/engine.ts';

/** Trimmed from the real pack, keeping one single-variant and one family cue. */
export const PACK = {
  format: 'woc-sfx-runtime-pack',
  version: 1,
  // Built from entry pairs: cue names are the game's own and are not ours to
  // rename into camelCase.
  clips: Object.fromEntries([
    [
      'ui_click',
      { variants: [{ url: '/audio/sfx/ui_click.mp3?v=aabb' }], gain: 2, playbackRate: 1 },
    ],
    [
      'combat_block',
      {
        variants: [
          { url: '/audio/sfx/combat_block_1.mp3' },
          { url: '/audio/sfx/combat_block_2.mp3' },
          { url: '/audio/sfx/combat_block_3.mp3' },
        ],
        gain: 1,
        playbackRate: 1,
      },
    ],
  ]),
};

export interface Started {
  gain: number;
  rate: number;
  buffer: unknown;
}

export interface SoundHarnessOptions {
  running?: boolean;
  volume?: number;
  pack?: unknown;
  packFails?: boolean;
}

export interface SoundHarness {
  engine: SoundEngine;
  sink: AudioSink & { closed: boolean };
  /** Every cue the sink was asked to start, in order. */
  started: Started[];
  fetched: string[];
  advance: (ms: number) => void;
  suspend: () => void;
  /** Stands in for the random pick a family cue would otherwise make. */
  chooseVariant: (index: number) => void;
}

export function soundHarness(options?: SoundHarnessOptions): SoundHarness {
  const started: Started[] = [];
  const fetched: string[] = [];
  let running = options?.running !== false;
  let now = 0;
  let variant = 0;

  const sink: AudioSink & { closed: boolean } = {
    closed: false,
    running: () => running,
    resume: () => {
      running = true;
      return Promise.resolve();
    },
    decode: (bytes) => Promise.resolve({ decoded: bytes }),
    start: (buffer, gain, rate) => {
      started.push({ buffer, gain, rate });
    },
    close: () => {
      sink.closed = true;
    },
  };

  const engine = createSoundEngine({
    sink,
    fetchJson: () => {
      if (options?.packFails === true) {
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve(options?.pack ?? PACK);
    },
    fetchBytes: (url) => {
      fetched.push(url);
      return Promise.resolve(new ArrayBuffer(8));
    },
    volume: () => options?.volume ?? 1,
    now: () => now,
    pick: () => variant,
  });

  return {
    engine,
    sink,
    started,
    fetched,
    advance: (ms: number) => {
      now += ms;
    },
    suspend: () => {
      running = false;
    },
    chooseVariant: (index: number) => {
      variant = index;
    },
  };
}
