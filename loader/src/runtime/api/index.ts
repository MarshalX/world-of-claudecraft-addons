// The `woc` object one addon is handed.
//
// Assembly only. What each surface is bound to is api/bind.ts and what the object
// IS is api/context.ts; this file decides the ORDER, which is the part that has to
// be in one place. What makes the object per-addon is the disposal bag threaded
// through all of them, so disabling the addon releases its listeners, frames,
// keybinds, timers, and toasts without the addon writing any cleanup.
//
// The lifecycle itself lives elsewhere: runtime/loader.ts hydrates and evaluates
// one addon's source, and runtime/supervisor.ts decides which addons are running
// and records a throw as `failed` while LEAVING THE ROW ENABLED. This file only
// builds the surface that lifecycle hands over.

import { API_MINOR, API_VERSION } from '../../shared/api-version.ts';
import type { DisposalBag, Teardown } from '../disposal.ts';
import type { SettingValues } from '../settings/values.ts';
import { createLogSurface, createStores, createSurfaces } from './bind.ts';
import type { AddonApi, AddonContext, GameIdentity, SharedServices, WocApi } from './context.ts';
import { addonIdentity } from './context.ts';
import { createTimers } from './timers.ts';

/** Both the bag and the addon hold the unsubscribe, so an explicit call drops both. */
function tracked(bag: DisposalBag, off: Teardown): Teardown {
  const drop = bag.add(off);
  return () => {
    drop();
    off();
  };
}

function createAddonApi(shared: SharedServices, addon: AddonContext): AddonApi {
  const { bag } = addon;
  const { settings, keybinds } = createStores(shared, addon);
  const timers = createTimers(shared.window, bag);

  const log = createLogSurface(shared, addon);

  const woc: WocApi = {
    ...timers,
    ...log,

    addon: addonIdentity(addon),

    api: API_VERSION,

    apiMinor: API_MINOR,

    // A getter, because the footer is not readable until the document is, and
    // an addon holding `woc.game` from its first line should still see the
    // version once there is one.
    get game(): GameIdentity {
      const { version, build } = shared.gameVersion();
      return { host: shared.host, channel: shared.channel, version, build };
    },

    ...createSurfaces(shared, addon, keybinds, log),

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

export type {
  AddonApi,
  AddonContext,
  AddonIdentity,
  GameIdentity,
  SharedServices,
  WocApi,
} from './context.ts';
export { createAddonApi };
