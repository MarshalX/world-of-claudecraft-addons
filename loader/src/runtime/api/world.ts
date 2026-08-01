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
import type { AbilityIndex } from '../world/abilities.ts';
import {
  type AuraQuery,
  filterAuras,
  filterPartyAuras,
  NO_ROWS,
  NONE,
  type PartyAuraQuery,
} from '../world/auras.ts';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from '../world/character.ts';
import type { CombatState } from '../world/combat.ts';
import type { EntityCast, Hazard } from '../world/derived.ts';
import type { EncounterInfo } from '../world/encounter.ts';
import { mergeLive } from '../world/facade.ts';
import type {
  Aura,
  Entity,
  EquipSlot,
  InvSlot,
  PartyInfo,
  PartyMemberAura,
  WorldQuests,
} from '../world/game-types.ts';
import type { GroupInfo } from '../world/group.ts';
import type { WorldHub } from '../world/hub.ts';
import { isWorldKey, WORLD_KEYS, type WorldKey } from '../world/signature.ts';
import { NO_THREAT, type ThreatTable } from '../world/threat.ts';
import { resolveUnit, type UnitContext, type UnitToken } from '../world/units.ts';
import type { WorldValues } from '../world/values.ts';
import { derivedReads, emptyEntities, fromBackend, gameReads, selfReads } from './world-reads.ts';

/** Null before world entry, which is the one case `mine` cannot be answered in. */
function playerIdOf(ctx: UnitContext): number | null {
  if (ctx.player === null) {
    return null;
  }
  return ctx.player.id;
}

/**
 * Everything that takes an argument: resolving a unit, and filtering its auras.
 *
 * These are lookups OVER the reads above rather than reads of their own, which
 * is why they are not world keys and cannot be subscribed to. Watch the key the
 * answer comes from (`target`, `party`, `auras`) and re-resolve in the handler.
 */
function lookups(hub: WorldHub) {
  const context = (): UnitContext => {
    const backend = hub.backend();
    return {
      player: backend?.player ?? null,
      target: backend?.target ?? null,
      entities: backend?.entities ?? emptyEntities(),
      party: backend?.party ?? null,
    };
  };

  return {
    unit: (token: string): Entity | null => resolveUnit(token, context()),

    aurasOn: (token: string, query: AuraQuery = {}): readonly Aura[] => {
      const ctx = context();
      const unit = resolveUnit(token, ctx);
      if (unit === null) {
        return NONE;
      }
      return filterAuras(unit.auras, query, playerIdOf(ctx));
    },

    threat: (entityId: number): ThreatTable => {
      const backend = hub.backend();
      if (backend === null) {
        return NO_THREAT;
      }
      return backend.threat(entityId);
    },

    partyAuras: (pid: number, query: PartyAuraQuery = {}): readonly PartyMemberAura[] => {
      const party = hub.backend()?.party;
      if (party === undefined || party === null) {
        return NO_ROWS;
      }
      const row = party.members.find((member) => member.pid === pid);
      return filterPartyAuras(row?.auras, query);
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
  /** Worn gear by slot, item ids only. A slot with nothing in it is absent. */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;
  /** The bag sockets: an item id per equipped bag, null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;
  /** Total slots across the backpack and every equipped bag. Derived from `bags`. */
  readonly bagCapacity: number | null;
  /** Money, in copper. */
  readonly copper: number | null;
  /** The zone name the game is displaying. Localized text, never an id. */
  readonly zone: string | null;
  /** Progression, deeds and titles. Null before world entry. */
  readonly character: CharacterInfo | null;
  readonly talents: TalentInfo | null;
  /** The two profession counter maps. See `world/character.ts` for what is left out. */
  readonly professions: ProfessionInfo | null;
  /** Loot rolls, master loot and raid lockouts. */
  readonly group: GroupInfo | null;
  /** The instanced run in progress, thin by design. */
  readonly encounter: EncounterInfo | null;

  /** One entity's hate table, sorted and measured against you. */
  threat: (entityId: number) => ThreatTable;
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
   * The entity a unit token names, or null.
   *
   * `targettarget` reads whichever field the target's kind actually fills, which
   * is the reason to use this rather than open-coding the lookup: a mob never
   * carries `targetId`.
   */
  unit: (token: UnitToken) => Entity | null;

  /** The matching effects on a unit, empty when it resolves to nothing. */
  aurasOn: (token: UnitToken, query?: AuraQuery) => readonly Aura[];

  /** The same over a party row's compact strip, which carries no source. */
  partyAuras: (pid: number, query?: PartyAuraQuery) => readonly PartyMemberAura[];

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
  return mergeLive(
    mergeLive(gameReads(hub), mergeLive(selfReads(hub), derivedReads(hub))),
    mergeLive(lookups(hub), controls(hub, bag)),
  );
}
