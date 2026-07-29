// What the Dev pane reads and the actions it drives, loaded outside the tree.
//
// Same shape as manager/store.ts and for the same reason: a plain object a Node
// test can drive without rendering, and a reload triggered from outside the tree
// is a method call rather than a prop that exists to invalidate an effect.
//
// It holds the offered list and the installed set separately rather than one
// merged list. Whether an addon is installed comes from the registry, whether it
// is offered comes from the dev server, and the two go out of date at different
// moments: uninstalling changes one, saving a new addon.json changes the other.

import { describeError } from '../../../shared/diag.ts';
import { LOCAL_ID, fqid as makeFqid } from '../../../shared/marketplace.ts';
import type { DevApi, DevState, MarketApi, MarketplaceEntry } from '../../../shared/protocol.ts';

type DevStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface DevPaneState {
  status: DevStatus;
  /** Null until the first load, and whenever the bridge is not there. */
  dev: DevState | null;
  /** What the local dev server currently offers, from its index. */
  offered: readonly MarketplaceEntry[];
  /** fqids of everything installed, so a row knows which control to draw. */
  installed: ReadonlySet<string>;
  /** The fqid of an install or uninstall in flight, so its row can disable. */
  busy: string | null;
  error: string | null;
}

interface DevRegistry {
  list: () => Promise<{ fqid: string }[]>;
  install: (fqid: string) => Promise<void>;
  uninstall: (fqid: string) => Promise<void>;
}

interface DevStoreDeps {
  /** All three are null together when the bridge never connected. */
  dev: DevApi | null;
  market: Pick<MarketApi, 'list' | 'refresh'> | null;
  registry: DevRegistry | null;
  onChange: () => void;
}

interface DevStore {
  state: () => DevPaneState;
  /** Read the dev settings, the local index, and the installed set. */
  load: () => void;
  setEnabled: (on: boolean) => void;
  setHotReload: (on: boolean) => void;
  /** Re-fetch the local index, then reload. */
  refresh: () => void;
  install: (addonId: string) => void;
  uninstall: (fqid: string) => void;
}

/** The local source's fetch error, but only while that source exists. */
function localError(settings: DevState): string | null {
  if (!settings.enabled) {
    return null;
  }
  return settings.error;
}

const IDLE: DevPaneState = {
  status: 'idle',
  dev: null,
  offered: [],
  installed: new Set(),
  busy: null,
  error: null,
};

/**
 * The five things the pane can do, each a no-op without a bridge.
 *
 * Doing nothing rather than throwing: the pane already reports the unreachable
 * state, and a rejection from a click handler would be a second report of the
 * same fact with nowhere to go.
 */
function createActions(
  deps: DevStoreDeps,
  act: (busy: string | null, run: () => Promise<void>) => void,
): Pick<DevStore, 'setEnabled' | 'setHotReload' | 'refresh' | 'install' | 'uninstall'> {
  return {
    setEnabled: (on) => {
      const { dev } = deps;
      if (dev !== null) {
        act(null, () => dev.setEnabled(on));
      }
    },

    setHotReload: (on) => {
      const { dev } = deps;
      if (dev !== null) {
        act(null, () => dev.setHotReload(on));
      }
    },

    refresh: () => {
      const { market } = deps;
      if (market !== null) {
        act(null, () => market.refresh(LOCAL_ID));
      }
    },

    // The pane offers a short addon id, because that is what the index row
    // carries; the registry is keyed on the fully-qualified one.
    install: (addonId) => {
      const { registry } = deps;
      if (registry !== null) {
        const id = makeFqid(LOCAL_ID, addonId);
        act(id, () => registry.install(id));
      }
    },

    uninstall: (fqid) => {
      const { registry } = deps;
      if (registry !== null) {
        act(fqid, () => registry.uninstall(fqid));
      }
    },
  };
}

/**
 * One reading of everything the pane shows.
 *
 * Offered and installed are read together but kept apart: one comes from the dev
 * server's index and the other from the registry, and they go out of date at
 * different moments.
 */
async function read(deps: DevStoreDeps): Promise<DevPaneState> {
  const { dev, market, registry } = deps;
  if (dev === null || market === null || registry === null) {
    return { ...IDLE, status: 'failed' };
  }
  const [settings, markets, rows] = await Promise.all([
    dev.state(),
    market.list(),
    registry.list(),
  ]);
  const local = markets.find((entry) => entry.ref.id === LOCAL_ID);
  return {
    status: 'ready',
    dev: settings,
    offered: local?.addons ?? [],
    installed: new Set(rows.map((row) => row.fqid)),
    busy: null,
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

  const fail = (err: unknown): void => {
    commit({ ...state, busy: null, error: describeError(err) });
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
  const act = (busy: string | null, run: () => Promise<void>): void => {
    commit({ ...state, busy, error: null });
    run().then(load).catch(fail);
  };

  return { state: () => state, load, ...createActions(deps, act) };
}

export type { DevPaneState, DevRegistry, DevStatus, DevStore, DevStoreDeps };
export { createDevStore };
