// The two dev switches and what the local source last reported.
//
// Same shape as manager/store.ts and manager/catalog-store.ts, and for the same
// reason: a plain object a Node test can drive without rendering, and a reload
// triggered from outside the tree is a method call rather than a prop that
// exists to invalidate an effect.
//
// It used to hold the local server's offered list and the installed set as well,
// so the Dev pane could install from it directly. Browse does that now, for
// every source including this one, so what was two views of the same rows became
// one: this reads only DevApi, and the pane points at Browse. What is left here
// is what nothing else owns, which is the pair of switches that decide whether
// the local source exists at all.

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
   * Re-read the local index, then reload.
   *
   * Kept here even though the Marketplaces pane can refresh any source: the
   * watcher polls addon BODIES and never the index, so a new addon directory or
   * an edited manifest needs an explicit refresh, and this is the pane an author
   * is already on when that happens.
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

/**
 * The three things the pane can do, each a no-op without a bridge.
 *
 * Doing nothing rather than throwing: the pane already reports the unreachable
 * state, and a rejection from a click handler would be a second report of the
 * same fact with nowhere to go.
 */
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
    // The dev reading carries the local source's own fetch error, which is what
    // a dev server that is not running looks like, so it is shown rather than
    // only the last action's failure.
    error: localError(settings),
  };
}

function createDevStore(deps: DevStoreDeps): DevStore {
  let state = IDLE;
  // Every load takes a ticket and only the newest may write, so a slow first
  // load cannot land after a fast refresh and reinstate the older reading.
  let ticket = 0;

  const commit = (next: DevPaneState): void => {
    state = next;
    deps.onChange();
  };

  /**
   * Record a failure, and stop claiming a read is still in flight.
   *
   * Same reasoning as catalog-store.ts: a rejected load that left `loading`
   * behind would have the pane reporting a read that is never going to finish.
   */
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
