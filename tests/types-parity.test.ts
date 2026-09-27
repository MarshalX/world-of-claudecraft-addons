// The published `packages/types` surface against the loader's implementation.
//
// Every assertion is TYPE level and fails only `tsc --noEmit`, never the runner; the `it()`
// blocks exist so the suite reports that the check is present.

import { describe, expect, it } from 'vitest';
import type { BusApi } from '../loader/src/runtime/api/bus.ts';
import type { FmtApi } from '../loader/src/runtime/api/fmt.ts';
import type { AddonIdentity, GameIdentity, WocApi } from '../loader/src/runtime/api/index.ts';
import type { KeysApi } from '../loader/src/runtime/api/keys.ts';
import type { NetApi } from '../loader/src/runtime/api/net.ts';
import type { SoundApi } from '../loader/src/runtime/api/sound.ts';
import type { AddonStorageApi } from '../loader/src/runtime/api/storage.ts';
import type { UiApi } from '../loader/src/runtime/api/ui.ts';
import type { WorldApi } from '../loader/src/runtime/api/world.ts';
import type { EventPayloads } from '../loader/src/runtime/net/events.ts';
import type { IconUrls } from '../loader/src/runtime/ui/kit/icons.ts';
import type { AbilityInfo } from '../loader/src/runtime/world/abilities.ts';
import type { BankInfo } from '../loader/src/runtime/world/bank.ts';
import type {
  BattlegroundMatch,
  BattlegroundStandings,
} from '../loader/src/runtime/world/battleground.ts';
import type { ProfessionInfo, ToolEffectSlot } from '../loader/src/runtime/world/character.ts';
import type { CombatSource, CombatState } from '../loader/src/runtime/world/combat.ts';
import type { CivicService, Recipe, Station } from '../loader/src/runtime/world/content.ts';
import type { Hazard, HazardKind } from '../loader/src/runtime/world/derived.ts';
import type { Aura, Entity, HeldSlot, InvSlot } from '../loader/src/runtime/world/game-types.ts';
import type { CorpseView, DeathZone } from '../loader/src/runtime/world/ground.ts';
import type { HeldItemInstance, ItemInstance } from '../loader/src/runtime/world/items.ts';
import type { MarketInfo, MarketListing } from '../loader/src/runtime/world/market.ts';
import type { Reaction } from '../loader/src/runtime/world/reaction.ts';
import type { WorldKey } from '../loader/src/runtime/world/signature.ts';
import type { WorldValues } from '../loader/src/runtime/world/values.ts';
import type { VaultInfo, VaultState } from '../loader/src/runtime/world/vault.ts';
import type { AbilityInfo as PublicAbilityInfo } from '../packages/types/abilities.js';
import type { AddonInfo, GameInfo } from '../packages/types/addon.js';
import type {
  BattlegroundMatch as PublicBattlegroundMatch,
  BattlegroundStandings as PublicBattlegroundStandings,
} from '../packages/types/battleground.js';
import type { BusApi as PublicBusApi } from '../packages/types/bus.js';
import type {
  ProfessionInfo as PublicProfessionInfo,
  ToolEffectSlot as PublicToolEffectSlot,
} from '../packages/types/character.js';
import type {
  CivicService as PublicCivicService,
  Recipe as PublicRecipe,
  Station as PublicStation,
} from '../packages/types/content.js';
import type {
  MarketInfo as PublicMarketInfo,
  MarketListing as PublicMarketListing,
} from '../packages/types/economy.js';
import type {
  BankInfo as PublicBankInfo,
  VaultInfo as PublicVaultInfo,
  VaultState as PublicVaultState,
} from '../packages/types/economy-storage.js';
import type {
  Aura as PublicAura,
  Entity as PublicEntity,
  HeldItemInstance as PublicHeldItemInstance,
  ItemInstance as PublicItemInstance,
} from '../packages/types/entity.js';
import type { EventPayloads as PublicEventPayloads } from '../packages/types/events.js';
import type { FmtApi as PublicFmtApi } from '../packages/types/fmt.js';
import type { WocApi as PublicWocApi } from '../packages/types/index.js';
import type { KeysApi as PublicKeysApi } from '../packages/types/keys.js';
import type { NetApi as PublicNetApi } from '../packages/types/net.js';
import type { SoundApi as PublicSoundApi } from '../packages/types/sound.js';
import type { StorageApi as PublicStorageApi } from '../packages/types/storage.js';
import type { IconUrls as PublicIconUrls, UiApi as PublicUiApi } from '../packages/types/ui.js';
import type {
  CombatSource as PublicCombatSource,
  CombatState as PublicCombatState,
  Reaction as PublicReaction,
  WorldApi as PublicWorldApi,
} from '../packages/types/world.js';
import type {
  CorpseView as PublicCorpseView,
  DeathZone as PublicDeathZone,
  Hazard as PublicHazard,
  HazardKind as PublicHazardKind,
} from '../packages/types/world-ground.js';
import type {
  HeldSlot as PublicHeldSlot,
  InvSlot as PublicInvSlot,
} from '../packages/types/world-items.js';
import type {
  WorldKey as PublicWorldKey,
  WorldValues as PublicWorldValues,
} from '../packages/types/world-watch.js';

