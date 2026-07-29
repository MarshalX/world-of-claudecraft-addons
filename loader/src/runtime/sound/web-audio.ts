// The one file that knows what an AudioContext is.
//
// The loader owns its own context rather than reaching into the game's audio
// engine: `__game` exposes no mixer, and borrowing one would put addon sound on
// a graph the game reconfigures. The coupling to the game is one-way and is a
// single number, the SFX slider (see volume.ts).
//
// The context is created on first use, not at boot. Constructing one costs an
// audio thread, and a session where no addon ever plays a cue should not pay it.

import type { AudioSink } from './engine.ts';

/** Where the sink's output sits before the destination, so one node carries gain. */
interface LazyContext {
  ctx: AudioContext;
}

function createWebAudioSink(): AudioSink {
  let lazy: LazyContext | null = null;

  const context = (): AudioContext => {
    if (lazy === null) {
      lazy = { ctx: new AudioContext() };
    }
    return lazy.ctx;
  };

  return {
    // Answered without constructing anything: the engine asks on every play, and
    // a context that does not exist yet is exactly a context that is not running.
    running: () => lazy?.ctx.state === 'running',

    resume: async () => {
      await context().resume();
    },

    // decodeAudioData detaches the ArrayBuffer it is given, which is why each
    // fetch produces its own rather than a shared view.
    decode: (bytes) => context().decodeAudioData(bytes),

    start: (buffer, gain, rate) => {
      const ctx = context();
      const source = ctx.createBufferSource();
      source.buffer = buffer as AudioBuffer;
      source.playbackRate.value = rate;

      const volume = ctx.createGain();
      volume.gain.value = gain;

      source.connect(volume);
      volume.connect(ctx.destination);
      // Disconnected on end, so a session that plays thousands of cues does not
      // accumulate a graph node for each one.
      source.onended = (): void => {
        source.disconnect();
        volume.disconnect();
      };
      source.start();
    },

    close: () => {
      const open = lazy;
      lazy = null;
      open?.ctx.close().catch(() => undefined);
    },
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return await response.json();
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return await response.arrayBuffer();
}

export type { DecodedAudio } from './engine.ts';
export { createWebAudioSink, fetchBytes, fetchJson };
