// The counters you walk up to: the Merchant's market and the Ravenpost mailbox,
// plus the two badges that stay live when you walk away from them.
//
// The bank and the Materials Vault are the same shape of read and live in
// `economy-storage.d.ts`.
//
// Both reads here only exist while you are STANDING at the counter. The
// server sends them on proximity alone and sends nothing at all when you are
// more than a few paces away, so they are published as a status rather than as a
// value that might be null:
//
//   const market = woc.world.market;
//   if (market.status !== 'near') return;   // 'away', or 'unknown' before entry
//   for (const row of market.info.listings) { ... }
//
// That shape exists because the obvious alternative is a bug. On a nullable
// value the reading everyone writes is `world.market?.listings ?? []`, which
// answers the empty array BOTH when the filter matched nothing and when you are
// nowhere near a Merchant. Those are opposite facts and an addon that confuses
// them reports an empty market to a player standing in a town.
//
// The two BADGE reads are deliberately not inside them. `world.mailUnread` and
// `world.marketCollectPending` stream everywhere, because a badge exists for the
// moment you are NOT at the counter. Read those for an indicator; read the gated
// ones for a pane.
//
// There is no price history OF THE BOOK and there never was: nothing says what
// an item generally sells for, and there is no query for it. A price series is
// something your addon BUILDS, by recording each page its player browses.
//
// Your own completed sales are the one exception, in `MarketInfo.collectionSales`
// below. They are a real sold-price record and they are the only one the game
// keeps, but they are a pickup queue rather than an archive: capped, and emptied
// the moment the player collects. Copy them out if you want to keep them.

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
 * Never null, unlike most world reads: `unknown` already means "the loader has
 * no world yet", so a null beside it would be a second encoding of one fact.
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
}

/**
 * One of your own completed sales, still waiting to be collected.
 *
 * `price` is what the buyer paid and `proceeds` is what you actually get, so the
 * two differ by the Merchant's cut and summing the wrong one overstates your
 * income by `cutPct`.
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
   * Rows rather than listings, because `collapseLowest` narrows this as well as
   * the page: with it on the collapse happens before the count, so this is how
   * many distinct items matched, and how many listings stand behind each of them
   * is not on the wire at all.
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
   * matched book cheapest first, so page 0 is the cheap tail rather than an
   * alphabetical slice. That matters to anything building a price series out of
   * the pages a player happened to read: under `'price'` a partial read samples
   * one end of the book, so record which order produced a reading rather than
   * folding the two together.
   */
  sort: string;
  /**
   * The server COLLAPSED the matched book to one row per item id, cheapest first.
   *
   * It narrows the ROWS and both COUNTS, which is what makes it more than a
   * display option. The collapse runs before the page is cut and before the count
   * is taken, so `totalCount` and `pageCount` are both over collapsed rows: with
   * this on, nothing on the wire says how many listings stand behind a floor, and
   * a page cannot be read for depth at all.
   *
   * What it gives back is the strongest single reading Browse offers. The filter
   * is a function of the item id alone, so all of an item's listings match or
   * none do, which makes a collapsed row that item's cheapest listing in the
   * WHOLE BOOK rather than merely on this page. Your own listings collapse with
   * everyone else's, so one of yours on the page is one nobody has undercut, and
   * one that is missing has been undercut by the row standing in its place.
   * Instanced listings stay distinct, since no two of them are the same goods.
   *
   * Added in game 0.38.0, and in API minor 7.
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
   * Their gold IS in `collectionCopper`, so the rows and the total will not
   * reconcile whenever this is above 0. Say how many are missing rather than
   * showing a short list that does not add up.
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
   * Read this BEFORE `sellLowestPrice`. The pair answers a question the player
   * asked by staging an item and the answer arrives a round trip later, so a
   * snapshot taken across an item switch carries the previous item's price under
   * the new item's form. Comparing this id against what the player has staged is
   * the only thing that makes that visible.
   *
   * Added in game 0.38.0, and in API minor 7.
   */
  sellPriceItemId: string | null;
  /**
   * The cheapest active listing of `sellPriceItemId`, per unit, or null when that
   * item has none listed. Null under a null id means nothing was ever asked for.
   *
   * The only market-wide price the game will ever state, and you cannot ask for
   * it: it is filled by a request the Sell tab sends, and sending is outside what
   * an addon may do. So this is real while the player has an item staged on the
   * Sell tab and null the rest of the time, which is most of the time. `sellValue`
   * on an item is still the only reference always available, and a price series
   * is still something an addon builds by recording the pages its player browses.
   *
   * It counts EVERY active listing of that item, including the Merchant's own
   * stock and the player's own rows, because a buyer can take either instead of
   * the one being staged. So it is the price nothing resells above, and it is not
   * the cheapest RIVAL: an unguarded undercut of it can be a player undercutting
   * themselves. It is also a stack's price divided by the stack and rounded UP,
   * so it sits at or just above the true per-unit figure and never below it.
   *
   * Added in game 0.38.0, and in API minor 7.
   */
  sellLowestPrice: number | null;
}

/**
 * The market page, or why there is not one.
 *
 * `'unknown'` is what you see before the game is readable. `'away'` is what you
 * see when you are not at the Merchant, and it is ALSO what you see for one
 * snapshot after a reconnect even while standing there: the client clears its
 * own market mirror on reconnect and refills it from the next snapshot, about
 * fifty milliseconds later. Watch `net.state().reconnects` if a single frame of
 * `'away'` would make your display do something a player would notice.
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
   * An instance here is the DISPLAY trim, your own letters included: the full
   * payload only arrives when the letter is taken, which no addon can do.
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
