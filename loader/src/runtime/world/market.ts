// The World Market, as one browsed page, proximity-gated (see `proximity.ts`).
//
// Passed through rather than projected: a page is up to 120 rows sampled many times a second,
// so the arrays are the game's own and `readonly` is a type-level guard, not a boundary.
//
// The server keeps no price history of the book. The only sold-price record is the player's own
// `collectionSales`, which is capped and drained on collect.

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
  /** The recipe that crafted the stack, on a crafted listing only. A row field, not trimmed. */
  craftedRecipeId?: string;
}

/** One completed sale of yours, waiting to be collected. */
interface MarketSaleRecord {
  itemId: string;
  count: number;
  /** GROSS buyout the buyer paid for the whole stack, before the cut. */
  price: number;
  /** NET copper this sale added to the collection, after the cut. */
  proceeds: number;
  buyerName: string;
}

interface MarketInfo {
  /** Your own listings first, then one page of everyone else's. */
  listings: readonly MarketListing[];
  /**
   * Every ROW matching the filter, yours included, across all pages. Under `collapseLowest` that
   * is distinct items, not listings.
   */
  totalCount: number;
  /** The search string the server actually applied. */
  filter: string;
  /** The filter axes the server actually applied. */
  itemType: string;
  subtype: string;
  armorClass: string;
  primaryStat: string;
  rarity: string;
  /**
   * The ORDER the server applied; it reorders the matched book and never narrows it. `'name'` is
   * name then price; `'price'` is cheapest first, so its early pages sample only the cheap tail.
   */
  sort: string;
  /**
   * The server COLLAPSED the matched book to one row per item id, cheapest first. Both counts are
   * over the collapsed rows, so listing depth is not readable.
   *
   * Each collapsed row is that item's cheapest listing in the whole book, since the filter
   * depends on the item id alone. Instanced listings are never collapsed.
   */
  collapseLowest: boolean;
  /** Clamped by the server against the live match count, so this is the page you got. */
  page: number;
  /** Over the collapsed rows where `collapseLowest` is set. See it. */
  pageCount: number;
  /** Sale proceeds waiting at the Merchant. */
  collectionCopper: number;
  /** Returned or expired goods waiting at the Merchant. */
  collectionItems: readonly InvSlot[];
  /** The itemized ledger behind `collectionCopper`, oldest first. Capped; drained on collect. */
  collectionSales: readonly MarketSaleRecord[];
  /** How many older rows the cap dropped. Their copper is still in the total. */
  collectionSalesOmitted: number;
  /** The Merchant's cut on a sale, as a percentage. */
  cutPct: number;
  /** Per-seller active-listing cap. */
  maxListings: number;
  myListingCount: number;
  /**
   * The item the Sell tab's price reference was computed for, or null for none. Check it against
   * what is staged before reading `sellLowestPrice`: the pair lags an item switch by a round trip.
   */
  sellPriceItemId: string | null;
  /**
   * The cheapest active listing of `sellPriceItemId`, per unit, or null when that
   * item has none. Null with a null id means nothing was ever asked for.
   *
   * Filled only while the player has an item staged on the Sell tab; an addon cannot request it.
   *
   * It counts EVERY active listing, the Merchant's and the player's own included, so it is not
   * the cheapest rival. It is the stack price over the count rounded UP, never under the true
   * unit price.
   */
  sellLowestPrice: number | null;
}

/**
 * The market page, or why there is not one. It reads `'away'` for one snapshot after a
 * reconnect even at the Merchant.
 */
type MarketState = ProximityState<MarketInfo>;

export type { MarketInfo, MarketListing, MarketSaleRecord, MarketState };
