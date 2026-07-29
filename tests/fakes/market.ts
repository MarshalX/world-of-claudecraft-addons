// MarketplaceState and MarketplaceEntry shapes, for a suite that is not about
// either of them.
//
// Collected here because MarketplaceState is what the bridge carries to four
// different panes, so it is the shape most likely to gain a field: `degraded`
// arrived with the contents-API fallback and would otherwise have been a
// compile error in every suite that built one by hand.

import type { MarketplaceRef } from '../../loader/src/shared/marketplace.ts';
import type {
  MarketApi,
  MarketplaceEntry,
  MarketplaceState,
} from '../../loader/src/shared/protocol.ts';

/** A valid index row. The defaults are a real manifest, not a minimal one. */
function marketEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  const id = overrides.id ?? 'dps-meter';
  return {
    id,
    name: 'DPS Meter',
    version: '1.2.0',
    apiVersion: 1,
    author: 'MarshalX',
    description: 'Rolling damage per second.',
    entry: 'main.js',
    path: `addons/${id}`,
    ...overrides,
  };
}

/** One source's state: read, holding the rows given, and healthy. */
function marketState(
  ref: MarketplaceRef,
  addons: MarketplaceEntry[] = [],
  overrides: Partial<MarketplaceState> = {},
): MarketplaceState {
  return {
    ref,
    builtin: true,
    fetchedAt: 1,
    addons,
    degraded: false,
    error: null,
    ...overrides,
  };
}

/**
 * A MarketApi that answers, for a suite that is not about the source list.
 *
 * Every member is present because the manager's type demands all of them, and a
 * suite that only cares about `list` should not have to say what `setRef` does
 * to make the compiler let it through.
 */
function fakeMarketApi(overrides: Partial<MarketApi> = {}): MarketApi {
  return {
    list: () => Promise.resolve([]),
    add: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    setRef: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    ...overrides,
  };
}

export { fakeMarketApi, marketEntry, marketState };
