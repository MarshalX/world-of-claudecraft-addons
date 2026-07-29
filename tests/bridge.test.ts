// @vitest-environment happy-dom
import { expose, proxy } from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHostApi } from '../loader/src/host/api.ts';
import type { GmAdapter } from '../loader/src/host/gm.ts';
import { connectRuntime } from '../loader/src/host/handshake.ts';
import { createHostStorage } from '../loader/src/host/storage.ts';
import { connectHost, type HostConnection } from '../loader/src/runtime/bridge.ts';
import {
  bootScript,
  createNonce,
  helloMessage,
  isPortOffer,
} from '../loader/src/shared/handshake.ts';
import type { HostEvent } from '../loader/src/shared/protocol.ts';

const TIMEOUT_MS = 100;
/** Long enough for a queued postMessage and any answer it would provoke. */
const SETTLE_MS = 20;
const NS = 'addon:official/minimap';
const byName = (a: string, b: string): number => a.localeCompare(b);
const RUNTIME_SOURCE = '/* runtime */';
const VERSION = '1.4.2';

const RUNTIME_TIMEOUT = /runtime handshake timed out/;
const HOST_TIMEOUT = /host handshake timed out/;
const NOT_OFFERED = /not offered by any marketplace/;

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  vi.restoreAllMocks();
});

function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, SETTLE_MS);
  });
}

// happy-dom's MessagePort does not satisfy `instanceof MessagePort`, so the
// transfer list is recognized by shape.
function isMessagePort(value: Transferable): value is MessagePort {
  return typeof (value as Partial<MessagePort>).postMessage === 'function';
}

/**
 * happy-dom delivers postMessage but drops the transfer list, so a port would
 * never reach the other side. Only that gap is stubbed: the messages, the
 * listeners, and both real halves are what is under test.
 *
 * Delivery is queued rather than inline because the real postMessage queues a
 * task. Dispatching inline would re-enter the listener that is still running.
 */
function enablePortTransfer(): void {
  const original = globalThis.postMessage.bind(globalThis);
  globalThis.postMessage = ((data: unknown, _origin?: string, transfer?: Transferable[]): void => {
    const ports = (transfer ?? []).filter(isMessagePort);
    setTimeout(() => {
      globalThis.dispatchEvent(
        new MessageEvent('message', { data, origin: globalThis.location.origin, ports }),
      );
    }, 0);
  }) as typeof globalThis.postMessage;
  cleanups.push(() => {
    globalThis.postMessage = original;
  });
}

/** Captures the injected script instead of letting the environment run it. */
function captureInjection(): { text: () => string; attached: () => boolean } {
  let script: HTMLScriptElement | null = null;
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    script = node as unknown as HTMLScriptElement;
    return node;
  });
  return {
    text: () => script?.textContent ?? '',
    attached: () => script?.isConnected ?? false,
  };
}

function memoryGm(): GmAdapter {
  const store = new Map<string, unknown>();
  const read = <T>(key: string, fallback: T): T => {
    if (store.has(key)) {
      return store.get(key) as T;
    }
    return fallback;
  };
  return {
    getValue: <T>(key: string, fallback: T) => Promise.resolve(read(key, fallback)),
    setValue: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    deleteValue: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
    listValues: () => Promise.resolve([...store.keys()]),
    onValueChange: () => () => undefined,
    registerMenuCommand: () => undefined,
    // No marketplace fetching in either of these suites: they are about the
    // value store and the bridge, and a request here would be a request the
    // code under test never makes.
    request: () => Promise.reject(new Error('no http in this fake')),
    scriptVersion: VERSION,
    capabilities: { valueStore: 'gm4', valueChange: 'none', menuCommand: false, http: false },
  };
}

interface Handshake {
  nonce: string;
  injected: { text: () => string; attached: () => boolean };
  hostPort: Promise<MessagePort>;
  runtime: Promise<HostConnection>;
}

/**
 * Starts both halves on a fresh nonce.
 *
 * Every test in this file shares one window, and a queued message can outlive
 * the test that sent it. A per-handshake nonce is what keeps one test's traffic
 * from being answered by the next, which is also how it works in the browser.
 */
function startHandshake(runtimeNonce?: string): Handshake {
  enablePortTransfer();
  const injected = captureInjection();
  const nonce = createNonce(crypto);

  const hostPort = connectRuntime({
    win: globalThis,
    doc: document,
    source: RUNTIME_SOURCE,
    payload: { nonce, version: VERSION },
    timeoutMs: TIMEOUT_MS,
  });
  const runtime = connectHost({
    win: globalThis,
    nonce: runtimeNonce ?? nonce,
    timeoutMs: TIMEOUT_MS,
  });

  // Both settle in every test, but not always in the same turn, and an
  // unobserved rejection would be reported against whichever test runs next.
  hostPort.catch(() => undefined);
  runtime.catch(() => undefined);

  return { nonce, injected, hostPort, runtime };
}

/** Completes the handshake and puts the real host API on the far end. */
async function connectBoth(): Promise<Handshake & { connection: HostConnection }> {
  const handshake = startHandshake();
  const [port, connection] = await Promise.all([handshake.hostPort, handshake.runtime]);

  const gm = memoryGm();
  expose(
    createHostApi({
      storage: createHostStorage(gm),
      gm,
      setTimer: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
      clearTimer: (id) => {
        globalThis.clearTimeout(id);
      },
      now: () => 0,
    }).api,
    port,
  );
  cleanups.push(() => {
    connection.dispose();
  });
  return { ...handshake, connection };
}

