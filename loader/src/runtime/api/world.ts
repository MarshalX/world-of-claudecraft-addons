// The woc.world surface handed to addons. Mirrors packages/types/world.d.ts.
//
// A facade over a pluggable backend, never over __game directly. Backend A reads
// the live IWorld and is the only one built; if the game ever drops that hook, a
// backend rebuilt from snap frames slots in here and addon code does not change.

import type { DisposalBag } from '../disposal.ts';
import type { Unsubscribe } from '../net/bus.ts';
import type { WorldBackend } from '../world/backend.ts';
import type { WorldHub } from '../world/hub.ts';
import { readonlyMapView } from '../world/readonly-map.ts';
import { isWorldKey, WORLD_KEYS } from '../world/signature.ts';

/**
 * The roster before the game exists.
 *
 * A read-only view rather than a bare Map, and built per read rather than
 * shared. A bare Map would break the published contract for the whole window
 * between an addon's first line and world entry, so `entities.clear()` would
 * throw after entry and quietly succeed before it. Sharing one would be worse:
 * a write from one addon would land in what every other addon reads.
 */
function emptyEntities(): ReadonlyMap<number, unknown> {
  return readonlyMapView(new Map<number, unknown>());
}

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
        return emptyEntities();
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
