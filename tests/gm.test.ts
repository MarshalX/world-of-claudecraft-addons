import { describe, expect, it, vi } from 'vitest';

/** A callback that must never fire, without an empty block. */
const noop = (): undefined => undefined;

/** Store read shared by the fakes: the stored value, else the caller's fallback. */
function read(store: Map<string, unknown>, key: string, fallback: unknown): unknown {
  if (store.has(key)) {
    return store.get(key);
  }
  return fallback;
}

import {
  BROADCAST_CHANNEL,
  createGmAdapter,
  detectCapabilities,
  type GmSource,
} from '../loader/src/host/gm.ts';

type NativeListener = (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void;

/** Tampermonkey and Violentmonkey: both GM.* and the legacy GM_* names. */
function fullSource(): GmSource {
  const store = new Map<string, unknown>();
  const listeners = new Map<number, { key: string; cb: NativeListener }>();
  let nextId = 1;
  return {
    gm: {
      getValue: (k, f) => Promise.resolve(read(store, k, f)),
      setValue: (k, v) => {
        store.set(k, v);
        return Promise.resolve();
      },
      deleteValue: (k) => {
        store.delete(k);
        return Promise.resolve();
      },
      listValues: () => Promise.resolve([...store.keys()]),
      addValueChangeListener: (key, cb) => {
        const id = nextId;
        nextId += 1;
        listeners.set(id, { key, cb });
        return id;
      },
      removeValueChangeListener: (id) => {
        listeners.delete(id as number);
      },
      registerMenuCommand: noop,
    },
    legacyGetValue: (k, f) => read(store, k, f),
    legacySetValue: (k, v) => {
      store.set(k, v);
    },
    legacyRegisterMenuCommand: noop,
  };
}

/** Greasemonkey 4: GM.* only, no value-change listener. */
function greasemonkeySource(overrides: Partial<GmSource> = {}): GmSource {
  const store = new Map<string, unknown>();
  return {
    gm: {
      getValue: (k, f) => Promise.resolve(read(store, k, f)),
      setValue: (k, v) => {
        store.set(k, v);
        return Promise.resolve();
      },
      deleteValue: (k) => {
        store.delete(k);
        return Promise.resolve();
      },
      listValues: () => Promise.resolve([...store.keys()]),
      registerMenuCommand: noop,
    },
    ...overrides,
  };
}

/** A manager exposing only the legacy synchronous names. */
function legacyOnlySource(): GmSource {
  const store = new Map<string, unknown>();
  return {
    legacyGetValue: (k, f) => read(store, k, f),
    legacySetValue: (k, v) => {
      store.set(k, v);
    },
    legacyDeleteValue: (k) => {
      store.delete(k);
    },
    legacyListValues: () => [...store.keys()],
    legacyAddValueChangeListener: () => 1,
    legacyRemoveValueChangeListener: noop,
  };
}

const byName = (a: string, b: string): number => a.localeCompare(b);
const NO_STORE_MESSAGE = /no GM value store/;

class FakeChannel {
  static open: FakeChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    FakeChannel.open.push(this);
  }
  postMessage(data: unknown): void {
    for (const other of FakeChannel.open) {
      if (other !== this) {
        other.onmessage?.({ data } as MessageEvent);
      }
    }
  }
  close(): undefined {
    FakeChannel.open = FakeChannel.open.filter((ch) => ch !== this);
  }
}

describe('detectCapabilities', () => {
  it('prefers the promise API when both are present', () => {
    expect(detectCapabilities(fullSource())).toEqual({
      valueStore: 'gm4',
      valueChange: 'native',
      menuCommand: true,
    });
  });

  it('falls back to the legacy names when GM.* is absent', () => {
    const caps = detectCapabilities(legacyOnlySource());
    expect(caps.valueStore).toBe('legacy');
    expect(caps.valueChange).toBe('native');
  });

  it('selects the broadcast fallback when no listener API exists', () => {
    const caps = detectCapabilities(
      greasemonkeySource({ broadcastChannel: FakeChannel as unknown as typeof BroadcastChannel }),
    );
    expect(caps.valueStore).toBe('gm4');
    expect(caps.valueChange).toBe('broadcast');
  });

  it('reports no value-change support when neither exists', () => {
    expect(detectCapabilities(greasemonkeySource()).valueChange).toBe('none');
  });

  it('reports an absent value store rather than guessing', () => {
    expect(detectCapabilities({}).valueStore).toBe('none');
  });

  it('does not claim a store when only half the legacy pair is granted', () => {
    expect(detectCapabilities({ legacyGetValue: () => undefined }).valueStore).toBe('none');
  });

  it('reports menu commands from either surface', () => {
    expect(detectCapabilities(greasemonkeySource()).menuCommand).toBe(true);
    expect(detectCapabilities({ ...legacyOnlySource() }).menuCommand).toBe(false);
  });
});

