// Sibling data files: fetched where the body is fetched, cached beside it.
//
// Fetched in the host, not by handing an addon its base URL: that would be a second network
// path in the page realm, with no ETag cache and a URL an addon could point anywhere. Fetched
// at INSTALL and UPDATE, never lazily, so enabling is never a network call and an offline
// marketplace still serves what was installed.

import { DATA_MAX_BYTES } from '../shared/addon-data.ts';
import { fileUrl, type MarketplaceRef } from '../shared/marketplace.ts';
import type { StorageApi } from '../shared/protocol.ts';
// Type-only: a value import from schema.ts drags zod into whatever bundle asks.
import type { AddonManifest } from '../shared/schema.ts';
import { inSeries } from '../shared/sequence.ts';
import type { Fetcher } from './fetcher.ts';
import { dataKey, REGISTRY_NS } from './registry-keys.ts';

/** Raw file text, keyed by the path the manifest declared. */
type AddonData = Readonly<Record<string, string>>;

type DataStorage = Pick<StorageApi, 'get' | 'set' | 'delete'>;

/** Where one addon's files live in its marketplace. */
interface DataSource {
  market: MarketplaceRef;
  /** The addon's directory in the repository, from the index row. */
  path: string;
}

function dataUrl(source: DataSource, file: string): string {
  return fileUrl(source.market, `${source.path}/${file}`);
}

/**
 * One file, fetched and checked. The parse is only a check, so bad JSON fails the install
 * rather than the addon's first read; the TEXT is what is stored and crosses the bridge.
 *
 * The size ceiling is enforced here as well as in `pnpm validate`, because CI never sees a
 * third-party marketplace.
 */
async function fetchOne(
  fetcher: Pick<Fetcher, 'get'>,
  source: DataSource,
  file: string,
): Promise<string> {
  const url = dataUrl(source, file);
  const { body } = await fetcher.get(url);
  if (body.length > DATA_MAX_BYTES) {
    throw new Error(
      `${url} is ${body.length} bytes, over the ${DATA_MAX_BYTES} a data file may be`,
    );
  }
  try {
    JSON.parse(body);
  } catch (err) {
    throw new Error(`${url} is not JSON: ${String(err)}`, { cause: err });
  }
  return body;
}

/** Every file a manifest declares, or a rejection naming the one that failed. */
async function fetchAddonData(
  fetcher: Pick<Fetcher, 'get'>,
  source: DataSource,
  declared: AddonManifest['data'],
): Promise<AddonData> {
  const files: Record<string, string> = {};
  // In series: a rate-limited GitHub answers a queue better than a burst.
  await inSeries(declared ?? [], async (file) => {
    files[file] = await fetchOne(fetcher, source, file);
  });
  return files;
}

/** Replace what one addon has cached, or drop the record when it declares none. */
async function writeAddonData(storage: DataStorage, fqid: string, files: AddonData): Promise<void> {
  if (Object.keys(files).length === 0) {
    // Otherwise woc.data would keep answering from the previous version's files.
    await storage.delete(REGISTRY_NS, dataKey(fqid));
    return;
  }
  await storage.set(REGISTRY_NS, dataKey(fqid), files);
}

/** The cached record, or an empty one when storage holds something that is not an object. */
async function readAddonData(storage: Pick<DataStorage, 'get'>, fqid: string): Promise<AddonData> {
  const raw = await storage.get(REGISTRY_NS, dataKey(fqid));
  if (raw === null || typeof raw !== 'object') {
    return {};
  }
  return raw as AddonData;
}

export type { AddonData, DataSource, DataStorage };
export { fetchAddonData, fetchOne, readAddonData, writeAddonData };
