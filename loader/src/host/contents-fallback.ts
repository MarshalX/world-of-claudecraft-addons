// Reading a marketplace that has no marketplace.json, by enumerating it.
//
// Lists addons/ through the GitHub contents API and fetches each addon.json: 1 + N requests
// against an unauthenticated 60/hour limit, so it is a degraded mode the manager warns about.
// Reached ONLY on a 404 for the index; a 403 is the rate limit and N more requests would
// only spend what is left of it.

import { diagError } from '../shared/diag.ts';
import { contentsApiUrl, fileUrl, type MarketplaceRef } from '../shared/marketplace.ts';
import type { MarketplaceEntry } from '../shared/schema.ts';
import { validateManifest } from '../shared/schema.ts';
import { inSeries } from '../shared/sequence.ts';
import type { Fetcher } from './fetcher.ts';

/**
 * Past this the fallback is refused, never truncated: the first forty presented as the whole
 * source would misstate what it offers, and it cannot be read within quota anyway.
 */
const MAX_ENUMERATED = 40;

/** The addon directory inside a marketplace repository. */
const ADDONS_DIR = 'addons';

type ContentsFetcher = Pick<Fetcher, 'getJson'>;

/** A contents-API row that is a directory. Any row that does not look like one is not one. */
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
 * One directory's manifest as an index row, or null if it is not an addon. The id must match
 * the directory, as CI enforces, since `path` comes from one and the fqid from the other.
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
 * Enumerate a repository's addons, or throw with what stopped it. An unreadable addon is
 * skipped so it does not hide the rest; only an unlistable or oversized source fails.
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

  // In series, since a burst is what the rate limit answers worst. Sorted like the generated
  // index, so the order does not depend on the API.
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
