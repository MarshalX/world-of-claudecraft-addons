// The woc.world surface, mirroring packages/types/world.d.ts. A facade over a pluggable backend,
// never over __game directly, so a backend rebuilt from snap frames could replace the live one.

import type { DisposalBag } from '../disposal.ts';
import { unlessFrozen } from '../freeze.ts';
import type { Unsubscribe } from '../net/bus.ts';
import type { AbilityIndex } from '../world/abilities.ts';
import type { ArenaStandings } from '../world/arena.ts';
import type { AuraQuery, PartyAuraQuery } from '../world/auras.ts';
import type { BankState } from '../world/bank.ts';
import type { BattlegroundStandings } from '../world/battleground.ts';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from '../world/character.ts';
import type { CombatState } from '../world/combat.ts';
import type { CivicService, Recipe, Station } from '../world/content.ts';
import type { EntityCast, Hazard } from '../world/derived.ts';
import type { EncounterInfo } from '../world/encounter.ts';
import { mergeLive } from '../world/facade.ts';
import type { FinderInfo, FinderListingRow } from '../world/finder.ts';
import type {
  Aura,
  Entity,
  EquipSlot,
  HeldSlot,
  InvSlot,
  Vec3,
  WorldQuests,
} from '../world/game-types.ts';
import type { CorpseView, DeathZone } from '../world/ground.ts';
import type { GroupInfo } from '../world/group.ts';
import type { WorldHub } from '../world/hub.ts';
import type { ItemInstance } from '../world/items.ts';
import type { MailState } from '../world/mail.ts';
import type { MarketState } from '../world/market.ts';
import type { MatchInfo } from '../world/match.ts';
import type { PartyInfo, PartyMemberAura } from '../world/party-types.ts';
import type { Reaction } from '../world/reaction.ts';
import { isWorldKey, WORLD_KEYS, type WorldKey } from '../world/signature.ts';
import type { ThreatTable } from '../world/threat.ts';
import type { UnitToken } from '../world/units.ts';
import type { WorldValues } from '../world/values.ts';
import type { VaultState } from '../world/vault.ts';
import { contentReads } from './world-content.ts';
import { economyReads } from './world-economy-reads.ts';
import { geometryReads, lookups } from './world-lookups.ts';
import {
  derivedReads,
  fromBackend,
  gameReads,
  groundReads,
  selfReads,
  socialReads,
} from './world-reads.ts';

