// Derived change events over the world backend.
//
// Nothing in the game announces that state moved, so world.on samples and compares. It runs on
// animation frames (so offline play works too), only while something is subscribed, and
// throttled: the server sends 20 snapshots a second and a sample is not free.

import type { WorldBackend } from './backend.ts';
import { type Capture, capture, sameCapture, type WorldKey } from './signature.ts';

/**
 * The floor between samples, in milliseconds. Deliberately under the sim's 50 ms: the real
 * period is the floor rounded UP to a whole frame, so 50 would sample every 66 ms at 60 Hz.
 * `tests/world-watch-sampler.test.ts` holds the worst case below the sim interval.
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
  // Seed the baseline on subscribe, or the first sample would fire with no real change.
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
  /** Sample once and dispatch, ignoring the floor. Lets a test drive it without a frame clock. */
  poll: () => void;
  dispose: () => void;
}

export function createWorldWatcher(deps: WatchDeps): WorldWatcher {
  const state: WatchState = { listeners: new Map(), last: new Map(), deps };
  let frame: number | null = null;
  // Negative infinity, so the first frame after a subscribe samples immediately.
  let sampledAt = Number.NEGATIVE_INFINITY;

  const stop = (): void => {
    if (frame !== null) {
      deps.cancel(frame);
      frame = null;
    }
  };

  const tick = (): void => {
    const at = deps.now();
    // Stamped with the actual time, not advanced by the interval: a late frame leaves no backlog.
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

// Exported for the suite that checks the floor against real refresh rates.
export { SAMPLE_INTERVAL_MS };
