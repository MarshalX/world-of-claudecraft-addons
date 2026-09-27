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
import { createLoaderBinds, type LoaderBinds, UNLOCK_BIND } from './keys/loader-binds.ts';
import { type GameProbe, probeGame } from './probe.ts';
import { waitForDocument } from './ready.ts';
import { createRuntimeServices, type RuntimeServices } from './services.ts';
import { fetchJson } from './sound/web-audio.ts';
import type { AddonStatus } from './supervisor.ts';
import { createSupervisor, type Supervisor } from './supervisor.ts';
import { createGameSurfaces, type GameSurfaces } from './surfaces.ts';
import { type MountedUi, mountUi } from './ui/mount.ts';
import { LOADER_CSS } from './ui/styles/index.ts';
import { createUnitPoints } from './world/anchor-point.ts';
import { createProjector } from './world/project.ts';
import { contextOf } from './world/unit-context.ts';

/** Held so the manager's Diagnostics pane can report the probe after the fact. */
interface ProbeSlot {
  value: GameProbe | null;
}

/** Recorded per host: channels diverge, so a member missing on one is an early warning. */
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
  /** The loader's own keybinds, which outlive every addon. */
  loaderBinds: LoaderBinds;
}

/** The supervisor as the manager sees it, resolved lazily. See startUi. */
interface SupervisorView {
  statuses: () => readonly AddonStatus[];
  reload: (fqid: string) => Promise<void>;
  reloadAll: () => Promise<void>;
}

/**
 * The supervisor, held before it exists, to break a cycle: the manager needs the supervisor, which
 * needs the shared services, which include the UI kit. Every member is called after the fill.
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
    // Failures are recorded as addon status, so there is nothing to await.
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

/** Registered after the UI, because what they switch is part of the kit. */
function bindLoaderKeys(services: RuntimeServices, ui: MountedUi): LoaderBinds {
  const binds = createLoaderBinds({
    hub: services.storage,
    dispatcher: services.dispatcher,
    onUnlock: () => {
      ui.kit.unlock.toggle();
    },
  });
  // Read from the store, so the hint names the combo the player rebound it to.
  ui.kit.arrangeHint.setCombo(() => binds.store.combo(UNLOCK_BIND));
  return binds;
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
    // All four are null together when the handshake failed; the UI comes up anyway.
    registry: host?.registry ?? null,
    market: host?.market ?? null,
    dev: host?.dev ?? null,
    storage: host?.storage ?? null,
    ...view,
    ...pageServices(),
    frames: services.frames,
    project: createProjector(() => deps.surfaces.world.game()),
    // The context `world.unit` uses, so 'target' means one unit everywhere.
    unitPoint: createUnitPoints({
      game: () => deps.surfaces.world.game(),
      context: () => contextOf(deps.surfaces.world),
    }),
    storageHub: services.storage,
    gameBindings: services.gameBindings,
    dispatcher: services.dispatcher,
    logs: services.logs,
    readDiagnostics: () => diagnosticsFor(deps),
  };
}

/** The UI dependencies that are just the page. */
function pageServices() {
  return {
    setTimer,
    clearTimer,
    viewport: () => ({ w: globalThis.innerWidth, h: globalThis.innerHeight }),
    fetchJson,
    // The browser locale, so the manager follows the player's regional settings.
    formatTime: (at: number) => new Date(at).toLocaleTimeString(),
  };
}

/** Gated on the document, not the game, so the manager is reachable from the login screen. */
async function startUi(deps: UiStartDeps): Promise<StartedRuntime> {
  const { host } = deps;
  await waitForDocument({ doc: globalThis.document });

  const win = globalThis as unknown as Window;
  // Before the UI, which edits settings and keybinds through these same services.
  const services = createRuntimeServices({
    scope: win,
    surfaces: deps.surfaces,
    channel: deps.channel,
    storage: host?.storage ?? null,
    registry: host?.registry ?? null,
  });

  const slot = supervisorSlot();
  const ui = mountUi(uiDeps(deps, services, slot.view));

  const loaderBinds = bindLoaderKeys(services, ui);

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

  // proxy() lets the sandbox call back, which is how a write in one tab reaches the others.
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

  // The first reconcile, once everything an addon needs is in place.
  await supervisor.sync();

  return { ui, shared, services, supervisor, loaderBinds };
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

  // Before the bridge: the socket hook must precede the game's first connection.
  const surfaces = createGameSurfaces();
  const slot: ProbeSlot = { value: null };
  reportProbe(surfaces, channel, slot);

  // A failed handshake costs the registry, not the UI: the manager is how a player learns of it.
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
