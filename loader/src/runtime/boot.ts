// Page-realm bootstrap: claim the boot payload, join the bridge, mount the UI.

import { proxy } from 'comlink';
import { diagError, diagInfo } from '../shared/diag.ts';
import { type MessageScope, takeBootPayload } from '../shared/handshake.ts';
import { type Channel, channelForOrigin } from '../shared/hosts.ts';
import type { HostEvent, RemoteHostApi } from '../shared/protocol.ts';
import type { SharedServices } from './api/index.ts';
import { connectHost, type HostConnection } from './bridge.ts';
import { readDiagnostics } from './diagnostics.ts';
import { type GameProbe, probeGame } from './probe.ts';
import { waitForDocument } from './ready.ts';
import { createRuntimeServices, type RuntimeServices } from './services.ts';
import { createGameSurfaces, type GameSurfaces } from './surfaces.ts';
import { type MountedUi, mountUi } from './ui/mount.ts';
// The three sheets bundled as text and joined into the one injected <style>.
import { LOADER_CSS } from './ui/styles/index.ts';

/** Held so the manager's Diagnostics pane can report the probe after the fact. */
interface ProbeSlot {
  value: GameProbe | null;
}

/**
 * Report the __game shape once the game reaches world entry.
 *
 * Recorded per host on purpose: PBE runs ahead of live, so a member that goes
 * missing there is the earliest warning that a game update will break addons.
 */
function reportProbe(surfaces: GameSurfaces, channel: string, slot: ProbeSlot): void {
  surfaces.world.ready
    .then(() => {
      const probe = probeGame(surfaces.world.game());
      slot.value = probe;
      diagInfo(`__game on ${channel}: ${probe.present.length} members`, probe);
    })
    .catch((err: unknown) => {
      diagError('the game never became readable', err);
    });
}

interface UiStartDeps {
  scope: MessageScope;
  loaderVersion: string;
  surfaces: GameSurfaces;
  channel: Channel;
  /** Null when the handshake failed. The manager reports that in its own panes. */
  host: RemoteHostApi | null;
  slot: ProbeSlot;
}

interface StartedRuntime {
  ui: MountedUi;
  /** The completed per-addon service bundle, once the UI kit exists. */
  shared: SharedServices;
  services: RuntimeServices;
}

/**
 * Bring up the loader's own UI and the services every addon shares.
 *
 * Gated on the document rather than on the game, so the manager is reachable
 * from the login screen and from a session that never gets that far. The
 * services follow the UI because the UI kit is one of them.
 */
async function startUi(deps: UiStartDeps): Promise<StartedRuntime> {
  const { scope, host } = deps;
  await waitForDocument({ doc: globalThis.document });

  const win = globalThis as unknown as Window;
  // Before the UI, because the manager edits addon settings and keybinds through
  // the same storage hub and the same dispatcher an addon uses. The UI kit is
  // itself a service, which is why it is attached afterwards rather than passed
  // in: see services.ts.
  const services = createRuntimeServices({
    scope: win,
    surfaces: deps.surfaces,
    channel: deps.channel,
    storage: host?.storage ?? null,
  });

  const ui = mountUi({
    doc: globalThis.document,
    css: LOADER_CSS,
    registry: host?.registry ?? null,
    storage: host?.storage ?? null,
    channel: deps.channel,
    setTimer: (handler, ms) => globalThis.setTimeout(handler, ms),
    clearTimer: (id) => {
      globalThis.clearTimeout(id);
    },
    viewport: () => ({ w: globalThis.innerWidth, h: globalThis.innerHeight }),
    storageHub: services.storage,
    gameBindings: services.gameBindings,
    dispatcher: services.dispatcher,
    logs: services.logs,
    readDiagnostics: () =>
      readDiagnostics({
        doc: globalThis.document,
        origin: scope.location.origin,
        channel: deps.channel,
        loaderVersion: deps.loaderVersion,
        bridged: host !== null,
        net: deps.surfaces.net.state(),
        probe: deps.slot.value,
      }),
  });

  // proxy() is what lets the sandbox call back into this realm. Storage changes
  // are the reason it exists for anything but the manager: an addon's settings
  // written in one tab have to reach its running copy in every other.
  await host?.subscribe(
    proxy((event: HostEvent) => {
      if (event.k === 'ui.open') {
        ui.manager.open();
      } else if (event.k === 'registry.changed') {
        ui.manager.invalidate();
      } else if (event.k === 'storage.changed') {
        services.storage.deliver(event.ns, event.key, event.value);
      }
    }),
  );

  return { ui, shared: services.withKit(ui.kit), services };
}

export interface RuntimeBoot {
  /** Null when the handshake failed, which does not stop the UI. */
  connection: HostConnection | null;
  surfaces: GameSurfaces;
  ui: MountedUi;
  /** What runtime/loader.ts builds each addon's `woc` object out of, in M5. */
  shared: SharedServices;
  services: RuntimeServices;
}

/**
 * Reads the payload before anything can yield, so no page code observes the
 * transient global. Everything after that point is asynchronous.
 */
export async function bootRuntime(scope: MessageScope): Promise<RuntimeBoot | null> {
  const payload = takeBootPayload(scope as unknown as Record<string, unknown>);
  if (payload === null) {
    diagError('runtime started without a boot payload');
    return null;
  }

  const channel = channelForOrigin(scope.location.origin);
  if (channel === null) {
    return null;
  }

  // Before the bridge, not after: the socket hook has to be in place ahead of
  // the game's first connection, and the handshake has no bearing on that.
  const surfaces = createGameSurfaces();
  const slot: ProbeSlot = { value: null };
  reportProbe(surfaces, channel, slot);

  // A failed handshake costs the registry, not the UI. The manager is how a
  // player finds out the loader is broken, so it comes up either way.
  let connection: HostConnection | null = null;
  let host: RemoteHostApi | null = null;
  try {
    connection = await connectHost({ win: scope, nonce: payload.nonce });
    ({ host } = connection);
    diagInfo(`bridge connected on ${channel}`);
  } catch (err) {
    diagError('bridge handshake failed, addons will not load', err);
  }

  const { ui, shared, services } = await startUi({
    scope,
    loaderVersion: payload.version,
    surfaces,
    channel,
    host,
    slot,
  });
  return { connection, surfaces, ui, shared, services };
}
