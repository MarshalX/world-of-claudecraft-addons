// The plain state reads on `woc.world`, split from the facade that assembles them.
//
// Every one is a getter, and that is load-bearing: the game mutates its objects
// in place, so reading on access is what makes the surface live rather than a
// copy taken at assembly. Each answers null before the game exists, so an addon
// can hold `woc.world` from its first line without guarding every read.

import { type AbilityIndex, emptyAbilities } from '../world/abilities.ts';
import type { WorldBackend } from '../world/backend.ts';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from '../world/character.ts';
import { type CombatState, OUT_OF_COMBAT } from '../world/combat.ts';
import type { EntityCast, Hazard } from '../world/derived.ts';
import type { EncounterInfo } from '../world/encounter.ts';
import type {
  Aura,
  Entity,
  EquipSlot,
  InvSlot,
  PartyInfo,
  WorldQuests,
} from '../world/game-types.ts';
import type { GroupInfo } from '../world/group.ts';
import type { WorldHub } from '../world/hub.ts';
import { readonlyMapView } from '../world/readonly-map.ts';

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

/**
 * The roster before the game exists.
 *
 * A read-only view rather than a bare Map, and built per read rather than
 * shared. A bare Map would break the published contract for the whole window
 * between an addon's first line and world entry, so `entities.clear()` would
 * throw after entry and quietly succeed before it. Sharing one would be worse:
 * a write from one addon would land in what every other addon reads.
 */
export function emptyEntities(): ReadonlyMap<number, Entity> {
  return readonlyMapView(new Map<number, Entity>());
}

/** Every read answers null before the game exists, rather than throwing at an addon. */
export function fromBackend<T>(hub: WorldHub, read: (backend: WorldBackend) => T | null): T | null {
  const backend = hub.backend();
  if (backend === null) {
    return null;
  }
  return read(backend);
}

/** The reads that come straight off the backend, each null until the game is up. */
export function gameReads(hub: WorldHub) {
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

/**
 * What the player owns and who they are: their own record rather than the world.
 *
 * Its own group because `gameReads` outgrew a function body, and this is where
 * the seam falls: everything here rides the SELF payload, so it exists for the
 * player and for nobody else.
 */
export function selfReads(hub: WorldHub) {
  return {
    get equipment(): Partial<Record<EquipSlot, string>> | null {
      return fromBackend(hub, (backend) => backend.equipment);
    },

    get bags(): readonly (string | null)[] | null {
      return fromBackend(hub, (backend) => backend.bags);
    },

    get bagCapacity(): number | null {
      return fromBackend(hub, (backend) => backend.bagCapacity);
    },

    get copper(): number | null {
      return fromBackend(hub, (backend) => backend.copper);
    },

    get zone(): string | null {
      return fromBackend(hub, (backend) => backend.zone);
    },

    get character(): CharacterInfo | null {
      return fromBackend(hub, (backend) => backend.character);
    },

    get talents(): TalentInfo | null {
      return fromBackend(hub, (backend) => backend.talents);
    },

    get professions(): ProfessionInfo | null {
      return fromBackend(hub, (backend) => backend.professions);
    },

    get group(): GroupInfo | null {
      return fromBackend(hub, (backend) => backend.group);
    },

    get encounter(): EncounterInfo | null {
      return fromBackend(hub, (backend) => backend.encounter);
    },
  };
}

/** The reads the loader computes. See `world/derived.ts` for why each exists. */
export function derivedReads(hub: WorldHub) {
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
