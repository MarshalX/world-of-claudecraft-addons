// Page-realm bootstrap: claim the boot payload, then join the bridge.

import { diagError, diagInfo } from '../shared/diag.ts';
import { type MessageScope, takeBootPayload } from '../shared/handshake.ts';
import { channelForOrigin } from '../shared/hosts.ts';
import { connectHost, type HostConnection } from './bridge.ts';

/**
 * Reads the payload before anything can yield, so no page code observes the
 * transient global. Everything after that point is asynchronous.
 */
export async function bootRuntime(scope: MessageScope): Promise<HostConnection | null> {
  const payload = takeBootPayload(scope as unknown as Record<string, unknown>);
  if (payload === null) {
    diagError('runtime started without a boot payload');
    return null;
  }

  const channel = channelForOrigin(scope.location.origin);
  if (channel === null) {
    return null;
  }

  try {
    const connection = await connectHost({ win: scope, nonce: payload.nonce });
    diagInfo(`bridge connected on ${channel}`);
    return connection;
  } catch (err) {
    diagError('bridge handshake failed, addons will not load', err);
    return null;
  }
}