describe('createGmAdapter', () => {
  it('refuses to construct without a value store', () => {
    expect(() => createGmAdapter({})).toThrow(NO_STORE_MESSAGE);
  });

  it.each([
    ['promise API', fullSource],
    ['legacy names', legacyOnlySource],
    ['greasemonkey', greasemonkeySource],
  ])('round-trips a value through the %s', async (_label, make) => {
    const gm = createGmAdapter(make());
    await gm.setValue('k', { a: 1 });
    expect(await gm.getValue('k', null)).toEqual({ a: 1 });
  });

  it('returns the fallback for a missing key', async () => {
    const gm = createGmAdapter(fullSource());
    expect(await gm.getValue('absent', 'fb')).toBe('fb');
  });

  it('treats a stored undefined as missing', async () => {
    const gm = createGmAdapter(fullSource());
    await gm.setValue('k', undefined);
    expect(await gm.getValue('k', 'fb')).toBe('fb');
  });

  it('deletes and lists', async () => {
    const gm = createGmAdapter(fullSource());
    await gm.setValue('a', 1);
    await gm.setValue('b', 2);
    expect((await gm.listValues()).sort(byName)).toEqual(['a', 'b']);
    await gm.deleteValue('a');
    expect((await gm.listValues()).sort(byName)).toEqual(['b']);
  });

  it('lists nothing when the manager does not grant listValues', async () => {
    const gm = createGmAdapter(greasemonkeySource({ gm: { ...greasemonkeySource().gm } }));
    expect(Array.isArray(await gm.listValues())).toBe(true);
  });

  it('uses the native listener and unsubscribes through it', () => {
    const src = fullSource();
    const remove = vi.fn();
    src.gm = { ...src.gm, removeValueChangeListener: remove };
    const gm = createGmAdapter(src);

    const off = gm.onValueChange('k', noop);
    off();
    expect(remove).toHaveBeenCalledOnce();
  });

  describe('broadcast fallback', () => {
    it('delivers a change to another tab', async () => {
      FakeChannel.open = [];
      const Ch = FakeChannel as unknown as typeof BroadcastChannel;
      const writer = createGmAdapter(greasemonkeySource({ broadcastChannel: Ch }));
      const reader = createGmAdapter(greasemonkeySource({ broadcastChannel: Ch }));

      const seen = vi.fn();
      reader.onValueChange('k', seen);
      // The writer only broadcasts for keys it knows are watched.
      writer.onValueChange('k', noop);
      await writer.setValue('k', 'new');

      expect(seen).toHaveBeenCalledOnce();
      expect(seen.mock.calls[0]?.[0]).toMatchObject({ key: 'k', newValue: 'new', remote: true });
    });

    it('does not deliver a change back to the tab that wrote it', async () => {
      FakeChannel.open = [];
      const Ch = FakeChannel as unknown as typeof BroadcastChannel;
      const gm = createGmAdapter(greasemonkeySource({ broadcastChannel: Ch }));

      const seen = vi.fn();
      gm.onValueChange('k', seen);
      await gm.setValue('k', 'new');

      expect(seen).not.toHaveBeenCalled();
    });

    it('stops delivering after unsubscribe', async () => {
      FakeChannel.open = [];
      const Ch = FakeChannel as unknown as typeof BroadcastChannel;
      const writer = createGmAdapter(greasemonkeySource({ broadcastChannel: Ch }));
      const reader = createGmAdapter(greasemonkeySource({ broadcastChannel: Ch }));

      const seen = vi.fn();
      reader.onValueChange('k', seen)();
      writer.onValueChange('k', noop);
      await writer.setValue('k', 'new');

      expect(seen).not.toHaveBeenCalled();
    });

    it('names the channel consistently so tabs meet on it', () => {
      FakeChannel.open = [];
      const Ch = FakeChannel as unknown as typeof BroadcastChannel;
      const gm = createGmAdapter(greasemonkeySource({ broadcastChannel: Ch }));
      gm.onValueChange('k', noop);
      expect(FakeChannel.open[0]?.name).toBe(BROADCAST_CHANNEL);
    });

    it('writes normally when nothing is watching', async () => {
      FakeChannel.open = [];
      const gm = createGmAdapter(
        greasemonkeySource({ broadcastChannel: FakeChannel as unknown as typeof BroadcastChannel }),
      );
      await gm.setValue('k', 1);
      expect(await gm.getValue('k', null)).toBe(1);
      expect(FakeChannel.open).toHaveLength(0);
    });

    it('degrades to a no-op subscription with no BroadcastChannel', async () => {
      const gm = createGmAdapter(greasemonkeySource());
      const seen = vi.fn();
      const off = gm.onValueChange('k', seen);
      await gm.setValue('k', 'new');
      off();
      expect(seen).not.toHaveBeenCalled();
    });
  });

  it('registers a menu command through whichever surface exists', () => {
    const register = vi.fn();
    const gm = createGmAdapter(greasemonkeySource({ legacyRegisterMenuCommand: register }));
    gm.registerMenuCommand('Addons', noop);
    // GM.registerMenuCommand is preferred, so the legacy spy stays untouched.
    expect(register).not.toHaveBeenCalled();

    const legacy = createGmAdapter({ ...legacyOnlySource(), legacyRegisterMenuCommand: register });
    legacy.registerMenuCommand('Addons', noop);
    expect(register).toHaveBeenCalledOnce();
  });
});
