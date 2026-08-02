// Sibling data files: fetched where the body is fetched, cached beside it.
//
// The feature is that an addon can ship a table without embedding it in its
// source. The host does the fetching for three reasons the page realm cannot
// match: it already holds the marketplace ref, its fetcher already has an ETag
// cache, and it already pulls the entry body down this exact path. Handing an
// addon its own base URL instead was weighed and refused: no cache, a second
// network path in the page realm, and a URL an addon can point anywhere.
//
// Fetched at INSTALL and at UPDATE, never lazily on first read, because that is
// what the entry body does and for the same reasons: enabling an addon must not
// be a network call, and a marketplace that goes offline must not take the
// addons installed from it with it. A lazy read would answer from the ETag cache
// while online and reject outright offline, which is the failure that shows up
// on a plane rather than in testing.
//
// A HOST module. It names the fetcher and GM storage, and loader/build-runtime.mjs
// fails the build if anything under host/ reaches the page realm.

import { DATA_MAX_BYTES } from '../shared/addon-data.ts';
import { fileUrl, type MarketplaceRef } from '../shared/marketplace.ts';
import type { StorageApi } from '../shared/protocol.ts';
// Type-only, and load-bearing: a value import of anything in schema.ts drags zod
// into whatever bundle asks for it.
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
 * One file, fetched and checked.
 *
 * Parsed on the way through and the result thrown away: what is stored is the
 * TEXT, because the host has no use for the shape and a string is the cheapest
 * thing to hand across the bridge. The parse is the CHECK. A data file that is
 * not JSON fails the install, with the URL in the message, rather than the
 * addon's first read of it, which would be an addon that starts and does nothing.
 *
 * The size ceiling is applied HERE as well as in `pnpm validate`, because CI only
 * ever sees this repository's addons and a marketplace is not this repository.
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
  // Sequential for the reason every other multi-request read here is: a
  // rate-limited GitHub answers a queue better than it answers a burst.
  await inSeries(declared ?? [], async (file) => {
    files[file] = await fetchOne(fetcher, source, file);
  });
  return files;
}

/** Replace what one addon has cached, or drop the record when it declares none. */
async function writeAddonData(storage: DataStorage, fqid: string, files: AddonData): Promise<void> {
  if (Object.keys(files).length === 0) {
    // An update that removed the last data file has to take the record with it,
    // or woc.data would keep answering from a version nobody is running.
    await storage.delete(REGISTRY_NS, dataKey(fqid));
    return;
  }
  await storage.set(REGISTRY_NS, dataKey(fqid), files);
}

/**
 * The cached record, or an empty one.
 *
 * Untrusted like everything else out of GM storage, so a record that is not an
 * object reads as no files rather than as a shape the caller then indexes into.
 */
async function readAddonData(storage: Pick<DataStorage, 'get'>, fqid: string): Promise<AddonData> {
  const raw = await storage.get(REGISTRY_NS, dataKey(fqid));
  if (raw === null || typeof raw !== 'object') {
    return {};
  }
  return raw as AddonData;
}

export type { AddonData, DataSource, DataStorage };
export { fetchAddonData, fetchOne, readAddonData, writeAddonData };
