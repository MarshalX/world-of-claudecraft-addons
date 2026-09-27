// What each world key reports and what the matching read returns, declared once so the read and
// the subscription are the same type. The key list itself is authoritative in `signature.ts`;
// `tests/world-shape.test.ts` asserts the two agree.

import type { AbilityIndex } from './abilities.ts';
import type { ArenaStandings } from './arena.ts';
import type { BankState } from './bank.ts';
import type { BattlegroundStandings } from './battleground.ts';
import type { CharacterInfo, ProfessionInfo, TalentInfo } from './character.ts';
import type { CombatState } from './combat.ts';
import type { EntityCast, Hazard } from './derived.ts';
import type { EncounterInfo } from './encounter.ts';
import type { FinderInfo, FinderListingRow } from './finder.ts';
import type {
  Aura,
  Entity,
  EquipSlot,
  HeldSlot,
  InvSlot,
  Vec3,
  WorldQuests,
} from './game-types.ts';
import type { CorpseView, DeathZone } from './ground.ts';
import type { GroupInfo } from './group.ts';
import type { ItemInstance } from './items.ts';
import type { MailState } from './mail.ts';
import type { MarketState } from './market.ts';
import type { MatchInfo } from './match.ts';
import type { PartyInfo } from './party-types.ts';
import type { VaultState } from './vault.ts';

export interface WorldValues {
  player: Entity | null;
  target: Entity | null;
  entities: ReadonlyMap<number, Entity>;
  party: PartyInfo | null;
  inventory: readonly HeldSlot[] | null;
  equipment: Partial<Record<EquipSlot, string>> | null;
  /** What is on the worn gear. Sparse: a plain piece has no key. */
  equipmentInstances: Partial<Record<EquipSlot, ItemInstance>> | null;
  /** The equipped bag sockets. `bagCapacity` derives from this, so watch this. */
  bags: readonly (string | null)[] | null;
  copper: number | null;
  /**
   * The zone name the game is displaying, or null before the HUD exists. Localized text read off
   * the minimap label, not an id.
   */
  zone: string | null;
  /**
   * Who is playing, as the key per-character state is filed under. Null before world entry.
   * Watchable because a character switch happens without a page reload.
   */
  characterKey: string | null;
  character: CharacterInfo | null;
  talents: TalentInfo | null;
  professions: ProfessionInfo | null;
  group: GroupInfo | null;
  encounter: EncounterInfo | null;
  /**
   * The competitive bout in progress, or null when you are not in one.
   *
   * Cadences differ: a duel every tick, a battleground at 1 Hz plus every transition, arena
   * formats up to ten seconds stale. The live path for Fiesta and Yumi is the event queue, and
   * for a battleground the `bg*` events.
   */
  match: MatchInfo | null;
  /** Where you stand and what you are queued for. Present whether or not you play. */
  arena: ArenaStandings | null;
  /** Your battleground record, queue and ladder. Present whether or not you play. */
  battleground: BattlegroundStandings | null;
  /** Your dungeon finder state. Present whether or not you are queued. */
  finder: FinderInfo | null;
  /** The realm's open premade listings, capped by the server. Null before the first sync. */
  finderBoard: readonly FinderListingRow[] | null;
  quests: WorldQuests | null;
  cooldowns: ReadonlyMap<string, number> | null;
  auras: readonly Aura[] | null;
  /** Entity id to what it is casting, for everything in interest scope. */
  casts: ReadonlyMap<number, EntityCast>;
  /** The current target's effects. Null when nothing is targeted. */
  targetAuras: readonly Aura[] | null;
  hazards: readonly Hazard[] | null;
  /** Entity id to raid target marker, 0 through 7. */
  markers: ReadonlyMap<number, number> | null;
  /** Lethal rings on a rift boss floor. Not `hazards`, and the type says why. */
  deathZones: readonly DeathZone[] | null;
  /** Entity id to what one corpse holds and what you could take off it. Never null. */
  corpses: ReadonlyMap<number, CorpseView>;
  /** Gathering node id to seconds until YOU can harvest it. Per player, not shared. */
  nodeCooldowns: ReadonlyMap<string, number> | null;
  /** Where your own body is lying while your spirit is a ghost. Yours alone. */
  corpse: Vec3 | null;
  /** The player's own spellbook, with lookups by id and display name. Never null; empty early. */
  abilities: AbilityIndex;
  /** Whether the player is fighting, with the signal that answered. Never null. */
  combat: CombatState;
  /** The Merchant's book, or why you cannot see it. Never null: `'unknown'` before world entry. */
  market: MarketState;
  /** Whether gold or goods wait at the Merchant. Ungated, so a badge always works. */
  marketCollectPending: boolean | null;
  /** The mailbox, or why you cannot see it. Never null, like `market`. */
  mail: MailState;
  /** Delivered and unread letters. Ungated, so a badge always works. */
  mailUnread: number | null;
  /** The deposit box, or why you cannot see it. Never null, like `market`. */
  bank: BankState;
  /** The Materials Vault, or why you cannot see it. Banker-gated, like `bank`. */
  vault: VaultState;
  /** What crafting may draw from the vault where you stand, or null inside an instance. */
  craftVaultStock: Readonly<Record<string, number>> | null;
  /** The buyback ring, most recent first. Ungated. */
  buyback: readonly InvSlot[] | null;
}
