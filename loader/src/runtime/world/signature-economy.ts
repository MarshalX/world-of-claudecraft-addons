// What counts as a change on the counters, the badges and the buyback ring. Nothing in these
// payloads counts down, so there is no ticking field to leave out. The closed arms are constant
// work, so a page, mailbox or bank is walked only while the player stands at the counter.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { inventorySignature } from './signature-world.ts';

const ECONOMY_KEYS = [
  'market',
  'marketCollectPending',
  'mail',
  'mailUnread',
  'bank',
  'vault',
  'craftVaultStock',
  'buyback',
] as const;

type EconomyKey = (typeof ECONOMY_KEYS)[number];

const ECONOMY_SET: ReadonlySet<string> = new Set<string>(ECONOMY_KEYS);

/** Takes a plain string: naming `WorldKey` would be an import cycle with `signature.ts`. */
function isEconomyKey(key: string): key is EconomyKey {
  return ECONOMY_SET.has(key);
}

/**
 * The status alone, or null when the reading is `near` and has to be walked. Reads nothing but
 * `status`, which keeps a closed arm constant work.
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
 * `sort` and `collapseLowest` are in although they narrow nothing: a re-sort or a collapse can
 * return an identical listing array (one row, or one listing per item) under a different
 * meaning, and the flag is then the only thing that differs.
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
    collapseMark(info),
  ].join(':');
}

/** The collapse flag as a digit. A named helper because `noTernary` is on. */
function collapseMark(info: unknown): string {
  if (fieldValue(info, 'collapseLowest') === true) {
    return '1';
  }
  return '0';
}

/**
 * The Sell tab's price reference, id and price together: either can move without the other,
 * and neither touches the browsed page.
 */
function sellReferenceOf(info: unknown): string {
  // biome-ignore lint/security/noSecrets: a field name copied from the game, which the entropy heuristic cannot tell from a token
  const itemId = fieldString(info, 'sellPriceItemId') ?? '';
  const price = fieldNumber(info, 'sellLowestPrice');
  return `${itemId}@${String(price ?? -1)}`;
}

/** A letter's read flag as a digit. A named helper because `noTernary` is on. */
function readMark(message: unknown): string {
  if (fieldValue(message, 'read') === true) {
    return '1';
  }
  return '0';
}

/**
 * The page, by listing id. A listing is immutable once created and ids come from a monotonic
 * counter, so price, count and seller cannot move under a live id.
 *
 * The query echo is in because a fresh join resets the server's query while the window's
 * controls survive.
 *
 * `collectionSales` is covered only by coincidence: a sale retires its listing, so the id list
 * changes on the same snapshot, and a collect zeroes `collectionCopper`. A sale that retires no
 * listing, or a partial collect that leaves the copper, would go unseen; sign
 * `collectionSales` and `collectionSalesOmitted` here if either becomes possible.
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
  return `near|${paging}|${queryOf(info)}|${sellReferenceOf(info)}|${collection}|${ids}`;
}

/**
 * Which letters are in the box and what is still in each. Subjects and bodies are out (free
 * text an id already covers); `read`, `copper` and the attachment count are in, because reading
 * a letter or taking a parcel mutates it in place under the same id.
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

/** An empty socket, as a mark that cannot collide with a bag id. */
function bagMark(bag: unknown): string {
  if (typeof bag === 'string') {
    return bag;
  }
  return '-';
}

/**
 * How many bag sockets are open and what is in each, in socket order. Neither
 * moves `capacity`: an unlocked socket is empty, and a bag swapped for another
 * of the same size changes nothing but this list.
 */
function socketsOf(info: unknown): string {
  const bags = fieldArray(info, 'socketBags').map(bagMark).join(',');
  return `${fieldNumber(info, 'socketsUnlocked') ?? 0}:${bags}`;
}

/**
 * The two-pool split and what sits in each. `capacity` is their sum, so a
 * general bag swapped for a materials bag of equal size, or a stack recharged
 * against the other pool, moves nothing else in this signature.
 */
function poolsOf(info: unknown): string {
  return (
    `${fieldNumber(info, 'generalCapacity') ?? 0}/${fieldNumber(info, 'generalUsed') ?? 0}` +
    `|${fieldNumber(info, 'materialsCapacity') ?? 0}/${fieldNumber(info, 'materialsUsed') ?? 0}`
  );
}

/** The contents, both budgets, the sockets, and what the next rung costs. */
function bankSignature(state: unknown): string {
  const away = closed(state);
  if (away !== null) {
    return away;
  }
  const info = fieldValue(state, 'info');
  const budget =
    `${fieldNumber(info, 'capacity') ?? 0}|${fieldNumber(info, 'purchasedSlots') ?? 0}` +
    `|${fieldNumber(info, 'bonusSlots') ?? 0}|${fieldNumber(info, 'nextExpansionCost') ?? ''}` +
    `|${fieldNumber(info, 'nextSocketCost') ?? ''}` +
    `|${fieldNumber(info, 'nextRungClaudiumPrice') ?? ''}`;
  const bonus = fieldArray(info, 'bonusSources')
    .map((row) => `${fieldString(row, 'id') ?? ''}=${fieldNumber(row, 'slots') ?? 0}`)
    .join(',');
  return `near|${budget}|${socketsOf(info)}|${poolsOf(info)}|${bonus}|${slotsOf(info, 'slots')}`;
}

/** A material-to-count record, sorted by id. Shared by the vault and `craftVaultStock`. */
function stockSignature(stock: unknown): string {
  if (typeof stock !== 'object' || stock === null) {
    return '';
  }
  return Object.entries(stock as Record<string, unknown>)
    .map(([itemId, count]) => `${itemId}x${String(count)}`)
    .sort()
    .join(',');
}

/**
 * The vault, by what is in it and how much of it is bought. The stock is sorted by id because
 * the server's jsonb round-trip reorders it; `special` keeps array order, since rows are picked
 * by index.
 */
function vaultSignature(state: unknown): string {
  const away = closed(state);
  if (away !== null) {
    return away;
  }
  const info = fieldValue(state, 'info');
  const budget =
    `${fieldNumber(info, 'upgrades') ?? 0}|${fieldNumber(info, 'perMaterialCap') ?? 0}` +
    `|${fieldNumber(info, 'nextUpgradeCost') ?? ''}`;
  return `near|${budget}|${stockSignature(fieldValue(info, 'stock'))}|${slotsOf(info, 'special')}`;
}

/**
 * The drawable craft stock, a record or null rather than a gated state. Null
 * (the draw is refused here) needs its own mark, or a player walking into a
 * delve with an empty vault would sign the same as one who stayed outside.
 */
function craftStockSignature(stock: unknown): string {
  if (stock === null || stock === undefined) {
    return 'none';
  }
  return `here|${stockSignature(stock)}`;
}

/**
/** The four keys the player stands at, and the four they carry with them. */
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
  if (key === 'vault') {
    return vaultSignature(value);
  }
  if (key === 'craftVaultStock') {
    return craftStockSignature(value);
  }
  // The ring's ORDER is meaningful: a sale unshifts and a re-sale moves a stack
  // back to the front, so the array-ordered join is the reading, not a shortcut.
  if (key === 'buyback') {
    return inventorySignature(value);
  }
  return String(value);
}

export type { EconomyKey };
export {
  bankSignature,
  craftStockSignature,
  economyCapture,
  isEconomyKey,
  mailSignature,
  marketSignature,
  vaultSignature,
};
