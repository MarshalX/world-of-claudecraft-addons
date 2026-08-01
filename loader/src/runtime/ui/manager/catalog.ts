// Turning every source's index into the one list Browse draws.
//
// Pure, and tested as such. What makes it worth its own module is that the
// interesting decisions are all about the merge rather than about rendering:
// two marketplaces may legitimately publish the same addon id, so the row's
// identity is the fqid and never the id, and an addon is "installed" against
// the source it came from rather than against its name.

import { type MarketplaceRef, fqid as makeFqid } from '../../../shared/marketplace.ts';
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
 * Every offered addon, in source order, filtered.
 *
 * Source order rather than sorted by name: the official marketplace is first in
 * the list because it is the trust anchor, and a browse list that mixed a third
 * party's rows in among it by alphabet would lose that.
 */
function browseRows(
  markets: readonly MarketplaceState[],
  installed: ReadonlySet<string>,
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

export type { BrowseEmptiness, BrowseFilter, BrowseRow };
export { browseEmptiness, browseRows, catalogTags, NO_FILTER, pendingUpdates };
