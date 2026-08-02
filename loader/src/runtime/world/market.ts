// The World Market, as one browsed page.
//
// Proximity-gated (see `proximity.ts`), so the reading exists only while the
// player stands at the Merchant.
//
// PASSED THROUGH rather than projected, the way `party` is. A page is up to 120
// rows, read on every access and sampled up to forty times a second while a
// player browses; rebuilding 120 objects at that rate to rename nothing would be
// allocation for its own sake. The cost is that these arrays are the game's own,
// so `readonly` here is a type-level guard and not a boundary, exactly as it is
// for `cooldowns` in `backend.ts`.
//
// Nothing in a page counts down and no row can change: a listing is immutable
// once created and a buy takes the whole stack. That is what lets the signature
// in `signature-economy.ts` be an id list rather than a digest of every field.
//
// The server keeps NO price history and no sold-price record. This page is the
// only economic data the game will ever hand an addon, so a price series is
// something an addon BUILDS by recording the pages its player browses.

import type { InvSlot } from './game-types.ts';
import type { PublicItemInstance } from './items.ts';
import type { ProximityState } from './proximity.ts';

interface MarketListing {
  /** Stable for the whole life of the listing: a row is never edited. */
  id: number;
  sellerName: string;
  itemId: string;
  count: number;
  /** TOTAL copper buyout for the whole stack, not a unit price. */
  price: number;
  /** You are the seller, so the game offers Cancel rather than Buy. */
  mine: boolean;
  /** The Merchant's own standing stock rather than a player's listing. */
  house: boolean;
  /** Present only on an instanced listing, trimmed to the public fields. */
  instance?: PublicItemInstance;
}

interface MarketInfo {
  /** Your own listings first, then one page of everyone else's. */
  listings: readonly MarketListing[];
  /** Every listing matching the filter, yours included, across all pages. */
  totalCount: number;
  /** The search string the server actually applied. */
  filter: string;
  /** The filter axes the server actually applied. */
  itemType: string;
  subtype: string;
  armorClass: string;
  primaryStat: string;
  rarity: string;
  /** Clamped by the server against the live match count, so this is the page you got. */
  page: number;
  pageCount: number;
  /** Sale proceeds waiting at the Merchant. */
  collectionCopper: number;
  /** Returned or expired goods waiting at the Merchant. */
  collectionItems: readonly InvSlot[];
  /** The Merchant's cut on a sale, as a percentage. */
  cutPct: number;
  /** Per-seller active-listing cap. */
  maxListings: number;
  myListingCount: number;
}

/**
 * The market page, or why there is not one.
 *
 * `'away'` is also what you see for one snapshot after a reconnect even while
 * standing at the Merchant: the client clears its own market mirror on reconnect
 * and refills it from the next snapshot, about fifty milliseconds later.
 */
type MarketState = ProximityState<MarketInfo>;

export type { MarketInfo, MarketListing, MarketState };
