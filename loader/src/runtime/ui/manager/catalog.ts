// Turning every source's index into the one list Browse draws. Two marketplaces may publish the
// same addon id, so a row's identity is the fqid, and "installed" is judged per source.

import { fileUrl, type MarketplaceRef, fqid as makeFqid } from '../../../shared/marketplace.ts';
import type { MarketplaceEntry, MarketplaceState, UpdateRow } from '../../../shared/protocol.ts';

interface BrowseRow {
  /** The registry key, the install argument, and the list key. */
  fqid: string;
  /** The source this row came from, which the badge names. */
  market: MarketplaceRef;
  entry: MarketplaceEntry;
  installed: boolean;
}

interface BrowseFilter {
  /** Free text, matched against name, id, author, description, and tags. */
  query: string;
  /** One tag to keep, or null for every tag. */
  tag: string | null;
}

const NO_FILTER: BrowseFilter = { query: '', tag: null };

/** Any run of whitespace, so a query is split into the words a player typed. */
const WORDS_RE = /\s+/;

/** Everything about a row that free text is matched against, lowercased once. */
function haystack(entry: MarketplaceEntry): string {
  return [entry.name, entry.id, entry.author, entry.description, ...(entry.tags ?? [])]
    .join(' ')
    .toLowerCase();
}

/** Every word has to appear somewhere, in any order, so "meter dps" finds the DPS Meter. */
function matchesQuery(entry: MarketplaceEntry, query: string): boolean {
  const words = query.toLowerCase().split(WORDS_RE).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const text = haystack(entry);
  return words.every((word) => text.includes(word));
}

function matchesTag(entry: MarketplaceEntry, tag: string | null): boolean {
  if (tag === null) {
    return true;
  }
  return entry.tags?.includes(tag) === true;
}

/**
 * Every tag any source offers, deduplicated, so a third-party marketplace's own categories are
 * filterable too. Sorted by code unit so the order does not vary with the machine's locale.
 */
function catalogTags(markets: readonly MarketplaceState[]): string[] {
  const tags = new Set<string>();
  for (const market of markets) {
    for (const entry of market.addons) {
      for (const tag of entry.tags ?? []) {
        tags.add(tag);
      }
    }
  }
  return [...tags].sort();
}

/**
 * Whether the screenshot column is drawn at all. Asked of every source rather than the filtered
 * rows, so typing in the search box cannot make the column appear and disappear.
 */
function catalogHasPreviews(markets: readonly MarketplaceState[]): boolean {
  return markets.some((market) => market.addons.some((entry) => entry.preview !== undefined));
}

/** An addon's screenshot as a page can load it, resolved in the runtime. */
interface AddonShot {
  url: string;
  alt: string;
}

/** One addon a source offers, reduced to what a companion note needs of it. */
interface OfferedAddon {
  name: string;
  fqid: string;
}

/** Null for the ordinary case of an addon nobody has taken a picture of. */
function shotFor(market: MarketplaceRef, entry: MarketplaceEntry): AddonShot | null {
  const { preview } = entry;
  if (preview === undefined) {
    return null;
  }
  return { url: fileUrl(market, `${entry.path}/${preview.file}`), alt: preview.alt };
}

/** The screenshot a browse row declares, resolved against the source it came from. */
function shotOf(row: BrowseRow): AddonShot | null {
  return shotFor(row.market, row.entry);
}

/**
 * Every offered addon's screenshot, by fqid, for the Installed pane. The registry does not persist
 * the addon's directory, so an addon its source no longer offers draws no thumbnail.
 *
 * The INDEX's declaration is taken over the installed manifest's: the bytes at that URL are the
 * index's version, and the alt text has to describe the same picture.
 */
function catalogShots(markets: readonly MarketplaceState[]): Map<string, AddonShot> {
  const shots = new Map<string, AddonShot>();
  for (const market of markets) {
    for (const entry of market.addons) {
      const shot = shotFor(market.ref, entry);
      if (shot !== null) {
        shots.set(makeFqid(market.ref.id, entry.id), shot);
      }
    }
  }
  return shots;
}

/**
 * Every offered addon, filtered, in source order: the official marketplace comes first as the trust
 * anchor, and sorting by name would mix third-party rows in among it.
 */
function browseRows(
  markets: readonly MarketplaceState[],
  installed: ReadonlyMap<string, boolean>,
  filter: BrowseFilter = NO_FILTER,
): BrowseRow[] {
  const rows: BrowseRow[] = [];
  for (const market of markets) {
    for (const entry of market.addons) {
      if (matchesQuery(entry, filter.query) && matchesTag(entry, filter.tag)) {
        const fqid = makeFqid(market.ref.id, entry.id);
        rows.push({ fqid, market: market.ref, entry, installed: installed.has(fqid) });
      }
    }
  }
  return rows;
}

/**
 * Why Browse has nothing to draw. The store seeds the indexes on first read, so an empty list is
 * usually a source that could not be read, and `unreadable` points at the pane that says why rather
 * than at Refresh.
 */
type BrowseEmptiness = 'unread' | 'unreadable' | 'empty';

function browseEmptiness(markets: readonly MarketplaceState[]): BrowseEmptiness {
  if (markets.every((market) => market.fetchedAt === null && market.error === null)) {
    return 'unread';
  }
  if (markets.some((market) => market.error !== null)) {
    return 'unreadable';
  }
  return 'empty';
}

/** The update rows no pin holds back; "update all" and the tab count both skip a pinned addon. */
function pendingUpdates(updates: readonly UpdateRow[]): UpdateRow[] {
  return updates.filter((row) => row.pin === null);
}

/**
 * Every offered addon by BARE id, because a `companions` entry names an addon whichever source it
 * comes from. The first source wins a duplicate id, so a note points at the row Browse shows first.
 */
function offeredAddons(markets: readonly MarketplaceState[]): Map<string, OfferedAddon> {
  const offered = new Map<string, OfferedAddon>();
  for (const market of markets) {
    for (const entry of market.addons) {
      if (!offered.has(entry.id)) {
        offered.set(entry.id, { name: entry.name, fqid: makeFqid(market.ref.id, entry.id) });
      }
    }
  }
  return offered;
}

export type { AddonShot, BrowseEmptiness, BrowseFilter, BrowseRow, OfferedAddon };
export {
  browseEmptiness,
  browseRows,
  catalogHasPreviews,
  catalogShots,
  catalogTags,
  NO_FILTER,
  offeredAddons,
  pendingUpdates,
  shotOf,
};
