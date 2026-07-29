// What the three marketplace panes read, and what their controls do.
//
// The property this suite exists for is that nothing on the reading path goes to
// the network. Opening the manager reads the source list, the installed set, and
// the update rows, and if any of those fetched then every open of the window
// would cost a request per marketplace before it could draw. Refresh is the one
// control that is allowed to.
//
// The other half is that every action reloads afterwards rather than guessing.
// The host is what decides whether a write landed, so a pane that predicted the
// outcome would show a state the host may have refused.

import { describe, expect, it, vi } from 'vitest';
import type { CatalogRegistry } from '../loader/src/runtime/ui/manager/catalog-actions.ts';
import type { CatalogStoreDeps } from '../loader/src/runtime/ui/manager/catalog-store.ts';
import { createCatalogStore } from '../loader/src/runtime/ui/manager/catalog-store.ts';
import { OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { InstalledAddon, MarketApi, UpdateRow } from '../loader/src/shared/protocol.ts';
import { fakeMarketApi, marketEntry, marketState } from './fakes/market.ts';

const FQID = 'official/dps-meter';

function installedRow(fqid = FQID): InstalledAddon {
  const { path: _path, ...manifest } = marketEntry();
  return { fqid, marketplace: 'official', manifest, enabled: true, pin: null };
}

function updateRow(overrides: Partial<UpdateRow> = {}): UpdateRow {
  return {
    fqid: FQID,
    name: 'DPS Meter',
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
}

function open(options: Options = {}) {
  // Typed by their real signatures rather than left to inference, so a test that
  // wants to see which fqid an action was given can say so.
  const calls = {
    install: vi.fn<CatalogRegistry['install']>(() => Promise.resolve()),
    update: vi.fn<CatalogRegistry['update']>(() => Promise.resolve()),
    setPin: vi.fn<CatalogRegistry['setPin']>(() => Promise.resolve()),
    refresh: vi.fn<MarketApi['refresh']>(() => Promise.resolve()),
    add: vi.fn<MarketApi['add']>(() => Promise.resolve()),
    remove: vi.fn<MarketApi['remove']>(() => Promise.resolve()),
    setRef: vi.fn<MarketApi['setRef']>(() => Promise.resolve()),
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
    refresh: calls.refresh,
    add: calls.add,
    remove: calls.remove,
    setRef: calls.setRef,
  });

  // Both null together, which is the state the manager is in when the bridge
  // handshake never completed.
  const deps: CatalogStoreDeps = { market: null, registry: null, onChange: () => undefined };
  if (options.bridged !== false) {
    deps.market = market;
    deps.registry = registry;
  }
  return { store: createCatalogStore(deps), calls };
}

/**
 * Wait for something to become true, rather than for a fixed number of turns.
 *
 * An action is a promise chain with a reload on the end of it, so the number of
 * microtasks between the call and the result is an implementation detail. Every
 * wait below therefore names the observable it is actually waiting for.
 */
const until = (assertion: () => void): Promise<void> => vi.waitFor(assertion);

/** Wait for a load to reach a terminal status. */
function settled(store: ReturnType<typeof open>['store']): Promise<void> {
  return until(() => {
    expect(['ready', 'failed']).toContain(store.state().status);
  });
}

/**
 * A store that has already read once, which is the state every pane is in.
 *
 * The window loads all three readings on open, so an action always runs against
 * a store that has settled. Driving one straight out of `idle` would exercise an
 * ordering the manager never produces.
 */
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
    expect([...state.installed]).toEqual([FQID]);
    expect(state.updates.map((row) => row.fqid)).toEqual([FQID]);
  });

  // The whole point of computing update rows against the cached indexes.
  it('does not refresh anything', async () => {
    const { store, calls } = open();

    store.load();
    await settled(store);

    expect(calls.refresh).not.toHaveBeenCalled();
  });

  it('reports failed with nothing read when the bridge never connected', async () => {
    const { store } = open({ bridged: false });

    store.load();
    await settled(store);

    expect(store.state().status).toBe('failed');
    expect(store.state().markets).toEqual([]);
  });

  // Not just an error: the status has to leave `loading` too, or Refresh, which
  // is disabled while a read is in flight and is the only way to retry, stays
  // disabled for the rest of the session.
  it('records a rejection as a failure rather than a read still in flight', async () => {
    const { store, calls } = open();
    calls.list.mockImplementation(() => Promise.reject(new Error('the port is closed')));

    store.load();
    await settled(store);

    expect(store.state().error).toContain('the port is closed');
    expect(store.state().status).toBe('failed');
  });

  // A slow first load landing after a fast second one would reinstate the older
  // reading, and nothing on screen would say the list was stale.
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

  // Each update re-fetches a body, so a burst is the request pattern a rate
  // limit answers worst.
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

  // The pane already reports the unreachable state; a rejection out of a click
  // handler would be a second report of the same fact with nowhere to go.
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
