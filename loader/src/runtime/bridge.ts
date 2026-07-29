// Page-realm half of the bootstrap, plus the Comlink client over the port.

import { wrap } from 'comlink';
import {
  HANDSHAKE_TIMEOUT_MS,
  helloMessage,
  isPortOffer,
  type MessageScope,
} from '../shared/handshake.ts';
import type { HostApi, RemoteHostApi } from '../shared/protocol.ts';

interface ConnectHostOpts {
  win: MessageScope;
  nonce: string;
  timeoutMs?: number;
}

/** The cast is what RemoteHostApi documents: the proxy resolves nested paths. */
function wrapHost(port: MessagePort): RemoteHostApi {
  return wrap<HostApi>(port) as unknown as RemoteHostApi;
}

export interface HostConnection {
  host: RemoteHostApi;
  port: MessagePort;
  /** Closes the port, which also releases the host's exposed object. */
  dispose: () => void;
}

/**
 * Announce this realm and resolve once the host transfers its port.
 *
 * Comlink starts the port when it wraps it, so there is no explicit start().
 */
export function connectHost(opts: ConnectHostOpts): Promise<HostConnection> {
  const { win, nonce } = opts;
  const timeoutMs = opts.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;

  return new Promise<HostConnection>((resolve, reject) => {
    let timer = 0;

    const onMessage = (event: MessageEvent<unknown>): void => {
      const [port] = event.ports;
      if (!isPortOffer(event.data, nonce) || port === undefined) {
        return;
      }
      win.clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      resolve({
        host: wrapHost(port),
        port,
        dispose: () => {
          port.close();
        },
      });
    };

    timer = win.setTimeout(() => {
      win.removeEventListener('message', onMessage);
      reject(new Error(`host handshake timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    win.addEventListener('message', onMessage);
    win.postMessage(helloMessage(nonce), win.location.origin);
  });
}
