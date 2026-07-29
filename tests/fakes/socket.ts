// A stand-in for the page's WebSocket constructor.
//
// EventTarget gives addEventListener and dispatchEvent for free, which is all
// the hook uses, so the subclass it installs behaves exactly as it does in a
// browser.

import type { SocketCtor } from '../../loader/src/runtime/net/hook.ts';

export class FakeSocket extends EventTarget {
  /** Every socket constructed, hooked or not, in construction order. */
  static made: FakeSocket[] = [];

  readonly url: string;
  readonly sent: unknown[] = [];

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeSocket.made.push(this);
  }

  static reset(): void {
    FakeSocket.made = [];
  }

  static last(): FakeSocket {
    const socket = FakeSocket.made.at(-1);
    if (socket === undefined) {
      throw new Error('no socket was constructed');
    }
    return socket;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  receive(data: unknown): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  open(): void {
    this.dispatchEvent(new Event('open'));
  }

  close(): void {
    this.dispatchEvent(new Event('close'));
  }
}

/** A mutable slot standing in for the page's WebSocket global. */
export function socketSlot(): { read: () => SocketCtor; write: (ctor: SocketCtor) => void } {
  let current = FakeSocket as unknown as SocketCtor;
  return {
    read: () => current,
    write: (ctor) => {
      current = ctor;
    },
  };
}
