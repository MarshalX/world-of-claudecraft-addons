import { describe, expect, it, vi } from 'vitest';

import { createGmAdapter, type GmAdapter, type ValueChange } from '../loader/src/host/gm.ts';
import { createHostStorage } from '../loader/src/host/storage.ts';
import { tampermonkeySource } from './fakes/gm.ts';

const NS = 'addon:official/minimap';
const byName = (a: string, b: string): number => a.localeCompare(b);

interface FakeGm extends GmAdapter {
  store: Map<string, unknown>;
  /** Simulates a write made in another tab. */
  emitRemote: (key: string, value: unknown) => void;
  /** Simulates a manager that reports the calling tab's own writes back to it. */
  emitEcho: (key: string, value: unknown) => void;
  watched: () => string[];
}

function fakeGm(): FakeGm {
  const store = new Map<string, unknown>();
  const listeners = new Map<string, Set<(change: ValueChange) => void>>();

  const fire = (key: string, value: unknown, remote: boolean): void => {
    store.set(key, value);
    for (const handler of listeners.get(key) ?? []) {
      handler({ key, oldValue: undefined, newValue: value, remote });
    }
  };

  return {
    store,
    watched: () => [...listeners.keys()].filter((key) => (listeners.get(key)?.size ?? 0) > 0),
    emitRemote: (key, value) => fire(key, value, true),
    emitEcho: (key, value) => fire(key, value, false),
    scriptVersion: '1.4.2',

    getValue: <T>(key: string, fallback: T) => {
      if (store.has(key)) {
        return Promise.resolve(store.get(key) as T);
      }
      return Promise.resolve(fallback);
    },
    setValue: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    deleteValue: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
    listValues: () => Promise.resolve([...store.keys()]),
    onValueChange: (key, handler) => {
      const set = listeners.get(key) ?? new Set();
      set.add(handler);
      listeners.set(key, set);
      return () => set.delete(handler);
    },
    registerMenuCommand: () => undefined,
    // No marketplace fetching in either of these suites: they are about the
    // value store and the bridge, and a request here would be a request the
    // code under test never makes.
    request: () => Promise.reject(new Error('no http in this fake')),
    capabilities: { valueStore: 'gm4', valueChange: 'native', menuCommand: true, http: false },
  };
}

