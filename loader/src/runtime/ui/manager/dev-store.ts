// The two dev switches, which decide whether the local source exists, and what that source last
// reported. Installing from it goes through Browse like any other source. Same shape as store.ts
// and catalog-store.ts.

import { describeError } from '../../../shared/diag.ts';
import { LOCAL_ID } from '../../../shared/marketplace.ts';
import type { DevApi, DevState, MarketApi } from '../../../shared/protocol.ts';

type DevStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface DevPaneState {
  status: DevStatus;
  /** Null until the first load, and whenever the bridge is not there. */
  dev: DevState | null;
  error: string | null;
}

interface DevStoreDeps {
  /** Both are null together when the bridge never connected. */
  dev: DevApi | null;
  market: Pick<MarketApi, 'refresh'> | null;
  onChange: () => void;
}

interface DevStore {
  state: () => DevPaneState;
  load: () => void;
  setEnabled: (on: boolean) => void;
  setHotReload: (on: boolean) => void;
  /**
   * Re-read the local index, then reload. The watcher polls bodies and never the index, so a new
   * addon or an edited manifest needs this.
   */
  refresh: () => void;
}

/** The local source's fetch error, but only while that source exists. */
function localError(settings: DevState): string | null {
  if (!settings.enabled) {
    return null;
  }
  return settings.error;
}

const IDLE: DevPaneState = { status: 'idle', dev: null, error: null };

/** The three things the pane can do, each a no-op without a bridge, which the pane reports. */
function createActions(
  deps: DevStoreDeps,
  act: (run: () => Promise<void>) => void,
): Pick<DevStore, 'setEnabled' | 'setHotReload' | 'refresh'> {
  return {
    setEnabled: (on) => {
      const { dev } = deps;
      if (dev !== null) {
        act(() => dev.setEnabled(on));
      }
    },

    setHotReload: (on) => {
      const { dev } = deps;
      if (dev !== null) {
        act(() => dev.setHotReload(on));
      }
    },

    refresh: () => {
      const { market } = deps;
      if (market !== null) {
        act(() => market.refresh(LOCAL_ID));
      }
    },
  };
}

/** One reading of the dev settings, plus what the local source last reported. */
async function read(deps: DevStoreDeps): Promise<DevPaneState> {
  const { dev } = deps;
  if (dev === null) {
    return { ...IDLE, status: 'failed' };
  }
  const settings = await dev.state();
  return {
    status: 'ready',
    dev: settings,
    // The local source's fetch error is what a stopped dev server looks like, so show it.
    error: localError(settings),
  };
}

function createDevStore(deps: DevStoreDeps): DevStore {
  let state = IDLE;
  // Only the newest load may write, so a slow load cannot land after a fast refresh.
  let ticket = 0;

  const commit = (next: DevPaneState): void => {
    state = next;
    deps.onChange();
  };

  /** Record a failure, moving the status off `loading`. */
  const fail = (err: unknown): void => {
    commit({ ...state, status: 'failed', error: describeError(err) });
  };

  const load = (): void => {
    ticket += 1;
    const mine = ticket;
    commit({ ...state, status: 'loading', error: null });
    read(deps)
      .then((next) => {
        if (mine === ticket) {
          commit(next);
        }
      })
      .catch((err: unknown) => {
        if (mine === ticket) {
          fail(err);
        }
      });
  };

  /** Run one action, then reload, so the pane reflects what the host now holds. */
  const act = (run: () => Promise<void>): void => {
    commit({ ...state, error: null });
    run().then(load).catch(fail);
  };

  return { state: () => state, load, ...createActions(deps, act) };
}

export type { DevPaneState, DevStatus, DevStore, DevStoreDeps };
export { createDevStore };
