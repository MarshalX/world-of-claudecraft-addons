// The source list: official (from the build), then the dev server while dev mode is on (never
// persisted), then user-added repositories, the only ones stored.
//
// Only owner, repo and ref are persisted, and every read re-validates them. The id is the
// storage namespace of every addon from that source, so it is re-derived rather than trusted,
// or a hand-edited GM value could claim another source's addon data.

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
 * The user-added sources, dropping any record that no longer validates: it could neither be
 * fetched nor repaired, so it would be a manager row with no working control.
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

/** Drop one source, or throw. Built-ins are refused here too, since this is the writer. */
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
 * Point one source at another branch, tag, or commit, and answer what it became. The id comes
 * from owner and repo, so installed addons keep their fqid, settings, keybinds and data.
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
