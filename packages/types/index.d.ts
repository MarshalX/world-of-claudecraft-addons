// Public API surface for World of ClaudeCraft addon authors.
//
// Add one line at the top of your addon to get autocomplete:
//   /// <reference types="@woc-addons/types" />
//
// The surface is a single `woc` global inside your addon file. Everything it
// creates is torn down when the addon is disabled, so addons need no cleanup
// code of their own.

import type { AddonInfo, GameInfo, Unsubscribe } from './addon.js';
import type { KeysApi } from './keys.js';
import type { NetApi } from './net.js';
import type { SoundApi } from './sound.js';
import type { StorageApi } from './storage.js';
import type { UiApi } from './ui.js';
import type { WorldApi } from './world.js';

declare global {
  const woc: WocApi;
}

export type { AddonInfo, GameInfo, Unsubscribe } from './addon.js';
export type { KnownCue } from './cues.generated.js';
export type { ConflictReport, KeysApi } from './keys.js';
export type { FrameType, NetApi, NetState, SubscribeOpts } from './net.js';
export type { Cue, PlayOpts, SoundApi } from './sound.js';
export type { StorageApi } from './storage.js';
export type {
  AlertOpts,
  Frame,
  FrameDensity,
  FrameOpts,
  MicroButtonOpts,
  ToastOpts,
  UiApi,
} from './ui.js';
export type {
  Aura,
  AuraKind,
  Entity,
  EntityKind,
  InvSlot,
  PartyInfo,
  PartyMember,
  PartyMemberAura,
  QuestProgress,
  ResourceType,
  School,
  Vec3,
  WorldApi,
  WorldKey,
  WorldQuests,
  WorldValues,
} from './world.js';

export interface WocApi {
  readonly addon: AddonInfo;
  readonly game: GameInfo;
  readonly api: number;

  readonly net: NetApi;
  readonly world: WorldApi;
  readonly ui: UiApi;
  readonly sound: SoundApi;
  readonly keys: KeysApi;
  readonly storage: StorageApi;

  /** Settings declared in addon.json, hydrated before your code runs. */
  readonly settings: Readonly<Record<string, unknown>>;
  onSettingsChange: (handler: (settings: Readonly<Record<string, unknown>>) => void) => Unsubscribe;

  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;

  /** Monotonic milliseconds. */
  now: () => number;

  /** Cleared on disable. Prefer these over the globals. */
  setTimeout: (handler: () => void, ms: number) => number;
  setInterval: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  clearInterval: (id: number) => void;
  requestAnimationFrame: (handler: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;

  /** Register a teardown for anything the API did not create. */
  onDispose: (handler: () => void) => void;
}