describe('createHostStorage', () => {
  it('round-trips a value through the GM store', async () => {
    const gm = fakeGm();
    const storage = createHostStorage(gm);

    await storage.set(NS, 'scale', 1.5);

    expect(await storage.get(NS, 'scale')).toBe(1.5);
  });

  // The namespace is what keeps two addons from reading each other's settings,
  // so it has to be in the key the manager actually stores.
  it('prefixes the namespace onto the stored key', async () => {
    const gm = fakeGm();
    const storage = createHostStorage(gm);

    await storage.set(NS, 'scale', 1.5);

    expect([...gm.store.keys()]).toEqual([`${NS}:scale`]);
  });

  it('keeps namespaces apart', async () => {
    const gm = fakeGm();
    const storage = createHostStorage(gm);

    await storage.set(NS, 'scale', 1.5);
    await storage.set('addon:other/thing', 'scale', 9);

    expect(await storage.get(NS, 'scale')).toBe(1.5);
    expect(await storage.get('addon:other/thing', 'scale')).toBe(9);
  });

  it('resolves a missing key to undefined', async () => {
    const storage = createHostStorage(fakeGm());

    expect(await storage.get(NS, 'absent')).toBeUndefined();
  });

  it('deletes', async () => {
    const gm = fakeGm();
    const storage = createHostStorage(gm);

    await storage.set(NS, 'scale', 1.5);
    await storage.delete(NS, 'scale');

    expect(await storage.get(NS, 'scale')).toBeUndefined();
    expect(gm.store.size).toBe(0);
  });

  describe('keys', () => {
    it('returns only its own namespace, with the prefix stripped', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);

      await storage.set(NS, 'scale', 1);
      await storage.set(NS, 'anchor', 'top');
      await storage.set('addon:other/thing', 'scale', 1);

      expect((await storage.keys(NS)).sort(byName)).toEqual(['anchor', 'scale']);
    });

    // 'addon:foo' must not sweep up 'addon:foobar', which shares the prefix but
    // not the separator.
    it('does not match a namespace that merely starts the same', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);

      await storage.set('addon:foo', 'a', 1);
      await storage.set('addon:foobar', 'b', 2);

      expect(await storage.keys('addon:foo')).toEqual(['a']);
    });

    it('returns nothing for an untouched namespace', async () => {
      const storage = createHostStorage(fakeGm());

      expect(await storage.keys(NS)).toEqual([]);
    });
  });

  describe('change events', () => {
    it('reports a local write once', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);
      const seen = vi.fn();
      storage.onChange(seen);

      await storage.set(NS, 'scale', 2);

      expect(seen).toHaveBeenCalledExactlyOnceWith(NS, 'scale', 2);
    });

    it('reports a local delete as undefined', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);
      await storage.set(NS, 'scale', 2);
      const seen = vi.fn();
      storage.onChange(seen);

      await storage.delete(NS, 'scale');

      expect(seen).toHaveBeenCalledExactlyOnceWith(NS, 'scale', undefined);
    });

    // A write in another tab arrives through the manager's listener, which is
    // the whole reason a key is watched on read rather than only on write.
    it('reports a remote write against a key that was only read', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);
      const seen = vi.fn();
      storage.onChange(seen);

      await storage.get(NS, 'scale');
      gm.emitRemote(`${NS}:scale`, 7);

      expect(seen).toHaveBeenCalledExactlyOnceWith(NS, 'scale', 7);
    });

    // Managers differ on whether their listener fires for the calling tab. The
    // local emit is unconditional, so the listener has to drop non-remote
    // changes or every write would be reported twice.
    it('does not double-report a write the manager echoes back', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);
      const seen = vi.fn();
      storage.onChange(seen);

      await storage.set(NS, 'scale', 2);
      gm.emitEcho(`${NS}:scale`, 2);

      expect(seen).toHaveBeenCalledExactlyOnceWith(NS, 'scale', 2);
    });

    it('watches a key once however often it is touched', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);

      await storage.get(NS, 'scale');
      await storage.set(NS, 'scale', 1);
      await storage.delete(NS, 'scale');

      expect(gm.watched()).toEqual([`${NS}:scale`]);
    });

    it('stops delivering after unsubscribe', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);
      const seen = vi.fn();
      const off = storage.onChange(seen);

      off();
      await storage.set(NS, 'scale', 2);

      expect(seen).not.toHaveBeenCalled();
    });

    // Against the real Tampermonkey shape rather than a hand-driven echo:
    // Tampermonkey 5.5 was observed reporting the calling tab's own writes back
    // with remote false. Whether other managers echo is not something the loader
    // gets to assume, which is exactly why the filter is on the flag rather than
    // on the manager.
    it('reports one event per write on a manager that echoes its own writes', async () => {
      const storage = createHostStorage(createGmAdapter(tampermonkeySource()));
      const seen = vi.fn();
      storage.onChange(seen);

      await storage.set(NS, 'scale', 2);

      expect(seen).toHaveBeenCalledExactlyOnceWith(NS, 'scale', 2);
    });

    it('reports a cross-tab write on that manager exactly once', async () => {
      const gm = tampermonkeySource();
      const storage = createHostStorage(createGmAdapter(gm));
      const seen = vi.fn();
      storage.onChange(seen);
      await storage.get(NS, 'scale');

      gm.emit(`${NS}:scale`, 9);

      expect(seen).toHaveBeenCalledExactlyOnceWith(NS, 'scale', 9);
    });

    it('releases its manager listeners on dispose', async () => {
      const gm = fakeGm();
      const storage = createHostStorage(gm);
      const seen = vi.fn();
      storage.onChange(seen);
      await storage.get(NS, 'scale');

      storage.dispose();
      gm.emitRemote(`${NS}:scale`, 7);

      expect(gm.watched()).toEqual([]);
      expect(seen).not.toHaveBeenCalled();
    });
  });
});
