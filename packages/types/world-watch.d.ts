// What `world.on` watches, and what each key hands back.

// Its own file for the reason the loader keeps `world/values.ts` and
// `world/signature.ts` apart from the API that returns them: this is the
// SUBSCRIPTION surface, one entry per watchable key, and `world.d.ts` is what
// `woc.world` answers. They grow for different reasons, and the reads outgrew
// the file limit first.
//
// Nothing is re-exported from here through `world.d.ts`, so a split is visible in
// the import, which is the same rule `ui-timers.d.ts` and `events-combat.d.ts`
// already follow.

import type { AbilityIndex } from './abilities.js';
import type { ArenaStandings } from './arena.js';
import type { BattlegroundStandings } from './battleground.js';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from './character.js';
import type { BankState, MailState, MarketState } from './economy.js';
import type { Aura, Entity, EquipSlot, ItemInstance, Vec3 } from './entity.js';
import type { FinderInfo, FinderListingRow } from './finder.js';
import type { EncounterInfo, GroupInfo } from './group.js';
import type { MatchInfo } from './match.js';
import type { PartyInfo } from './party.js';
import type { CombatState, EntityCast, WorldQuests } from './world.js';
import type { CorpseView, DeathZone, Hazard } from './world-ground.js';
import type { HeldSlot, InvSlot } from './world-items.js';

/** What each read returns, and what the matching `world.on` key reports. */
export interface WorldValues {
  player: Entity | null;
  target: Entity | null;
  entities: ReadonlyMap<number, Entity>;
  party: PartyInfo | null;
  inventory: readonly HeldSlot[] | null;
  equipment: Partial<Record<EquipSlot, string>> | null;
  /** What is on the worn gear. Sparse: a plain piece has no key. Added in API minor 2. */
  equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;
  bags: readonly (string | null)[] | null;
  copper: number | null;
  zone: string | null;
  /** Who is playing, as the key per-character state is filed under. Added in API minor 2. */
  characterKey: string | null;
  character: CharacterInfo | null;
  talents: TalentInfo | null;
  professions: ProfessionInfo | null;
  group: GroupInfo | null;
  encounter: EncounterInfo | null;
  /** The competitive bout in progress. Added in API minor 2. */
  match: MatchInfo | null;
  /** Your standings and queue. Added in API minor 2. */
  arena: ArenaStandings | null;
  /** Your battleground record, queue and ladder. Added in API minor 6. */
  battleground: BattlegroundStandings | null;
  /** Your dungeon finder state. Added in API minor 2. */
  finder: FinderInfo | null;
  /** The realm's open premade listings. Added in API minor 2. */
  finderBoard: readonly FinderListingRow[] | null;
  quests: WorldQuests | null;
  cooldowns: ReadonlyMap<string, number> | null;
  auras: readonly Aura[] | null;
  casts: ReadonlyMap<number, EntityCast>;
  targetAuras: readonly Aura[] | null;
  hazards: readonly Hazard[] | null;
  markers: ReadonlyMap<number, number> | null;
  /** Lethal rings on a rift boss floor. Added in API minor 2. */
  deathZones: readonly DeathZone[] | null;
  /** Every lootable corpse in scope. Never null, like `casts`. Added in API minor 2. */
  corpses: ReadonlyMap<number, CorpseView>;
  /** Gathering node id to seconds until you can harvest it. Added in API minor 2. */
  nodeCooldowns: ReadonlyMap<string, number> | null;
  /** Where your own body lies while your spirit is a ghost. Added in API minor 2. */
  corpse: Vec3 | null;
  abilities: AbilityIndex;
  combat: CombatState;
  /** The Merchant's book, or why there is not one. Never null. Added in API minor 2. */
  market: MarketState;
  /** Whether gold or goods wait at the Merchant. Added in API minor 2. */
  marketCollectPending: boolean | null;
  /** The mailbox, or why there is not one. Never null. Added in API minor 2. */
  mail: MailState;
  /** Delivered and unread letters. Added in API minor 2. */
  mailUnread: number | null;
  /** The deposit box, or why there is not one. Never null. Added in API minor 2. */
  bank: BankState;
  /** The buyback ring, most recent first. Added in API minor 2. */
  buyback: readonly InvSlot[] | null;
}

/** The state keys `world.on` can watch. Anything else throws. */
export type WorldKey = keyof WorldValues;
