// Derived change events over the world backend.
//
// Nothing in the game announces that state moved, so the only honest way to
// offer world.on is to sample and compare. The sampler runs on animation frames
// rather than on snapshots: it must work in offline play too, and a change an
// addon cannot paint before the next frame is not one worth waking it for.
//
// It runs only while something is subscribed, so an addon that never calls
// world.on costs nothing at all.

import type { WorldBackend } from './backend.ts';
import { type Capture, capture, sameCapture, type WorldKey } from './signature.ts';

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
  onError: (key: WorldKey, err: unknown) => void;
}

export interface WorldWatcher {
  on: (key: WorldKey, listener: Listener) => () => void;
  /** Sample once and dispatch. Exposed so a test drives it without a frame clock. */
  poll: () => void;
  dispose: () => void;
}

export function createWorldWatcher(deps: WatchDeps): WorldWatcher {
  const state: WatchState = { listeners: new Map(), last: new Map(), deps };
  let frame: number | null = null;

  const stop = (): void => {
    if (frame !== null) {
      deps.cancel(frame);
      frame = null;
    }
  };

  const tick = (): void => {
    sample(state);
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
