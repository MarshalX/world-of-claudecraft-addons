// Cue playback: the pack, the buffer cache, the cooldowns and the gain math. Host-agnostic over an
// AudioSink so a Node test reaches it; web-audio.ts is the only file that knows an AudioContext.

import { diagError } from '../../shared/diag.ts';
import type { Teardown } from '../disposal.ts';
import { fallbackCueUrl, fetchSoundPack, type SoundClip, type SoundPack } from './pack.ts';

/** The floor between two plays of one cue, so one played from a 20 Hz snap handler is not noise. */
const DEFAULT_COOLDOWN_MS = 120;

const DEFAULT_VOLUME = 1;
const MIN_GAIN = 0;
const MAX_ADDON_VOLUME = 1;

/** The tuning assumed for a cue the pack does not list. */
const UNTUNED_GAIN = 1;
const UNTUNED_RATE = 1;

type DecodedAudio = unknown;

interface AudioSink {
  /** A boolean, not the context state: of its four values only `running` will be heard. */
  running: () => boolean;
  resume: () => Promise<void>;
  decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
  start: (buffer: DecodedAudio, gain: number, rate: number) => void;
  close: () => void;
}

interface SoundEngineDeps {
  sink: AudioSink;
  fetchJson: (url: string) => Promise<unknown>;
  fetchBytes: (url: string) => Promise<ArrayBuffer>;
  /** The player's SFX slider, 0 to 1. Read per play so the slider is live. */
  volume: () => number;
  /** Monotonic milliseconds, for cooldowns. */
  now: () => number;
  /** Which variant of a family cue to play, given how many there are. */
  pick: (count: number) => number;
}

interface PlayOpts {
  /** The addon's own 0 to 1 multiplier. */
  volume?: number;
  rate?: number;
  /** Milliseconds before this cue may play again. */
  cooldown?: number;
}

interface SoundEngine {
  /** Empty until the pack has loaded. */
  cues: () => string[];
  /** Reads the pack if nothing has yet, and resolves once it is in, failed or not. */
  ready: () => Promise<void>;
  /** Start the pack read without waiting, so the first `play` does not take the fallback URL. */
  warm: () => void;
  play: (cue: string, opts?: PlayOpts) => void;
  preload: (cues: readonly string[]) => Promise<void>;
  /** Resume the sink on the first user gesture. Returns the listener teardown. */
  arm: (target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>) => Teardown;
  dispose: () => void;
}

const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Captured, so a game stopPropagation cannot eat the gesture that starts audio. The object form:
 * Node's EventTarget ignores a boolean on removeEventListener, so the teardown would do nothing.
 */
const CAPTURE = { capture: true } as const;

function clampAddonVolume(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_VOLUME;
  }
  return Math.max(MIN_GAIN, Math.min(MAX_ADDON_VOLUME, value));
}

function clampRate(value: number | undefined, clipRate: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return clipRate;
  }
  return value;
}

/** Pick a variant, defensively: `pick` is injected and a bad index would throw. */
function chooseVariant(clip: SoundClip, pick: (count: number) => number): string {
  const { variants } = clip;
  const index = pick(variants.length);
  if (Number.isInteger(index) && index >= 0 && index < variants.length) {
    return variants[index] as string;
  }
  return variants[0] as string;
}

interface BufferCache {
  /** Shared per URL, so two addons playing one cue at once fetch it once. */
  get: (url: string) => Promise<DecodedAudio>;
  clear: () => void;
}

function createBufferCache(deps: Pick<SoundEngineDeps, 'fetchBytes' | 'sink'>): BufferCache {
  const buffers = new Map<string, Promise<DecodedAudio>>();

  return {
    get: (url) => {
      const cached = buffers.get(url);
      if (cached !== undefined) {
        return cached;
      }
      const loading = deps
        .fetchBytes(url)
        .then((bytes) => deps.sink.decode(bytes))
        .catch((err: unknown) => {
          // Dropped so a transient failure is retried rather than poisoning the cue.
          buffers.delete(url);
          throw err;
        });
      buffers.set(url, loading);
      return loading;
    },

    clear: () => {
      buffers.clear();
    },
  };
}

/** One record, not closure variables, so `disposed` keeps its `boolean` type across awaits. */
interface EngineState {
  pack: SoundPack;
  disposed: boolean;
  readonly lastPlayed: Map<string, number>;
  readonly buffers: BufferCache;
  /** The one pack read, started by whoever needs it first. Null until then. */
  loading: Promise<void> | null;
}

