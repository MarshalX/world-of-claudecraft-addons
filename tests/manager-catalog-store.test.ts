// What the three marketplace panes read, and what their controls do. The reading path fetches at
// most once a session: only `market.ensure` reaches the network, and only for an unread source;
// Refresh always may. Every action reloads afterwards, because the host decides whether it landed.

import { describe, expect, it, vi } from 'vitest';
import type { CatalogRegistry } from '../loader/src/runtime/ui/manager/catalog-actions.ts';
import type { CatalogStoreDeps } from '../loader/src/runtime/ui/manager/catalog-store.ts';
import { createCatalogStore } from '../loader/src/runtime/ui/manager/catalog-store.ts';
import { OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { InstalledAddon, MarketApi, UpdateRow } from '../loader/src/shared/protocol.ts';
import { fakeMarketApi, marketEntry, marketState } from './fakes/market.ts';

const FQID = 'official/combat-meter';

function installedRow(fqid = FQID): InstalledAddon {
  const { path: _path, ...manifest } = marketEntry();
  return { fqid, marketplace: 'official', manifest, enabled: true, pin: null };
}

function updateRow(overrides: Partial<UpdateRow> = {}): UpdateRow {
  return {
    fqid: FQID,
    name: 'Combat Meter',
    marketplace: 'official',
    installed: '1.2.0',
    available: '1.3.0',
    pin: null,
    ...overrides,
  };
}

interface Options {
  installed?: InstalledAddon[];
  updates?: UpdateRow[];
  /** Null puts the store in the state it has when the bridge never connected. */
  bridged?: boolean;
  /** A seeding read the test resolves by hand, to pin what waits on it. */
  seeding?: Promise<void>;
}

function open(options: Options = {}) {
  const calls = {
    install: vi.fn<CatalogRegistry['install']>(() => Promise.resolve()),
    update: vi.fn<CatalogRegistry['update']>(() => Promise.resolve()),
    setPin: vi.fn<CatalogRegistry['setPin']>(() => Promise.resolve()),
    refresh: vi.fn<MarketApi['refresh']>(() => Promise.resolve()),
    add: vi.fn<MarketApi['add']>(() => Promise.resolve()),
    remove: vi.fn<MarketApi['remove']>(() => Promise.resolve()),
    setRef: vi.fn<MarketApi['setRef']>(() => Promise.resolve()),
    ensure: vi.fn<MarketApi['ensure']>(() => options.seeding ?? Promise.resolve()),
    list: vi.fn<MarketApi['list']>(() => Promise.resolve([marketState(OFFICIAL, [marketEntry()])])),
    updates: vi.fn<CatalogRegistry['updates']>(() => Promise.resolve(options.updates ?? [])),
  };

  const registry: CatalogRegistry = {
    list: () => Promise.resolve(options.installed ?? []),
    install: calls.install,
    update: calls.update,
    setPin: calls.setPin,
    updates: calls.updates,
  };
  const market: MarketApi = fakeMarketApi({
    list: calls.list,
    ensure: calls.ensure,
    refresh: calls.refresh,
    add: calls.add,
    remove: calls.remove,
    setRef: calls.setRef,
  });

  // Both null: the bridge handshake never completed.
  const deps: CatalogStoreDeps = { market: null, registry: null, onChange: () => undefined };
  if (options.bridged !== false) {
    deps.market = market;
    deps.registry = registry;
  }
  return { store: createCatalogStore(deps), calls };
}

/**
 * Wait for something to become true, since the microtask count of an action's promise chain is an
 * implementation detail.
 */
const until = (assertion: () => void): Promise<void> => vi.waitFor(assertion);

/** Wait for a load to reach a terminal status. */
function settled(store: ReturnType<typeof open>['store']): Promise<void> {
  return until(() => {
    expect(['ready', 'failed']).toContain(store.state().status);
  });
}

/** A store that has already read once, since the window loads all three readings on open. */
async function primed(options: Options = {}) {
  const opened = open(options);
  opened.store.load();
  await settled(opened.store);
  opened.calls.list.mockClear();
  return opened;
}

describe('the reading', () => {
  it('holds the source list, the installed set, and the update rows', async () => {
    const { store } = open({ installed: [installedRow()], updates: [updateRow()] });

    store.load();
    await settled(store);

    const state = store.state();
    expect(state.status).toBe('ready');
    expect(state.markets.map((market) => market.ref.id)).toEqual(['official']);
    // A map, because a row has to be able to say "installed but switched off".
    expect([...state.installed]).toEqual([[FQID, true]]);
    expect(state.updates.map((row) => row.fqid)).toEqual([FQID]);
  });

  it('does not refresh anything', async () => {
    const { store, calls } = open();

    store.load();
    await settled(store);

    expect(calls.refresh).not.toHaveBeenCalled();
  });

  // Without seeding, a fresh session compares updates against no rows: a false all-clear.
  it('seeds the indexes before it reads them', async () => {
    const { store, calls } = open();

    store.load();
    await settled(store);

    expect(calls.ensure).toHaveBeenCalled();
  });

  // All three reads answer from the index cache, so they must not run alongside the seeding.
  it('waits for the seeding before reading anything', async () => {
    let seeded = (): void => undefined;
    const seeding = new Promise<void>((resolve) => {
      seeded = resolve;
    });
    const { store, calls } = open({ seeding });

    store.load();
    await until(() => {
      expect(calls.ensure).toHaveBeenCalled();
    });
    expect(calls.list).not.toHaveBeenCalled();
    expect(calls.updates).not.toHaveBeenCalled();

    seeded();
    await settled(store);
    expect(calls.list).toHaveBeenCalled();
  });

  it('reports failed with nothing read when the bridge never connected', async () => {
    const { store } = open({ bridged: false });

    store.load();
    await settled(store);

    expect(store.state().status).toBe('failed');
    expect(store.state().markets).toEqual([]);
  });

  // Refresh is disabled while loading, so a status stuck there leaves no way to retry.
  it('records a rejection as a failure rather than a read still in flight', async () => {
    const { store, calls } = open();
    calls.list.mockImplementation(() => Promise.reject(new Error('the port is closed')));

    store.load();
    await settled(store);

    expect(store.state().error).toContain('the port is closed');
    expect(store.state().status).toBe('failed');
  });

  it('lets only the newest load write', async () => {
    const { store, calls } = open();
    let release = (): void => undefined;
    calls.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve([]);
          };
        }),
    );

    store.load();
    store.load();
    await settled(store);
    release();
    await Promise.resolve();

    expect(store.state().markets).toHaveLength(1);
  });
});

