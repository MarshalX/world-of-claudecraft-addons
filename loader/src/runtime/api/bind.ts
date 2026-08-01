// Which shared thing each surface is bound to.
//
// One function per domain, and every one of them says the same three things: the
// hub or engine it reads, the addon's fqid, and the addon's disposal bag. That
// repetition is the point of the file existing: it is the ONE place to look for
// "what is this surface actually connected to", and a surface wired to the wrong
// hub or given nobody's bag is visible here as an odd line rather than buried in
// a two-hundred-line constructor.
//
// The contract these build against is api/context.ts, and the assembly that calls
// them is api/index.ts. Nothing here knows the order they are built in.

import { createKeybindStore, type KeybindStore } from '../keys/store.ts';
import { CONSOLE_SINK } from '../log/console.ts';
import { createSettingsStore, type SettingsStore } from '../settings/store.ts';
import { createFrameStateStore } from '../ui/kit/frame-state.ts';
import { type BusApi, createBus } from './bus.ts';
import type { AddonContext, SharedServices, WocApi } from './context.ts';
import { createKeys, type KeysApi } from './keys.ts';
import { createLog, type LogApi } from './log.ts';
import { createNet, type NetTimers } from './net.ts';
import { createSound } from './sound.ts';
import { type AddonStorageApi, createStorage } from './storage.ts';
import { createUi, type UiApi } from './ui.ts';
import { createWorld } from './world.ts';

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

/**
 * The ui surface, with the per-character frame store it persists through.
 *
 * `onError` is the addon's own logger. The one callback the ui surface hands back
 * to addon code, a frame's `onMove`, runs inside a pointer gesture the LOADER is
 * in the middle of, so a throw there must cost a warning rather than a window that
 * stops following the pointer. Reported through the addon's log rather than
 * swallowed, so it reaches the manager's log tail where a player can quote it.
 */
function createUiSurface(shared: SharedServices, addon: AddonContext, log: LogApi): UiApi {
  return createUi({
    doc: shared.doc,
    kit: shared.kit,
    fqid: addon.fqid,
    bag: addon.bag,
    onError: (where, err) => {
      log.error(`${where} threw`, err);
    },
    frameStore: createFrameStateStore({
      fqid: addon.fqid,
      hub: shared.storage,
      channel: shared.channel,
      character: shared.character,
      known: shared.characterKnown,
    }),
    viewport: shared.viewport,
    window: shared.window,
  });
}

/**
 * The bus surface.
 *
 * `onError` is the addon's OWN log rather than the sender's, because the throw it
 * reports happened in a handler this addon wrote: the addon that published the
 * message has nothing it could do about somebody else's bug, and telling it would
 * be reporting a fault against the wrong author.
 */
function createBusSurface(shared: SharedServices, addon: AddonContext, log: LogApi): BusApi {
  return createBus({
    hub: shared.bus,
    fqid: addon.fqid,
    bag: addon.bag,
    onError: (where, err) => {
      log.error(`${where} threw`, err);
    },
  });
}

/** The storage surface: the account-wide store, and the per-character one on it. */
function createStorageSurface(shared: SharedServices, addon: AddonContext): AddonStorageApi {
  return createStorage({
    hub: shared.storage,
    fqid: addon.fqid,
    channel: shared.channel,
    character: shared.character,
    known: shared.characterKnown,
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

/** The domain surfaces, every one of them bound to the same addon and the same bag. */
type AddonSurfaces = Pick<WocApi, 'bus' | 'keys' | 'net' | 'sound' | 'storage' | 'ui' | 'world'>;

function createSurfaces(
  shared: SharedServices,
  addon: AddonContext,
  keybinds: KeybindStore,
  log: LogApi,
): AddonSurfaces {
  return {
    net: createNet(shared.net, addon.bag, createNetTimers(shared)),
    world: createWorld(shared.world, addon.bag),
    ui: createUiSurface(shared, addon, log),
    sound: createSound(shared.sound, addon.bag),
    keys: createKeysSurface(shared, addon, keybinds),
    bus: createBusSurface(shared, addon, log),
    storage: createStorageSurface(shared, addon),
  };
}

export type { AddonStores, AddonSurfaces };
export { createLogSurface, createStores, createSurfaces };
