// Fetching each source's index, and the two dev-mode switches.
//
// Index state is per session rather than persisted: the fetcher's ETag cache is
// what survives a page reload, so a second copy here would be a second thing to
// keep in step with it. `fetchedAt: null` therefore means "not read this
// session", which the manager renders differently from an index that was read
// and found empty.
//
// The list itself is host/market-list.ts and the switches are
// host/dev-settings.ts; this is what turns them into the bridge's MarketApi.

import { describeError } from '../shared/diag.ts';
import {
  indexUrl,
  isBuiltinMarketplace,
  LOCAL,
  LOCAL_ORIGIN,
  type MarketplaceRef,
  normalizeMarketplaceUrl,
  splitFqid,
} from '../shared/marketplace.ts';
import type {
  DevApi,
  DevState,
  HostEvent,
  MarketApi,
  MarketplaceState,
} from '../shared/protocol.ts';
import type { MarketplaceEntry, ValidationIssue } from '../shared/schema.ts';
import { validateIndex } from '../shared/schema.ts';
import { inSeries } from '../shared/sequence.ts';
import type { DevSettings } from './dev-settings.ts';
import { readDevSettings, writeDevSettings } from './dev-settings.ts';
import type { Fetcher } from './fetcher.ts';
import type { ListStorage } from './market-list.ts';
import { readAll, readStored, writeStored } from './market-list.ts';

/** How many index issues to quote before the message stops being readable. */
const MAX_QUOTED_ISSUES = 3;

/** The mutable half of MarketplaceState: what a fetch produces. */
interface IndexState {
  fetchedAt: number | null;
  addons: MarketplaceEntry[];
  error: string | null;
}

interface MarketDeps {
  storage: ListStorage;
  fetcher: Fetcher;
  emit: (event: HostEvent) => void;
  /** Wall-clock ms, for the last-fetched readout. */
  now: () => number;
}

interface MarketService {
  api: MarketApi;
  dev: DevApi;
  /** Every source in list order, official first. */
  refs: () => Promise<MarketplaceRef[]>;
  /**
   * The index row one fqid names, fetching that source's index first if it has
   * never been read. Null when the source or the addon is not there.
   */
  entry: (fqid: string) => Promise<{ market: MarketplaceRef; row: MarketplaceEntry } | null>;
  devSettings: () => Promise<DevSettings>;
}

const EMPTY: IndexState = { fetchedAt: null, addons: [], error: null };

/** A validation failure rendered as one line, since it lands in a pane, not a log. */
function indexIssues(issues: readonly ValidationIssue[]): string {
  const quoted = issues
    .slice(0, MAX_QUOTED_ISSUES)
    .map((issue) => `${issue.path || '(root)'}: ${issue.message}`)
    .join('; ');
  if (issues.length > MAX_QUOTED_ISSUES) {
    return `${quoted}; and ${issues.length - MAX_QUOTED_ISSUES} more`;
  }
  return quoted;
}

/** The per-session index cache, and the one operation that fills it. */
function createIndexes(deps: MarketDeps) {
  const indexes = new Map<string, IndexState>();
  const stateFor = (id: string): IndexState => indexes.get(id) ?? EMPTY;

  const report = (id: string, state: 'ok' | 'error', error?: string): void => {
    if (error === undefined) {
      deps.emit({ k: 'market.progress', id, state });
    } else {
      deps.emit({ k: 'market.progress', id, state, error });
    }
    deps.emit({ k: 'market.changed', id });
  };

  /**
   * Fetch and parse one index, replacing that source's state either way.
   *
   * A source that publishes a bad index keeps whatever rows it published last:
   * it should not also take away what a player is looking at.
   */
  const load = async (ref: MarketplaceRef): Promise<void> => {
    deps.emit({ k: 'market.progress', id: ref.id, state: 'fetching' });
    try {
      const { value } = await deps.fetcher.getJson(indexUrl(ref));
      const parsed = validateIndex(value);
      if (parsed.ok) {
        indexes.set(ref.id, { fetchedAt: deps.now(), addons: parsed.value.addons, error: null });
        report(ref.id, 'ok');
        return;
      }
      const error = `the index is not valid: ${indexIssues(parsed.issues)}`;
      indexes.set(ref.id, { ...stateFor(ref.id), error });
      report(ref.id, 'error', error);
    } catch (err) {
      const error = describeError(err);
      indexes.set(ref.id, { ...stateFor(ref.id), error });
      report(ref.id, 'error', error);
    }
  };

  return { indexes, stateFor, load };
}

