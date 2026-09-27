// Public API surface for World of ClaudeCraft addon authors.
//
// Add one line at the top of your addon to get autocomplete:
//   /// <reference types="@woc-addons/types" />
//
// The surface is a single `woc` global inside your addon file. Everything it
// creates is torn down when the addon is disabled.

import type { AddonInfo, GameInfo, Unsubscribe } from './addon.js';
import type { BusApi } from './bus.js';
import type { FmtApi } from './fmt.js';
import type { KeysApi } from './keys.js';
import type { NetApi } from './net.js';
import type { SoundApi } from './sound.js';
import type { StorageApi } from './storage.js';
import type { UiApi } from './ui.js';
import type { Frame } from './ui-frame.js';
import type { WorldApi } from './world.js';

declare global {
  const woc: WocApi;
}

export type {
  AbilityChannel,
  AbilityDescription,
  AbilityIndex,
  AbilityInfo,
} from './abilities.js';
export type { AddonInfo, GameInfo, Unsubscribe } from './addon.js';
export type {
  ArenaFormat,
  ArenaLadderRow,
  ArenaStanding,
  ArenaStandings,
} from './arena.js';
export type {
  BattlegroundMatch,
  BattlegroundStandings,
  BgFighter,
  BgFlag,
  BgLadderRow,
  BgProposal,
} from './battleground.js';
export type { BusApi, BusMessage, Publication } from './bus.js';
export type {
  CharacterInfo,
  CraftingIdentity,
  DeedStats,
  ProfessionInfo,
  SavedLoadout,
  TalentInfo,
  TalentRole,
  TalentRowLevel,
} from './character.js';
export type { CivicService, Recipe, Station } from './content.js';
export type { KnownCue } from './cues.generated.js';
export type {
  Absent,
  MailInfo,
  MailKind,
  MailMessage,
  MailState,
  MarketInfo,
  MarketListing,
  MarketState,
  Near,
  ProximityState,
} from './economy.js';
export type {
  BankBonusSource,
  BankInfo,
  BankState,
  VaultInfo,
  VaultState,
} from './economy-storage.js';
export type {
  AbilityCharge,
  Aura,
  AuraKind,
  CoreStats,
  Entity,
  EntityKind,
  EquipSlot,
  HeldItemInstance,
  ItemInstance,
  PublicItemInstance,
  ResourceType,
  School,
  Vec3,
  WeaponInfo,
} from './entity.js';
export type {
  FinderApplicant,
  FinderInfo,
  FinderListing,
  FinderListingRow,
  FinderProposal,
  FinderQueue,
  FinderRole,
  RoleNeeds,
} from './finder.js';
export type { FmtApi } from './fmt.js';
export type {
  EncounterInfo,
  GroupInfo,
  LootRoll,
  MasterLoot,
  RunInfo,
  ThreatRow,
  ThreatTable,
} from './group.js';
export type { KnownSkillIcon, SkillIconClass } from './icons.generated.js';
export type { KnownItemIcon } from './items.generated.js';
export type { ConflictReport, KeysApi } from './keys.js';
export type { BoutBase, DuelMatch, MatchCombatant, MatchInfo, RankedMatch } from './match.js';
export type {
  AugmentOffer,
  FiestaMatch,
  FiestaPowerup,
  FiestaScore,
  YumiCat,
  YumiMatch,
  YumiScore,
} from './match-modes.js';
export type { FrameType, NetApi, NetState, SubscribeOpts } from './net.js';
export type {
  PartyAuraQuery,
  PartyInfo,
  PartyMember,
  PartyMemberAura,
} from './party.js';
export type { Cue, PlayOpts, SoundApi } from './sound.js';
export type { CharacterStore, StorageApi } from './storage.js';
export type {
  AbilityIconId,
  AlertOpts,
  BannerKind,
  BannerOpts,
  BannerSize,
  IconClass,
  IconUrls,
  ItemIconId,
  MicroButtonOpts,
  ToastOpts,
  UiApi,
  UnitOpts,
} from './ui.js';
export type {
  Anchor3d,
  Anchor3dOpts,
  PointSource,
  ScreenPoint,
  UnitPoint,
  WorldPoint,
} from './ui-anchor.js';
export type {
  Field,
  FieldBuilders,
  FieldOpts,
  MenuItem,
  SelectOpts,
  SliderOpts,
  Tab,
  Tabs,
  TabsOpts,
  TextOpts,
  TooltipContent,
  TooltipInput,
  TooltipLine,
  TooltipTone,
} from './ui-controls.js';
export type { Frame, FrameBox, FrameDensity, FrameOpts } from './ui-frame.js';
export type { LineOpts, LineTone, RowAlign, RowOpts, StackOpts } from './ui-layout.js';
export type { Destroyable, List, ListOpts } from './ui-list.js';
export type {
  Bar,
  BarClass,
  BarOpts,
  BarSchool,
  BarTone,
  BarUpdate,
  MoneyValue,
  Tile,
  TileOpts,
  TileSchool,
  TileTone,
  TileUpdate,
} from './ui-timers.js';
export type {
  AuraQuery,
  CombatSource,
  CombatState,
  EntityCast,
  QuestProgress,
  Reaction,
  UnitToken,
  WorldApi,
  WorldQuests,
} from './world.js';
export type {
  CorpseLoot,
  CorpseView,
  DeathZone,
  Hazard,
  HazardKind,
  LootSlot,
} from './world-ground.js';
export type { HeldSlot, InvSlot } from './world-items.js';
export type { WorldKey, WorldValues } from './world-watch.js';

