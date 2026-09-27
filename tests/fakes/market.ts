// MarketplaceState and MarketplaceEntry builders, so a new field is one edit rather than one per
// suite.

import type { MarketplaceRef } from '../../loader/src/shared/marketplace.ts';
import type {
  MarketApi,
  MarketplaceEntry,
  MarketplaceState,
} from '../../loader/src/shared/protocol.ts';

/** A valid index row. The defaults are a real manifest, not a minimal one. */
function marketEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  const id = overrides.id ?? 'combat-meter';
  return {
    id,
    name: 'Combat Meter',
    version: '1.2.0',
    apiVersion: 1,
    // Present by default so a case that DROPS it is testing something.
    apiMinor: 1,
    author: 'MarshalX',
    description: 'What your damage is made of.',
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

/** A MarketApi that answers, for a suite that is not about the source list. */
function fakeMarketApi(overrides: Partial<MarketApi> = {}): MarketApi {
  return {
    list: () => Promise.resolve([]),
    ensure: () => Promise.resolve(),
    add: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    setRef: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    ...overrides,
  };
}

export { fakeMarketApi, marketEntry, marketState };
