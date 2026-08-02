// Turning every source's index into the one list Browse draws.
//
// Pure, and tested as such. What makes it worth its own module is that the
// interesting decisions are all about the merge rather than about rendering:
// two marketplaces may legitimately publish the same addon id, so the row's
// identity is the fqid and never the id, and an addon is "installed" against
// the source it came from rather than against its name.

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

/**
 * Every word has to appear somewhere, in any order.
 *
 * Rather than one substring match on the whole query, so "meter dps" finds the
 * DPS Meter. A player typing two words is naming two things they remember about
 * an addon, not quoting its title.
 */
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
 * Every tag any source in the list offers, sorted and without repeats.
 *
 * Built from what is actually on offer rather than from a fixed vocabulary, so
 * a third-party marketplace's own categories are filterable too. Sorted by code
 * unit so the control's order does not vary with the machine's locale.
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
 * Whether the screenshot column is worth drawing at all.
 *
 * Asked of every source rather than of the filtered rows, so that typing in the
 * search box cannot make the column appear and disappear under the player's
 * hands. Where nothing on offer has a screenshot the list is text and lines up
 * without a column; where anything does, every row reserves one so the rows
 * still line up, and the ones with nothing to show say so.
 */
function catalogHasPreviews(markets: readonly MarketplaceState[]): boolean {
  return markets.some((market) => market.addons.some((entry) => entry.preview !== undefined));
}

/**
 * An addon's screenshot as a page can load it.
 *
 * Resolved in the RUNTIME rather than carried over the bridge, which is the
 * opposite of what an update row does and is not an inconsistency: an update row
 * is computed in the host because comparing versions needs semver, and a
 * marketplace URL needs nothing the runtime may not import.
 */
interface AddonShot {
  url: string;
  alt: string;
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
 * Every offered addon's screenshot, by fqid.
 *
 * What the Installed pane draws from, because the registry cannot answer this on
 * its own: it persists the manifest but not the addon's directory in the
 * repository, and without that directory there is no URL to build. So an
 * installed addon whose source has been removed, or which its source no longer
 * offers, draws no thumbnail. That is the honest answer rather than a gap:
 * nothing the loader still holds says where that picture is.
 *
 * The declaration taken is the INDEX's rather than the installed manifest's, and
 * they can differ by a version. A marketplace serves one version per ref, so the
 * bytes at that URL are the index's either way, and taking the alt text from the
 * same place keeps the sentence matched to the picture it describes.
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
 * Every offered addon, in source order, filtered.
 *
 * Source order rather than sorted by name: the official marketplace is first in
 * the list because it is the trust anchor, and a browse list that mixed a third
 * party's rows in among it by alphabet would lose that.
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
 * Why Browse has nothing to draw, which is three different facts.
 *
 * `unread` stopped being the ordinary case when the catalog store started
 * seeding the indexes on its first read, so the note that says to press Refresh
 * has to stop being the ordinary answer with it: what is left when a seeded list
 * is still empty is usually a source that could not be READ, and telling a player
 * to refresh an index that just answered 404 sends them at the one control that
 * will not help. `unreadable` names it and points at the pane that says which
 * source and why.
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

/**
 * The update rows nothing is holding back.
 *
 * A pinned addon is left out of "update all" and out of the count beside the
 * tab. The pin is the player having already decided, and an action labelled
 * "all" that overrode it would make the pin advisory rather than a decision.
 */
function pendingUpdates(updates: readonly UpdateRow[]): UpdateRow[] {
  return updates.filter((row) => row.pin === null);
}

/**
 * Every bare addon id any source in the list offers.
 *
 * Bare rather than fully qualified, because it answers a question asked in bare
 * ids: a `companions` entry names the addon the author meant, whichever source a
 * player happens to have it from. See manager/companions.ts.
 */
function offeredIds(markets: readonly MarketplaceState[]): Set<string> {
  const ids = new Set<string>();
  for (const market of markets) {
    for (const entry of market.addons) {
      ids.add(entry.id);
    }
  }
  return ids;
}

export type { AddonShot, BrowseEmptiness, BrowseFilter, BrowseRow };
export {
  browseEmptiness,
  browseRows,
  catalogHasPreviews,
  catalogShots,
  catalogTags,
  NO_FILTER,
  offeredIds,
  pendingUpdates,
  shotOf,
};
