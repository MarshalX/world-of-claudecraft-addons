// Getting one addon's files out of its marketplace, and forgetting them again.
//
// Split out of registry.ts when data files landed, and the seam is a real one:
// registry.ts is the installed-set bookkeeping it started as, and this is
// everything that resolves an fqid to URLs and reads them. `RegistryDeps` lives
// here rather than there because every member of it exists for this half.
//
// The dev source is the deliberate exception to reading from the cache, and it
// is deliberate twice over: `refetchLocal` for the body and `refetchLocalData`
// for a declared table. Reopening the game has to pick up whatever is on disk
// now, which is the entire point of pointing the loader at a dev server, and it
// is bounded to `localhost` by shared/marketplace.ts.

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
  /**
   * `entry` says where an addon's files are; `api.list` is what update rows are
   * compared against, and it answers from the indexes as they were last read
   * rather than fetching.
   */
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

  // `path` is the index's own field and is not part of a manifest, so it is
  // dropped rather than persisted: it is re-read from the index on update, and a
  // stale copy of it would send the next fetch to the wrong directory.
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

/**
 * Every URL this addon's files came from: the entry, then each declared data file.
 *
 * One resolution rather than two, because both callers want the same index row
 * and `market.entry` may fetch an index to answer.
 */
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
 * Re-read a dev-server addon, falling back to the cached body.
 *
 * A server that is not running must leave the last body it served working rather
 * than disabling the addon, so a failure here is a diagnostic and not a
 * rejection.
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
 * The same deliberate exception `refetchLocal` is, for the same reason: a table
 * an author just regenerated has to be what the next load reads.
 *
 * The declared list is re-read from the INDEX rather than from the installed
 * record, because the dev server rebuilds its index from disk on every request
 * and a file added to the manifest since install is exactly the case worth
 * catching.
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
