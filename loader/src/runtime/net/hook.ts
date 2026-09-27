// The WebSocket constructor wrap, installed at document-start so every socket the game opens,
// reconnects included, is seen. Purely observational.

import { diagError } from '../../shared/diag.ts';

/** The game's world socket. Any other socket the page opens is left alone. */
const WORLD_SOCKET_PATH = '/ws';

export type SocketCtor = new (
  url: string | URL,
  protocols?: string | readonly string[],
) => WebSocket;

export interface SocketTaps {
  onOpen: () => void;
  onMessage: (data: unknown) => void;
  onSend: (data: unknown) => void;
  onClose: () => void;
}

export interface SocketHookOpts {
  /** Reads the constructor currently installed on the page. */
  read: () => SocketCtor;
  write: (ctor: SocketCtor) => void;
  /** Base for resolving a relative socket URL, normally the page origin. */
  base: string;
  taps: SocketTaps;
}

export function isWorldSocket(url: string, base: string): boolean {
  try {
    return new URL(url, base).pathname === WORLD_SOCKET_PATH;
  } catch {
    return false;
  }
}

/** Every tap runs inside the game's own stack, so a loader throw is caught before it breaks one. */
export function installSocketHook(opts: SocketHookOpts): () => void {
  const original = opts.read();

  const guard = (what: string, run: () => void): void => {
    try {
      run();
    } catch (err) {
      diagError(`socket tap failed on ${what}`, err);
    }
  };

  class HookedSocket extends original {
    private readonly tapped: boolean;

    constructor(url: string | URL, protocols?: string | readonly string[]) {
      super(url, protocols);
      this.tapped = isWorldSocket(String(url), opts.base);
      if (!this.tapped) {
        return;
      }
      this.addEventListener('open', () => guard('open', () => opts.taps.onOpen()));
      this.addEventListener('message', (event: MessageEvent) => {
        guard('message', () => opts.taps.onMessage(event.data));
      });
      this.addEventListener('close', () => guard('close', () => opts.taps.onClose()));
    }

    override send(data: Parameters<WebSocket['send']>[0]): void {
      if (this.tapped) {
        guard('send', () => opts.taps.onSend(data));
      }
      super.send(data);
    }
  }

  opts.write(HookedSocket);
  return () => {
    opts.write(original);
  };
}