/** True only when every member of `From` satisfies `To`; asserted both ways per surface. */
type Assignable<From, To> = [From] extends [To] ? true : false;

/**
 * Which field NAMES a record carries. Two-way `Assignable` is blind to an OPTIONAL field on
 * one side only, and fields the game adds to an existing record arrive optional.
 */
type SameFields<A, B> = [keyof A, keyof B] extends [keyof B, keyof A] ? true : false;

/** The kinds whose two declarations disagree about which fields exist. */
type EventFieldDrift = {
  [K in keyof EventPayloads]: K extends keyof PublicEventPayloads
    ? SameFields<EventPayloads[K], PublicEventPayloads[K]> extends true
      ? never
      : K
    : K;
}[keyof EventPayloads];

/** Each of these is a compile error the moment the two shapes disagree. */
const uiIsPublished: Assignable<UiApi, PublicUiApi> = true;
const publishedIsUi: Assignable<PublicUiApi, UiApi> = true;

/** `SameFields` because the whole-`UiApi` pair cannot see an optional member added to `icon`. */
const iconsArePublished: Assignable<IconUrls, PublicIconUrls> = true;
const publishedAreIcons: Assignable<PublicIconUrls, IconUrls> = true;
const iconFieldsAgree: SameFields<IconUrls, PublicIconUrls> = true;

/** Also proves the two separately written event catalogues describe the same records. */
const netIsPublished: Assignable<NetApi, PublicNetApi> = true;
const publishedIsNet: Assignable<PublicNetApi, NetApi> = true;

/**
 * The event catalogues field by field: the `net` pair compares them only through `onEvent`,
 * which misses a field added to one side alone.
 */
const kindsArePublished: Assignable<keyof EventPayloads, keyof PublicEventPayloads> = true;
const publishedAreKinds: Assignable<keyof PublicEventPayloads, keyof EventPayloads> = true;
const noEventFieldDrift: Assignable<EventFieldDrift, never> = true;

const soundIsPublished: Assignable<SoundApi, PublicSoundApi> = true;
const publishedIsSound: Assignable<PublicSoundApi, SoundApi> = true;

const keysIsPublished: Assignable<KeysApi, PublicKeysApi> = true;
const publishedIsKeys: Assignable<PublicKeysApi, KeysApi> = true;

const storageIsPublished: Assignable<AddonStorageApi, PublicStorageApi> = true;
const publishedIsStorage: Assignable<PublicStorageApi, AddonStorageApi> = true;

/** `duration`'s style is a named alias here and an inline union in the package. */
const fmtIsPublished: Assignable<FmtApi, PublicFmtApi> = true;
const publishedIsFmt: Assignable<PublicFmtApi, FmtApi> = true;

/** `Teardown` and `Unsubscribe` are both `() => void`, so nothing structural links them. */
const busIsPublished: Assignable<BusApi, PublicBusApi> = true;
const publishedIsBus: Assignable<PublicBusApi, BusApi> = true;

