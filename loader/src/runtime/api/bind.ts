// Which shared hub, fqid and disposal bag each surface is bound to, one function per domain, so a
// miswired surface shows here as an odd line. Contract in context.ts, assembly in index.ts.

import { createKeybindStore, type KeybindStore } from '../keys/store.ts';
import { CONSOLE_SINK } from '../log/console.ts';
import { createSettingsStore, type SettingsStore } from '../settings/store.ts';
import { createFrameStateStore } from '../ui/kit/frame-state.ts';
import { createFrameToggles, type FrameToggles } from '../ui/kit/frame-toggle.ts';
import { type BusApi, createBus } from './bus.ts';
import type { AddonContext, SharedServices, WocApi } from './context.ts';
import { createData } from './data.ts';
import { createKeys, type KeysApi } from './keys.ts';
import { createLog, type LogApi } from './log.ts';
import { createNet, type NetTimers } from './net.ts';
import { createSound, type SoundApi } from './sound.ts';
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

/** `onError` reports addon callback throws to the addon's own log, where a player can quote it. */
function createUiSurface(
  shared: SharedServices,
  addon: AddonContext,
  log: LogApi,
  toggles: FrameToggles,
): UiApi {
  return createUi({
    doc: shared.doc,
    kit: shared.kit,
    fqid: addon.fqid,
    addonName: addon.manifest.name,
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
    toggles,
    viewport: shared.viewport,
    window: shared.window,
  });
}

/** `onError` is this addon's log: the throw is in a handler it wrote, not in the sender. */
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

function createStorageSurface(shared: SharedServices, addon: AddonContext): AddonStorageApi {
  return createStorage({
    hub: shared.storage,
    fqid: addon.fqid,
    channel: shared.channel,
    character: shared.character,
    known: shared.characterKnown,
  });
}

/** Bound to the manifest's list, so a name is a membership test, never a path join. */
function createDataSurface(shared: SharedServices, addon: AddonContext): WocApi['data'] {
  return createData({
    fqid: addon.fqid,
    declared: addon.manifest.data,
    read: shared.addonData,
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

/**
 * An addon declaring `sound` warms the lazy pack read at start, so its first cue does not take a
 * guessed URL. An undeclared addon still plays; the permission is a disclosure.
 */
function createSoundSurface(shared: SharedServices, addon: AddonContext): SoundApi {
  if (addon.manifest.permissions?.includes('sound') === true) {
    shared.sound.warm();
  }
  return createSound(shared.sound, addon.bag);
}

/** The domain surfaces, all bound to one addon and one bag. */
type AddonSurfaces = Pick<
  WocApi,
  'bus' | 'data' | 'keys' | 'net' | 'sound' | 'storage' | 'ui' | 'world'
>;

function createSurfaces(
  shared: SharedServices,
  addon: AddonContext,
  keybinds: KeybindStore,
  log: LogApi,
): AddonSurfaces {
  // Keys before ui: a frame's `toggleKey` goes through `keys.bind`, so a rebind moves it.
  const keys = createKeysSurface(shared, addon, keybinds);
  const toggles = createFrameToggles({
    bind: keys.bind,
    warn: (message, err) => {
      log.warn(message, err);
    },
  });

  return {
    net: createNet(shared.net, addon.bag, createNetTimers(shared)),
    world: createWorld(shared.world, addon.bag),
    ui: createUiSurface(shared, addon, log, toggles),
    sound: createSoundSurface(shared, addon),
    keys,
    bus: createBusSurface(shared, addon, log),
    storage: createStorageSurface(shared, addon),
    data: createDataSurface(shared, addon),
  };
}

export type { AddonStores, AddonSurfaces };
export { createLogSurface, createStores, createSurfaces };
