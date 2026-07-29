// Remembering where the player left the manager window.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGeometryStore,
  type GeometryStorage,
  geometryKey,
} from '../loader/src/runtime/ui/manager/geometry-store.ts';
import { type CapturedDiag, captureDiag } from './fakes/diag.ts';

const NS = 'loader';
const BOX = { x: 100, y: 40, w: 720, h: 600 };

function memoryStorage(seed?: unknown) {
  const cell = { value: seed };
  const storage: GeometryStorage = {
    get: () => Promise.resolve(cell.value),
    set: (_ns, _key, value) => {
      cell.value = value;
      return Promise.resolve();
    },
  };
  return { storage, cell };
}

let diag: CapturedDiag;

beforeEach(() => {
  diag = captureDiag();
});

afterEach(() => {
  diag.restore();
});

describe('the key', () => {
  // Window position is a preference about the player's screen rather than about
  // a character, but the channels are separate deployments a player may want
  // arranged differently.
  it('is scoped by channel', () => {
    expect(geometryKey('pbe')).not.toBe(geometryKey('live'));
  });
});

describe('loading', () => {
  it('answers null before anything is loaded', () => {
    const { storage } = memoryStorage(BOX);

    expect(createGeometryStore({ storage, channel: 'pbe' }).box()).toBeNull();
  });

  it('reads a persisted box', async () => {
    const { storage } = memoryStorage(BOX);
    const store = createGeometryStore({ storage, channel: 'pbe' });

    await store.load();

    expect(store.box()).toEqual(BOX);
  });

  // A box that no longer parses would put NaN into a style property, which drops
  // the declaration silently and strands the window wherever it happened to be.
  it('ignores a persisted value that is not a box', async () => {
    const { storage } = memoryStorage({ x: 1, y: 2 });
    const store = createGeometryStore({ storage, channel: 'pbe' });

    await store.load();

    expect(store.box()).toBeNull();
  });

  it('reports a failed read rather than rejecting', async () => {
    const storage: GeometryStorage = {
      get: () => Promise.reject(new Error('port closed')),
      set: () => Promise.resolve(),
    };
    const store = createGeometryStore({ storage, channel: 'pbe' });

    await expect(store.load()).resolves.toBeUndefined();
    expect(diag.errors()).toHaveLength(1);
  });

  it('does nothing when the bridge never connected', async () => {
    const store = createGeometryStore({ storage: null, channel: 'pbe' });

    await store.load();

    expect(store.box()).toBeNull();
  });
});

describe('saving', () => {
  it('takes effect in memory at once', () => {
    const { storage } = memoryStorage();
    const store = createGeometryStore({ storage, channel: 'pbe' });

    store.save(BOX);

    expect(store.box()).toEqual(BOX);
  });

  it('writes through to storage', async () => {
    const { storage, cell } = memoryStorage();

    createGeometryStore({ storage, channel: 'pbe' }).save(BOX);
    await vi.waitFor(() => {
      expect(cell.value).toEqual(BOX);
    });
  });

  it('writes under the loader namespace and the channel key', () => {
    const set = vi.fn(() => Promise.resolve());
    const storage: GeometryStorage = { get: () => Promise.resolve(undefined), set };

    createGeometryStore({ storage, channel: 'pbe' }).save(BOX);

    expect(set).toHaveBeenCalledWith(NS, geometryKey('pbe'), BOX);
  });

  // Blocking a drag on a bridge round trip would be worse than losing the
  // position, so the write is fire and forget and its failure is reported.
  it('keeps the position in memory when the write fails', async () => {
    const storage: GeometryStorage = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error('port closed')),
    };
    const store = createGeometryStore({ storage, channel: 'pbe' });

    store.save(BOX);

    expect(store.box()).toEqual(BOX);
    await vi.waitFor(() => {
      expect(diag.errors()).toHaveLength(1);
    });
  });

  it('does not throw when the bridge never connected', () => {
    const store = createGeometryStore({ storage: null, channel: 'pbe' });

    expect(() => {
      store.save(BOX);
    }).not.toThrow();
    expect(store.box()).toEqual(BOX);
  });
});
