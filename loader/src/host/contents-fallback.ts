// Reading a marketplace that has no marketplace.json, by enumerating it.
//
// A supported marketplace publishes an index and the loader reads it in one
// request. This is the fallback for a repository that has not wired the Action
// yet: list addons/ through the GitHub contents API, then fetch each addon.json
// individually. It costs 1 + N requests against an unauthenticated 60/hour
// limit, so it is a degraded mode with a warning in the manager rather than a
// second supported way to publish.
//
// It is reached ONLY on a 404 for the index. A 403 is the rate limit, and
// answering that by issuing N more requests would spend the rest of the hour
// discovering there is no quota left.

import { diagError } from '../shared/diag.ts';
import { contentsApiUrl, fileUrl, type MarketplaceRef } from '../shared/marketplace.ts';
import type { MarketplaceEntry } from '../shared/schema.ts';
import { validateManifest } from '../shared/schema.ts';
import { inSeries } from '../shared/sequence.ts';
import type { Fetcher } from './fetcher.ts';

/**
 * Past this the fallback is refused rather than truncated.
 *
 * One request per addon against 60 an hour means a repository this size cannot
 * be enumerated within quota even once, let alone refreshed. Reading the first
 * forty and presenting them as the source's contents would be a silent lie about
 * what the marketplace offers; saying it is too large to read this way is the
 * truth, and publishing an index is the fix.
 */
const MAX_ENUMERATED = 40;

/** The addon directory inside a marketplace repository. */
const ADDONS_DIR = 'addons';

type ContentsFetcher = Pick<Fetcher, 'getJson'>;

/**
 * The subdirectory names in a contents-API listing.
 *
 * Read defensively rather than through a schema: this is one field of a
 * third-party API shape the loader does not otherwise model, and every row that
 * does not look like a directory is simply not one.
 */
function isDirectoryRow(row: unknown): row is { name: string } {
  if (row === null || typeof row !== 'object') {
    return false;
  }
  const { name, type } = row as { name?: unknown; type?: unknown };
  return type === 'dir' && typeof name === 'string' && name.length > 0;
}

function directoryNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isDirectoryRow).map((row) => row.name);
}

/** By code unit, so the order does not vary with the machine's locale. */
function byName(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left < right) {
    return -1;
  }
  return 1;
}

/**
 * One directory's manifest as an index row, or null if it is not an addon.
 *
 * The id has to match the directory for the same reason CI enforces it: the
 * directory is what the index publishes as `path`, and the id is what the fqid
 * is built from, so a mismatch would install an addon whose storage namespace
 * names a directory that does not hold it.
 */
async function readOne(
  fetcher: ContentsFetcher,
  market: MarketplaceRef,
  dir: string,
): Promise<MarketplaceEntry | null> {
  const path = `${ADDONS_DIR}/${dir}`;
  try {
    const { value } = await fetcher.getJson(fileUrl(market, `${path}/addon.json`));
    const parsed = validateManifest(value);
    if (!parsed.ok) {
      diagError(`skipping ${market.id}/${dir}: its addon.json is not valid`, parsed.issues);
      return null;
    }
    if (parsed.value.id !== dir) {
      diagError(`skipping ${market.id}/${dir}: its id is "${parsed.value.id}"`, null);
      return null;
    }
    return { ...parsed.value, path };
  } catch (err) {
    diagError(`skipping ${market.id}/${dir}: its addon.json could not be read`, err);
    return null;
  }
}

/**
 * Enumerate a repository's addons, or throw with what stopped it.
 *
 * A directory that does not hold a readable addon is skipped rather than
 * failing the whole source: one broken addon in a third-party repository should
 * not hide the rest of it. What fails the source is not being able to list the
 * directory at all, and being too large to list within quota.
 */
async function enumerateAddons(
  fetcher: ContentsFetcher,
  market: MarketplaceRef,
): Promise<MarketplaceEntry[]> {
  const url = contentsApiUrl(market);
  if (url === null) {
    throw new Error(`${market.id} has no repository to enumerate`);
  }

  const { value } = await fetcher.getJson(url);
  const dirs = directoryNames(value);
  if (dirs.length === 0) {
    throw new Error(`${market.name} publishes no marketplace.json and has no addons/ directory`);
  }
  if (dirs.length > MAX_ENUMERATED) {
    throw new Error(
      `${market.name} has ${dirs.length} addon directories and no marketplace.json, ` +
        `which is more than the ${MAX_ENUMERATED} that can be read one at a time. ` +
        'It has to publish an index.',
    );
  }

  // One at a time rather than concurrently: this path exists because the source
  // is already costing a request per addon against a shared rate limit, and a
  // burst is what that limit answers worst.
  // Sorted so the pane's order does not depend on what the API happened to
  // return, the same way the generated index is sorted by directory.
  const addons: MarketplaceEntry[] = [];
  await inSeries(dirs.sort(byName), async (dir) => {
    const row = await readOne(fetcher, market, dir);
    if (row !== null) {
      addons.push(row);
    }
  });
  return addons;
}

export type { ContentsFetcher };
export { ADDONS_DIR, enumerateAddons, MAX_ENUMERATED };
