// What Browse, Marketplaces, and Updates all read, loaded outside the tree.
//
// One store for the three panes rather than one each, because they are three
// views of the same two readings: the source list with each source's index, and
// the installed set. Splitting them would mean three copies of that pair, going
// out of date independently, so Browse could offer an Install for something the
// Marketplaces pane had already removed the source of.
//
// Same shape as manager/store.ts and manager/dev-store.ts: a plain object a Node
// test can drive without rendering, and a reload triggered from outside the tree
// is a method call rather than a prop that exists to invalidate an effect. The
// actions live in catalog-actions.ts.

import { describeError } from '../../../shared/diag.ts';
import type { MarketplaceState, UpdateRow } from '../../../shared/protocol.ts';
import type { CatalogActions, CatalogServices } from './catalog-actions.ts';
import { createCatalogActions } from './catalog-actions.ts';

type CatalogStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface CatalogState {
  status: CatalogStatus;
  /** Every source in list order, official first, each with its cached index. */
  markets: readonly MarketplaceState[];
  /** fqids of everything installed, so a row knows which control to draw. */
  installed: ReadonlySet<string>;
  /** Installed addons their marketplace now offers a newer version of. */
  updates: readonly UpdateRow[];
  /** What an action is running against, so its row can disable. Null when idle. */
  busy: string | null;
  error: string | null;
}

interface CatalogStoreDeps extends CatalogServices {
  onChange: () => void;
}

interface CatalogStore extends CatalogActions {
  state: () => CatalogState;
  /** Read the source list, the installed set, and the update rows. */
  load: () => void;
}

const IDLE: CatalogState = {
  status: 'idle',
  markets: [],
  installed: new Set(),
  updates: [],
  busy: null,
  error: null,
};

/**
 * One reading of everything the three panes show.
 *
 * None of the three calls fetches: `market.list` answers from the indexes as
 * they were last read and `registry.updates` compares against those. Refresh is
 * what goes to the network, which is what keeps opening the manager from costing
 * a request per source before it can draw anything.
 */
async function read(deps: CatalogStoreDeps): Promise<CatalogState> {
  const { market, registry } = deps;
  if (market === null || registry === null) {
    return { ...IDLE, status: 'failed' };
  }
  const [markets, rows, updates] = await Promise.all([
    market.list(),
    registry.list(),
    registry.updates(),
  ]);
  return {
    status: 'ready',
    markets,
    installed: new Set(rows.map((row) => row.fqid)),
    updates,
    busy: null,
    error: null,
  };
}

function createCatalogStore(deps: CatalogStoreDeps): CatalogStore {
  let state = IDLE;
  // Every load takes a ticket and only the newest may write, so a slow first
  // load cannot land after a fast refresh and reinstate the older reading.
  let ticket = 0;

  const commit = (next: CatalogState): void => {
    state = next;
    deps.onChange();
  };

  /**
   * Record a failure, and stop claiming a read is still in flight.
   *
   * The status has to move off `loading`, not just gain an error. Every control
   * that greys out during a read is disabled on that status, including the
   * Refresh that is the way to retry, so a rejected load that left `loading`
   * behind would leave the pane stuck on the one thing it needs.
   */
  const fail = (err: unknown): void => {
    commit({ ...state, status: 'failed', busy: null, error: describeError(err) });
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

  /** Run one action, then reload, so the panes reflect what the host now holds. */
  const act = (busy: string | null, run: () => Promise<void>): void => {
    commit({ ...state, busy, error: null });
    run().then(load).catch(fail);
  };

  return { state: () => state, load, ...createCatalogActions(deps, act) };
}

export type { CatalogState, CatalogStatus, CatalogStore, CatalogStoreDeps };
export { createCatalogStore };
