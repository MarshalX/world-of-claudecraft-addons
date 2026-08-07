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
import { reportedOnce } from '../frame-loop.ts';
import type { SettingValues } from '../settings/values.ts';
import { createLogSurface, createStores, createSurfaces } from './bind.ts';
import type { AddonApi, AddonContext, GameIdentity, SharedServices, WocApi } from './context.ts';
import { addonIdentity } from './context.ts';
import { createFmtApi } from './fmt.ts';
import type { LogApi } from './log.ts';
import { createPaintApi } from './paint.ts';
import { createTimers } from './timers.ts';

/** Both the bag and the addon hold the unsubscribe, so an explicit call drops both. */
function tracked(bag: DisposalBag, off: Teardown): Teardown {
  const drop = bag.add(off);
  return () => {
    drop();
    off();
  };
}

/**
 * The addon's seat on the loader's one animation-frame loop.
 *
 * Bagged, so a disabled addon stops drawing without having written that: disable
 * is hot with no page reload, and a bare frame loop would go on running against
 * DOM the loader has already removed. Guarded against the ADDON's own log rather
 * than the diagnostics channel, so a throw lands where its author is looking, and
 * reported once rather than sixty times a second for the rest of the session.
 */
function frameSurface(
  shared: SharedServices,
  bag: DisposalBag,
  log: LogApi,
): Pick<WocApi, 'onFrame'> {
  const report = (err: unknown): void => {
    log.error('an onFrame handler threw, and further throws from it are not reported', err);
  };
  return {
    onFrame: (handler) => tracked(bag, shared.frames.on(reportedOnce(report, handler))),
  };
}

/**
 * The coalesced repaint, on the same loop and reported the same way.
 *
 * Beside `frameSurface` rather than in `api/timers.ts`, which owns the PLATFORM
 * timers and is built from a `TimerHost` alone: the loader's loop is a shared
 * service, and a repaint that armed its own `requestAnimationFrame` would be one
 * browser callback per addon and would keep drawing while the loader is frozen.
 */
function paintSurface(
  shared: SharedServices,
  bag: DisposalBag,
  log: LogApi,
): Pick<WocApi, 'paint'> {
  const report = (err: unknown): void => {
    log.error('a paint handler threw, and further throws from it are not reported', err);
  };
  return { paint: createPaintApi({ frames: shared.frames, bag, report }) };
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

    // Not built per addon and not bagged: pure functions with no context and
    // nothing to tear down, so every addon is handed the same frozen object.
    fmt: createFmtApi(),

    get settings(): SettingValues {
      return settings.values();
    },

    onSettingsChange: (handler) => tracked(bag, settings.onChange(handler)),

    onDispose: (teardown) => bag.add(teardown),

    ...frameSurface(shared, bag, log),
    ...paintSurface(shared, bag, log),

    now: shared.now,

    wallClock: shared.wallClock,
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
