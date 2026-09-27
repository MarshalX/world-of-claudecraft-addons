// The counters you walk up to: the Merchant's market and the Ravenpost mailbox,
// plus the two badges that stay live when you walk away from them.
//
// The bank and the Materials Vault are the same shape of read and live in
// `economy-storage.d.ts`.
//
// Both reads exist only while you are STANDING at the counter, so they are
// published as a status, never null:
//
//   const market = woc.world.market;
//   if (market.status !== 'near') return;   // 'away', or 'unknown' before entry
//   for (const row of market.info.listings) { ... }
//
// The status keeps "the filter matched nothing" apart from "you are nowhere near
// a Merchant", which `world.market?.listings ?? []` would conflate.
//
// The BADGE reads, `world.mailUnread` and `world.marketCollectPending`, stream
// everywhere: read those for an indicator and the gated ones for a pane.
//
// There is no price history of the book and no query for one. A price series is
// something your addon BUILDS by recording the pages its player browses. Your own
// completed sales, `MarketInfo.collectionSales`, are the one sold-price record,
// and they are capped and emptied on collect: copy them out to keep them.

import type { PublicItemInstance } from './entity.js';
import type { InvSlot } from './world-items.js';

/** The open arm: you are at the counter and the reading is real. */
export interface Near<T> {
  readonly status: 'near';
  readonly info: T;
}

/** Both closed arms. They carry no payload and differ only in why. */
export interface Absent {
  readonly status: 'away' | 'unknown';
  readonly info: null;
}

/**
 * Where a proximity-gated read stands.
 *
 * Never null: `unknown` means the loader has no world yet.
 */
export type ProximityState<T> = Near<T> | Absent;

/** One row of the Merchant's book. */
export interface MarketListing {
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
  /**
   * The id of the recipe that crafted the stack. Absent on anything not crafted,
   * and on every stack from a server older than game 0.43.0.
   *
   * A recipe id, not an item id, with no route to an icon or a display name. It
   * answers whether two same-item listings are the same GOODS. Unlike `instance`,
   * it is present on a stranger's row as on yours.
   *
   * Added in API minor 12.
   */
  craftedRecipeId?: string;
}

/**
 * One of your own completed sales, still waiting to be collected.
 *
 * `price` is what the buyer paid and `proceeds` is what you get after the
 * Merchant's cut. Sum `proceeds` for income.
 */
export interface MarketSaleRecord {
  itemId: string;
  count: number;
  /** GROSS buyout the buyer paid for the whole stack. */
  price: number;
  /** NET copper this added to `collectionCopper`, after the cut. */
  proceeds: number;
  buyerName: string;
}

/** One browsed page of the Merchant's book, plus what is waiting for you there. */
export interface MarketInfo {
  /** Your own listings first, then one page of everyone else's. */
  listings: readonly MarketListing[];
  /**
   * Every ROW matching the filter, yours included, across all pages.
   *
   * With `collapseLowest` on, this counts distinct items, and how many listings
   * stand behind each is not on the wire.
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
   * The ORDER the server applied. It reorders the matched book, never narrows it.
   *
   * `'name'` is the default, name then price. `'price'` puts the whole book
   * cheapest first, so a partial read samples the cheap end: a price series should
   * record which order produced each reading.
   */
  sort: string;
  /**
   * The server COLLAPSED the matched book to one row per item id, cheapest first.
   *
   * It narrows the ROWS and both COUNTS: `totalCount` and `pageCount` are over
   * collapsed rows, so nothing says how many listings stand behind a floor.
   *
   * A collapsed row is that item's cheapest listing in the WHOLE BOOK, not just on
   * this page. Your own listings collapse with everyone else's, so one of yours on
   * the page is not undercut, and one that is missing has been. Instanced listings
   * stay distinct.
   *
   * Added in API minor 7.
   */
  collapseLowest: boolean;
  /** Clamped by the server against the live match count, so this is the page you got. */
  page: number;
  /** Over the collapsed rows wherever `collapseLowest` is set. Read it first. */
  pageCount: number;
  /** Sale proceeds waiting at the Merchant. */
  collectionCopper: number;
  /** Returned or expired goods waiting at the Merchant. */
  collectionItems: readonly InvSlot[];
  /**
   * The itemized ledger behind `collectionCopper`: one row per sale of yours
   * still awaiting pickup, oldest first, and empty when nothing has sold since
   * the last collect.
   */
  collectionSales: readonly MarketSaleRecord[];
  /**
   * How many older sales the cap dropped from `collectionSales`.
   *
   * Their gold IS in `collectionCopper`, so the rows and the total do not
   * reconcile while this is above 0. Say how many are missing.
   */
  collectionSalesOmitted: number;
  /** The Merchant's cut on a sale, as a percentage. */
  cutPct: number;
  /** Per-seller active-listing cap. */
  maxListings: number;
  myListingCount: number;
  /**
   * The item the Sell tab's price reference below was computed for, or null.
   *
   * Read this BEFORE `sellLowestPrice`: the price arrives a round trip after the
   * player stages an item, so across an item switch it can still be the previous
   * item's. Compare this id against what is staged.
   *
   * Added in API minor 7.
   */
  sellPriceItemId: string | null;
  /**
   * The cheapest active listing of `sellPriceItemId`, per unit, or null when that
   * item has none listed. Null under a null id means nothing was ever asked for.
   *
   * Filled only while the player has an item staged on the Sell tab; an addon
   * cannot request it. `sellValue` on an item is the only reference always
   * available.
   *
   * It counts EVERY active listing, the Merchant's stock and the player's own
   * included, so it is not the cheapest RIVAL: undercutting it blindly can
   * undercut yourself. It is a stack price divided by the count and rounded UP,
   * so it is never below the true per-unit figure.
   *
   * Added in API minor 7.
   */
  sellLowestPrice: number | null;
}

/**
 * The market page, or why there is not one.
 *
 * `'unknown'` is before the game is readable. `'away'` is not at the Merchant,
 * and ALSO one snapshot (about 50 ms) after a reconnect while standing there.
 * Watch `net.state.reconnects` if a single frame of `'away'` would show.
 */
export type MarketState = ProximityState<MarketInfo>;

/** Where a letter came from. Authored letters localize through `letterId`. */
export type MailKind = 'player' | 'system' | 'npc';

/** One letter in the box. */
export interface MailMessage {
  id: number;
  senderName: string;
  kind: MailKind;
  /** Authored-letter id on system and NPC mail. Absent on player mail. */
  letterId?: string;
  subject: string;
  body: string;
  /** Coin still waiting in the letter. */
  copper: number;
  /**
   * Parcels still waiting in the letter.
   *
   * An instance here is the public trim, your own letters included.
   */
  items: readonly InvSlot[];
  read: boolean;
}

/** The mailbox as the pane sees it. */
export interface MailInfo {
  /** Newest first. Delivered letters only: one in flight is not in here. */
  messages: readonly MailMessage[];
  totalCount: number;
  /** Unread among the letters in this box. For a badge, use `world.mailUnread`. */
  unread: number;
  /** Copper cost of sending one letter. */
  postage: number;
  /** Item stacks one letter can carry. */
  maxAttachments: number;
  /** The raven's flight time for player mail, in seconds. */
  deliverySeconds: number;
}

/** The mailbox, or why there is not one. Read `status` first, like `MarketState`. */
export type MailState = ProximityState<MailInfo>;
