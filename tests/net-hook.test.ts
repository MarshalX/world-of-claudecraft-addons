import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installSocketHook,
  isWorldSocket,
  type SocketTaps,
} from '../loader/src/runtime/net/hook.ts';
import { FakeSocket, socketSlot } from './fakes/socket.ts';

const ORIGIN = 'https://pbe.worldofclaudecraft.com';
const WORLD_URL = 'wss://pbe.worldofclaudecraft.com/ws';

function taps(): SocketTaps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onOpen: () => calls.push('open'),
    onClose: () => calls.push('close'),
    onMessage: (data) => calls.push(`message:${String(data)}`),
    onSend: (data) => calls.push(`send:${String(data)}`),
  };
}

function install(tapped: SocketTaps): {
  uninstall: () => void;
  ctor: () => new (url: string) => FakeSocket;
} {
  const slot = socketSlot();
  const uninstall = installSocketHook({ ...slot, base: ORIGIN, taps: tapped });
  return {
    uninstall,
    ctor: () => slot.read() as unknown as new (url: string) => FakeSocket,
  };
}

beforeEach(() => {
  FakeSocket.reset();
});

describe('isWorldSocket', () => {
  it('matches the game socket', () => {
    expect(isWorldSocket(WORLD_URL, ORIGIN)).toBe(true);
  });

  // A realm connects to that realm's own origin, so the host cannot be part of
  // the test or a realm socket would go unseen.
  it('matches a realm socket on another host', () => {
    expect(isWorldSocket('wss://realm-eu.worldofclaudecraft.com/ws', ORIGIN)).toBe(true);
  });

  it('matches a relative url against the page origin', () => {
    expect(isWorldSocket('/ws', ORIGIN)).toBe(true);
  });

  it.each([
    ['another path', 'wss://pbe.worldofclaudecraft.com/socket'],
    ['a path that merely starts the same', 'wss://pbe.worldofclaudecraft.com/wsx'],
    ['a query that looks like the path', 'wss://pbe.worldofclaudecraft.com/other?x=/ws'],
    ['nonsense', '::::'],
  ])('does not match %s', (_label, url) => {
    expect(isWorldSocket(url, ORIGIN)).toBe(false);
  });
});

describe('installSocketHook', () => {
  it('replaces the constructor and restores it on uninstall', () => {
    const slot = socketSlot();
    const original = slot.read();

    const uninstall = installSocketHook({ ...slot, base: ORIGIN, taps: taps() });
    expect(slot.read()).not.toBe(original);

    uninstall();
    expect(slot.read()).toBe(original);
  });

  it('reports open, message, and close on the game socket', () => {
    const tapped = taps();
    const { ctor } = install(tapped);

    const socket = new (ctor())(WORLD_URL);
    socket.open();
    socket.receive('{"t":"hello"}');
    socket.close();

    expect(tapped.calls).toEqual(['open', 'message:{"t":"hello"}', 'close']);
  });

  it('reports what the game sends', () => {
    const tapped = taps();
    const { ctor } = install(tapped);

    new (ctor())(WORLD_URL).send('{"t":"input","seq":1}');

    expect(tapped.calls).toEqual(['send:{"t":"input","seq":1}']);
  });

  // Read-only means read-only: the frame still has to reach the server exactly
  // as the game wrote it.
  it('passes the send through to the real socket', () => {
    const { ctor } = install(taps());

    const socket = new (ctor())(WORLD_URL);
    socket.send('{"t":"input"}');

    expect(socket.sent).toEqual(['{"t":"input"}']);
  });

  it('ignores a socket the page opens to anywhere else', () => {
    const tapped = taps();
    const { ctor } = install(tapped);

    const other = new (ctor())('wss://analytics.example.com/collect');
    other.open();
    other.receive('{"t":"hello"}');
    other.send('anything');

    expect(tapped.calls).toEqual([]);
    expect(other.sent).toEqual(['anything']);
  });

  // The game builds a new socket per reconnect, so the wrap has to keep working
  // rather than being tied to the first one.
  it('taps every socket the game opens, not only the first', () => {
    const tapped = taps();
    const { ctor } = install(tapped);

    new (ctor())(WORLD_URL).open();
    new (ctor())(WORLD_URL).open();

    expect(tapped.calls).toEqual(['open', 'open']);
  });

  it('stops reporting once uninstalled', () => {
    const tapped = taps();
    const { ctor, uninstall } = install(tapped);
    uninstall();

    // Built the way the game builds one, by reading the global after uninstall.
    const socket = new (ctor())(WORLD_URL);
    socket.open();
    socket.receive('{"t":"snap"}');
    socket.send('{"t":"input"}');

    expect(tapped.calls).toEqual([]);
    expect(socket.sent).toEqual(['{"t":"input"}']);
  });

  // A tap runs inside the game's own stack, `send` synchronously. A throw there
  // would break the frame the game was sending.
  describe('a throwing tap', () => {
    it('does not stop the game sending', () => {
      const { ctor } = install({
        ...taps(),
        onSend: () => {
          throw new Error('loader bug');
        },
      });

      const socket = new (ctor())(WORLD_URL);
      expect(() => socket.send('{"t":"input"}')).not.toThrow();
      expect(socket.sent).toEqual(['{"t":"input"}']);
    });

    it('does not escape the message listener', () => {
      const { ctor } = install({
        ...taps(),
        onMessage: () => {
          throw new Error('loader bug');
        },
      });

      const socket = new (ctor())(WORLD_URL);
      expect(() => socket.receive('{"t":"snap"}')).not.toThrow();
    });
  });

  it('keeps the socket usable as its original type', () => {
    const { ctor } = install(taps());

    expect(new (ctor())(WORLD_URL)).toBeInstanceOf(FakeSocket);
  });

  it('leaves the message listener count to one per socket', () => {
    const tapped = taps();
    const { ctor } = install(tapped);
    const socket = new (ctor())(WORLD_URL);

    socket.receive('one');

    expect(tapped.calls.filter((call) => call.startsWith('message'))).toHaveLength(1);
  });

  it('passes the url and protocols through to the real constructor', () => {
    const seen = vi.fn();
    class Recording extends FakeSocket {
      constructor(url: string | URL, protocols?: string | readonly string[]) {
        super(url);
        seen(String(url), protocols);
      }
    }
    let current: unknown = Recording;
    const uninstall = installSocketHook({
      read: () => current as never,
      write: (ctor) => {
        current = ctor;
      },
      base: ORIGIN,
      taps: taps(),
    });

    const built = new (current as new (url: string, protocols?: string[]) => FakeSocket)(
      WORLD_URL,
      ['woc'],
    );
    expect(built.url).toBe(WORLD_URL);

    expect(seen).toHaveBeenCalledExactlyOnceWith(WORLD_URL, ['woc']);
    uninstall();
  });
});
