// Page-realm bootstrap: claim the boot payload, join the bridge, mount the UI.

import { proxy } from 'comlink';
import { diagError, diagInfo } from '../shared/diag.ts';
import { type MessageScope, takeBootPayload } from '../shared/handshake.ts';
import { channelForOrigin } from '../shared/hosts.ts';
import type { HostEvent, RemoteHostApi } from '../shared/protocol.ts';
import { connectHost, type HostConnection } from './bridge.ts';
import { readDiagnostics } from './diagnostics.ts';
import { type GameProbe, probeGame } from './probe.ts';
import { waitForDocument } from './ready.ts';
import { createGameSurfaces, type GameSurfaces } from './surfaces.ts';
import { type MountedUi, mountUi } from './ui/mount.ts';
// Bundled as text by loader/build-runtime.mjs and injected as one <style>.
// biome-ignore lint/correctness/noUnresolvedImports: loader/build-runtime.mjs loads .css as text, which a static resolver does not model
import css from './ui/styles.css';

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
  channel: string;
  /** Null when the handshake failed. The manager reports that in its own panes. */
  host: RemoteHostApi | null;
  slot: ProbeSlot;
}

/**
 * Bring up the loader's own UI.
 *
 * Gated on the document rather than on the game, so the manager is reachable
 * from the login screen and from a session that never gets that far.
 */
async function startUi(deps: UiStartDeps): Promise<MountedUi> {
  const { scope, host } = deps;
  await waitForDocument({ doc: globalThis.document });

  const ui = mountUi({
    doc: globalThis.document,
    css,
    registry: host?.registry ?? null,
    storage: host?.storage ?? null,
    channel: deps.channel,
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

  // proxy() is what lets the sandbox call back into this realm. The manager is
  // the only consumer today: a registry write in another tab has to reload this
  // one's list, and the userscript popup command has no other way in.
  await host?.subscribe(
    proxy((event: HostEvent) => {
      if (event.k === 'ui.open') {
        ui.manager.open();
      } else if (event.k === 'registry.changed') {
        ui.manager.invalidate();
      }
    }),
  );

  return ui;
}

export interface RuntimeBoot {
  /** Null when the handshake failed, which does not stop the UI. */
  connection: HostConnection | null;
  surfaces: GameSurfaces;
  ui: MountedUi;
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

  const ui = await startUi({
    scope,
    loaderVersion: payload.version,
    surfaces,
    channel,
    host,
    slot,
  });
  return { connection, surfaces, ui };
}
