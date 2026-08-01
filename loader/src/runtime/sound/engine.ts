// Cue playback: the pack, the buffer cache, the cooldowns, and the gain math.
//
// Everything here is host-agnostic and drives an AudioSink, so the decisions a
// player notices (a cue is not machine-gunned by a 20 Hz handler, the slider is
// respected, a variant family sounds varied) are decided somewhere a Node test
// can reach. web-audio.ts is the only file that knows what an AudioContext is.

import { diagError } from '../../shared/diag.ts';
import type { Teardown } from '../disposal.ts';
import { fallbackCueUrl, fetchSoundPack, type SoundClip, type SoundPack } from './pack.ts';

/**
 * The floor between two plays of the same cue.
 *
 * `net.on('snap')` fires 20 times a second, and an addon that plays a cue from
 * one is the obvious thing to write. Without a floor that is 20 overlapping
 * copies a second, which is not a sound, it is a noise. 120 ms is short enough
 * that a deliberate rapid cue still reads as rapid.
 */
const DEFAULT_COOLDOWN_MS = 120;

const DEFAULT_VOLUME = 1;
const MIN_GAIN = 0;
const MAX_ADDON_VOLUME = 1;

/** What an unlisted cue is assumed to be tuned at, having no pack entry to say. */
const UNTUNED_GAIN = 1;
const UNTUNED_RATE = 1;

/** What a decoded buffer is to this module: something the sink handed back. */
type DecodedAudio = unknown;

interface AudioSink {
  /**
   * Whether output is actually flowing.
   *
   * A boolean rather than the context's own state, because that state has four
   * values and only one of them means "will be heard": browsers start
   * `suspended` until a user gesture, and iOS moves to `interrupted` for a phone
   * call. Every not-running case is handled the same way, so naming them here
   * would only invite a check that forgets one.
   */
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
  /**
   * Start reading the pack without waiting for it.
   *
   * For a caller that knows a cue is coming but is not playing one yet, which is
   * what an addon declaring the `sound` permission is telling the loader. Without
   * it the read starts on the first `play`, and that cue takes the fallback URL.
   */
  warm: () => void;
  play: (cue: string, opts?: PlayOpts) => void;
  preload: (cues: readonly string[]) => Promise<void>;
  /** Resume the sink on the first user gesture. Returns the listener teardown. */
  arm: (target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>) => Teardown;
  dispose: () => void;
}

const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Captured, so a game handler calling stopPropagation cannot cost the loader the
 * one gesture it needs to start audio at all.
 *
 * The OBJECT form, never the boolean shorthand. Node's EventTarget accepts a
 * boolean on addEventListener and then ignores it on removeEventListener, so the
 * shorthand leaves the listener attached and the teardown silently does nothing.
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
          // Dropped from the cache so a transient failure can be retried, rather
          // than poisoning the cue for the rest of the session.
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

/**
 * The engine's mutable state.
 *
 * Held in one record rather than in closure variables so the play path is a
 * plain function a reader can follow top to bottom, and so `disposed` keeps its
 * declared `boolean` type across the awaits that have to re-check it.
 */
interface EngineState {
  pack: SoundPack;
  disposed: boolean;
  readonly lastPlayed: Map<string, number>;
  readonly buffers: BufferCache;
  /** The one pack read, started by whoever needs it first. Null until then. */
  loading: Promise<void> | null;
}

/**
 * Start the pack read, or hand back the one already running.
 *
 * The pack is 119 kB and used to be fetched when the engine was BUILT, which is at
 * loader boot, so every page load paid for it whether or not a single installed
 * addon ever played a cue. It is content the game serves for its own audio, and
 * fetching it alongside the game's own boot assets is a request the player waits
 * behind for something most sessions never use.
 *
 * The read reports its own failures and resolves with an empty pack, so there is
 * nothing here to reject and a failed read is not retried: a second attempt would
 * fetch the same missing file again on the next cue, and the fallback path already
 * covers the case.
 */
function startPack(deps: Pick<SoundEngineDeps, 'fetchJson'>, state: EngineState): void {
  state.loading ??= fetchSoundPack(deps.fetchJson).then((pack) => {
    state.pack = pack;
  });
}

/** The same read, for a caller that has to wait for it. */
function ensurePack(deps: Pick<SoundEngineDeps, 'fetchJson'>, state: EngineState): Promise<void> {
  startPack(deps, state);
  // `startPack` always leaves one behind. The coalesce is for the type alone.
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

  // A sound requested before the player has clicked anything is dropped
  // rather than queued: a suspended context does not discard what was
  // started on it, so queueing means every dropped cue fires at once the
  // moment the player finally clicks.
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
      // Re-checked after the await: the addon may have been disabled while
      // its first play of a cue was still fetching.
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
      // Answers what is known NOW, as it always has, and starts the read so the
      // next call can answer properly. An addon listing cues before the pack has
      // landed got an empty array before this was lazy too.
      startPack(deps, state);
      return [...state.pack.keys()].sort();
    },

    ready: () => ensurePack(deps, state),

    warm: () => {
      startPack(deps, state);
    },

    play: (cue, opts) => {
      // Kicked off, never awaited. `play` has always been able to run before the
      // pack landed and falls back to a guessed URL when it does, so awaiting here
      // would change a cue that is merely untuned into one that is late. What keeps
      // that window small is `warm`, called when an addon declaring sound starts.
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
