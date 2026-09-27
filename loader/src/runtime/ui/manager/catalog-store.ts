// What Browse, Marketplaces, and Updates all read, loaded outside the tree.
//
// One store for the three panes, so they cannot go out of date independently and Browse cannot
// offer an Install for a source the Marketplaces pane already removed. Same shape as store.ts and
// dev-store.ts; the actions live in catalog-actions.ts.

import { describeError } from '../../../shared/diag.ts';
import type { MarketplaceState, UpdateRow } from '../../../shared/protocol.ts';
import type { CatalogActions, CatalogServices } from './catalog-actions.ts';
import { createCatalogActions } from './catalog-actions.ts';

type CatalogStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface CatalogState {
  status: CatalogStatus;
  /** Every source in list order, official first, each with its cached index. */
  markets: readonly MarketplaceState[];
  /** fqid to enable flag for everything installed, so a row can say "installed but off". */
  installed: ReadonlyMap<string, boolean>;
  /**
   * fqid to display name for everything installed, from the registry's copy of the manifest: the
   * only name left for an addon whose source has gone.
   */
  names: ReadonlyMap<string, string>;
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
  installed: new Map(),
  names: new Map(),
  updates: [],
  busy: null,
  error: null,
};

/**
 * One reading of everything the three panes show. None of the three calls fetches; Refresh is what
 * goes to the network. `ensure` fetches a source this session has never read, and is awaited AHEAD
 * of the three because all three read the index cache it fills.
 */
async function read(deps: CatalogStoreDeps): Promise<CatalogState> {
  const { market, registry } = deps;
  if (market === null || registry === null) {
    return { ...IDLE, status: 'failed' };
  }
  await market.ensure();
  const [markets, rows, updates] = await Promise.all([
    market.list(),
    registry.list(),
    registry.updates(),
  ]);
  return {
    status: 'ready',
    markets,
    installed: new Map(rows.map((row) => [row.fqid, row.enabled])),
    names: new Map(rows.map((row) => [row.fqid, row.manifest.name])),
    updates,
    busy: null,
    error: null,
  };
}

function createCatalogStore(deps: CatalogStoreDeps): CatalogStore {
  let state = IDLE;
  // Only the newest load may write, so a slow load cannot land after a fast refresh.
  let ticket = 0;

  const commit = (next: CatalogState): void => {
    state = next;
    deps.onChange();
  };

  /**
   * Record a failure. The status must leave `loading`, since Refresh, the retry, is disabled on it.
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
