// Page-realm bootstrap: claim the boot payload, then join the bridge.

import { diagError, diagInfo } from '../shared/diag.ts';
import { type MessageScope, takeBootPayload } from '../shared/handshake.ts';
import { channelForOrigin } from '../shared/hosts.ts';
import { connectHost, type HostConnection } from './bridge.ts';
import { probeGame } from './probe.ts';
import { createGameSurfaces, type GameSurfaces } from './surfaces.ts';

/**
 * Report the __game shape once the game reaches world entry.
 *
 * Recorded per host on purpose: PBE runs ahead of live, so a member that goes
 * missing there is the earliest warning that a game update will break addons.
 */
function reportProbe(surfaces: GameSurfaces, channel: string): void {
  surfaces.world.ready
    .then(() => {
      const probe = probeGame(surfaces.world.game());
      diagInfo(`__game on ${channel}: ${probe.present.length} members`, probe);
    })
    .catch((err: unknown) => {
      diagError('the game never became readable', err);
    });
}

export interface RuntimeBoot {
  connection: HostConnection;
  surfaces: GameSurfaces;
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
  reportProbe(surfaces, channel);

  try {
    const connection = await connectHost({ win: scope, nonce: payload.nonce });
    diagInfo(`bridge connected on ${channel}`);
    return { connection, surfaces };
  } catch (err) {
    surfaces.dispose();
    diagError('bridge handshake failed, addons will not load', err);
    return null;
  }
}