/** The package marks every field `readonly`, which assignability is blind to. */
const addonIsPublished: Assignable<AddonIdentity, AddonInfo> = true;
const publishedIsAddon: Assignable<AddonInfo, AddonIdentity> = true;
const addonFieldsAgree: SameFields<AddonIdentity, AddonInfo> = true;

const gameIsPublished: Assignable<GameIdentity, GameInfo> = true;
const publishedIsGame: Assignable<GameInfo, GameIdentity> = true;

const worldIsPublished: Assignable<WorldApi, PublicWorldApi> = true;
const publishedIsWorld: Assignable<PublicWorldApi, WorldApi> = true;

/**
 * The world's own shapes, compared directly so an error names the shape that moved rather
 * than surfacing deep inside `WorldApi`. `world/shape.ts` checks them against the live game.
 */
const entityIsPublished: Assignable<Entity, PublicEntity> = true;
const publishedIsEntity: Assignable<PublicEntity, Entity> = true;
/**
 * `inCombat` is omitted because it is written only on the player's own record; published, it
 * would be permanently false on every other entity. `world.combat` exposes it instead.
 */
const entityFieldsAgree: SameFields<Omit<Entity, 'inCombat'>, PublicEntity> = true;
/**
 * Only `SameFields` sees an optional field land on one side; the pair covers a required one.
 * `undispellable` and `permanent` are omitted: they feed `world.dispellable`, and publishing
 * them invites addons to re-derive that verdict wrongly.
 */
const auraIsPublished: Assignable<Omit<Aura, 'undispellable' | 'permanent'>, PublicAura> = true;
const publishedIsAura: Assignable<PublicAura, Aura> = true;
const auraFieldsAgree: SameFields<Omit<Aura, 'undispellable' | 'permanent'>, PublicAura> = true;
/** Compared directly with `SameFields`, since an optional field is invisible to the pair. */
const corpseIsPublished: Assignable<CorpseView, PublicCorpseView> = true;
const publishedIsCorpse: Assignable<PublicCorpseView, CorpseView> = true;
const corpseFieldsAgree: SameFields<CorpseView, PublicCorpseView> = true;
const deathZoneIsPublished: Assignable<DeathZone, PublicDeathZone> = true;
const publishedIsDeathZone: Assignable<PublicDeathZone, DeathZone> = true;
const deathZoneFieldsAgree: SameFields<DeathZone, PublicDeathZone> = true;
/**
 * The kind pair proves the loader publishes a name for every hazard list it reads and the
 * reverse. `SameFields` cannot check a union of string literals, which has no keys.
 */
const hazardIsPublished: Assignable<Hazard, PublicHazard> = true;
const publishedIsHazard: Assignable<PublicHazard, Hazard> = true;
const hazardFieldsAgree: SameFields<Hazard, PublicHazard> = true;
const hazardKindIsPublished: Assignable<HazardKind, PublicHazardKind> = true;
const publishedIsHazardKind: Assignable<PublicHazardKind, HazardKind> = true;

const valuesArePublished: Assignable<WorldValues, PublicWorldValues> = true;
const publishedAreValues: Assignable<PublicWorldValues, WorldValues> = true;

/** Compared directly so a drop names the row rather than the `world.professions` return. */
const professionsArePublished: Assignable<ProfessionInfo, PublicProfessionInfo> = true;
const publishedAreProfessions: Assignable<PublicProfessionInfo, ProfessionInfo> = true;
const professionFieldsAgree: SameFields<ProfessionInfo, PublicProfessionInfo> = true;
const toolSlotIsPublished: Assignable<ToolEffectSlot, PublicToolEffectSlot> = true;
const publishedIsToolSlot: Assignable<PublicToolEffectSlot, ToolEffectSlot> = true;
const toolSlotFieldsAgree: SameFields<ToolEffectSlot, PublicToolEffectSlot> = true;

/**
 * The stack shapes: `WorldValues` compares `inventory` whole and misses a field on the slot.
 * `HeldSlot` is checked too, since an `InvSlot`-shaped one would pass the base pair and drop
 * the lock.
 */
