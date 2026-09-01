// @vitest-environment happy-dom

// Whether an arranged frame lands on the alignment grid: the gate and the persistence.

import { describe, expect, it } from 'vitest';
import { NO_SNAP, SNAP_GRID } from '../loader/src/runtime/ui/frame/snap.ts';
import { createUnlockMode } from '../loader/src/runtime/ui/kit/unlock.ts';
import type { GeometryStorage } from '../loader/src/runtime/ui/manager/geometry-store.ts';
import { createSnapStore, type SnapStore, snapKey } from '../loader/src/runtime/ui/snap-store.ts';

const CHANNEL = 'pbe';

/** The mode over one snap store, which is how the two are composed at mount. */
function mode(snap: SnapStore) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return createUnlockMode(el, () => snap.enabled);
}

/** The loader's own namespace, with what was written kept for a case to read. */
function store(seed?: unknown) {
  const written = new Map<string, unknown>();
  const storage: GeometryStorage = {
    get: () => Promise.resolve(seed),
    set: (ns, key, value) => {
      written.set(`${ns}:${key}`, value);
      return Promise.resolve();
    },
  };
  return { storage, written };
}

describe('the snap setting', () => {
  it('starts off, the way the game does', () => {
    const snap = createSnapStore({ storage: null, channel: CHANNEL });

    expect(snap.enabled).toBe(false);
  });

  // Outside the mode there are no lines on screen to explain a quantized drag.
  it('gives no grid while the arrange mode is off, however it is set', () => {
    const snap = createSnapStore({ storage: null, channel: CHANNEL });
    const unlock = mode(snap);

    snap.set(true);

    expect(unlock.grid()).toBe(NO_SNAP);
  });

  it('gives the grid only when the mode is on and the setting is too', () => {
    const snap = createSnapStore({ storage: null, channel: CHANNEL });
    const unlock = mode(snap);

    unlock.set(true);

    expect(unlock.grid()).toBe(NO_SNAP);

    snap.toggle();

    expect(unlock.grid()).toBe(SNAP_GRID);
  });

  it('writes the answer to the loader namespace, keyed by channel', () => {
    const { storage, written } = store();
    const snap = createSnapStore({ storage, channel: CHANNEL });

    snap.set(true);

    expect(written.get(`loader:${snapKey(CHANNEL)}`)).toBe(true);
  });

  it('reads a saved answer back', async () => {
    const { storage } = store(true);
    const snap = createSnapStore({ storage, channel: CHANNEL });

    await snap.load();

    expect(snap.enabled).toBe(true);
  });

  // GM storage is editable and an older loader may have written another shape.
  it('ignores a stored value that is not a boolean', async () => {
    const { storage } = store('yes');
    const snap = createSnapStore({ storage, channel: CHANNEL });

    await snap.load();

    expect(snap.enabled).toBe(false);
  });

  it('works for the session with no storage at all', async () => {
    const snap = createSnapStore({ storage: null, channel: CHANNEL });
    const unlock = mode(snap);
    unlock.set(true);

    await snap.load();
    snap.set(true);

    expect(unlock.grid()).toBe(SNAP_GRID);
  });
});
