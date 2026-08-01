// Derived change events over the world backend.
//
// Nothing in the game announces that state moved, so the only honest way to
// offer world.on is to sample and compare. The sampler runs on animation frames
// rather than on snapshots: it must work in offline play too, and a change an
// addon cannot paint before the next frame is not one worth waking it for.
//
// It runs only while something is subscribed, so an addon that never calls
// world.on costs nothing at all.
//
// It is also THROTTLED, because an animation frame is not what makes a value move.
// The server sends 20 snapshots a second and the loop runs at 60 or 120, so two of
// every three samples were guaranteed to find nothing, and a sample is not free: the
// `entities` signature allocates a Set of every entity id, and `casts` rebuilds a Map
// by walking every entity in interest scope before its signature sorts and joins
// strings over the result. See world/signature.ts and world/derived.ts.

import type { WorldBackend } from './backend.ts';
import { type Capture, capture, sameCapture, type WorldKey } from './signature.ts';

/**
 * The floor between samples, in milliseconds.
 *
 * Under the sim's own 50 ms, deliberately, because the sampler cannot sample at the
 * floor: it runs on animation frames, so the real period is the floor rounded UP to
 * the next whole frame, `ceil(floor / interval) * interval`. At 60 Hz a 25 ms floor
 * therefore samples every other frame, at 33 ms. Set to 50 to match the snapshot rate
 * it would land on every fourth frame and sit 66 ms behind, which is longer than the
 * gap it exists to track.
 *
 * A FASTER MONITOR IS THE BETTER CASE, not the worse one. The rounding is finer the
 * shorter the frame is, so 120 Hz lands on 25 ms exactly and reports a change sooner
 * than 60 Hz does, while the floor still caps the rate at about 40 samples a second
 * however fast the display runs. The worst case over every rate worth caring about is
 * 40 ms, at 50 Hz, and `tests/world-watch-sampler.test.ts` holds that below the sim
 * interval rather than leaving it as arithmetic in this comment. Below about 40 Hz
 * nothing is skipped at all and the frame rate is the sample rate.
 */
const SAMPLE_INTERVAL_MS = 25;

type Listener = (value: unknown) => void;

function read(backend: WorldBackend | null, key: WorldKey): unknown {
  if (backend === null) {
    return null;
  }
  return backend[key];
}

function dispatch(
  subs: ReadonlySet<Listener>,
  value: unknown,
  onError: (err: unknown) => void,
): void {
  for (const listener of [...subs]) {
    try {
      listener(value);
    } catch (err) {
      onError(err);
    }
  }
}

interface WatchState {
  listeners: Map<WorldKey, Set<Listener>>;
  last: Map<WorldKey, Capture>;
  deps: WatchDeps;
}

function sample(state: WatchState): void {
  for (const [key, subs] of state.listeners) {
    const value = read(state.deps.backend(), key);
    const next = capture(key, value);
    const prev = state.last.get(key);
    state.last.set(key, next);
    if (prev !== undefined && !sameCapture(prev, next)) {
      dispatch(subs, value, (err) => state.deps.onError(key, err));
    }
  }
}

function add(state: WatchState, key: WorldKey, listener: Listener): void {
  const subs = state.listeners.get(key) ?? new Set<Listener>();
  subs.add(listener);
  state.listeners.set(key, subs);
  // Seed the baseline on subscribe, so the first sample reports a real change
  // rather than firing once because nothing had been recorded yet.
  if (!state.last.has(key)) {
    state.last.set(key, capture(key, read(state.deps.backend(), key)));
  }
}

/** Returns whether that was the last listener, so the caller can stop sampling. */
function drop(state: WatchState, key: WorldKey, listener: Listener): boolean {
  const subs = state.listeners.get(key);
  if (subs !== undefined) {
    subs.delete(listener);
    if (subs.size === 0) {
      state.listeners.delete(key);
      state.last.delete(key);
    }
  }
  return state.listeners.size === 0;
}

export interface WatchDeps {
  /** Read on every sample: the backend does not exist until the game does. */
  backend: () => WorldBackend | null;
  schedule: (frame: () => void) => number;
  cancel: (id: number) => void;
  /** Monotonic milliseconds, for the sample floor. */
  now: () => number;
  onError: (key: WorldKey, err: unknown) => void;
}

export interface WorldWatcher {
  on: (key: WorldKey, listener: Listener) => () => void;
  /**
   * Sample once and dispatch, ignoring the floor.
   *
   * Exposed so a test drives it without a frame clock, and unthrottled because a
   * caller asking for a sample outright has already decided it wants one.
   */
  poll: () => void;
  dispose: () => void;
}

export function createWorldWatcher(deps: WatchDeps): WorldWatcher {
  const state: WatchState = { listeners: new Map(), last: new Map(), deps };
  let frame: number | null = null;
  // Negative infinity rather than the clock at construction, so the first frame
  // after a subscribe samples rather than waiting out an interval nobody was
  // watching for.
  let sampledAt = Number.NEGATIVE_INFINITY;

  const stop = (): void => {
    if (frame !== null) {
      deps.cancel(frame);
      frame = null;
    }
  };

  const tick = (): void => {
    const at = deps.now();
    // Stamped with the time the sample actually ran rather than advanced by the
    // interval, so a frame the browser delivered late cannot leave a backlog for the
    // next few frames to work off.
    if (at - sampledAt >= SAMPLE_INTERVAL_MS) {
      sampledAt = at;
      sample(state);
    }
    frame = null;
    if (state.listeners.size > 0) {
      frame = deps.schedule(tick);
    }
  };

  return {
    on: (key, listener) => {
      add(state, key, listener);
      if (frame === null) {
        frame = deps.schedule(tick);
      }
      return () => {
        if (drop(state, key, listener)) {
          stop();
        }
      };
    },

    poll: () => sample(state),

    dispose: () => {
      stop();
      state.listeners.clear();
      state.last.clear();
    },
  };
}

// Exported for the suite that holds the floor against real refresh rates, which is
// arithmetic over this number rather than something a frame clock can demonstrate.
export { SAMPLE_INTERVAL_MS };