/** The four MarketApi members, over the list and the index cache. */
function createMarketApi(
  deps: MarketDeps,
  indexes: ReturnType<typeof createIndexes>,
  refs: () => Promise<MarketplaceRef[]>,
): MarketApi {
  const { storage, emit } = deps;

  return {
    list: async () =>
      (await refs()).map(
        (ref): MarketplaceState => ({
          ref,
          builtin: isBuiltinMarketplace(ref.id),
          ...indexes.stateFor(ref.id),
        }),
      ),

    add: async (url) => {
      const parsed = normalizeMarketplaceUrl(url);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      const stored = await readStored(storage);
      if (stored.some((ref) => ref.id === parsed.ref.id)) {
        throw new Error(`${parsed.ref.name} is already in the list`);
      }
      await writeStored(storage, [...stored, parsed.ref]);
      emit({ k: 'market.changed', id: parsed.ref.id });
      await indexes.load(parsed.ref);
    },

    // Built-ins are refused here rather than in the UI. Hiding the control is
    // presentation; this is what makes a hand-crafted call from the runtime fail
    // too.
    remove: async (id) => {
      if (isBuiltinMarketplace(id)) {
        throw new Error(`${id} ships with the loader and cannot be removed`);
      }
      const stored = await readStored(storage);
      const kept = stored.filter((ref) => ref.id !== id);
      if (kept.length === stored.length) {
        throw new Error(`no such marketplace: ${id}`);
      }
      await writeStored(storage, kept);
      indexes.indexes.delete(id);
      emit({ k: 'market.changed', id });
    },

    refresh: async (id) => {
      const all = await refs();
      if (id === undefined) {
        await inSeries(all, indexes.load);
        return;
      }
      const wanted = all.filter((ref) => ref.id === id);
      if (wanted.length === 0) {
        throw new Error(`no such marketplace: ${id}`);
      }
      // Sequential on purpose: three sources against one host is not worth the
      // concurrency, and a rate-limited GitHub answers a burst worse than a queue.
      await inSeries(wanted, indexes.load);
    },
  };
}

/** The dev switches, plus what the pane reads about the local source. */
function createDevApi(deps: MarketDeps, indexes: ReturnType<typeof createIndexes>): DevApi {
  const { storage, emit } = deps;

  const set = async (patch: Partial<DevSettings>): Promise<void> => {
    await writeDevSettings(storage, patch);
    emit({ k: 'dev.changed' });
  };

  return {
    state: async (): Promise<DevState> => {
      const settings = await readDevSettings(storage);
      const local = indexes.stateFor(LOCAL.id);
      return {
        enabled: settings.enabled,
        hotReload: settings.hotReload,
        origin: LOCAL_ORIGIN,
        polledAt: local.fetchedAt,
        error: local.error,
      };
    },

    setEnabled: async (on) => {
      await set({ enabled: on });
      // Turning it on loads the local index immediately, so the pane has rows to
      // show rather than an empty list the player has to refresh by hand.
      if (on) {
        await indexes.load(LOCAL);
        return;
      }
      indexes.indexes.delete(LOCAL.id);
      emit({ k: 'market.changed', id: LOCAL.id });
    },

    setHotReload: async (on) => {
      await set({ hotReload: on });
    },
  };
}

function createMarketService(deps: MarketDeps): MarketService {
  const indexes = createIndexes(deps);
  const refs = (): Promise<MarketplaceRef[]> => readAll(deps.storage);

  return {
    refs,
    devSettings: () => readDevSettings(deps.storage),
    api: createMarketApi(deps, indexes, refs),
    dev: createDevApi(deps, indexes),

    entry: async (fqid) => {
      const split = splitFqid(fqid);
      if (split === null) {
        return null;
      }
      const market = (await refs()).find((ref) => ref.id === split.marketplace) ?? null;
      if (market === null) {
        return null;
      }
      // Loaded on demand so installing works straight after adding a source,
      // without the caller having to know that a refresh has to come first.
      if (indexes.stateFor(market.id).fetchedAt === null) {
        await indexes.load(market);
      }
      const row = indexes.stateFor(market.id).addons.find((addon) => addon.id === split.addonId);
      if (row === undefined) {
        return null;
      }
      return { market, row };
    },
  };
}

export type { MarketDeps, MarketService };
export { createMarketService };