/** Subscribing plus the two escape hatches. */
function controls(hub: WorldHub, bag: DisposalBag) {
  return {
    ready: hub.ready,

    on: <K extends WorldKey>(key: K, handler: (value: WorldValues[K]) => void): Unsubscribe => {
      if (!isWorldKey(key)) {
        throw new Error(`world.on: unknown key '${key}'. Known keys: ${WORLD_KEYS.join(', ')}`);
      }
      // Gate the handler, not the sampler: the baseline keeps moving while frozen, so a resume
      // does not fire every listener at once for stale changes.
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
  readonly inventory: readonly HeldSlot[] | null;
  /** Worn gear by slot, item ids only. An empty slot is absent. */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;
  /**
   * What is on your worn gear, sparse: an absent slot means nothing is on it. Untrimmed, unlike
   * `player.equippedInstances`, which is the projection everybody else receives.
   */
  readonly equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;
  /** An item id per equipped bag, null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;
  /** Total slots across the backpack and every equipped bag. */
  readonly bagCapacity: number | null;
  /** Money, in copper. */
  readonly copper: number | null;
  /** Localized zone name, never an id. */
  readonly zone: string | null;
  /** The key `woc.storage.character` files under. Opaque; null before world entry. */
  readonly characterKey: string | null;
  /** Who this session is spectating, or null. Non-null means `player` is somebody else. */
  readonly spectating: string | null;
  /** Null is "nobody said" and 1 is a real reading; see `world/movement.ts`. */
  readonly moveSpeedMult: number | null;
  readonly character: CharacterInfo | null;
  readonly talents: TalentInfo | null;
  readonly professions: ProfessionInfo | null;
  readonly group: GroupInfo | null;
  readonly encounter: EncounterInfo | null;
  /**
   * The bout you are in, discriminated on `format`. Cadence is per format: the four arena formats
   * are up to ten seconds old, gated at 0.1 Hz on the server.
   */
  readonly match: MatchInfo | null;
  /** Present for every character; only the two ranked brackets mean anything. */
  readonly arena: ArenaStandings | null;
  /** Present for every character; the match itself is `match` with `format: 'battleground'`. */
  readonly battleground: BattlegroundStandings | null;
  readonly finder: FinderInfo | null;
  /** Realm-shared and capped by the server, or null before the first sync. */
  readonly finderBoard: readonly FinderListingRow[] | null;
  threat: (entityId: number) => ThreatTable;
  /** Side from the bout: `entity.hostile` is false on every player. See `world/reaction.ts`. */
  reaction: (entityId: number) => Reaction | null;
  readonly quests: WorldQuests | null;
  readonly cooldowns: ReadonlyMap<string, number> | null;
  readonly auras: readonly Aura[] | null;
  readonly casts: ReadonlyMap<number, EntityCast>;
  readonly targetAuras: readonly Aura[] | null;
  readonly hazards: readonly Hazard[] | null;
  readonly markers: ReadonlyMap<number, number> | null;
  /**
   * Rift boss-floor rings, mirrored from spawn events, so a zone placed before you came into range
   * is missing. Unlike `hazards`, which ride the snapshot.
   */
  readonly deathZones: readonly DeathZone[] | null;
  /** Never null. Watch this, not `entities`, for a corpse becoming lootable. */
  readonly corpses: ReadonlyMap<number, CorpseView>;
  /** Per player; a node with no entry is ready. */
  readonly nodeCooldowns: ReadonlyMap<string, number> | null;
  /** Your own body while a ghost. The server sends nobody else's. */
  readonly corpse: Vec3 | null;
  /** Filtered to what you could take; `Entity.loot` is the unfiltered list. */
  corpseLoot: (entityId: number) => CorpseView | null;
  /** Never null: read `status` first, since "matched nothing" and "not there" differ. */
  readonly market: MarketState;
  /** Ungated badge, readable anywhere. */
  readonly marketCollectPending: boolean | null;
  readonly mail: MailState;
  /** Ungated badge. Do not derive it from `mail.unread` or the reverse. */
  readonly mailUnread: number | null;
  readonly bank: BankState;
  readonly vault: VaultState;
  /** Null means an instance refuses the draw; an empty record is a real answer. */
  readonly craftVaultStock: Readonly<Record<string, number>> | null;
  /** Most recent first. Ungated. */
  readonly buyback: readonly InvSlot[] | null;
  /** The player's own spellbook, by id and display name. A mob's ability is not in it. */
  readonly abilities: AbilityIndex;
  /** Derived; `world/combat.ts` holds the order the signals are consulted in. */
  readonly combat: CombatState;
  /** `targettarget` reads the field the target's kind fills: a mob never carries `targetId`. */
  unit: (token: UnitToken) => Entity | null;
  aurasOn: (token: UnitToken, query?: AuraQuery) => readonly Aura[];
  /** A party row's strip carries no source. */
  partyAuras: (pid: number, query?: PartyAuraQuery) => readonly PartyMemberAura[];
  /** A function because the auras handed over are the game's own objects, not copies. */
  harmful: (aura: Aura | PartyMemberAura) => boolean;
  /** Full auras only; a party row cannot answer. */
  dispellable: (aura: Aura, offensive?: boolean) => boolean;
  /** Whether an effect is a mode, so its `remaining` and `duration` mean nothing. */
  toggle: (aura: Pick<Aura, 'id' | 'kind'>) => boolean;
  /** Flat yards, ignoring height. */
  distanceTo: (at: { x: number; z: number }) => number | null;
  /** Degrees clockwise from facing, -180 <= turn < 180, the convention `fmt.compass` takes. */
  bearingTo: (at: { x: number; z: number }) => number | null;
  /**
   * Static, so it must never get a watch key: a signature would walk every recipe per snapshot.
   * What changes is on `professions`.
   */
  readonly recipes: readonly Recipe[];
  readonly stations: readonly Station[];
  /** Where a counter is. Whether the player stands at one is `mail`. */
  readonly civicServices: readonly CivicService[];
  /** Sampled once per animation frame. */
  on: <K extends WorldKey>(key: K, handler: (value: WorldValues[K]) => void) => Unsubscribe;
  /** The game's own objects, unstable by definition. The manager flags an addon that reads one. */
  readonly raw: unknown;
  readonly game: unknown;
}

export function createWorld(hub: WorldHub, bag: DisposalBag): WorldApi {
  return mergeLive(
    mergeLive(
      mergeLive(gameReads(hub), mergeLive(selfReads(hub), derivedReads(hub))),
      mergeLive(groundReads(hub), socialReads(hub)),
    ),
    mergeLive(
      mergeLive(economyReads(hub), contentReads(hub)),
      mergeLive(mergeLive(lookups(hub), geometryReads(hub)), controls(hub, bag)),
    ),
  );
}
