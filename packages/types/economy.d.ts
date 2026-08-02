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
// There is no price history anywhere and there never was: the server keeps no
// record of a completed sale and offers no query for one. A price series is
// something your addon BUILDS, by recording each page its player browses.

import type { PublicItemInstance } from './entity.js';
import type { InvSlot } from './world.js';

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
  slots: readonly InvSlot[];
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
