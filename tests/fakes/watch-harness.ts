// A world watcher over a backend whose reads follow a mutable object, the way
// the real one follows the game's live state.
//
// The frame clock is manual: the sampler schedules itself, so a real one would
// make every assertion a race.

import type { WorldBackend } from '../../loader/src/runtime/world/backend.ts';
import { createWorldWatcher, type WorldWatcher } from '../../loader/src/runtime/world/watch.ts';
import { PLAYER_ENTITY } from './frames.ts';

export interface WatchHarness {
  watcher: WorldWatcher;
  live: { player: Record<string, unknown>; entities: Map<number, unknown> };
  errors: unknown[];
  /** Frames currently scheduled. Zero means the sampler is not running. */
  frames: () => number;
  frame: () => void;
  /** Stands in for the game arriving or never having arrived. */
  setAttached: (on: boolean) => void;
}

export function watchHarness(): WatchHarness {
  const live = {
    player: { ...PLAYER_ENTITY } as Record<string, unknown>,
    entities: new Map<number, unknown>(),
  };
  let attached = true;
  const errors: unknown[] = [];
  const scheduled = new Map<number, () => void>();
  let nextFrame = 1;

  const backend = {
    kind: 'test',
    get player(): unknown {
      return live.player;
    },
    get target(): unknown {
      return null;
    },
    get entities(): ReadonlyMap<number, unknown> {
      return live.entities;
    },
    get party(): unknown {
      return null;
    },
    get inventory(): unknown {
      return null;
    },
    get quests(): { log: unknown; done: unknown } {
      return { log: null, done: null };
    },
    get cooldowns(): unknown {
      return null;
    },
    get auras(): unknown {
      return null;
    },
    raw: live,
  } satisfies WorldBackend;

  const readBackend = (): WorldBackend | null => {
    if (attached) {
      return backend;
    }
    return null;
  };

  const watcher = createWorldWatcher({
    backend: readBackend,
    schedule: (frame) => {
      const id = nextFrame;
      nextFrame += 1;
      scheduled.set(id, frame);
      return id;
    },
    cancel: (id) => {
      scheduled.delete(id);
    },
    onError: (_key, err) => errors.push(err),
  });

  return {
    watcher,
    live,
    errors,
    frames: () => scheduled.size,
    frame: () => {
      for (const run of [...scheduled.values()]) {
        scheduled.clear();
        run();
      }
    },
    setAttached: (on) => {
      attached = on;
    },
  };
}
