// What the `woc` object IS, apart from how it is assembled.
//
// Split out of api/index.ts when that file crossed the size limit, and the seam
// is a real one rather than a place to cut: this file is the CONTRACT (the shape
// an addon is handed, and the shape the runtime has to supply for one to be
// built) while index.ts is the assembly and api/bind.ts is the wiring. Nothing
// here constructs anything, which is why it can be imported by both without a
// cycle.

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
  /** Durations, ids as words, counted nouns, arrows. Pure, and shared by every addon. */
  readonly fmt: FmtApi;
  /**
   * A JSON file from this addon's own directory, declared as `data` in the
   * manifest. Fetched by the loader at install; this is a cached read.
   */
  data: (name: string) => Promise<unknown>;
  /** Hydrated from the manifest schema before the addon's code runs. */
  readonly settings: SettingValues;
  onSettingsChange: (handler: SettingsChangeHandler) => Teardown;
  onDispose: (teardown: Teardown) => Teardown;
  /**
   * Run something on the loader's own animation-frame loop.
   *
   * `dt` is milliseconds since the previous frame, 0 on the first, clamped at 250.
   * Top level rather than under `ui`, because a decay curve and a meter's
   * arithmetic are as much a use of a frame tick as a sweep is.
   */
  onFrame: (handler: (dt: number) => void) => Teardown;
  /**
   * A repaint that runs at most once a frame, however many times it is asked for.
   *
   * Returns the function that asks. See runtime/api/paint.ts.
   */
  paint: PaintApi;
  /** Monotonic milliseconds. Right for an interval, wrong for anything you store. */
  now: () => number;
  /**
   * Epoch milliseconds, as `Date.now` reads them.
   *
   * Declared next to `now` because the choice between them is the whole hazard:
   * an author following the prefer-`woc` rule reaches for the monotonic one,
   * stores it, and gets a stamp that reads as being in the future on the next
   * page load, with nothing to indicate it.
   */
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
  /** The one animation-frame loop. See runtime/frame-loop.ts. */
  frames: FrameLoop;
  kit: UiKit;
  channel: Channel;
  host: string;
  gameVersion: () => { version: string | null; build: string | null };
  /** The character in play, for per-character frame state. Null before entry. */
  character: () => string | null;
  /**
   * Resolves the first time there IS a character, which is world entry.
   *
   * Per-character state cannot be read before then: there is no key to read it
   * under. An addon builds its frames at document-start, so without this the one
   * read of a saved position happens on the landing page, finds nothing, and is
   * never tried again.
   *
   * A function rather than a promise because asking for it costs a world
   * subscription, and only an addon with a saved frame ever asks.
   */
  characterKnown: () => Promise<void>;
  /**
   * One addon's declared data file, out of the host's install-time cache.
   *
   * A function rather than a hub, because there is no event to route and no state
   * to hold: the host answers, the per-addon surface in api/data.ts memoises.
   */
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
