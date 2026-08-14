// Public API surface for World of ClaudeCraft addon authors.
//
// Add one line at the top of your addon to get autocomplete:
//   /// <reference types="@woc-addons/types" />
//
// The surface is a single `woc` global inside your addon file. Everything it
// creates is torn down when the addon is disabled, so addons need no cleanup
// code of their own.

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

export type { AbilityDescription, AbilityIndex, AbilityInfo } from './abilities.js';
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
export type { Recipe, Station } from './content.js';
export type { KnownCue } from './cues.generated.js';
export type {
  Absent,
  BankBonusSource,
  BankInfo,
  BankState,
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
   * refuses to start you on an older one, with a message naming both. Read this
   * only when you want to degrade rather than be refused: an addon that declares
   * a lower minor and feature-detects can keep working on an older loader with
   * one feature switched off.
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
   * Declare it as `data` in `addon.json` and the loader fetches it at install,
   * caches it beside your code, and hands you the parsed value here. That is what
   * lets a table live in its own file instead of being pasted into your source,
   * and it is why there is no base URL: nothing in your addon performs the
   * request, so there is no URL for it to point anywhere else.
   *
   * `unknown` for the reason `storage.get` is: nothing validates the shape. The
   * loader checks it parses as JSON at install and nothing more.
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
   * its declared type, finite if it is a number, clamped into its declared range,
   * and one of the options a `select` still offers, falling back to your declared
   * default otherwise. So a `typeof` guard with a fallback beside it is dead code.
   *
   * An id you did NOT declare reads as `undefined`, which is a bug in your
   * manifest rather than a value to defend against.
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
   * The clock for the two things that have to survive a page load: a timestamp
   * you store, and a comparison against a stamp the server sent absolute, such as
   * `GroupInfo.lockouts`. Storing a `now()` reading instead gives you a value that
   * reads as being in the future on the next load, with nothing to indicate it.
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
   * Reach for this rather than `requestAnimationFrame` re-armed from inside its
   * own handler. It is one browser callback for the whole loader instead of one
   * per addon, it is dropped rather than queued while the loader is frozen, and
   * it is unsubscribed when your addon is disabled without you writing that.
   *
   * `dt` is milliseconds since the previous frame, 0 on the first one, and
   * clamped at 250 so a tab returning from the background does not hand you half
   * a minute to multiply by. The loader positions every `ui.anchor3d` AFTER your
   * handler has run, so a point you move here is followed in the same frame.
   *
   * Not the answer for everything: a panel whose figures move once a second
   * wants `woc.setInterval`, not sixty rewrites a second of the same six
   * strings. Added in API minor 2.
   */
  onFrame: (handler: (dt: number) => void) => Unsubscribe;

  /**
   * A repaint that runs at most once a frame, however many times you ask.
   *
   * Returns the function you call to ask.
   *
   *     const repaint = woc.paint(draw, { frame });
   *     woc.world.on('bagChanged', repaint);
   *
   * With `frame`, a request made while it is hidden is HELD rather than dropped:
   * one repaint runs when the panel comes back, so it returns current, not stale.
   *
   * That costs one boolean read per frame for as long as a repaint is owed, so a
   * panel closed and never reopened holds a seat on the loop.
   *
   * Only pass `frame` when the handler ONLY paints. Bookkeeping inside one stops
   * while the panel is closed, and nothing reports that.
   *
   * A figure that moves on its own wants `woc.setInterval`; a bar animating every
   * frame wants `woc.onFrame`. Added in API minor 4.
   */
  paint: (handler: () => void, opts?: { frame?: Frame }) => () => void;
}
