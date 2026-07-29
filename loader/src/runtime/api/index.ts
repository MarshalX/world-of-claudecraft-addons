// The `woc` object one addon is handed.
//
// Assembly only: every surface is built in its own module and this file says
// which shared thing each one is bound to. What makes the object per-addon is
// the disposal bag threaded through all of them, so disabling the addon
// releases its listeners, frames, keybinds, timers, and toasts without the
// addon writing any cleanup.
//
// The addon lifecycle itself (fetching source, evaluating it, auto-disabling one
// that throws) is runtime/loader.ts and arrives with M5. This builds the surface
// that lifecycle hands over.

import { API_VERSION } from '../../shared/api-version.ts';
import type { Channel } from '../../shared/hosts.ts';
import type { AddonManifest } from '../../shared/schema.ts';
import type { DisposalBag, Teardown } from '../disposal.ts';
import type { KeyDispatcher } from '../keys/dispatcher.ts';
import type { GameBindings } from '../keys/game-bindings.ts';
import { createKeybindStore, type KeybindStore } from '../keys/store.ts';
import type { LogBuffer } from '../log/buffer.ts';
import { CONSOLE_SINK } from '../log/console.ts';
import type { NetHub } from '../net/hub.ts';
import type { SettingsChangeHandler, SettingsStore } from '../settings/store.ts';
import { createSettingsStore } from '../settings/store.ts';
import type { SettingValues } from '../settings/values.ts';
import type { SoundEngine } from '../sound/engine.ts';
import type { StorageHub } from '../storage/hub.ts';
import { createFrameStateStore } from '../ui/kit/frame-state.ts';
import type { UiKit } from '../ui/mount.ts';
import type { WorldHub } from '../world/hub.ts';
import { createKeys, type KeysApi } from './keys.ts';
import { createLog, type LogApi } from './log.ts';
import { createNet, type NetApi, type NetTimers } from './net.ts';
import { createSound, type SoundApi } from './sound.ts';
import { type AddonStorageApi, createStorage } from './storage.ts';
import { createTimers, type TimerHost, type TimersApi } from './timers.ts';
import { createUi, type UiApi } from './ui.ts';
import { createWorld, type WorldApi } from './world.ts';

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
  readonly game: GameIdentity;
  readonly net: NetApi;
  readonly world: WorldApi;
  readonly ui: UiApi;
  readonly sound: SoundApi;
  readonly keys: KeysApi;
  readonly storage: AddonStorageApi;
  /** Hydrated from the manifest schema before the addon's code runs. */
  readonly settings: SettingValues;
  onSettingsChange: (handler: SettingsChangeHandler) => Teardown;
  onDispose: (teardown: Teardown) => Teardown;
  /** Monotonic milliseconds. */
  now: () => number;
}

/** Everything shared across every addon, built once by the runtime. */
interface SharedServices {
  doc: Document;
  window: TimerHost & Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  net: NetHub;
  world: WorldHub;
  storage: StorageHub;
  sound: SoundEngine;
  dispatcher: KeyDispatcher;
  gameBindings: GameBindings;
  logs: LogBuffer;
  kit: UiKit;
  channel: Channel;
  host: string;
  gameVersion: () => { version: string | null; build: string | null };
  /** The character in play, for per-character frame state. Null before entry. */
  character: () => string | null;
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

/** The two stores an addon carries, both hydrated before its code is evaluated. */
interface AddonStores {
  settings: SettingsStore;
  keybinds: KeybindStore;
}

function createStores(shared: SharedServices, addon: AddonContext): AddonStores {
  const { manifest, fqid, bag } = addon;

  const settings = createSettingsStore({
    fqid,
    decls: manifest.settings ?? [],
    hub: shared.storage,
  });
  bag.add(settings.dispose);

  const keybinds = createKeybindStore({
    fqid,
    decls: manifest.keybinds ?? [],
    hub: shared.storage,
  });
  bag.add(keybinds.dispose);

  return { settings, keybinds };
}

function createNetTimers(shared: SharedServices): NetTimers {
  return {
    setTimer: (handler, ms) => shared.window.setTimeout(handler, ms),
    clearTimer: (id) => {
      shared.window.clearTimeout(id);
    },
  };
}

/** The ui surface, with the per-character frame store it persists through. */
function createUiSurface(shared: SharedServices, addon: AddonContext): UiApi {
  return createUi({
    doc: shared.doc,
    kit: shared.kit,
    fqid: addon.fqid,
    bag: addon.bag,
    frameStore: createFrameStateStore({
      fqid: addon.fqid,
      hub: shared.storage,
      channel: shared.channel,
      character: shared.character,
    }),
    viewport: shared.viewport,
    window: shared.window,
  });
}

function createLogSurface(shared: SharedServices, addon: AddonContext): LogApi {
  return createLog({
    fqid: addon.fqid,
    buffer: shared.logs,
    now: shared.wallClock,
    sink: CONSOLE_SINK,
  });
}

function createKeysSurface(
  shared: SharedServices,
  addon: AddonContext,
  store: KeybindStore,
): KeysApi {
  return createKeys({
    fqid: addon.fqid,
    dispatcher: shared.dispatcher,
    store,
    game: shared.gameBindings,
    bag: addon.bag,
  });
}

/** Both the bag and the addon hold the unsubscribe, so an explicit call drops both. */
function tracked(bag: DisposalBag, off: Teardown): Teardown {
  const drop = bag.add(off);
  return () => {
    drop();
    off();
  };
}

function createAddonApi(shared: SharedServices, addon: AddonContext): AddonApi {
  const { fqid, bag } = addon;
  const { settings, keybinds } = createStores(shared, addon);
  const timers = createTimers(shared.window, bag);

  const woc: WocApi = {
    ...timers,
    ...createLogSurface(shared, addon),

    addon: addonIdentity(addon),

    api: API_VERSION,

    // A getter, because the footer is not readable until the document is, and
    // an addon holding `woc.game` from its first line should still see the
    // version once there is one.
    get game(): GameIdentity {
      const { version, build } = shared.gameVersion();
      return { host: shared.host, channel: shared.channel, version, build };
    },

    net: createNet(shared.net, bag, createNetTimers(shared)),
    world: createWorld(shared.world, bag),

    ui: createUiSurface(shared, addon),

    sound: createSound(shared.sound, bag),

    keys: createKeysSurface(shared, addon, keybinds),

    storage: createStorage(shared.storage, fqid),

    get settings(): SettingValues {
      return settings.values();
    },

    onSettingsChange: (handler) => tracked(bag, settings.onChange(handler)),

    onDispose: (teardown) => bag.add(teardown),

    now: shared.now,
  };

  return {
    woc,
    settings,
    // Both are read before the addon's code runs, so `woc.settings.window` is
    // correct on its first line rather than briefly the default.
    hydrate: async () => {
      await Promise.all([settings.hydrate(), keybinds.hydrate()]);
    },
  };
}

export type { AddonApi, AddonContext, AddonIdentity, GameIdentity, SharedServices, WocApi };
export { createAddonApi };
