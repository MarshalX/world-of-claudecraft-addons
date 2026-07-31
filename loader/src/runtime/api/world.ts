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
import { unlessFrozen } from '../freeze.ts';
import type { Unsubscribe } from '../net/bus.ts';
import { type AbilityIndex, emptyAbilities } from '../world/abilities.ts';
import type { WorldBackend } from '../world/backend.ts';
import { type CombatState, OUT_OF_COMBAT } from '../world/combat.ts';
import type { EntityCast, Hazard } from '../world/derived.ts';
import { mergeLive } from '../world/facade.ts';
import type { Aura, Entity, InvSlot, PartyInfo, WorldQuests } from '../world/game-types.ts';
import type { WorldHub } from '../world/hub.ts';
import { readonlyMapView } from '../world/readonly-map.ts';
import { isWorldKey, WORLD_KEYS, type WorldKey } from '../world/signature.ts';
import type { WorldValues } from '../world/values.ts';

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

/**
 * No cast before the game exists.
 *
 * A bare Map is right here where it is wrong for `entities`: this one is built by
 * the loader on every read rather than being the game's own live collection, so a
 * write into it lands in something already discarded and cannot reach another
 * addon. It is not wrapped because wrapping every derived read would be a
 * per-frame allocation to guard a value nobody holds.
 */
function emptyCasts(): ReadonlyMap<number, EntityCast> {
  return new Map<number, EntityCast>();
}

/** Every read answers null before the game exists, rather than throwing at an addon. */
function fromBackend<T>(hub: WorldHub, read: (backend: WorldBackend) => T | null): T | null {
  const backend = hub.backend();
  if (backend === null) {
    return null;
  }
  return read(backend);
}

/** The reads that come straight off the backend, each null until the game is up. */
function gameReads(hub: WorldHub) {
  return {
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
  };
}

/** The reads the loader computes. See `world/derived.ts` for why each exists. */
function derivedReads(hub: WorldHub) {
  return {
    get casts(): ReadonlyMap<number, EntityCast> {
      const backend = hub.backend();
      if (backend === null) {
        return emptyCasts();
      }
      return backend.casts;
    },

    get targetAuras(): readonly Aura[] | null {
      return fromBackend(hub, (backend) => backend.targetAuras);
    },

    get hazards(): readonly Hazard[] | null {
      return fromBackend(hub, (backend) => backend.hazards);
    },

    get markers(): ReadonlyMap<number, number> | null {
      return fromBackend(hub, (backend) => backend.markers);
    },

    get abilities(): AbilityIndex {
      const backend = hub.backend();
      if (backend === null) {
        return emptyAbilities();
      }
      return backend.abilities;
    },

    get combat(): CombatState {
      const backend = hub.backend();
      if (backend === null) {
        return OUT_OF_COMBAT;
      }
      return backend.combat;
    },
  };
}

/** Subscribing, plus the two escape hatches. Everything that is not a state read. */
function controls(hub: WorldHub, bag: DisposalBag) {
  return {
    ready: hub.ready,

    on: <K extends WorldKey>(key: K, handler: (value: WorldValues[K]) => void): Unsubscribe => {
      if (!isWorldKey(key)) {
        throw new Error(`world.on: unknown key '${key}'. Known keys: ${WORLD_KEYS.join(', ')}`);
      }
      // The watcher samples the one key it was given and dispatches what the
      // backend read answered, which is this key's value by construction.
      //
      // Gated on the freeze switch here rather than by stopping the sampler,
      // which matters on resume: the watcher keeps taking its baseline while
      // frozen, so unfreezing reports the state as it is NOW instead of firing
      // every listener at once for changes the addon can no longer act on.
      const off = hub.watcher.on(key, unlessFrozen(handler as (value: unknown) => void));
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
  readonly casts: ReadonlyMap<number, EntityCast>;
  readonly targetAuras: readonly Aura[] | null;
  readonly hazards: readonly Hazard[] | null;
  readonly markers: ReadonlyMap<number, number> | null;
  /**
   * The player's own spellbook, with lookups by id and by display name.
   *
   * The bridge between an ability's id and the name combat events carry, which
   * nothing else on the surface provides. Covers the player's OWN kit, so a mob's
   * ability name is not in here.
   */
  readonly abilities: AbilityIndex;

  /**
   * Whether the player is fighting, and which signal answered.
   *
   * Derived: the game sends no combat flag on the self record, and the one that
   * exists on the client entity is never written. `world/combat.ts` holds the
   * order the signals are consulted in.
   */
  readonly combat: CombatState;

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
  return mergeLive(mergeLive(gameReads(hub), derivedReads(hub)), controls(hub, bag));
}
