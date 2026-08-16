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
// The server keeps NO price history of the BOOK. Nothing says what an item has
// sold for in general, so a price series is still something an addon BUILDS by
// recording the pages its player browses.
//
// The one exception is the player's OWN sales: `collectionSales` is a real
// sold-price record, and it is the only one the game keeps. It is also transient
// (capped, and drained on collect), so an addon that wants a history of its own
// sales has to copy rows out before the player collects them.

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
   * Every ROW matching the filter, yours included, across all pages.
   *
   * Rows rather than listings, because `collapseLowest` narrows this too: it
   * collapses before the count is taken, so with it on this counts the distinct
   * items that matched and the listings standing behind them are not on the wire
   * at all.
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
   * The ORDER the server applied, which is a different axis from the filters
   * above: it reorders the matched book and never narrows it.
   *
   * `'name'` is the classic default, name then price. `'price'` puts the whole
   * matched book cheapest first, which means page 0 is the cheap tail rather
   * than an alphabetical slice, so anything inferring a market-wide figure from
   * the pages a player happened to read is sampling one end of it.
   */
  sort: string;
  /**
   * The server COLLAPSED the matched book to one row per item id, cheapest first.
   *
   * It narrows the rows AND both counts: the collapse runs before the page is cut
   * and before the count is taken, so `totalCount` and `pageCount` are over the
   * collapsed rows. How many listings stand behind a floor is not on the wire
   * under this, so depth cannot be read off a page at all here.
   *
   * What the page becomes is stronger than what it loses. The filter is a
   * function of the item id alone, so every listing of one item matches or none
   * does, which makes a collapsed row that item's cheapest listing in the whole
   * book rather than on the page. An instanced listing is exempt, because no two
   * of them are the same goods.
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
  /**
   * The itemized ledger behind `collectionCopper`, oldest first. Capped at 50,
   * and DRAINED when the player collects, so it is a pickup queue rather than a
   * history.
   */
  collectionSales: readonly MarketSaleRecord[];
  /** How many older rows the cap dropped. Their copper is still in the total. */
  collectionSalesOmitted: number;
  /** The Merchant's cut on a sale, as a percentage. */
  cutPct: number;
  /** Per-seller active-listing cap. */
  maxListings: number;
  myListingCount: number;
  /**
   * The item the Sell tab's price reference was computed for, or null for none.
   *
   * Read it BEFORE `sellLowestPrice`: the pair is the answer to a question the
   * player asked by staging an item, and it arrives a round trip later, so a
   * snapshot taken across an item switch carries the previous item's price under
   * the new one's form. Comparing this against what is staged is what makes that
   * visible.
   */
  sellPriceItemId: string | null;
  /**
   * The cheapest active listing of `sellPriceItemId`, per unit, or null when that
   * item has none. Null with a null id means nothing was ever asked for.
   *
   * The only market-wide price the game will state, and it exists because the
   * player asked: it is filled by a request the Sell tab sends, which is a SEND
   * and therefore outside what an addon may do. So an addon reads it when the
   * player has staged an item and reads null the rest of the time, and it cannot
   * make the reading happen. `sellValue` is still the only reference always
   * there, and a price series is still something an addon builds from the pages
   * its player browses.
   *
   * It counts EVERY active listing, the Merchant's own stock and the player's own
   * rows included, because a buyer can take either instead. So it is what nothing
   * resells above, and it is NOT the cheapest rival. It is also the whole stack's
   * price divided by the stack and rounded UP, so it sits at or just above the
   * true per-unit price and never under it.
   */
  sellLowestPrice: number | null;
}

/**
 * The market page, or why there is not one.
 *
 * `'away'` is also what you see for one snapshot after a reconnect even while
 * standing at the Merchant: the client clears its own market mirror on reconnect
 * and refills it from the next snapshot, about fifty milliseconds later.
 */
type MarketState = ProximityState<MarketInfo>;

export type { MarketInfo, MarketListing, MarketSaleRecord, MarketState };
