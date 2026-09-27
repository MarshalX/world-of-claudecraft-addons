// The plain state reads on `woc.world`. Every one is a GETTER, which is what keeps the surface live
// over objects the game mutates in place. Each answers null before the game exists.

import { type AbilityIndex, emptyAbilities } from '../world/abilities.ts';
import type { ArenaStandings } from '../world/arena.ts';
import type { WorldBackend } from '../world/backend.ts';
import type { BattlegroundStandings } from '../world/battleground.ts';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from '../world/character.ts';
import { type CombatState, OUT_OF_COMBAT } from '../world/combat.ts';
import type { EntityCast, Hazard } from '../world/derived.ts';
import type { EncounterInfo } from '../world/encounter.ts';
import type { FinderInfo, FinderListingRow } from '../world/finder.ts';
import type { Aura, Entity, EquipSlot, HeldSlot, Vec3, WorldQuests } from '../world/game-types.ts';
import type { CorpseView, DeathZone } from '../world/ground.ts';
import type { GroupInfo } from '../world/group.ts';
import type { WorldHub } from '../world/hub.ts';
import type { ItemInstance } from '../world/items.ts';
import type { MatchInfo } from '../world/match.ts';
import type { PartyInfo } from '../world/party-types.ts';
import { readonlyMapView } from '../world/readonly-map.ts';

/** A bare Map is fine here, unlike `entities`: it is built per read, so a write reaches nobody. */
function emptyCasts(): ReadonlyMap<number, EntityCast> {
  return new Map<number, EntityCast>();
}

/** No corpse in scope before the game exists. Built per read, like `emptyCasts`. */
function emptyCorpses(): ReadonlyMap<number, CorpseView> {
  return new Map<number, CorpseView>();
}

/**
 * A read-only view, so `entities.clear()` throws before world entry as it does after. Built per
 * read, since a shared one would carry one addon's write to the others.
 */
export function emptyEntities(): ReadonlyMap<number, Entity> {
  return readonlyMapView(new Map<number, Entity>());
}

/** Null before the game exists, rather than a throw. */
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

    get inventory(): readonly HeldSlot[] | null {
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

/** What rides the self payload: the player's own record, for nobody else. */
export function selfReads(hub: WorldHub) {
  return {
    get equipment(): Partial<Record<EquipSlot, string>> | null {
      return fromBackend(hub, (backend) => backend.equipment);
    },

    get equipmentInstances(): Partial<Record<EquipSlot, ItemInstance>> | null {
      return fromBackend(hub, (backend) => backend.equipmentInstances);
    },

    get characterKey(): string | null {
      return fromBackend(hub, (backend) => backend.characterKey);
    },

    get spectating(): string | null {
      return fromBackend(hub, (backend) => backend.spectating);
    },

    get moveSpeedMult(): number | null {
      return fromBackend(hub, (backend) => backend.moveSpeedMult);
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

/** The ground around the player, mirroring the group of the same name in the backend. */
export function groundReads(hub: WorldHub) {
  return {
    get hazards(): readonly Hazard[] | null {
      return fromBackend(hub, (backend) => backend.hazards);
    },

    get markers(): ReadonlyMap<number, number> | null {
      return fromBackend(hub, (backend) => backend.markers);
    },

    get deathZones(): readonly DeathZone[] | null {
      return fromBackend(hub, (backend) => backend.deathZones);
    },

    get corpses(): ReadonlyMap<number, CorpseView> {
      const backend = hub.backend();
      if (backend === null) {
        return emptyCorpses();
      }
      return backend.corpses;
    },

    get nodeCooldowns(): ReadonlyMap<string, number> | null {
      return fromBackend(hub, (backend) => backend.nodeCooldowns);
    },

    get corpse(): Vec3 | null {
      return fromBackend(hub, (backend) => backend.corpse);
    },
  };
}

/** What the player is currently IN. Its own group, mirroring `world/backend.ts`. */
export function socialReads(hub: WorldHub) {
  return {
    get match(): MatchInfo | null {
      return fromBackend(hub, (backend) => backend.match);
    },

    get arena(): ArenaStandings | null {
      return fromBackend(hub, (backend) => backend.arena);
    },

    get battleground(): BattlegroundStandings | null {
      return fromBackend(hub, (backend) => backend.battleground);
    },

    get finder(): FinderInfo | null {
      return fromBackend(hub, (backend) => backend.finder);
    },

    get finderBoard(): readonly FinderListingRow[] | null {
      return fromBackend(hub, (backend) => backend.finderBoard);
    },
  };
}
