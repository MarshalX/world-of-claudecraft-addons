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
import { contentReads } from './world-content.ts';
import { geometryReads, lookups } from './world-lookups.ts';
import {
  derivedReads,
  economyReads,
  fromBackend,
  gameReads,
  groundReads,
  selfReads,
  socialReads,
} from './world-reads.ts';

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
  readonly inventory: readonly HeldSlot[] | null;
  /** Worn gear by slot, item ids only. A slot with nothing in it is absent. */
  readonly equipment: Partial<Record<EquipSlot, string>> | null;
  /**
   * What is ON your worn gear: enchants, masterwork and rift rolls, signers.
   *
   * Keyed like `equipment` and sparse: a plain piece has no key, so an absent
   * slot means nothing is on it rather than nothing is worn. This is the
   * untrimmed payload, unlike `world.player.equippedInstances`, which is the
   * public projection the server sends about you to everybody else.
   */
  readonly equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;
  /** The bag sockets: an item id per equipped bag, null for an empty socket. */
  readonly bags: readonly (string | null)[] | null;
  /** Total slots across the backpack and every equipped bag. Derived from `bags`. */
  readonly bagCapacity: number | null;
  /** Money, in copper. */
  readonly copper: number | null;
  /** The zone name the game is displaying. Localized text, never an id. */
  readonly zone: string | null;
  /**
   * Who is playing, as the key per-character state is filed under.
   *
   * The value `woc.storage.character` derives its keys from, published so two
   * addons keeping their own per-character records cannot disagree about whose
   * they are. OPAQUE: do not parse it. Null before world entry.
   */
  readonly characterKey: string | null;
  /**
   * The character this session is watching, or null when it is watching itself.
   *
   * Non-null means `player` is somebody else, so anything filed under the
   * person at the keyboard has to stop while it is.
   */
  readonly spectating: string | null;
  /** Progression, deeds and titles. Null before world entry. */
  readonly character: CharacterInfo | null;
  readonly talents: TalentInfo | null;
  /** The two profession counter maps. See `world/character.ts` for what is left out. */
  readonly professions: ProfessionInfo | null;
  /** Loot rolls, master loot and raid lockouts. */
  readonly group: GroupInfo | null;
  /** The instanced run in progress, thin by design. */
  readonly encounter: EncounterInfo | null;

  /**
   * The competitive bout you are in, or null.
   *
   * One union over all seven formats, discriminated on `format`, so a display
   * asks what kind of bout this is rather than reading three unrelated members.
   * A duel is a member of it, and so is a battleground.
   *
   * THE CADENCE IS PER FORMAT. A duel rides every tick. A battleground rides at
   * 1 Hz and is forced fresh on every transition worth acting on. The four arena
   * formats are UP TO TEN SECONDS OLD, because that self key is gated to 0.1 Hz
   * on the server. That is the game's own cadence, so a Fiesta ring drawn from
   * this agrees with the ring the game draws; a Yumi health bar does not, and
   * the type says which events carry the live figures.
   */
  readonly match: MatchInfo | null;

  /**
   * Your competitive standings, your queue and the live ladders.
   *
   * Present for every character, so this being non-null says nothing about
   * whether you have ever played. Only the two ranked brackets mean anything:
   * the unranked three carry a copy of the 2v2 record and an empty ladder.
   */
  readonly arena: ArenaStandings | null;

  /**
   * Your battleground record, your queue and the live ladder.
   *
   * Present for every character, so this being non-null says nothing about
   * whether you have ever fought one. The match itself is the
   * `format: 'battleground'` member of `match` above; this is the standing that
   * outlives it.
   */
  readonly battleground: BattlegroundStandings | null;

  /** Your dungeon finder state. Present whether or not you are queued. */
  readonly finder: FinderInfo | null;

  /**
   * The realm's open premade listings, or null before the first sync.
   *
   * Realm-shared and capped by the server, so it is what is offered rather than
   * everything that exists.
   */
  readonly finderBoard: readonly FinderListingRow[] | null;

  /** One entity's hate table, sorted and measured against you. */
  threat: (entityId: number) => ThreatTable;
  /**
   * Which side one unit is on, from the bout rather than from `entity.hostile`.
   *
   * The flag is a mob's and is false on every player alive, so this is the only
   * honest answer for a player. See `world/reaction.ts`.
   */
  reaction: (entityId: number) => Reaction | null;
  readonly quests: WorldQuests | null;
  readonly cooldowns: ReadonlyMap<string, number> | null;
  readonly auras: readonly Aura[] | null;
  readonly casts: ReadonlyMap<number, EntityCast>;
  readonly targetAuras: readonly Aura[] | null;
  readonly hazards: readonly Hazard[] | null;
  readonly markers: ReadonlyMap<number, number> | null;

  /**
   * Lethal rings on a rift boss floor, or null outside one.
   *
   * NOT `hazards`, and the difference is worth knowing before you draw either. A
   * hazard's geometry rides the snapshot and is complete for everything near
   * you. A death zone is mirrored from a spawn event and counted down on your
   * own client, so a zone placed before you came into range is missing and stays
   * missing. The game's own rings have the same hole.
   */
  readonly deathZones: readonly DeathZone[] | null;

  /**
   * Every lootable corpse in scope, with what you could take off each.
   *
   * Never null, like `casts`: it is a reading the loader assembles rather than a
   * value the game hands over. Watch this rather than `entities` for a corpse
   * becoming lootable, which is a field change on an entity that already existed
   * and so is invisible to the entity set.
   */
  readonly corpses: ReadonlyMap<number, CorpseView>;

  /**
   * Gathering node id to seconds until YOU can harvest it again.
   *
   * Per player, so a node another player just took is still yours. A node with
   * no entry is ready.
   */
  readonly nodeCooldowns: ReadonlyMap<string, number> | null;

  /**
   * Where your own body lies while your spirit is a ghost, or null.
   *
   * Yours alone: the server sends it to you and to nobody else, so there is no
   * way to ask where another player's corpse is.
   */
  readonly corpse: Vec3 | null;

  /**
   * One corpse's contents, filtered to what YOU could take.
   *
   * The wire carries a corpse's whole contents to every player in range,
   * personal slots included, and the game's own loot window filters on read.
   * This applies the same filter, so it is what a loot display should use;
   * `Entity.loot` is the unfiltered list and shows people things they cannot
   * have.
   */
  corpseLoot: (entityId: number) => CorpseView | null;

  /**
   * The Merchant's book, one browsed page at a time, or why there is not one.
   *
   * Never null: read `status` first. `'near'` carries `info`; `'away'` and
   * `'unknown'` carry null and no page to reach for. The distinction is the
   * point of the shape, because "the filter matched nothing" and "you are not at
   * the Merchant" are opposite facts that a nullable value collapses into one.
   */
  readonly market: MarketState;

  /**
   * Whether gold or goods wait at the Merchant.
   *
   * Ungated, so it is readable anywhere in the world. This is the badge; the
   * page above is the pane.
   */
  readonly marketCollectPending: boolean | null;

  /** The mailbox, or why there is not one. Read `status` first, like `market`. */
  readonly mail: MailState;

  /**
   * Delivered letters you have not read.
   *
   * Ungated, so it is readable anywhere in the world. `world.mail` carries its
   * own `unread` over the same letters; that one is the mailbox pane's figure
   * and this one is the badge. Do not derive either from the other.
   */
  readonly mailUnread: number | null;

  /** The deposit box, or why there is not one. Read `status` first, like `market`. */
  readonly bank: BankState;

  /**
   * The buyback ring: what you have sold to a vendor and can still take back.
   *
   * MOST RECENT FIRST. Ungated, unlike the three above: standing at a vendor is
   * what lets a player USE the ring, not what lets them see it.
   */
  readonly buyback: readonly InvSlot[] | null;

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
   * Whether an effect works against the unit carrying it. Either aura shape.
   *
   * A function rather than a field on the aura, because the loader hands over the
   * game's own aura objects rather than copies. See `world/auras.ts`.
   */
  harmful: (aura: Aura | PartyMemberAura) => boolean;

  /** Whether an effect can be removed. Full auras only; a party row cannot answer. */
  dispellable: (aura: Aura, offensive?: boolean) => boolean;

  /** Flat yards from the player to a point, ignoring height. Null before world entry. */
  distanceTo: (at: { x: number; z: number }) => number | null;

  /**
   * Degrees CLOCKWISE from where the player is looking, -180 <= turn < 180.
   *
   * Null before world entry, and null for a facing that is not finite. Composes
   * with `fmt.compass`, which takes this convention.
   */
  bearingTo: (at: { x: number; z: number }) => number | null;

  /**
   * The game's own recipe table, copied and frozen.
   *
   * Static content, so there is no watch key and there must never be one: a
   * signature over it would walk every recipe per snapshot to report that
   * nothing moved. What actually changes is on `world.professions`.
   */
  readonly recipes: readonly Recipe[];

  /** The authored crafting stations, copied and frozen. Static, like `recipes`. */
  readonly stations: readonly Station[];

  /**
   * The authored mailboxes and noticeboards, copied and frozen. Static too.
   *
   * Where a counter IS, from the game's own list. Whether the player is standing
   * at one is `world.mail`, which is proximity-gated.
   */
  readonly civicServices: readonly CivicService[];

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
