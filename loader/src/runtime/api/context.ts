// The contract of the `woc` object: what an addon is handed and what the runtime supplies.
// index.ts assembles it and bind.ts wires it; nothing here constructs, so both import it freely.

import type { Channel } from '../../shared/hosts.ts';
import type { AddonManifest } from '../../shared/schema.ts';
import type { BusHub } from '../bus/hub.ts';
import type { DisposalBag, Teardown } from '../disposal.ts';
import type { FrameLoop } from '../frame-loop.ts';
import type { KeyDispatcher } from '../keys/dispatcher.ts';
import type { GameBindings } from '../keys/game-bindings.ts';
import type { LogBuffer } from '../log/buffer.ts';
import type { NetHub } from '../net/hub.ts';
import type { SettingsChangeHandler, SettingsStore } from '../settings/store.ts';
import type { SettingValues } from '../settings/values.ts';
import type { SoundEngine } from '../sound/engine.ts';
import type { StorageHub } from '../storage/hub.ts';
import type { UiKit } from '../ui/mount.ts';
import type { WorldHub } from '../world/hub.ts';
import type { BusApi } from './bus.ts';
import type { FmtApi } from './fmt.ts';
import type { KeysApi } from './keys.ts';
import type { LogApi } from './log.ts';
import type { NetApi } from './net.ts';
import type { PaintApi } from './paint.ts';
import type { SoundApi } from './sound.ts';
import type { AddonStorageApi } from './storage.ts';
import type { TimerHost, TimersApi } from './timers.ts';
import type { UiApi } from './ui.ts';
import type { WorldApi } from './world.ts';

/** Identity, as an addon sees itself. */
interface AddonIdentity {
  id: string;
  fqid: string;
  name: string;
  version: string;
  marketplace: string;
}

/** Where the addon is running. */
interface GameIdentity {
  host: string;
  channel: Channel;
  /** The client version, patch restored. Null before the footer is readable. */
  version: string | null;
  build: string | null;
}

interface WocApi extends TimersApi, LogApi {
  readonly addon: AddonIdentity;
  readonly api: number;
  readonly apiMinor: number;
  readonly game: GameIdentity;
  readonly net: NetApi;
  readonly world: WorldApi;
  readonly ui: UiApi;
  readonly sound: SoundApi;
  readonly keys: KeysApi;
  readonly storage: AddonStorageApi;
  /** Publish and subscribe between addons, in this page. */
  readonly bus: BusApi;
  /** Durations, ids as words, counted nouns, arrows. */
  readonly fmt: FmtApi;
  /** A JSON file declared as `data` in the manifest, fetched at install and read from cache. */
  data: (name: string) => Promise<unknown>;
  /** Hydrated from the manifest schema before the addon's code runs. */
  readonly settings: SettingValues;
  onSettingsChange: (handler: SettingsChangeHandler) => Teardown;
  onDispose: (teardown: Teardown) => Teardown;
  /** The loader's frame loop. `dt` is ms since the last frame, 0 on the first, clamped at 250. */
  onFrame: (handler: (dt: number) => void) => Teardown;
  /** A repaint coalesced to once a frame. See runtime/api/paint.ts. */
  paint: PaintApi;
  /** Monotonic milliseconds. Right for an interval, wrong for anything you store. */
  now: () => number;
  /** Epoch milliseconds. Store this, never `now`, which reads as the future after a reload. */
  wallClock: () => number;
}

/** Everything shared across every addon, built once by the runtime. */
interface SharedServices {
  doc: Document;
  window: TimerHost & Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  net: NetHub;
  world: WorldHub;
  storage: StorageHub;
  /** The inter-addon bus. Page realm only; nothing on it crosses the bridge. */
  bus: BusHub;
  sound: SoundEngine;
  dispatcher: KeyDispatcher;
  gameBindings: GameBindings;
  logs: LogBuffer;
  /** The one animation-frame loop. */
  frames: FrameLoop;
  kit: UiKit;
  channel: Channel;
  host: string;
  gameVersion: () => { version: string | null; build: string | null };
  /** The character in play, for per-character frame state. Null before entry. */
  character: () => string | null;
  /**
   * Resolves at world entry, when per-character state first has a key. A function, not a promise,
   * because asking costs a world subscription.
   */
  characterKnown: () => Promise<void>;
  /** One addon's declared data file, from the host's install-time cache. */
  addonData: (fqid: string, name: string) => Promise<string>;
  now: () => number;
  wallClock: () => number;
  viewport: () => { w: number; h: number };
  /** Which variant of a family sound cue to play. */
  pick: (count: number) => number;
}

interface AddonContext {
  manifest: AddonManifest;
  fqid: string;
  marketplace: string;
  bag: DisposalBag;
}

interface AddonApi {
  woc: WocApi;
  /** Read settings and keybinds. Awaited before the addon's code is evaluated. */
  hydrate: () => Promise<void>;
  settings: SettingsStore;
}

/** Identity is frozen: an addon must not be able to rename itself to another. */
function addonIdentity(addon: AddonContext): AddonIdentity {
  return Object.freeze({
    id: addon.manifest.id,
    fqid: addon.fqid,
    name: addon.manifest.name,
    version: addon.manifest.version,
    marketplace: addon.marketplace,
  });
}

export type { AddonApi, AddonContext, AddonIdentity, GameIdentity, SharedServices, WocApi };
export { addonIdentity };
