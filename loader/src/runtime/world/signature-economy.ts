// What counts as a change on the three counters, the two badges and the ring.
//
// The measurement that shapes all three gated signatures: NOTHING in these
// payloads counts down. No wired market row carries an expiry, no mail message
// carries one, and the bank has no timer at all. So unlike `auras` and
// `cooldowns` there is no ticking field to leave out, and the only question is
// the size of the walk.
//
// The answer is the same for all three: the CLOSED arms are constant work. A
// gated key reads `away` for nearly all of a session, so the walk over a page, a
// mailbox or a bank runs only while the player is standing at the counter with
// something subscribed.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { inventorySignature } from './signature-world.ts';

const ECONOMY_KEYS = [
  'market',
  'marketCollectPending',
  'mail',
  'mailUnread',
  'bank',
  'buyback',
] as const;

type EconomyKey = (typeof ECONOMY_KEYS)[number];

const ECONOMY_SET: ReadonlySet<string> = new Set<string>(ECONOMY_KEYS);

/**
 * Takes a plain string rather than a `WorldKey`.
 *
 * `signature.ts` imports this module, so naming its key union here would be a
 * cycle for no gain: the narrowing a caller wants happens against whatever
 * union it already holds.
 */
function isEconomyKey(key: string): key is EconomyKey {
  return ECONOMY_SET.has(key);
}

/**
 * The status alone, or null when the reading is `near` and has to be walked.
 *
 * Reads `status` and nothing else, which is what keeps a closed arm constant
 * work: touching `info` first would walk a page the player is nowhere near.
 */
function closed(state: unknown): string | null {
  const status = fieldString(state, 'status');
  if (status === 'near') {
    return null;
  }
  return status ?? '';
}

/** The stacks in one of the game's own slot lists, in the order it holds them. */
function slotsOf(source: unknown, field: string): string {
  return inventorySignature(fieldValue(source, field));
}

/**
 * The query the server echoed back, which is what says a page changed meaning.
 *
 * `sort` rides here beside the five filter axes even though it narrows nothing,
 * because the id list cannot stand in for it: a book of one row, or a page whose
 * rows happen to come back in the same order, reorders into an identical listing
 * array under a different reading of the same book.
 */
function queryOf(info: unknown): string {
  return [
    fieldString(info, 'filter') ?? '',
    fieldString(info, 'itemType') ?? '',
    fieldString(info, 'subtype') ?? '',
    fieldString(info, 'armorClass') ?? '',
    fieldString(info, 'primaryStat') ?? '',
    fieldString(info, 'rarity') ?? '',
    fieldString(info, 'sort') ?? '',
  ].join(':');
}

/** A letter's read flag as a digit. A named helper because `noTernary` is on. */
function readMark(message: unknown): string {
  if (fieldValue(message, 'read') === true) {
    return '1';
  }
  return '0';
}

/**
 * The page, by listing id.
 *
 * Ids alone identify the rows, and that is proved rather than assumed: a listing
 * is immutable once created (the game offers list, buy, cancel and collect and no
 * edit, and a buy takes the whole stack) and ids come from a monotonic per-boot
 * counter. So price, count and seller cannot move under a live id, and a digest
 * of every field would be a walk over 120 rows to report what the ids already do.
 *
 * The query echo is in because a fresh join silently resets the server's own
 * query while the window's controls survive, and an addon watching the echo is
 * the only thing that can see that happen.
 *
 * `collectionSales` and `collectionSalesOmitted` are NOT read here, and an addon
 * still sees every sale. That works by COINCIDENCE rather than by design, and the
 * coincidence is worth stating because it is the kind that stops being true
 * quietly: a sale is also the moment its listing leaves the book, so the id list
 * above changes on the same snapshot that appends the row. The ledger is
 * therefore covered by the signature of something else.
 *
 * Two things would break it, and neither would raise. A HOUSE sale, or any future
 * sale that does not retire a listing, would append a row while the ids stand
 * still. And a collect DRAINS the array, which is only caught because
 * `collectionCopper` goes to 0 in the same breath; a partial collect that left the
 * copper alone would empty the rows unnoticed. Add both fields here rather than
 * widening the id list if either becomes possible. They are cheap to hash, and
 * the only reason they are absent is that the array is capped at 50 and the
 * counter beside it already summarises the overflow.
 */
