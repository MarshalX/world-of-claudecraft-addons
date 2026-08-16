// The counters you walk up to: the Merchant's market, the Ravenpost mailbox and
// the bank, plus the two badges that stay live when you walk away from them.
//
// Three of these reads only exist while you are STANDING at the counter. The
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
import type { HeldSlot, InvSlot } from './world-items.js';

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
   * A narrowing of the ROWS and not of the match, so it changes what a page means
   * without changing what `totalCount` counts: with this on, the page is one
   * price floor per item and the count above it is how many listings stand behind
   * those floors. Anything reading depth out of a page has to read this first, or
   * it reports a market of one seller per item. Instanced listings stay distinct,
   * since no two of them are the same goods.
   *
   * Added in game 0.38.0.
   */
  collapseLowest: boolean;
  /** Clamped by the server against the live match count, so this is the page you got. */
  page: number;
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
   * Added in game 0.38.0.
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
   * Added in game 0.38.0.
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

/** One row of the bonus-slot breakdown. The id list is append-only content. */
export interface BankBonusSource {
  /** A source id such as 'email' or 'referral'. Content, so not a closed set. */
  id: string;
  /** Slots this source grants right now. 0 means it is advertised, not earned. */
  slots: number;
  maxSlots: number;
  /** Progress numerator, where the source has one. */
  count?: number;
  cap?: number;
}

/** The deposit box: one pooled list and the budget behind it. */
export interface BankInfo {
  /** The pooled contents. Order is the game's; there are no fixed cells. */
  slots: readonly HeldSlot[];
  /** Total budget: the base allowance plus purchased plus bonus. */
  capacity: number;
  /** Copper-bought slots. */
  purchasedSlots: number;
  /** Server-granted slots, recomputed at every login. */
  bonusSlots: number;
  /** Copper price of the next expansion, null once all of them are bought. */
  nextExpansionCost: number | null;
  /** The per-source breakdown behind `bonusSlots`. Always empty offline. */
  bonusSources: readonly BankBonusSource[];
}

/** The deposit box, or why there is not one. Read `status` first, like `MarketState`. */
export type BankState = ProximityState<BankInfo>;
