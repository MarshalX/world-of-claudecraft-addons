// Getting one addon's files out of its marketplace, and forgetting them again.
//
// The dev source is the one exception to reading from the cache (`refetchLocal` for the body,
// `refetchLocalData` for a table): reopening the game has to pick up what is on disk now.

import { diagError } from '../shared/diag.ts';
import { fileUrl, type MarketplaceRef } from '../shared/marketplace.ts';
import type { InstalledAddon, StorageApi } from '../shared/protocol.ts';
import {
  type AddonData,
  fetchAddonData,
  fetchOne,
  readAddonData,
  writeAddonData,
} from './addon-data.ts';
import type { Fetcher } from './fetcher.ts';
import type { MarketService } from './marketplace.ts';
import { REGISTRY_NS, sourceKey } from './registry-keys.ts';

/** Where one addon's entry file lives in its marketplace. */
function entryUrl(market: MarketplaceRef, path: string, entry: string): string {
  return fileUrl(market, `${path}/${entry}`);
}

type RegistryStorage = Pick<StorageApi, 'get' | 'set' | 'delete'>;

/** One addon's registry row, the body that goes with it, and its data files. */
interface Acquired {
  row: InstalledAddon;
  source: string;
  data: AddonData;
}

interface RegistryDeps {
  storage: RegistryStorage;
  /** `entry` locates an addon's files; `api.list` answers from the last-read indexes. */
  market: Pick<MarketService, 'entry' | 'api'>;
  fetcher: Pick<Fetcher, 'get' | 'forget'>;
  /** Called after a write that changed something, so the manager can refresh. */
  onChanged: () => void;
}

/** Fetch one addon's manifest, body and declared data files, or throw. */
async function acquire(deps: RegistryDeps, fqid: string): Promise<Acquired> {
  const found = await deps.market.entry(fqid);
  if (found === null) {
    throw new Error(`${fqid} is not offered by any marketplace in the list`);
  }
  const { market: source, row } = found;
  const url = entryUrl(source, row.path, row.entry);
  const { body } = await deps.fetcher.get(url);
  if (body.trim().length === 0) {
    throw new Error(`${url} is empty, so there is nothing to install`);
  }

  // `path` belongs to the index, not the manifest, and is re-read on update: a persisted
  // copy would go stale and send the next fetch to the wrong directory.
  const { path: _path, ...manifest } = row;
  const data = await fetchAddonData(
    deps.fetcher,
    { market: source, path: row.path },
    manifest.data,
  );
  return {
    row: { fqid, marketplace: source.id, manifest, enabled: true, pin: null },
    source: body,
    data,
  };
}

/** Every URL this addon's files came from: the entry, then each declared data file. */
async function urlsOf(deps: RegistryDeps, fqid: string): Promise<string[]> {
  const found = await deps.market.entry(fqid);
  if (found === null) {
    return [];
  }
  const { market, row } = found;
  return [
    entryUrl(market, row.path, row.entry),
    ...(row.data ?? []).map((file) => fileUrl(market, `${row.path}/${file}`)),
  ];
}

/** The URL an addon's body comes from, or null if no source offers it. */
async function originOf(deps: RegistryDeps, fqid: string): Promise<string | null> {
  return (await urlsOf(deps, fqid))[0] ?? null;
}

/**
 * Re-read a dev-server addon, falling back to the cached body. A stopped server must leave
 * the last body working, so a failure is a diagnostic and not a rejection.
 */
async function refetchLocal(deps: RegistryDeps, fqid: string): Promise<string | null> {
  try {
    const url = await originOf(deps, fqid);
    if (url === null) {
      return null;
    }
    const { body } = await deps.fetcher.get(url);
    await deps.storage.set(REGISTRY_NS, sourceKey(fqid), body);
    return body;
  } catch (err) {
    diagError(`could not re-read ${fqid} from the dev server, using the cached body`, err);
    return null;
  }
}

/**
 * Re-read one data file from the dev server, falling back to the cached copy.
 *
 * The declared list comes from the INDEX, which the dev server rebuilds from disk per
 * request, so a file added to the manifest since install is found.
 */
async function refetchLocalData(
  deps: RegistryDeps,
  fqid: string,
  name: string,
): Promise<string | null> {
  try {
    const found = await deps.market.entry(fqid);
    if (found === null || found.row.data?.includes(name) !== true) {
      return null;
    }
    const source = { market: found.market, path: found.row.path };
    const body = await fetchOne(deps.fetcher, source, name);
    await writeAddonData(deps.storage, fqid, {
      ...(await readAddonData(deps.storage, fqid)),
      [name]: body,
    });
    return body;
  } catch (err) {
    diagError(`could not re-read ${name} for ${fqid} from the dev server, using the cache`, err);
    return null;
  }
}

export type { Acquired, RegistryDeps, RegistryStorage };
export { acquire, refetchLocal, refetchLocalData, urlsOf };
