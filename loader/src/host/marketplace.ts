// Fetching each source's index, and the two dev-mode switches.
//
// The list itself is host/market-list.ts, the per-session index cache is
// host/market-indexes.ts, and the switches are host/dev-settings.ts; this is
// what turns the three of them into the bridge's MarketApi.

import {
  githubMarketplace,
  isBuiltinMarketplace,
  LOCAL,
  LOCAL_ORIGIN,
  type MarketplaceRef,
  type NormalizeResult,
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
import type { MarketplaceEntry } from '../shared/schema.ts';
import { inSeries } from '../shared/sequence.ts';
import type { DevSettings } from './dev-settings.ts';
import { readDevSettings, writeDevSettings } from './dev-settings.ts';
import type { Fetcher } from './fetcher.ts';
import type { IndexCache } from './market-indexes.ts';
import { createIndexCache } from './market-indexes.ts';
import type { ListStorage } from './market-list.ts';
import { addStored, readAll, removeStored, repointStored } from './market-list.ts';

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

/** A normalized source moved onto an explicit ref, or left where the URL put it. */
function pinRef(ref: MarketplaceRef, wanted: string | undefined): NormalizeResult {
  const trimmed = wanted?.trim() ?? '';
  if (trimmed.length === 0 || ref.source.kind !== 'github') {
    return { ok: true, ref };
  }
  return githubMarketplace(ref.source.owner, ref.source.repo, trimmed);
}

/**
 * The three writes to the source list.
 *
 * Every one of them is refused in the host rather than hidden in the UI. Hiding
 * a control is presentation; this is what makes a hand-crafted call from the
 * runtime fail too. market-list.ts holds the storage half and the refusals; what
 * is here is what the rest of the host has to be told about a change.
 */
function createListApi(
  deps: MarketDeps,
  indexes: IndexCache,
): Pick<MarketApi, 'add' | 'remove' | 'setRef'> {
  const { storage, emit } = deps;

  return {
    add: async (url, ref) => {
      const parsed = normalizeMarketplaceUrl(url);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      // An explicit ref wins over whatever the URL carried, so pasting a tree
      // URL and then typing a tag pins to the tag rather than silently to the
      // branch that was in the URL.
      const pinned = pinRef(parsed.ref, ref);
      if (!pinned.ok) {
        throw new Error(pinned.error);
      }
      await addStored(storage, pinned.ref);
      emit({ k: 'market.changed', id: pinned.ref.id });
      await indexes.load(pinned.ref);
    },

    remove: async (id) => {
      await removeStored(storage, id);
      indexes.drop(id);
      emit({ k: 'market.changed', id });
    },

    setRef: async (id, ref) => {
      const moved = await repointStored(storage, id, ref);
      // The cached rows came from the ref this source no longer points at, so
      // they are not its contents any more. Dropping them rather than leaving
      // them to be replaced means a failed load reports nothing rather than the
      // previous tag's addons under the new tag's name.
      indexes.drop(id);
      emit({ k: 'market.changed', id });
      await indexes.load(moved);
    },
  };
}

/** The MarketApi, over the source list and the index cache. */
function createMarketApi(
  deps: MarketDeps,
  indexes: IndexCache,
  refs: () => Promise<MarketplaceRef[]>,
): MarketApi {
  return {
    ...createListApi(deps, indexes),

    ensure: async () => {
      await indexes.ensure(await refs());
    },

    list: async () =>
      (await refs()).map(
        (ref): MarketplaceState => ({
          ref,
          builtin: isBuiltinMarketplace(ref.id),
          ...indexes.stateFor(ref.id),
        }),
      ),

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
function createDevApi(deps: MarketDeps, indexes: IndexCache): DevApi {
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
      indexes.drop(LOCAL.id);
      emit({ k: 'market.changed', id: LOCAL.id });
    },

    setHotReload: async (on) => {
      await set({ hotReload: on });
    },
  };
}

function createMarketService(deps: MarketDeps): MarketService {
  const indexes = createIndexCache(deps);
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
