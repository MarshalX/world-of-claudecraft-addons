// What the Dev pane reads, and the three actions it drives.
//
// It used to hold the local server's offered list and the installed set too, so
// the pane could install from it. Browse covers that for every source including
// this one, so those cases moved to manager-catalog-store and what is left here
// is the pair of switches nothing else owns, plus the explicit index refresh the
// watcher deliberately does not do on its own.

import { describe, expect, it, vi } from 'vitest';
import { createDevStore, type DevStoreDeps } from '../loader/src/runtime/ui/manager/dev-store.ts';
import { LOCAL_ID, LOCAL_ORIGIN } from '../loader/src/shared/marketplace.ts';
import type { DevState } from '../loader/src/shared/protocol.ts';

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

interface Options {
  dev?: DevState;
  bridged?: boolean;
}

function open(options: Options = {}) {
  const calls = {
    state: vi.fn<() => Promise<DevState>>(() => Promise.resolve(options.dev ?? devState())),
    setEnabled: vi.fn<(on: boolean) => Promise<void>>(() => Promise.resolve()),
    setHotReload: vi.fn<(on: boolean) => Promise<void>>(() => Promise.resolve()),
    refresh: vi.fn<(id?: string) => Promise<void>>(() => Promise.resolve()),
  };

  // Both null together, which is the state the manager is in when the bridge
  // handshake never completed.
  const deps: DevStoreDeps = { dev: null, market: null, onChange: () => undefined };
  if (options.bridged !== false) {
    deps.dev = {
      state: calls.state,
      setEnabled: calls.setEnabled,
      setHotReload: calls.setHotReload,
    };
    deps.market = { refresh: calls.refresh };
  }
  return { store: createDevStore(deps), calls };
}

/** Wait for something to become true, rather than for a fixed number of turns. */
const until = (assertion: () => void): Promise<void> => vi.waitFor(assertion);

function settled(store: ReturnType<typeof open>['store']): Promise<void> {
  return until(() => {
    expect(['ready', 'failed']).toContain(store.state().status);
  });
}

describe('loading', () => {
  it('starts idle rather than claiming the dev server is off', () => {
    expect(open().store.state()).toMatchObject({ status: 'idle', dev: null });
  });

  it('reads the dev settings', async () => {
    const { store } = open({ dev: devState({ hotReload: true, polledAt: 42 }) });

    store.load();
    await settled(store);

    expect(store.state().dev).toMatchObject({ enabled: true, hotReload: true, polledAt: 42 });
  });

  // What a dev server that is not running looks like, which is the state this
  // pane exists to make visible.
  it('surfaces the local source own fetch error', async () => {
    const { store } = open({ dev: devState({ error: 'HTTP 404 from http://localhost:5180' }) });

    store.load();
    await settled(store);

    expect(store.state().error).toContain('404');
  });

  it('hides that error while dev mode is off', async () => {
    const { store } = open({ dev: devState({ enabled: false, error: 'connection refused' }) });

    store.load();
    await settled(store);

    expect(store.state().error).toBeNull();
  });

  it('reports a bridge that never connected as failed with nothing read', async () => {
    const { store } = open({ bridged: false });

    store.load();
    await settled(store);

    expect(store.state()).toMatchObject({ status: 'failed', dev: null });
  });

  // Not just an error: the status has to leave `loading`, or the pane keeps
  // reporting a read that is never going to finish.
  it('records a rejection as a failure rather than a read still in flight', async () => {
    const { store, calls } = open();
    calls.state.mockImplementation(() => Promise.reject(new Error('the port is closed')));

    store.load();
    await settled(store);

    expect(store.state().status).toBe('failed');
    expect(store.state().error).toContain('the port is closed');
  });

  it('lets only the newest load write', async () => {
    const { store, calls } = open();
    let release = (): void => undefined;
    calls.state.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(devState({ hotReload: true }));
          };
        }),
    );

    store.load();
    store.load();
    await settled(store);
    release();
    await Promise.resolve();

    expect(store.state().dev?.hotReload).toBe(false);
  });
});

describe('the two switches', () => {
  it('turns dev mode on through the host', async () => {
    const { store, calls } = open();

    store.setEnabled(true);
    await until(() => {
      expect(calls.setEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('turns hot reload on through the host', async () => {
    const { store, calls } = open();

    store.setHotReload(true);
    await until(() => {
      expect(calls.setHotReload).toHaveBeenCalledWith(true);
    });
  });

  // The host decides what a switch actually became, so the pane re-reads rather
  // than showing the value it asked for.
  it('reloads after the switch lands', async () => {
    const { store, calls } = open();

    store.setEnabled(true);
    await until(() => {
      expect(calls.state).toHaveBeenCalled();
    });
  });

  it('shows the reason when a switch fails', async () => {
    const { store, calls } = open();
    calls.setEnabled.mockImplementation(() => Promise.reject(new Error('storage is unwritable')));

    store.setEnabled(true);
    await until(() => {
      expect(store.state().error).toContain('storage is unwritable');
    });
  });
});

// The watcher polls addon BODIES and never the index, so a new addon directory
// or an edited manifest needs an explicit refresh. This is that control.
describe('refresh', () => {
  it('refreshes the local source only', async () => {
    const { store, calls } = open();

    store.refresh();
    await until(() => {
      expect(calls.refresh).toHaveBeenCalledWith(LOCAL_ID);
    });
  });
});

describe('without a bridge', () => {
  // The pane already reports the unreachable state; a rejection out of a click
  // handler would be a second report of the same fact with nowhere to go.
  it('does nothing rather than throwing', async () => {
    const { store, calls } = open({ bridged: false });

    store.setEnabled(true);
    store.setHotReload(true);
    store.refresh();
    await Promise.resolve();

    expect(calls.setEnabled).not.toHaveBeenCalled();
    expect(calls.setHotReload).not.toHaveBeenCalled();
    expect(calls.refresh).not.toHaveBeenCalled();
  });
});