const slotIsPublished: Assignable<InvSlot, PublicInvSlot> = true;
const publishedIsSlot: Assignable<PublicInvSlot, InvSlot> = true;
const slotFieldsAgree: SameFields<InvSlot, PublicInvSlot> = true;
const heldSlotIsPublished: Assignable<HeldSlot, PublicHeldSlot> = true;
const publishedIsHeldSlot: Assignable<PublicHeldSlot, HeldSlot> = true;
const heldInstanceIsPublished: Assignable<HeldItemInstance, PublicHeldItemInstance> = true;
const publishedIsHeldInstance: Assignable<PublicHeldItemInstance, HeldItemInstance> = true;
const heldInstanceFieldsAgree: SameFields<HeldItemInstance, PublicHeldItemInstance> = true;
/**
 * The owner's payload carries owner-only fields `HeldItemInstance` cannot see, and every
 * field is optional, so `SameFields` is the assertion that matters.
 */
const instanceIsPublished: Assignable<ItemInstance, PublicItemInstance> = true;
const publishedIsInstance: Assignable<PublicItemInstance, ItemInstance> = true;
const instanceFieldsAgree: SameFields<ItemInstance, PublicItemInstance> = true;
const marketIsPublished: Assignable<MarketInfo, PublicMarketInfo> = true;
const publishedIsMarket: Assignable<PublicMarketInfo, MarketInfo> = true;
const marketFieldsAgree: SameFields<MarketInfo, PublicMarketInfo> = true;

/**
 * The market ROW: an array of a superset with an extra optional member stays assignable both
 * ways, so the `MarketInfo` pair misses it.
 */
const listingIsPublished: Assignable<MarketListing, PublicMarketListing> = true;
const publishedIsListing: Assignable<PublicMarketListing, MarketListing> = true;
const listingFieldsAgree: SameFields<MarketListing, PublicMarketListing> = true;

/**
 * `nextRungClaudiumPrice` is optional, so only `SameFields` catches it leaving one side.
 * `VaultState` is checked separately because the `VaultInfo` pair cannot see a wrong wrapper;
 * `BankState` is reached through `WorldValues`.
 */
const bankIsPublished: Assignable<BankInfo, PublicBankInfo> = true;
const publishedIsBank: Assignable<PublicBankInfo, BankInfo> = true;
const bankFieldsAgree: SameFields<BankInfo, PublicBankInfo> = true;
const vaultIsPublished: Assignable<VaultInfo, PublicVaultInfo> = true;
const publishedIsVault: Assignable<PublicVaultInfo, VaultInfo> = true;
const vaultFieldsAgree: SameFields<VaultInfo, PublicVaultInfo> = true;
const vaultStateIsPublished: Assignable<VaultState, PublicVaultState> = true;
const publishedIsVaultState: Assignable<PublicVaultState, VaultState> = true;

/** `WorldApi` reaches this only through `AbilityIndex`, whose errors do not name the field. */
const abilityIsPublished: Assignable<AbilityInfo, PublicAbilityInfo> = true;
const publishedIsAbility: Assignable<PublicAbilityInfo, AbilityInfo> = true;
const abilityFieldsAgree: SameFields<AbilityInfo, PublicAbilityInfo> = true;

/** The authored content tables, compared directly so an error names the row that moved. */
const recipeIsPublished: Assignable<Recipe, PublicRecipe> = true;
const publishedIsRecipe: Assignable<PublicRecipe, Recipe> = true;
const recipeFieldsAgree: SameFields<Recipe, PublicRecipe> = true;
const stationIsPublished: Assignable<Station, PublicStation> = true;
const publishedIsStation: Assignable<PublicStation, Station> = true;
const stationFieldsAgree: SameFields<Station, PublicStation> = true;
const civicServiceIsPublished: Assignable<CivicService, PublicCivicService> = true;
const publishedIsCivicService: Assignable<PublicCivicService, CivicService> = true;
const civicServiceFieldsAgree: SameFields<CivicService, PublicCivicService> = true;

/**
 * `BattlegroundMatch` is one member of a five-way union, so a drift through `WorldApi` names
 * none of them. `SameFields` because the mode keeps gaining optional fields.
 */
