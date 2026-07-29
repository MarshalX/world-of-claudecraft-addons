// Page-realm bootstrap: claim the boot payload, join the bridge, mount the UI.

import { proxy } from 'comlink';
import { diagError, diagInfo } from '../shared/diag.ts';
import { type MessageScope, takeBootPayload } from '../shared/handshake.ts';
import { type Channel, channelForOrigin } from '../shared/hosts.ts';
import type { RemoteHostApi } from '../shared/protocol.ts';
import type { SharedServices } from './api/index.ts';
import { connectHost, type HostConnection } from './bridge.ts';
import { type DiagnosticsReading, readDiagnostics } from './diagnostics.ts';
import { clearTimer, setTimer } from './dom-timers.ts';
import { createHostEventHandler } from './host-events.ts';
import { type GameProbe, probeGame } from './probe.ts';
import { waitForDocument } from './ready.ts';
import { createRuntimeServices, type RuntimeServices } from './services.ts';
import type { AddonStatus } from './supervisor.ts';
import { createSupervisor, type Supervisor } from './supervisor.ts';
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
  supervisor: Supervisor;
}

/** The supervisor as the manager sees it, resolved lazily. See startUi. */
interface SupervisorView {
  statuses: () => readonly AddonStatus[];
  reload: (fqid: string) => Promise<void>;
  reloadAll: () => Promise<void>;
}

/**
 * The supervisor, held before it exists.
 *
 * One indirection breaks a real cycle: the manager renders each addon's run
 * status and drives Reload, so it needs the supervisor; the supervisor evaluates
 * addons against the shared services, and the UI kit is one of those services.
 * Every member below is called from a click, a repaint, or a host event, all of
 * which happen after the slot is filled.
 */
function supervisorSlot() {
  let supervisor: Supervisor | null = null;
  return {
    fill: (value: Supervisor): void => {
      supervisor = value;
    },
    view: {
      statuses: () => supervisor?.statuses() ?? [],
      reload: (fqid: string) => supervisor?.reload(fqid) ?? Promise.resolve(),
      reloadAll: () => supervisor?.reloadAll() ?? Promise.resolve(),
    } satisfies SupervisorView,
    // Both absorb their own failures and record them as addon status, so there
    // is nothing to await or to catch: these exist so an event handler stays a
    // statement rather than an expression nobody reads the result of.
    resync: (): void => {
      supervisor?.sync().catch(() => undefined);
    },
    reload: (fqid: string): void => {
      supervisor?.reload(fqid).catch(() => undefined);
    },
  };
}

/** One live reading, resolved when the pane asks rather than captured at mount. */
function diagnosticsFor(deps: UiStartDeps): DiagnosticsReading {
  return readDiagnostics({
    doc: globalThis.document,
    origin: deps.scope.location.origin,
    channel: deps.channel,
    loaderVersion: deps.loaderVersion,
    bridged: deps.host !== null,
    net: deps.surfaces.net.state(),
    probe: deps.slot.value,
  });
}

/** Everything mountUi reads, gathered so startUi stays a wiring function. */
function uiDeps(
  deps: UiStartDeps,
  services: RuntimeServices,
  view: SupervisorView,
): Parameters<typeof mountUi>[0] {
  const { host } = deps;
  return {
    doc: globalThis.document,
    css: LOADER_CSS,
    channel: deps.channel,
    // All four are null together: a failed handshake costs the registry, not
    // the UI, and the manager reports that in its own panes.
    registry: host?.registry ?? null,
    market: host?.market ?? null,
    dev: host?.dev ?? null,
    storage: host?.storage ?? null,
    ...view,
    ...pageServices(),
    storageHub: services.storage,
    gameBindings: services.gameBindings,
    dispatcher: services.dispatcher,
    logs: services.logs,
    readDiagnostics: () => diagnosticsFor(deps),
  };
}

/** The half of the UI's dependencies that is just the page it renders into. */
function pageServices() {
  return {
    setTimer,
    clearTimer,
    viewport: () => ({ w: globalThis.innerWidth, h: globalThis.innerHeight }),
    // The browser's own locale, which is the game's page locale. The loader has
    // no translation layer yet, and a hardcoded format would be the one part of
    // the manager that ignores the player's regional settings.
    formatTime: (at: number) => new Date(at).toLocaleTimeString(),
  };
}

/**
 * Bring up the loader's own UI and the services every addon shares.
 *
 * Gated on the document rather than on the game, so the manager is reachable
 * from the login screen and from a session that never gets that far. The
 * services follow the UI because the UI kit is one of them.
 */
async function startUi(deps: UiStartDeps): Promise<StartedRuntime> {
  const { host } = deps;
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

  const slot = supervisorSlot();
  const ui = mountUi(uiDeps(deps, services, slot.view));

  const shared = services.withKit(ui.kit);
  const supervisor = createSupervisor({
    shared,
    registry: host?.registry ?? null,
    channel: deps.channel,
    onChange: () => {
      ui.manager.repaint();
    },
  });
  slot.fill(supervisor);

  // proxy() is what lets the sandbox call back into this realm. Storage changes
  // are the reason it exists for anything but the manager: an addon's settings
  // written in one tab have to reach its running copy in every other.
  await host?.subscribe(
    proxy(
      createHostEventHandler({
        manager: ui.manager,
        resync: slot.resync,
        reload: slot.reload,
        deliverStorage: (ns, key, value) => {
          services.storage.deliver(ns, key, value);
        },
      }),
    ),
  );

  // The first reconcile. Everything an enabled addon needs is in place by now:
  // the socket hook, the keydown listener, the UI kit, and the storage hub.
  await supervisor.sync();

  return { ui, shared, services, supervisor };
}

export interface RuntimeBoot {
  /** Null when the handshake failed, which does not stop the UI. */
  connection: HostConnection | null;
  surfaces: GameSurfaces;
  ui: MountedUi;
  /** What runtime/loader.ts builds each addon's `woc` object out of. */
  shared: SharedServices;
  services: RuntimeServices;
  supervisor: Supervisor;
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

  const { ui, shared, services, supervisor } = await startUi({
    scope,
    loaderVersion: payload.version,
    surfaces,
    channel,
    host,
    slot,
  });
  return { connection, surfaces, ui, shared, services, supervisor };
}
