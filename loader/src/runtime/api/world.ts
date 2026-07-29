// The woc.world surface handed to addons. Mirrors packages/types/world.d.ts.
//
// A facade over a pluggable backend, never over __game directly. Backend A reads
// the live IWorld and is the only one built; if the game ever drops that hook, a
// backend rebuilt from snap frames slots in here and addon code does not change.
//
// Every read is typed against `world/game-types.ts`, which is a claim about the
// game rather than a compiled fact. `world/shape.ts` is what keeps the claim
// honest, and the hub runs it once when the world goes live.

import type { DisposalBag } from '../disposal.ts';
import type { Unsubscribe } from '../net/bus.ts';
import type { WorldBackend } from '../world/backend.ts';
import type {
  Aura,
  Entity,
  InvSlot,
  PartyInfo,
  WorldQuests,
  WorldValues,
} from '../world/game-types.ts';
import type { WorldHub } from '../world/hub.ts';
import { readonlyMapView } from '../world/readonly-map.ts';
import { isWorldKey, WORLD_KEYS, type WorldKey } from '../world/signature.ts';

/**
 * The roster before the game exists.
 *
 * A read-only view rather than a bare Map, and built per read rather than
 * shared. A bare Map would break the published contract for the whole window
 * between an addon's first line and world entry, so `entities.clear()` would
 * throw after entry and quietly succeed before it. Sharing one would be worse:
 * a write from one addon would land in what every other addon reads.
 */
function emptyEntities(): ReadonlyMap<number, Entity> {
  return readonlyMapView(new Map<number, Entity>());
}

/** Every read answers null before the game exists, rather than throwing at an addon. */
function fromBackend<T>(hub: WorldHub, read: (backend: WorldBackend) => T | null): T | null {
  const backend = hub.backend();
  if (backend === null) {
    return null;
  }
  return read(backend);
}

export interface WorldApi {
  readonly ready: Promise<void>;
  readonly player: Entity | null;
  readonly target: Entity | null;
  readonly entities: ReadonlyMap<number, Entity>;
  readonly party: PartyInfo | null;
  readonly inventory: readonly InvSlot[] | null;
  readonly quests: WorldQuests | null;
  readonly cooldowns: ReadonlyMap<string, number> | null;
  readonly auras: readonly Aura[] | null;

  /**
   * Watch one key for change, sampled once per animation frame.
   *
   * The handler's argument is typed from the key, so `world.on('cooldowns', ...)`
   * receives the cooldown map rather than a value the addon narrows itself.
   */
  on: <K extends WorldKey>(key: K, handler: (value: WorldValues[K]) => void) => Unsubscribe;

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

    get player(): Entity | null {
      return fromBackend(hub, (backend) => backend.player);
    },

    get target(): Entity | null {
      return fromBackend(hub, (backend) => backend.target);
    },

    get entities(): ReadonlyMap<number, Entity> {
      const backend = hub.backend();
      if (backend === null) {
        return emptyEntities();
      }
      return backend.entities;
    },

    get party(): PartyInfo | null {
      return fromBackend(hub, (backend) => backend.party);
    },

    get inventory(): readonly InvSlot[] | null {
      return fromBackend(hub, (backend) => backend.inventory);
    },

    get quests(): WorldQuests | null {
      return fromBackend(hub, (backend) => backend.quests);
    },

    get cooldowns(): ReadonlyMap<string, number> | null {
      return fromBackend(hub, (backend) => backend.cooldowns);
    },

    get auras(): readonly Aura[] | null {
      return fromBackend(hub, (backend) => backend.auras);
    },

    on: (key, handler) => {
      if (!isWorldKey(key)) {
        throw new Error(`world.on: unknown key '${key}'. Known keys: ${WORLD_KEYS.join(', ')}`);
      }
      // The watcher samples the one key it was given and dispatches what the
      // backend read answered, which is this key's value by construction.
      const off = hub.watcher.on(key, handler as (value: unknown) => void);
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
