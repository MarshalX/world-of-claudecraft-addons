// What the Dev pane reads, and the actions it drives.
//
// Offered and installed are kept apart on purpose: one comes from the dev
// server's index and the other from the registry, and they go out of date at
// different moments. Uninstalling changes the second; saving a new addon.json
// changes the first.

import { describe, expect, it, vi } from 'vitest';
import { createDevStore, type DevStoreDeps } from '../loader/src/runtime/ui/manager/dev-store.ts';
import { LOCAL, LOCAL_ORIGIN, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type {
  DevState,
  MarketplaceEntry,
  MarketplaceState,
} from '../loader/src/shared/protocol.ts';

const LOCAL_FQID = 'local/dev-harness';

function entry(id = 'dev-harness'): MarketplaceEntry {
  return {
    id,
    name: 'Dev Harness',
    version: '1.0.0',
    apiVersion: 1,
    author: 'MarshalX',
    description: 'Checks the API.',
    entry: 'main.js',
    path: `addons/${id}`,
  };
}

function devState(overrides: Partial<DevState> = {}): DevState {
  return {
    enabled: true,
    hotReload: false,
    origin: LOCAL_ORIGIN,
    polledAt: null,
    error: null,
    ...overrides,
  };
}

function markets(addons: MarketplaceEntry[]): MarketplaceState[] {
  return [
    { ref: OFFICIAL, builtin: true, fetchedAt: null, addons: [], error: null },
    { ref: LOCAL, builtin: true, fetchedAt: 1, addons, error: null },
  ];
}

interface Options {
  dev?: DevState;
  addons?: MarketplaceEntry[];
  installed?: string[];
  bridged?: boolean;
}

function open(options: Options = {}) {
  const calls = {
    setEnabled: vi.fn(() => Promise.resolve()),
    setHotReload: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    install: vi.fn(() => Promise.resolve()),
    uninstall: vi.fn(() => Promise.resolve()),
  };
  const installed = options.installed ?? [];

  // Null when the handshake failed, and all three together: the pane's
  // unreachable state is the case where none of them is there.
  const bridged = options.bridged !== false;
  const deps: DevStoreDeps = {
    dev: null,
    market: null,
    registry: null,
    onChange: vi.fn(),
  };
  if (bridged) {
    deps.dev = {
      state: () => Promise.resolve(options.dev ?? devState()),
      setEnabled: calls.setEnabled,
      setHotReload: calls.setHotReload,
    };
    deps.market = {
      list: () => Promise.resolve(markets(options.addons ?? [entry()])),
      refresh: calls.refresh,
    };
    deps.registry = {
      list: () => Promise.resolve(installed.map((fqid) => ({ fqid }))),
      install: calls.install,
      uninstall: calls.uninstall,
    };
  }

  return {
    store: createDevStore(deps),
    calls,
    onChange: deps.onChange as ReturnType<typeof vi.fn>,
  };
}

/**
 * The store commits asynchronously, so a suite waits for a load to finish.
 *
 * Waiting for a terminal status rather than for "not loading": an action commits
 * its busy flag before it starts loading, so "not loading" is also true in the
 * moment before the reload it triggers has begun.
 */
async function settled(store: ReturnType<typeof open>['store']) {
  await vi.waitFor(() => {
    expect(['ready', 'failed']).toContain(store.state().status);
  });
  return store.state();
}

describe('loading', () => {
  it('starts idle rather than claiming an empty dev server', () => {
    expect(open().store.state()).toMatchObject({ status: 'idle', dev: null, offered: [] });
  });

  it('reads the dev settings, the local index, and the installed set', async () => {
    const { store } = open({ installed: [LOCAL_FQID] });
    store.load();

    const state = await settled(store);

    expect(state.status).toBe('ready');
    expect(state.dev?.origin).toBe(LOCAL_ORIGIN);
    expect(state.offered.map((row) => row.id)).toEqual(['dev-harness']);
    expect(state.installed.has(LOCAL_FQID)).toBe(true);
  });

  it('reads only the local source addons, not the official ones', async () => {
    const { store } = open({ addons: [entry('a'), entry('b')] });
    store.load();

    expect((await settled(store)).offered).toHaveLength(2);
  });

  // A dev server that is not running is the ordinary state, and the reading that
  // says so comes from the host rather than from the last action's failure.
  it('surfaces the local source own fetch error', async () => {
    const { store } = open({ dev: devState({ error: 'HTTP 404 from localhost' }) });
    store.load();

    expect((await settled(store)).error).toContain('404');
  });

  // With dev mode off there is nothing to be unreachable, so an error left over
  // from a previous session must not sit in the pane.
  it('hides that error while dev mode is off', async () => {
    const { store } = open({ dev: devState({ enabled: false, error: 'HTTP 404' }) });
    store.load();

    expect((await settled(store)).error).toBeNull();
  });

  it('reports a bridge that never connected as failed with nothing read', async () => {
    const { store } = open({ bridged: false });
    store.load();

    const state = await settled(store);
    expect(state.status).toBe('failed');
    expect(state.dev).toBeNull();
  });

  // Without the ticket a slow first load lands after a fast refresh and puts the
  // older reading back.
  it('lets only the newest load write', async () => {
    const { store } = open();
    store.load();
    store.load();

    expect((await settled(store)).status).toBe('ready');
  });
});

describe('the two switches', () => {
  it('turns dev mode on through the host', async () => {
    const { store, calls } = open();

    store.setEnabled(true);

    await vi.waitFor(() => {
      expect(calls.setEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('turns hot reload on through the host', async () => {
    const { store, calls } = open();

    store.setHotReload(true);

    await vi.waitFor(() => {
      expect(calls.setHotReload).toHaveBeenCalledWith(true);
    });
  });

  // Otherwise the pane still shows the list from before the switch moved.
  it('reloads after the switch lands', async () => {
    const { store, calls } = open();

    store.setEnabled(true);

    await vi.waitFor(() => {
      expect(calls.setEnabled).toHaveBeenCalled();
    });
    expect((await settled(store)).status).toBe('ready');
  });
});

describe('installing', () => {
  it('installs under the fully-qualified id, not the short one', async () => {
    const { store, calls } = open();

    store.install('dev-harness');

    await vi.waitFor(() => {
      expect(calls.install).toHaveBeenCalledWith(LOCAL_FQID);
    });
  });

  it('marks the row busy while the install is in flight', () => {
    const { store } = open();

    store.install('dev-harness');

    expect(store.state().busy).toBe(LOCAL_FQID);
  });

  it('clears busy and reloads once it lands', async () => {
    const { store } = open({ installed: [LOCAL_FQID] });

    store.install('dev-harness');

    const state = await settled(store);
    expect(state.busy).toBeNull();
    expect(state.installed.has(LOCAL_FQID)).toBe(true);
  });

  it('shows the reason when it fails', async () => {
    const { store, calls } = open();
    calls.install.mockReturnValue(Promise.reject(new Error('HTTP 404 from localhost')));

    store.install('dev-harness');

    await vi.waitFor(() => {
      expect(store.state().error).toContain('404');
    });
    expect(store.state().busy).toBeNull();
  });
});

describe('uninstalling', () => {
  it('sends the fqid through', async () => {
    const { store, calls } = open({ installed: [LOCAL_FQID] });

    store.uninstall(LOCAL_FQID);

    await vi.waitFor(() => {
      expect(calls.uninstall).toHaveBeenCalledWith(LOCAL_FQID);
    });
  });
});

describe('refresh', () => {
  it('refreshes the local source only', async () => {
    const { store, calls } = open();

    store.refresh();

    await vi.waitFor(() => {
      expect(calls.refresh).toHaveBeenCalledWith('local');
    });
  });
});

describe('without a bridge', () => {
  it.each(['setEnabled', 'setHotReload', 'refresh', 'install', 'uninstall'] as const)(
    '%s does nothing rather than throwing',
    (action) => {
      const { store } = open({ bridged: false });

      expect(() => {
        if (action === 'setEnabled' || action === 'setHotReload') {
          store[action](true);
        } else if (action === 'refresh') {
          store.refresh();
        } else {
          store[action]('dev-harness');
        }
      }).not.toThrow();
    },
  );
});
