// The one file that knows what an AudioContext is. The loader owns its context, since `__game`
// exposes no mixer. Created on first use: it costs an audio thread.

import type { AudioSink } from './engine.ts';

/** The context, once built. */
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
    // Answered without constructing one: an unbuilt context is not running.
    running: () => lazy?.ctx.state === 'running',

    resume: async () => {
      await context().resume();
    },

    // decodeAudioData detaches its ArrayBuffer, so each fetch produces its own.
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
      // Disconnected on end, so nodes do not accumulate per cue.
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