describe('the actions', () => {
  it('installs by fqid and re-reads afterwards', async () => {
    const { store, calls } = await primed();

    store.install(FQID);
    await until(() => {
      expect(calls.list).toHaveBeenCalled();
    });

    expect(calls.install).toHaveBeenCalledWith(FQID);
  });

  it('marks the row busy while an install is in flight', async () => {
    const { store } = await primed();

    store.install(FQID);

    expect(store.state().busy).toBe(FQID);
  });

  it('clears busy and reports the reason when an action fails', async () => {
    const { store, calls } = await primed();
    calls.install.mockImplementation(() => Promise.reject(new Error('already installed')));

    store.install(FQID);
    await until(() => {
      expect(store.state().error).toContain('already installed');
    });

    expect(store.state().busy).toBeNull();
  });

  it('pins and unpins through the registry', async () => {
    const { store, calls } = await primed();

    store.setPin(FQID, '1.2.0');
    await until(() => {
      expect(calls.setPin).toHaveBeenCalledTimes(1);
    });
    store.setPin(FQID, null);
    await until(() => {
      expect(calls.setPin).toHaveBeenCalledTimes(2);
    });

    expect(calls.setPin.mock.calls).toEqual([
      [FQID, '1.2.0'],
      [FQID, null],
    ]);
  });

  // Each update re-fetches a body, and a burst is what a rate limit answers worst.
  it('updates one at a time', async () => {
    const { store, calls } = await primed();
    const order: string[] = [];
    calls.update.mockImplementation((fqid) => {
      order.push(`start:${fqid}`);
      return Promise.resolve().then(() => {
        order.push(`done:${fqid}`);
      });
    });

    store.updateAll(['a/one', 'b/two']);
    await until(() => {
      expect(order).toHaveLength(4);
    });

    expect(order).toEqual(['start:a/one', 'done:a/one', 'start:b/two', 'done:b/two']);
  });

  it('stops an update-all run at the first failure', async () => {
    const { store, calls } = await primed();
    calls.update.mockImplementation((fqid) => {
      if (fqid === 'a/one') {
        return Promise.reject(new Error('the source is refusing requests'));
      }
      return Promise.resolve();
    });

    store.updateAll(['a/one', 'b/two']);
    await until(() => {
      expect(store.state().error).toContain('refusing requests');
    });

    expect(calls.update).toHaveBeenCalledTimes(1);
  });

  it('adds a marketplace with the ref the form supplied', async () => {
    const { store, calls } = await primed();

    store.addMarket('someone/their-addons', 'v2.0.0');
    await until(() => {
      expect(calls.add).toHaveBeenCalledWith('someone/their-addons', 'v2.0.0');
    });
  });

  it('removes and repoints a marketplace by id', async () => {
    const { store, calls } = await primed();

    store.setMarketRef('gh:someone/their-addons', 'v2.0.0');
    await until(() => {
      expect(calls.setRef).toHaveBeenCalledWith('gh:someone/their-addons', 'v2.0.0');
    });
    store.removeMarket('gh:someone/their-addons');
    await until(() => {
      expect(calls.remove).toHaveBeenCalledWith('gh:someone/their-addons');
    });
  });

  it('refreshes one source, and every source when given no id', async () => {
    const { store, calls } = await primed();

    store.refresh('official');
    await until(() => {
      expect(calls.refresh).toHaveBeenCalledTimes(1);
    });
    store.refresh();
    await until(() => {
      expect(calls.refresh).toHaveBeenCalledTimes(2);
    });

    expect(calls.refresh.mock.calls).toEqual([['official'], [undefined]]);
  });

  // The pane already reports the unreachable state.
  it('does nothing rather than throwing with no bridge', async () => {
    const { store, calls } = open({ bridged: false });

    store.install(FQID);
    store.updateAll([FQID]);
    store.addMarket('someone/their-addons', '');
    await Promise.resolve();

    expect(calls.install).not.toHaveBeenCalled();
    expect(calls.update).not.toHaveBeenCalled();
    expect(calls.add).not.toHaveBeenCalled();
  });
});
