// Assembles the `woc` object one addon is handed, in order. Binding is in bind.ts, the contract in
// context.ts; the disposal bag threaded through every surface is what makes it per-addon.

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

/** An explicit unsubscribe also drops the bag entry. */
function tracked(bag: DisposalBag, off: Teardown): Teardown {
  const drop = bag.add(off);
  return () => {
    drop();
    off();
  };
}

/** Bagged, and a throw is reported once to the addon's own log, where its author looks. */
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

/** The coalesced repaint, on the shared loop: no callback per addon, and it obeys the freeze. */
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

    // A getter: the version footer is unreadable at the addon's first line.
    get game(): GameIdentity {
      const { version, build } = shared.gameVersion();
      return { host: shared.host, channel: shared.channel, version, build };
    },

    ...createSurfaces(shared, addon, keybinds, log),

    // Pure functions, so every addon shares one frozen object.
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
    // Read before the addon runs, so its first line sees stored values, not defaults.
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