/**
 * Start the pack read once, lazily: it is 119 kB and most sessions never play a cue. A failed read
 * resolves empty and is not retried; the fallback URL covers it.
 */
function startPack(deps: Pick<SoundEngineDeps, 'fetchJson'>, state: EngineState): void {
  state.loading ??= fetchSoundPack(deps.fetchJson).then((pack) => {
    state.pack = pack;
  });
}

/** The same read, for a caller that has to wait for it. */
function ensurePack(deps: Pick<SoundEngineDeps, 'fetchJson'>, state: EngineState): Promise<void> {
  startPack(deps, state);
  // The coalesce is for the type alone.
  return state.loading ?? Promise.resolve();
}

/** The pack's clip for a cue, or the degraded stand-in for one it does not list. */
function clipFor(state: EngineState, cue: string): SoundClip {
  return (
    state.pack.get(cue) ?? {
      variants: [fallbackCueUrl(cue)],
      gain: UNTUNED_GAIN,
      playbackRate: UNTUNED_RATE,
    }
  );
}

function playCue(deps: SoundEngineDeps, state: EngineState, cue: string, opts?: PlayOpts): void {
  if (state.disposed) {
    return;
  }

  const cooldown = opts?.cooldown ?? DEFAULT_COOLDOWN_MS;
  const at = deps.now();
  const previous = state.lastPlayed.get(cue);
  if (previous !== undefined && at - previous < cooldown) {
    return;
  }

  // Dropped, not queued: a suspended context keeps what was started on it, so every queued cue
  // would fire at once on the first click.
  if (!deps.sink.running()) {
    deps.sink.resume().catch(() => undefined);
    return;
  }

  state.lastPlayed.set(cue, at);

  const clip = clipFor(state, cue);
  const gain = clip.gain * deps.volume() * clampAddonVolume(opts?.volume);
  const rate = clampRate(opts?.rate, clip.playbackRate);
  state.buffers
    .get(chooseVariant(clip, deps.pick))
    .then((decoded) => {
      // Re-checked: the addon may have been disabled mid-fetch.
      if (!state.disposed) {
        deps.sink.start(decoded, gain, rate);
      }
    })
    .catch((err: unknown) => {
      diagError(`could not play the '${cue}' cue`, err);
    });
}

async function preloadCues(
  deps: SoundEngineDeps,
  state: EngineState,
  cues: readonly string[],
): Promise<void> {
  await Promise.all(
    cues.map(async (cue) => {
      // One unreachable cue must not fail a whole preload list.
      try {
        await state.buffers.get(chooseVariant(clipFor(state, cue), deps.pick));
      } catch (err) {
        diagError(`could not preload the '${cue}' cue`, err);
      }
    }),
  );
}

function armGesture(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  sink: AudioSink,
): Teardown {
  const onGesture = (): void => {
    sink.resume().catch((err: unknown) => {
      diagError('the audio context would not resume', err);
    });
    stop();
  };
  const stop = (): void => {
    for (const type of GESTURE_EVENTS) {
      target.removeEventListener(type, onGesture, CAPTURE);
    }
  };
  for (const type of GESTURE_EVENTS) {
    target.addEventListener(type, onGesture, CAPTURE);
  }
  return stop;
}

function createSoundEngine(deps: SoundEngineDeps): SoundEngine {
  const state: EngineState = {
    pack: new Map(),
    disposed: false,
    lastPlayed: new Map(),
    buffers: createBufferCache(deps),
    loading: null,
  };

  return {
    cues: () => {
      // Answers what is known now and starts the read for the next call.
      startPack(deps, state);
      return [...state.pack.keys()].sort();
    },

    ready: () => ensurePack(deps, state),

    warm: () => {
      startPack(deps, state);
    },

    play: (cue, opts) => {
      // Never awaited: before the pack lands, a cue plays untuned from a guessed URL, not late.
      startPack(deps, state);
      playCue(deps, state, cue, opts);
    },

    preload: async (cues) => {
      await ensurePack(deps, state);
      await preloadCues(deps, state, cues);
    },

    arm: (target) => armGesture(target, deps.sink),

    dispose: () => {
      state.disposed = true;
      state.buffers.clear();
      state.lastPlayed.clear();
      deps.sink.close();
    },
  };
}

export type { AudioSink, DecodedAudio, PlayOpts, SoundEngine, SoundEngineDeps };
export { createSoundEngine, DEFAULT_COOLDOWN_MS };