describe('runtime injection', () => {
  it('injects the boot payload ahead of the bundle in one script', async () => {
    const { injected, nonce } = await connectBoth();

    expect(injected.text()).toBe(bootScript({ nonce, version: VERSION }, RUNTIME_SOURCE));
  });

  // The script has already run by the time it is removed, so leaving it in the
  // DOM would only hand page code the loader's source.
  it('leaves no script element behind', async () => {
    const { injected } = await connectBoth();

    expect(injected.attached()).toBe(false);
  });
});

describe('handshake', () => {
  it('gives each side a live end of the same channel', async () => {
    const { connection } = await connectBoth();

    expect(typeof connection.port.postMessage).toBe('function');
  });

  // A host that kept its window listener would hand a second port to whoever
  // replayed the hello, which is what a missed removeEventListener looks like.
  it('does not answer a second hello once connected', async () => {
    const { nonce } = await connectBoth();
    const offers: MessageEvent[] = [];
    const watch = (event: Event): void => {
      if (isPortOffer((event as MessageEvent).data, nonce)) {
        offers.push(event as MessageEvent);
      }
    };
    globalThis.addEventListener('message', watch);
    cleanups.push(() => {
      globalThis.removeEventListener('message', watch);
    });

    globalThis.postMessage(helloMessage(nonce), globalThis.location.origin);
    await settle();

    expect(offers).toEqual([]);
  });

  it('ignores a hello carrying a different nonce', async () => {
    const { hostPort, runtime } = startHandshake(createNonce(crypto));

    await expect(hostPort).rejects.toThrow(RUNTIME_TIMEOUT);
    await expect(runtime).rejects.toThrow(HOST_TIMEOUT);
  });

  it('times out when no runtime answers', async () => {
    enablePortTransfer();
    captureInjection();

    const hostPort = connectRuntime({
      win: globalThis,
      doc: document,
      source: RUNTIME_SOURCE,
      payload: { nonce: createNonce(crypto), version: VERSION },
      timeoutMs: TIMEOUT_MS,
    });

    await expect(hostPort).rejects.toThrow(RUNTIME_TIMEOUT);
  });

  it('times out when no host answers', async () => {
    enablePortTransfer();

    const runtime = connectHost({
      win: globalThis,
      nonce: createNonce(crypto),
      timeoutMs: TIMEOUT_MS,
    });

    await expect(runtime).rejects.toThrow(HOST_TIMEOUT);
  });
});

describe('host API over the bridge', () => {
  it('round-trips a stored value', async () => {
    const { connection } = await connectBoth();

    await connection.host.storage.set(NS, 'scale', 1.5);

    expect(await connection.host.storage.get(NS, 'scale')).toBe(1.5);
  });

  it('lists the keys of a namespace', async () => {
    const { connection } = await connectBoth();

    await connection.host.storage.set(NS, 'scale', 1);
    await connection.host.storage.set(NS, 'anchor', 'top');

    expect((await connection.host.storage.keys(NS)).sort(byName)).toEqual(['anchor', 'scale']);
  });

  it('deletes', async () => {
    const { connection } = await connectBoth();

    await connection.host.storage.set(NS, 'scale', 1);
    await connection.host.storage.delete(NS, 'scale');

    expect(await connection.host.storage.get(NS, 'scale')).toBeUndefined();
  });

  // The push direction only works if the proxied callback survives the realm
  // crossing, so it is worth proving over a real port rather than in isolation.
  it('pushes storage changes back to the runtime', async () => {
    const { connection } = await connectBoth();
    const events: HostEvent[] = [];
    await connection.host.subscribe(
      proxy((event: HostEvent) => {
        events.push(event);
      }),
    );

    await connection.host.storage.set(NS, 'scale', 3);
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toEqual({ k: 'storage.changed', ns: NS, key: 'scale', value: 3 });
  });

  // The registry's state half is real, so an empty answer here means the store
  // is empty rather than that the member is missing.
  it('answers the registry list from an empty store', async () => {
    const { connection } = await connectBoth();

    await expect(connection.host.registry.list()).resolves.toEqual([]);
  });

  // The official source is merged in from the loader build rather than read from
  // storage, so it is there on the first call with nothing installed and nothing
  // fetched. `fetchedAt: null` is what says the index has not been read yet, and
  // it is a different state from an index that was read and was empty.
  it('carries the built-in marketplace across the bridge', async () => {
    const { connection } = await connectBoth();

    const markets = await connection.host.market.list();

    expect(markets.map((entry) => entry.ref.id)).toEqual(['official']);
    expect(markets[0]?.builtin).toBe(true);
    expect(markets[0]?.fetchedAt).toBeNull();
  });

  // The manager holds the registry directly when it can, so a synchronous throw
  // would be a different failure for it than for a bridged caller. Comlink turns
  // a throw into a rejection either way, which is what hides the difference.
  it('rejects rather than answering emptily for an addon no source offers', async () => {
    const { connection } = await connectBoth();

    await expect(connection.host.registry.install('official/minimap')).rejects.toThrow(NOT_OFFERED);
  });

  // Dev mode is off until the player turns it on, so the local source is not in
  // the list above and nothing polls localhost on an ordinary session.
  it('reports dev mode off by default', async () => {
    const { connection } = await connectBoth();

    await expect(connection.host.dev.state()).resolves.toMatchObject({
      enabled: false,
      hotReload: false,
      origin: 'http://localhost:5180',
    });
  });
});
