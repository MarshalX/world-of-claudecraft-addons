// The per-session index cache: one reading per source, and the two ways it fills.
//
// State is per session rather than persisted: the fetcher's ETag cache is what
// survives a page reload, so a second copy here would be a second thing to keep
// in step with it. `fetchedAt: null` therefore means "not read this session",
// which the manager renders differently from an index that was read and found
// empty.
//
// `load` is what Refresh drives and always goes to the network. `ensure` is what
// opening the manager drives, and reads each source AT MOST ONCE a session.
// Without it the map starts empty on every page load and nothing ever seeded it,
// so Browse drew its "no marketplace has been read yet" note on a fresh install
// and again after every reload, and the update check compared installed addons
// against no rows at all, which reads as a clean bill of health rather than as a
// question nobody asked.

import { describeError } from '../shared/diag.ts';
import type { MarketplaceRef } from '../shared/marketplace.ts';
import type { HostEvent } from '../shared/protocol.ts';
import type { MarketplaceEntry } from '../shared/schema.ts';
import { inSeries } from '../shared/sequence.ts';
import type { Fetcher } from './fetcher.ts';
import { readRows } from './market-index.ts';

/** The mutable half of MarketplaceState: what a read of one source produces. */
interface IndexState {
  fetchedAt: number | null;
  addons: MarketplaceEntry[];
  /** The rows came from enumerating the repository rather than from an index. */
  degraded: boolean;
  error: string | null;
}

interface IndexDeps {
  fetcher: Fetcher;
  emit: (event: HostEvent) => void;
  /** Wall-clock ms, for the last-fetched readout. */
  now: () => number;
}

interface IndexCache {
  stateFor: (id: string) => IndexState;
  /** Read one source, whatever it already holds. Joins a read already running. */
  load: (ref: MarketplaceRef) => Promise<void>;
  /** Read every source this session has not attempted yet, in series. */
  ensure: (refs: readonly MarketplaceRef[]) => Promise<void>;
  /** Forget one source's reading, so a later `ensure` reads it afresh. */
  drop: (id: string) => void;
}

const EMPTY: IndexState = { fetchedAt: null, addons: [], degraded: false, error: null };

function report(deps: IndexDeps, id: string, state: 'ok' | 'error', error?: string): void {
  if (error === undefined) {
    deps.emit({ k: 'market.progress', id, state });
  } else {
    deps.emit({ k: 'market.progress', id, state, error });
  }
  deps.emit({ k: 'market.changed', id });
}

/**
 * Read one source, replacing its state either way.
 *
 * A source that fails keeps whatever rows it published last: it should not also
 * take away what a player is looking at.
 */
async function readInto(
  deps: IndexDeps,
  states: Map<string, IndexState>,
  ref: MarketplaceRef,
): Promise<void> {
  deps.emit({ k: 'market.progress', id: ref.id, state: 'fetching' });
  try {
    const { addons, degraded } = await readRows(deps.fetcher, ref);
    states.set(ref.id, { fetchedAt: deps.now(), addons, degraded, error: null });
    report(deps, ref.id, 'ok');
  } catch (err) {
    const error = describeError(err);
    states.set(ref.id, { ...(states.get(ref.id) ?? EMPTY), error });
    report(deps, ref.id, 'error', error);
  }
}

function createIndexCache(deps: IndexDeps): IndexCache {
  const states = new Map<string, IndexState>();
  /** Reads in flight, so two callers of one source share one request. */
  const running = new Map<string, Promise<void>>();
  /** Every source read this session, whether the read succeeded or failed. */
  const attempted = new Set<string>();

  const load = (ref: MarketplaceRef): Promise<void> => {
    const already = running.get(ref.id);
    if (already !== undefined) {
      return already;
    }
    attempted.add(ref.id);
    const run = readInto(deps, states, ref).finally(() => {
      running.delete(ref.id);
    });
    running.set(ref.id, run);
    return run;
  };

  return {
    load,
    stateFor: (id) => states.get(id) ?? EMPTY,

    // A source that FAILED counts as attempted, so a broken one is read once and
    // then left alone: retrying it here would put a doomed request in front of
    // every open of the window, which is the cost this whole function exists to
    // pay only once. Refresh is what retries. One already RUNNING is joined
    // rather than skipped, since skipping it would return to a caller that then
    // reads an index which has not landed yet.
    ensure: async (refs) => {
      const unread = refs.filter((ref) => running.has(ref.id) || !attempted.has(ref.id));
      await inSeries(unread, load);
    },

    drop: (id) => {
      states.delete(id);
      attempted.delete(id);
    },
  };
}

export type { IndexCache, IndexDeps, IndexState };
export { createIndexCache, EMPTY };
