// What the Installed pane reads, driven directly with no rendering.

import { describe, expect, it, vi } from 'vitest';
import {
  createInstalledStore,
  type InstalledRegistry,
} from '../loader/src/runtime/ui/manager/store.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { fakeRegistry } from './fakes/ui-deps.ts';

const FQID = 'official/minimap';

function addon(fqid = FQID): InstalledAddon {
  return {
    fqid,
    marketplace: 'official',
    enabled: true,
    pin: null,
    manifest: {
      id: 'minimap',
      name: 'Better Minimap',
      version: '1.2.0',
      apiVersion: 1,
      author: 'MarshalX',
      description: 'A better minimap.',
      entry: 'main.js',
    },
  };
}

/** A registry whose list() resolves only when the test says so. */
function deferredRegistry() {
  const pending: Array<(rows: InstalledAddon[]) => void> = [];
  const registry: InstalledRegistry = fakeRegistry({
    list: () =>
      new Promise<InstalledAddon[]>((resolve) => {
        pending.push(resolve);
      }),
    setEnabled: () => Promise.resolve(),
  });
  return { registry, settle: (index: number, rows: InstalledAddon[]) => pending[index]?.(rows) };
}

describe('loading', () => {
  it('starts idle and does not read until told to', () => {
    const list = vi.fn();
    const store = createInstalledStore({
      registry: fakeRegistry({ list, setEnabled: vi.fn() }),
      onChange: vi.fn(),
    });

    expect(store.state().status).toBe('idle');
    expect(list).not.toHaveBeenCalled();
  });

  it('reports the rows it loaded', async () => {
    const store = createInstalledStore({
      registry: fakeRegistry({ list: () => Promise.resolve([addon()]), setEnabled: vi.fn() }),
      onChange: vi.fn(),
    });

    store.reload();
    await vi.waitFor(() => {
      expect(store.state().status).toBe('ready');
    });
    expect(store.state().rows).toEqual([addon()]);
  });

  it('reports a failed read with the reason', async () => {
    const store = createInstalledStore({
      registry: fakeRegistry({
        list: () => Promise.reject(new Error('port closed')),
        setEnabled: vi.fn(),
      }),
      onChange: vi.fn(),
    });

    store.reload();
    await vi.waitFor(() => {
      expect(store.state().error).toBe('port closed');
    });
    expect(store.state().status).toBe('failed');
  });

  // Nothing was tried, so there is no error to quote.
  it('reports an unreachable registry as failed with no error text', () => {
    const store = createInstalledStore({ registry: null, onChange: vi.fn() });

    store.reload();

    expect(store.state()).toEqual({ status: 'failed', rows: [], error: null });
  });

  // Otherwise a slow first load lands after a fast second one and reinstates the older list.
  it('ignores a load that a newer one has overtaken', async () => {
    const { registry, settle } = deferredRegistry();
    const store = createInstalledStore({ registry, onChange: vi.fn() });

    store.reload();
    store.reload();
    settle(1, [addon('official/newer')]);
    await vi.waitFor(() => {
      expect(store.state().status).toBe('ready');
    });
    settle(0, [addon('official/older')]);
    await Promise.resolve();

    expect(store.state().rows).toEqual([addon('official/newer')]);
  });

  it('reports every transition to its subscriber', async () => {
    const onChange = vi.fn();
    const store = createInstalledStore({
      registry: fakeRegistry({ list: () => Promise.resolve([]), setEnabled: vi.fn() }),
      onChange,
    });

    store.reload();
    await vi.waitFor(() => {
      expect(store.state().status).toBe('ready');
    });

    // Once for loading, once for ready.
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('toggling', () => {
  it('forwards the flip to the registry', () => {
    const setEnabled = vi.fn(() => Promise.resolve());
    const store = createInstalledStore({
      registry: fakeRegistry({ list: () => Promise.resolve([]), setEnabled }),
      onChange: vi.fn(),
    });

    store.setEnabled(FQID, false);

    expect(setEnabled).toHaveBeenCalledWith(FQID, false);
  });

  // No optimistic flip: registry.changed after a real write is what reloads.
  it('does not move the row until a reload says so', () => {
    const store = createInstalledStore({
      registry: fakeRegistry({
        list: () => Promise.resolve([addon()]),
        setEnabled: () => Promise.resolve(),
      }),
      onChange: vi.fn(),
    });

    store.setEnabled(FQID, false);

    expect(store.state().rows).toEqual([]);
  });

  it('reports a rejected write without dropping the rows', async () => {
    const store = createInstalledStore({
      registry: fakeRegistry({
        list: () => Promise.resolve([addon()]),
        setEnabled: () => Promise.reject(new Error('not installed')),
      }),
      onChange: vi.fn(),
    });
    store.reload();
    await vi.waitFor(() => {
      expect(store.state().status).toBe('ready');
    });

    store.setEnabled(FQID, false);
    await vi.waitFor(() => {
      expect(store.state().error).toBe('not installed');
    });
    expect(store.state().rows).toEqual([addon()]);
  });

  it('does nothing when the registry is unreachable', () => {
    const store = createInstalledStore({ registry: null, onChange: vi.fn() });

    expect(() => {
      store.setEnabled(FQID, false);
    }).not.toThrow();
  });
});