const bgStandingsArePublished: Assignable<BattlegroundStandings, PublicBattlegroundStandings> =
  true;
const publishedAreBgStandings: Assignable<PublicBattlegroundStandings, BattlegroundStandings> =
  true;
const bgStandingsFieldsAgree: SameFields<BattlegroundStandings, PublicBattlegroundStandings> = true;
const bgMatchIsPublished: Assignable<BattlegroundMatch, PublicBattlegroundMatch> = true;
const publishedIsBgMatch: Assignable<PublicBattlegroundMatch, BattlegroundMatch> = true;
const bgMatchFieldsAgree: SameFields<BattlegroundMatch, PublicBattlegroundMatch> = true;

/**
 * Dropping a literal on one side leaves the other a superset, assignable in one direction.
 * No `SameFields`: it compares keys, and a union of literals has none.
 */
const reactionIsPublished: Assignable<Reaction, PublicReaction> = true;
const publishedIsReaction: Assignable<PublicReaction, Reaction> = true;

/**
 * Both directions on the union: a member on the published side alone promises a source no
 * branch returns. No `SameFields` on the union; `CombatState` needs it once a field is optional.
 */
const combatSourceIsPublished: Assignable<CombatSource, PublicCombatSource> = true;
const publishedIsCombatSource: Assignable<PublicCombatSource, CombatSource> = true;
const combatStateIsPublished: Assignable<CombatState, PublicCombatState> = true;
const publishedIsCombatState: Assignable<PublicCombatState, CombatState> = true;
const combatStateFieldsAgree: SameFields<CombatState, PublicCombatState> = true;

/**
 * `signature.ts` owns the keys `world.on` validates against, while the published `WorldKey`
 * derives from `WorldValues`; a key added to one side only would throw at the addon.
 */
const keysArePublished: Assignable<WorldKey, PublicWorldKey> = true;
const publishedAreKeys: Assignable<PublicWorldKey, WorldKey> = true;

/** What the assembly hands over, which the per-facet pairs (two declarations) cannot see. */
const wocCarriesUi: Assignable<WocApi['ui'], PublicUiApi> = true;
const wocCarriesSound: Assignable<WocApi['sound'], PublicSoundApi> = true;
const wocCarriesKeys: Assignable<WocApi['keys'], PublicKeysApi> = true;
const wocCarriesStorage: Assignable<WocApi['storage'], PublicStorageApi> = true;
const wocCarriesWorld: Assignable<WocApi['world'], PublicWorldApi> = true;
const wocCarriesNet: Assignable<WocApi['net'], PublicNetApi> = true;
const wocCarriesFmt: Assignable<WocApi['fmt'], PublicFmtApi> = true;
const wocCarriesBus: Assignable<WocApi['bus'], PublicBusApi> = true;
const wocCarriesAddon: Assignable<WocApi['addon'], AddonInfo> = true;
const wocCarriesGame: Assignable<WocApi['game'], GameInfo> = true;

/**
 * One direction on purpose: `PaintOpts.frame` accepts `{ visible: boolean }` where the package
 * publishes the whole `Frame`, so the reverse is false by design.
 */
const wocCarriesPaint: Assignable<WocApi['paint'], PublicWocApi['paint']> = true;

/**
 * A backstop for every unnamed root member. The reverse is absent because `settings` is
 * `unknown` in the package and `paint` is the narrowing above.
 */
const wocSatisfiesPublished: Assignable<WocApi, PublicWocApi> = true;

/** `data` and `wallClock` are root functions, so no per-facet check reaches them. */
const wocCarriesData: Assignable<WocApi['data'], PublicWocApi['data']> = true;
const publishedIsData: Assignable<PublicWocApi['data'], WocApi['data']> = true;
const wocCarriesWallClock: Assignable<WocApi['wallClock'], PublicWocApi['wallClock']> = true;
const publishedIsWallClock: Assignable<PublicWocApi['wallClock'], WocApi['wallClock']> = true;

/**
 * Both clocks are `() => number` and cannot be told apart structurally; this pins only that
 * the package still publishes two of them.
 */
