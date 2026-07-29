// The source list itself: what is built in, and what the player added.
//
// Three kinds, merged in a fixed order on every read. The official marketplace
// is first and comes from the loader build, so it cannot be removed or repointed
// without shipping a new loader. The local dev server is second and only while
// dev mode is on; it is never persisted, which is what makes turning dev mode
// off the way to remove it. User-added GitHub repositories follow, and they are
// the only ones that touch storage.
//
// Only the three fields a user actually chose are persisted, and reading the
// list back re-runs the same validation that accepting it did. The marketplace
// id is the storage namespace of every addon installed from it, so re-deriving
// it from owner and repo rather than trusting a stored id is what stops a
// hand-edited GM value from claiming another source's addon data.

import {
  fromStored,
  LOCAL,
  type MarketplaceRef,
  OFFICIAL,
  toStored,
} from '../shared/marketplace.ts';
import type { StorageApi } from '../shared/protocol.ts';
import { readDevSettings } from './dev-settings.ts';

const NS = 'loader';
const MARKETS_KEY = 'marketplaces';

type ListStorage = Pick<StorageApi, 'get' | 'set'>;

/**
 * The user-added sources, dropping any record that no longer validates.
 *
 * Dropping rather than surfacing: a record that fails validation cannot be
 * fetched from and cannot be repaired here, so keeping it would put a row in the
 * manager with no working control on it.
 */
async function readStored(storage: ListStorage): Promise<MarketplaceRef[]> {
  const raw = await storage.get(NS, MARKETS_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  const kept: MarketplaceRef[] = [];
  for (const record of raw) {
    const ref = fromStored(record);
    if (ref !== null && !kept.some((seen) => seen.id === ref.id)) {
      kept.push(ref);
    }
  }
  return kept;
}

async function writeStored(storage: ListStorage, refs: readonly MarketplaceRef[]): Promise<void> {
  await storage.set(
    NS,
    MARKETS_KEY,
    refs.map(toStored).filter((record) => record !== null),
  );
}

/** Every source in list order: official, then the dev server if on, then the rest. */
async function readAll(storage: ListStorage): Promise<MarketplaceRef[]> {
  const settings = await readDevSettings(storage);
  const built: MarketplaceRef[] = [OFFICIAL];
  if (settings.enabled) {
    built.push(LOCAL);
  }
  return [...built, ...(await readStored(storage))];
}

export type { ListStorage };
export { MARKETS_KEY, NS as MARKET_NS, readAll, readStored, writeStored };