function marketSignature(state: unknown): string {
  const away = closed(state);
  if (away !== null) {
    return away;
  }
  const info = fieldValue(state, 'info');
  const ids = fieldArray(info, 'listings')
    .map((row) => String(fieldNumber(row, 'id') ?? 0))
    .join(',');
  const paging =
    `${fieldNumber(info, 'page') ?? 0}/${fieldNumber(info, 'pageCount') ?? 0}` +
    `|${fieldNumber(info, 'totalCount') ?? 0}|${fieldNumber(info, 'myListingCount') ?? 0}`;
  const copper = fieldNumber(info, 'collectionCopper') ?? 0;
  const collection = `${copper}|${slotsOf(info, 'collectionItems')}`;
  return `near|${paging}|${queryOf(info)}|${collection}|${ids}`;
}

/**
 * Which letters are in the box and what is still in each.
 *
 * Subjects and bodies are deliberately out: a body is free text, so including it
 * would make the capture as large as everything a player has ever been sent, for
 * no change an id cannot already report. `read`, `copper` and the attachment
 * count ARE in, because marking a letter read and taking a parcel both mutate a
 * letter IN PLACE, so the same id is the same row with different contents and an
 * id list alone would report that nothing moved.
 */
function mailSignature(state: unknown): string {
  const away = closed(state);
  if (away !== null) {
    return away;
  }
  const info = fieldValue(state, 'info');
  const rows = fieldArray(info, 'messages')
    .map(
      (message) =>
        `${fieldNumber(message, 'id') ?? 0}:${readMark(message)}` +
        `:${fieldNumber(message, 'copper') ?? 0}:${fieldArray(message, 'items').length}`,
    )
    .join(',');
  const counts = `${fieldNumber(info, 'totalCount') ?? 0}|${fieldNumber(info, 'unread') ?? 0}`;
  return `near|${counts}|${rows}`;
}

/** The contents, the budget, and where the next expansion stands. */
function bankSignature(state: unknown): string {
  const away = closed(state);
  if (away !== null) {
    return away;
  }
  const info = fieldValue(state, 'info');
  const budget =
    `${fieldNumber(info, 'capacity') ?? 0}|${fieldNumber(info, 'purchasedSlots') ?? 0}` +
    `|${fieldNumber(info, 'bonusSlots') ?? 0}|${fieldNumber(info, 'nextExpansionCost') ?? ''}`;
  const bonus = fieldArray(info, 'bonusSources')
    .map((row) => `${fieldString(row, 'id') ?? ''}=${fieldNumber(row, 'slots') ?? 0}`)
    .join(',');
  return `near|${budget}|${bonus}|${slotsOf(info, 'slots')}`;
}

/**
 * The three keys the player stands at, and the three they carry with them.
 *
 * The gated three answer their STATUS when there is nothing to walk, so the walk
 * over a page, a mailbox or a bank happens only while the player is at the
 * counter.
 */
function economyCapture(key: EconomyKey, value: unknown): string {
  if (key === 'market') {
    return marketSignature(value);
  }
  if (key === 'mail') {
    return mailSignature(value);
  }
  if (key === 'bank') {
    return bankSignature(value);
  }
  // The ring's ORDER is meaningful: a sale unshifts and a re-sale moves a stack
  // back to the front, so the array-ordered join is the reading, not a shortcut.
  if (key === 'buyback') {
    return inventorySignature(value);
  }
  return String(value);
}

export type { EconomyKey };
export { bankSignature, economyCapture, isEconomyKey, mailSignature, marketSignature };