const publishedHasBothClocks: Assignable<
  PublicWocApi,
  { now: () => number; wallClock: () => number }
> = true;

describe('the published types', () => {
  it('match the implementation in both directions', () => {
    expect([
      uiIsPublished,
      publishedIsUi,
      iconsArePublished,
      publishedAreIcons,
      iconFieldsAgree,
      netIsPublished,
      publishedIsNet,
      soundIsPublished,
      publishedIsSound,
      keysIsPublished,
      publishedIsKeys,
      storageIsPublished,
      publishedIsStorage,
      fmtIsPublished,
      publishedIsFmt,
      busIsPublished,
      publishedIsBus,
      addonIsPublished,
      publishedIsAddon,
      addonFieldsAgree,
      gameIsPublished,
      publishedIsGame,
      worldIsPublished,
      publishedIsWorld,
    ]).not.toContain(false);
  });

  it('describe the same event kinds, carrying the same fields', () => {
    expect([kindsArePublished, publishedAreKinds, noEventFieldDrift]).not.toContain(false);
  });

  it('describe the world shapes and the keys that watch them', () => {
    expect([
      entityIsPublished,
      publishedIsEntity,
      entityFieldsAgree,
      auraIsPublished,
      publishedIsAura,
      auraFieldsAgree,
      corpseIsPublished,
      publishedIsCorpse,
      corpseFieldsAgree,
      deathZoneIsPublished,
      publishedIsDeathZone,
      deathZoneFieldsAgree,
      hazardIsPublished,
      publishedIsHazard,
      hazardFieldsAgree,
      hazardKindIsPublished,
      publishedIsHazardKind,
      professionsArePublished,
      publishedAreProfessions,
      professionFieldsAgree,
      toolSlotIsPublished,
      publishedIsToolSlot,
      toolSlotFieldsAgree,
      slotIsPublished,
      publishedIsSlot,
      slotFieldsAgree,
      heldSlotIsPublished,
      publishedIsHeldSlot,
      heldInstanceIsPublished,
      publishedIsHeldInstance,
      heldInstanceFieldsAgree,
      instanceIsPublished,
      publishedIsInstance,
      instanceFieldsAgree,
      marketIsPublished,
      publishedIsMarket,
      marketFieldsAgree,
      listingIsPublished,
      publishedIsListing,
      listingFieldsAgree,
      bankIsPublished,
      publishedIsBank,
      bankFieldsAgree,
      vaultIsPublished,
      publishedIsVault,
      vaultFieldsAgree,
      vaultStateIsPublished,
      publishedIsVaultState,
      abilityIsPublished,
      publishedIsAbility,
      abilityFieldsAgree,
      recipeIsPublished,
      publishedIsRecipe,
      recipeFieldsAgree,
      stationIsPublished,
      publishedIsStation,
      stationFieldsAgree,
      civicServiceIsPublished,
      publishedIsCivicService,
      civicServiceFieldsAgree,
      bgStandingsArePublished,
      publishedAreBgStandings,
      bgStandingsFieldsAgree,
      bgMatchIsPublished,
      publishedIsBgMatch,
      bgMatchFieldsAgree,
      reactionIsPublished,
      publishedIsReaction,
      combatSourceIsPublished,
      publishedIsCombatSource,
      combatStateIsPublished,
      publishedIsCombatState,
      combatStateFieldsAgree,
      valuesArePublished,
      publishedAreValues,
      keysArePublished,
      publishedAreKeys,
    ]).not.toContain(false);
  });

  it('describe every domain the assembled woc object carries', () => {
    expect([
      wocCarriesUi,
      wocCarriesSound,
      wocCarriesKeys,
      wocCarriesStorage,
      wocCarriesNet,
      wocCarriesWorld,
      wocCarriesFmt,
      wocCarriesBus,
      wocCarriesAddon,
      wocCarriesGame,
      wocCarriesPaint,
      wocSatisfiesPublished,
      wocCarriesData,
      publishedIsData,
      wocCarriesWallClock,
      publishedIsWallClock,
      publishedHasBothClocks,
    ]).not.toContain(false);
  });
});
