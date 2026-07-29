// A world watcher over a backend whose reads follow a mutable object, the way
// the real one follows the game's live state.
//
// The frame clock is manual: the sampler schedules itself, so a real one would
// make every assertion a race.

import type { WorldBackend } from '../../loader/src/runtime/world/backend.ts';
import type { Aura, Entity, WorldQuests } from '../../loader/src/runtime/world/game-types.ts';
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

  // `live` stays loose so a test can move one field at a time, including into a
  // shape the game would never produce, which is half of what these suites are
  // for. The backend asserts at its own boundary exactly as the real one does.
  const backend = {
    kind: 'test',
    get player(): Entity | null {
      return live.player as unknown as Entity;
    },
    get target(): Entity | null {
      return null;
    },
    get entities(): ReadonlyMap<number, Entity> {
      return live.entities as ReadonlyMap<number, Entity>;
    },
    get party(): null {
      return null;
    },
    get inventory(): null {
      return null;
    },
    get quests(): WorldQuests {
      return { log: null, done: null };
    },
    get cooldowns(): null {
      return null;
    },
    get auras(): readonly Aura[] | null {
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
