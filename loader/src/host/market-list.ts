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
  githubMarketplace,
  isBuiltinMarketplace,
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

/** Append one source, or throw if the list already holds it. */
async function addStored(storage: ListStorage, ref: MarketplaceRef): Promise<void> {
  const stored = await readStored(storage);
  if (stored.some((candidate) => candidate.id === ref.id)) {
    throw new Error(`${ref.name} is already in the list`);
  }
  await writeStored(storage, [...stored, ref]);
}

/**
 * Drop one source, or throw.
 *
 * Built-ins are refused here as well as at the API, since this is the function
 * that would otherwise be able to write a list that no longer holds one.
 */
async function removeStored(storage: ListStorage, id: string): Promise<void> {
  if (isBuiltinMarketplace(id)) {
    throw new Error(`${id} ships with the loader and cannot be removed`);
  }
  const stored = await readStored(storage);
  const kept = stored.filter((candidate) => candidate.id !== id);
  if (kept.length === stored.length) {
    throw new Error(`no such marketplace: ${id}`);
  }
  await writeStored(storage, kept);
}

/**
 * Point one source at another branch, tag, or commit, and answer what it became.
 *
 * The id is derived from owner and repo, so it does not move: everything already
 * installed from this source keeps its fqid, and therefore its settings, its
 * keybinds, and its data. Only where the next fetch reads from changes.
 */
async function repointStored(
  storage: ListStorage,
  id: string,
  ref: string,
): Promise<MarketplaceRef> {
  if (isBuiltinMarketplace(id)) {
    throw new Error(`${id} ships with the loader, so its ref comes from the loader build`);
  }
  const stored = await readStored(storage);
  const current = stored.find((candidate) => candidate.id === id);
  if (current === undefined) {
    throw new Error(`no such marketplace: ${id}`);
  }
  if (current.source.kind !== 'github') {
    throw new Error(`${id} is not a repository, so it has no ref`);
  }

  const rebuilt = githubMarketplace(current.source.owner, current.source.repo, ref.trim());
  if (!rebuilt.ok) {
    throw new Error(rebuilt.error);
  }
  const moved = stored.map((candidate) => {
    if (candidate.id === id) {
      return rebuilt.ref;
    }
    return candidate;
  });
  await writeStored(storage, moved);
  return rebuilt.ref;
}

export type { ListStorage };
export {
  addStored,
  MARKETS_KEY,
  NS as MARKET_NS,
  readAll,
  readStored,
  removeStored,
  repointStored,
  writeStored,
};
