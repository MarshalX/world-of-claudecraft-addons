// The woc.world surface handed to addons. Mirrors packages/types/world.d.ts.
//
// A facade over a pluggable backend, never over __game directly. Backend A reads
// the live IWorld and is the only one built; if the game ever drops that hook, a
// backend rebuilt from snap frames slots in here and addon code does not change.

import type { DisposalBag } from '../disposal.ts';
import type { Unsubscribe } from '../net/bus.ts';
import type { WorldBackend } from '../world/backend.ts';
import type { WorldHub } from '../world/hub.ts';
import { isWorldKey, WORLD_KEYS } from '../world/signature.ts';

const EMPTY_ENTITIES: ReadonlyMap<number, unknown> = new Map<number, unknown>();

/** Every read answers null before the game exists, rather than throwing at an addon. */
function fromBackend(hub: WorldHub, read: (backend: WorldBackend) => unknown): unknown {
  const backend = hub.backend();
  if (backend === null) {
    return null;
  }
  return read(backend);
}

export interface WorldApi {
  readonly ready: Promise<void>;
  readonly player: unknown;
  readonly target: unknown;
  readonly entities: ReadonlyMap<number, unknown>;
  readonly party: unknown;
  readonly inventory: unknown;
  readonly quests: unknown;
  readonly cooldowns: unknown;
  readonly auras: unknown;
  on: (key: string, handler: (value: unknown) => void) => Unsubscribe;

  /**
   * The game's own objects. Unstable by definition: the game promises nothing
   * about them, and the manager flags an addon that reaches for one.
   */
  readonly raw: unknown;
  readonly game: unknown;
}

export function createWorld(hub: WorldHub, bag: DisposalBag): WorldApi {
  return {
    ready: hub.ready,

    get player(): unknown {
      return fromBackend(hub, (backend) => backend.player);
    },

    get target(): unknown {
      return fromBackend(hub, (backend) => backend.target);
    },

    get entities(): ReadonlyMap<number, unknown> {
      const backend = hub.backend();
      if (backend === null) {
        return EMPTY_ENTITIES;
      }
      return backend.entities;
    },

    get party(): unknown {
      return fromBackend(hub, (backend) => backend.party);
    },

    get inventory(): unknown {
      return fromBackend(hub, (backend) => backend.inventory);
    },

    get quests(): unknown {
      return fromBackend(hub, (backend) => backend.quests);
    },

    get cooldowns(): unknown {
      return fromBackend(hub, (backend) => backend.cooldowns);
    },

    get auras(): unknown {
      return fromBackend(hub, (backend) => backend.auras);
    },

    on: (key, handler) => {
      if (!isWorldKey(key)) {
        throw new Error(`world.on: unknown key '${key}'. Known keys: ${WORLD_KEYS.join(', ')}`);
      }
      const off = hub.watcher.on(key, handler);
      const drop = bag.add(off);
      return () => {
        drop();
        off();
      };
    },

    get raw(): unknown {
      return fromBackend(hub, (backend) => backend.raw);
    },

    get game(): unknown {
      return hub.game();
    },
  };
}