export interface WocApi {
  readonly addon: AddonInfo;
  readonly game: GameInfo;
  /**
   * The API major this loader implements. An addon runs only on a matching one.
   */
  readonly api: number;
  /**
   * How much surface that major has grown, bumped by every additive change.
   *
   * Declare the minor you need as `apiMinor` in your addon.json and the loader
   * refuses to start you on an older one. Read this only to degrade instead: declare
   * a lower minor and feature-detect.
   */
  readonly apiMinor: number;

  readonly net: NetApi;
  readonly world: WorldApi;
  readonly ui: UiApi;
  readonly sound: SoundApi;
  readonly keys: KeysApi;
  readonly storage: StorageApi;
  /** Publish and subscribe between addons, in this page. */
  readonly bus: BusApi;
  /**
   * Durations, ids as words, counted nouns and arrows.
   *
   * Pure string formatting, nothing drawn. Added in API minor 4.
   */
  readonly fmt: FmtApi;

  /**
   * A JSON file shipped in your own addon directory.
   *
   * Declare it as `data` in `addon.json`; the loader fetches it at install, caches
   * it beside your code, and hands you the parsed value here.
   *
   * `unknown` because only JSON parsing is checked, never the shape.
   *
   * The same object every call, so treat it as read-only. Rejects for a name you
   * did not declare, naming the ones you did.
   *
   *     const items = await woc.data('items.json');
   *
   * Added in API minor 2.
   */
  data: (name: string) => Promise<unknown>;

  /**
   * Settings declared in addon.json, hydrated before your first line runs.
   *
   * TOTAL over what your manifest declares: every declared setting is present, of
   * its declared type, finite if a number, clamped into its range, and one of the
   * options a `select` offers, else your declared default. A `typeof` guard with a
   * fallback is dead code.
   *
   * An id you did NOT declare reads `undefined`: fix the manifest.
   */
  readonly settings: Readonly<Record<string, unknown>>;
  onSettingsChange: (handler: (settings: Readonly<Record<string, unknown>>) => void) => Unsubscribe;

  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;

  /** Monotonic milliseconds. Right for an interval, wrong for anything you store. */
  now: () => number;

  /**
   * Epoch milliseconds, as `Date.now` reads them.
   *
   * For a timestamp you store and for comparing absolute server stamps such as
   * `GroupInfo.lockouts`. A stored `now()` reading is meaningless after a reload.
   *
   * Added in API minor 2.
   */
  wallClock: () => number;

  /** Cleared on disable. Prefer these over the globals. */
  setTimeout: (handler: () => void, ms: number) => number;
  setInterval: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  clearInterval: (id: number) => void;
  requestAnimationFrame: (handler: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;

  /** Register a teardown for anything the API did not create. */
  onDispose: (handler: () => void) => void;

  /**
   * Run something on every animation frame, on the loop the loader already runs.
   *
   * Prefer this over a self-re-arming `requestAnimationFrame`: it is dropped, not
   * queued, while the loader is frozen, and unsubscribed on disable.
   *
   * `dt` is milliseconds since the previous frame, 0 on the first, clamped at
   * 250. Every `ui.anchor3d` is positioned AFTER your handler, so a point you move
   * here is followed in the same frame.
   *
   * Figures that change once a second want `woc.setInterval` instead. Added in
   * API minor 2.
   */
  onFrame: (handler: (dt: number) => void) => Unsubscribe;

  /**
   * A repaint that runs at most once a frame, however many times you ask.
   *
   * Returns the function you call to ask.
   *
   *     const repaint = woc.paint(draw, { frame });
   *     woc.world.on('inventory', repaint);
   *
   * With `frame`, a request made while it is hidden is HELD, not dropped: one
   * repaint runs when the panel comes back. Only pass `frame` when the handler
   * ONLY paints, since anything else in it stops while the panel is closed.
   *
   * A figure that moves on its own wants `woc.setInterval`; a bar animating every
   * frame wants `woc.onFrame`. Added in API minor 4.
   */
  paint: (handler: () => void, opts?: { frame?: Frame }) => () => void;
}
