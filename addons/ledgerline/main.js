/// <reference types="@woc-addons/types" />

// Ledgerline: a price history for a market that keeps none. The server has no price table and
// no query for one, so the ledger is exactly as complete as the player's browsing. Read only:
// there is no send API.
//
// Only `near` is ever recorded. `away` (walked off) and `unknown` (nothing decoded) are not an
// empty market; recording either erases the ledger. One `away` after a reconnect is a resync
// blip, and `onAway` guards it.
//
// A visit is the unit: a reading is `[when, cheapest, dearest, query]` per item per trip, pages
// in one trip merge, and every figure is one vote per visit. A median over listings would be
// weighted by who happened to be selling.
//
// `price` is the total buyout for the stack. Every series divides by `count` first; the total is
// kept too, since the server sorts on it and the undercut check compares it.
//
// Browse has two orders. Name-sorted (the default), an item's listings are contiguous and
// ascending, so the first copy on a page is the cheapest competitor. Price-sorted, the whole book
// ascends by total and every page after 0 can hide a cheaper copy of anything. The undercut
// verdict and the recorded query both carry the order, so series never mix them.
//
// The player's completed sales are the only sold-price record, and it is a pickup queue:
// `collectionSales` is capped at fifty (overflow counted in `collectionSalesOmitted`) and emptied
// on collect. A row has no id and no clock, so its identity is its position, which `foldSales`
// relies on. Counting a row twice inflates the record; reading the drain as an empty market
// deletes it. Every stamp is when this addon drained the row, and says so.
//
// Paid and asked are separate series, never folded; they meet on one labelled tooltip line.
//
// A fresh join resets the server-side query while the window's controls survive, so every entry
// carries the query that produced it.
//
// No API names an item. A bus publisher outranks `ui.icon.itemArtName`, which names a picture.
// Subscribe to both `item` and `items`: an ask is answered with the batch.
//
// "First seen by you" is this addon's own record and never appears beside the word "expires",
// since no row carries an expiry. The cut and the cap are read off every page, never hard-coded.
//
// Export and import merge. A visit has two stamps: `at` slides forward as a trip is paged and
// `first` never moves. Identity is `(first, query)`, so re-importing adds nothing and import order
// does not matter; a matched visit is widened. New fields are appended to positional rows and
// defaulted by their readers, so no migration pass is needed.
//
// Sales cannot be deduped (no id, and a drain shares one stamp), so they are partitioned: each
// row records which install drained it, and an import keeps whichever side holds more of an
// origin's rows. Two devices that both drained the same pending ledger record that sale twice.
//
// The ledger is one key: a key per item costs `storage.keys()` a scan of the whole GM store plus
// a bridge round trip and a watcher each. Writes are held and coalesced.
//
// Prices are per account (a market is a realm). Sales and listing stamps are per character (the
// Merchant keeps a collection per seller). Every stamp is `woc.wallClock()`, never `woc.now()`: a
// monotonic reading read in a later session is a moment in the future.

/** The whole price history for one market, in ONE key. See `ledgerKey`. */
const LEDGER_PREFIX = 'ledger';
/** What a market with no realm behind it is filed under. See `ledgerKey`. */
const NO_REALM = 'offline';
/** Where the first-seen stamps for the player's OWN listings live. One small key. */
const MINE_KEY = 'mine-seen';
/** Where the sales drained off the Merchant's pending ledger live, and how far it was read. */
const SOLD_KEY = 'sold';

/** One record and the batch. `woc.bus.follow` derives and sends the `items:ask` for itself. */
const ITEM_TOPIC = 'item';
const ITEMS_TOPIC = 'items';

/**
 * What this addon publishes, in the same two shapes as `item` and `items`. A price must never be
 * a field on `item`: a subscriber keyed by id replaces the record wholesale, so a second publisher
 * would overwrite the catalogue's name and tier. A price is also a dated observation with a realm
 * and an evidence count, where a sell value is a constant.
 */
const PRICE_TOPIC = 'price';
const PRICES_TOPIC = 'prices';

/** The older ask topic, sent beside the one `follow` derives. Drop next release. */
const LEGACY_ASK_TOPIC = 'item:ask';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;

const PERCENT = 100;

/** How often the ages on screen are rewritten. Nothing here animates. */
const AGE_TICK_SECONDS = 30;
const AGE_TICK_MS = AGE_TICK_SECONDS * MS_PER_SECOND;

/** The size bound beside the setting's time bound, since the ledger is read and written whole. */
const MAX_ITEMS = 400;
const MAX_VISITS = 30;

/** One ceiling over the whole record, so a daily ore sale cannot evict a yearly sword sale. */
const MAX_SALES = 400;

/**
 * How long a trip counts as one reading, so paging does not multiply votes. A different query
 * starts a new visit whatever the clock says.
 */
const VISIT_MINUTES = 10;
const VISIT_WINDOW_MS = VISIT_MINUTES * MINUTE_MS;

/**
 * A ceiling on the write rate: every write serializes the whole ledger and broadcasts it to every
 * tab. Up to this much browsing is lost if the tab closes, which is why disposal writes too.
 */
const WRITE_HOLD_MS = 2 * MS_PER_SECOND;

/** How many item rows are drawn before the pane asks the player to narrow it. */
const MAX_ROWS = 40;

/** The vendor floor table this addon ships, declared on the manifest for `woc.data`. */
const FLOORS_FILE = 'floors.json';

/** Where this install's own id is kept, so an exported file can say which device wrote it. */
const INSTALL_KEY = 'install';

/** For stating a file ceiling in kilobytes. */
const BYTES_PER_KB = 1024;

/** `2026-08-10`, the leading date of an ISO stamp, for naming a file. */
const DATE_LENGTH = 10;

/** For a random id: digits and letters. */
const BASE_36 = 36;
const RANDOM_START = 2;
const RANDOM_END = 10;

/**
 * The exported file's shape number, refused when not understood. Unlike the store, which only
 * appends defaulted fields, a file may come from a newer build, and guessing its shape corrupts
 * the merge.
 */
const FILE_VERSION = 1;

/** What an exported file calls itself, so a player can tell two of them apart in a folder. */
const FILE_PREFIX = 'ledgerline';

/**
 * The largest file read at all. A full ledger is about a third of a megabyte; this rejects a
 * mistaken pick (a video) before `JSON.parse` locks the tab.
 */
const MAX_IMPORT_MB = 4;
const MAX_IMPORT_BYTES = MAX_IMPORT_MB * BYTES_PER_KB * BYTES_PER_KB;

/**
 * Every listing seen during one visit to the counter, which is what makes a scan span pages: the
 * wire holds only the current page. Capped on listings, oldest first, since the stalest row is
 * the one most likely gone.
 */
const MAX_SCAN = 1500;

/**
 * How many other listings (or prior visits) make a figure firm. Two is drawn and called thin; one
 * is not a comparison and fires nothing.
 */
const FIRM_RIVALS = 3;
const FIRM_VISITS = 3;
const THIN_EVIDENCE = 2;

/**
 * How close a stack's total must sit to a plausible unit price to be reported as a typo (a whole
 * stack posted at one item's price) rather than a bargain.
 */
const STACK_SLIP = 0.1;

/** What the kit's layout boxes are spaced at here: a pane's rows, and a stat's two words. */
const PANE_GAP = 4;
const STAT_GAP = 4;
/**
 * The status strip's gaps: tight vertically, wide horizontally, as one line of figures that wraps.
 */
const STRIP_GAP = 10;
const STRIP_WRAP_GAP = 2;

/** The frame, and the floor it may be dragged down to. */
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 480;
const MIN_WIDTH = 320;
/**
 * Everything but the scrolling list, worst case. Stated because the size floor is set before
 * layout.
 */
const CHROME_HEIGHT = 240;
const ROW_HEIGHT = 48;

/**
 * The filter axes the server echoes, in the game's own field names. `filter` is free text, empty
 * when unset. The other five are enums whose unset value is `all`, which must never be read as a
 * filter or the panel says "Searching all, all, all, all, all".
 */
const QUERY_FIELDS = ['filter', 'itemType', 'subtype', 'armorClass', 'primaryStat', 'rarity'];

/** The five enum axes' unset value (`defaultMarketQuery` in the game's sim). */
const NO_FILTER = 'all';

/** What a query with nothing set is called, so a series can say which it came from. */
const NO_QUERY = 'the whole book';

/** Browse's default order: display name, then price. */
const NAME_SORT = 'name';

/** What the second order is called on screen, since `price` alone does not say which end. */
const PRICE_SORT_LABEL = 'cheapest first';

/**
 * Browse's "lowest price only", on screen and in a stored query signature. It collapses the
 * matched book to one row per item before paging and counting, so its readings must never fold
 * into an ordinary page's.
 */
const COLLAPSE_LABEL = 'lowest price only';
const COLLAPSE_KEY = 'collapsed';

/**
 * The Sell tab's reading, filed under its own signature so it cannot fold into a browsed visit.
 * `SELL_KEY` is stored; `SELL_LABEL` is shown.
 */
const SELL_KEY = 'sell';
const SELL_LABEL = 'the Sell tab';

/**
 * What kind of reading a visit is, in a sixth positional slot written only when not the default,
 * so every browsed visit stays byte-identical. `VISIT_ASKS` is a page: cheapest and dearest over
 * other sellers. `VISIT_FLOOR` is the Sell tab's answer: the whole book's cheapest copy per unit,
 * house and own listings included. `recordedAnchor` reads only the first.
 */
const VISIT_ASKS = 0;
const VISIT_FLOOR = 1;

/** The Merchant's own floor is one copper, so nothing below it is a price. */
const MIN_ASK = 1;

/** A flag in a cell, so a handler and the paint path cannot hold different copies of it. */
function cell(value) {
  return { on: value };
}

/** Item id to what somebody published about it, plus who published it. */
const names = new Map();
/** Item id to its recorded series. See `emptySeries`. */
const series = new Map();
/**
 * Item id to `{ sellValue?, buyValue?, noVendorSell? }`, off the shipped table. See `readFloors`.
 */
const floors = new Map();
/** Which game the floor table was read from, because a price is a claim about a version. */
const floorsFrom = { version: '' };
/** Item id to the figure last put on the bus for it, so a re-read page publishes nothing. */
const onBus = new Map();
/**
 * This install's id, so a sale record says which device drained it. Account-wide: it identifies
 * the store. Managers that sync values share the id, which is correct since they share the store.
 */
const install = { id: '' };
/**
 * Listing id to what was seen of it this visit. Memory only: the book moves, and a persisted
 * scan would be shown as current long after it stopped being true.
 */
const scan = new Map();
/** The last Sell tab answer folded, so a snapshot repeating it is not a second reading. */
const stagedSeen = { itemId: '', unit: -1 };
/** Query signature to which pages of it have been read this visit, and how big it said it was. */
const covered = new Map();
/** Listing ids already announced this visit, so paging back over one is not a second toast. */
const announced = new Set();
/**
 * What each pane last drew. A tooltip runs when the pointer arrives, after the paint, so it reads
 * this rather than recomputing against a possibly newer reading.
 */
const shown = { deals: new Map() };
/** Whether a write is already waiting on its timer. See `keep`. */
const saving = cell(false);
/** Listing id to the first time this addon saw one of the player's OWN listings. */
const mineSeen = new Map();
/** Item id to the sales of it drained off the Merchant's ledger. See `emptySold`. */
const sold = new Map();

/**
 * How far into the current pending ledger this has read. `read` counts sales (the wire array is a
 * window over that count). `anchor` is the last row read, catching a collect followed by exactly
 * as many new sales. `lost` is cumulative: how incomplete the record is.
 */
const cycle = { read: 0, anchor: '', lost: 0 };

/** Set once the stored ledger has been read, or once reading it has failed. */
const loaded = cell(false);
/** Whose the held data is: one realm's prices written into another's key are indistinguishable. */
const loadedFor = { ledger: '', character: '' };
/** Cleared on disable, so an awaited continuation cannot draw into a dead frame. */
const running = cell(true);
/** Whether the undercut warning has already fired for this trip above the line. */
const alerted = cell(false);

/**
 * The last page read, copied: it must outlive walking away, and the client may replace its array.
 */
const live = { status: 'unknown', page: null };
/** Whether the held page is being resynced after a reconnect. See `onAway`. */
const resyncing = cell(false);
/** The reconnect count as of the last market reading. See `onAway`. */
const lastRead = { reconnects: 0 };
/** What the search field holds, which narrows the ledger rather than the market. */
const search = { text: '' };

/** No clamp: the manifest declares the bounds and the loader has already applied them. */
function historyDays() {
  return woc.settings['history-days'];
}

function recordingHouse() {
  return woc.settings['record-house'];
}

function alerting() {
  return woc.settings['undercut-alert'];
}

function minProfit() {
  return woc.settings['min-profit'];
}

/** Zero announces nothing, which is what the setting's own label promises. */
function announceOver() {
  return woc.settings['alert-profit'];
}

function announcingAloud() {
  return woc.settings['alert-sound'];
}

function dealsFirst() {
  return woc.settings['deals-first'];
}

function text(value) {
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

/** A number somebody else stored, or the fallback. Everything read back is untrusted. */
function numberOr(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

/**
 * One field of the game's payload by a variable name, so this addon never names a field it does not
 * own.
 */
function fieldText(source, name) {
  if (typeof source !== 'object' || source === null) {
    return '';
  }
  return text(source[name]);
}

/** One filter axis, with the game's own "nothing chosen" spelling read as nothing chosen. */
function axisText(source, name) {
  const value = fieldText(source, name);
  if (value === NO_FILTER) {
    return '';
  }
  return value;
}

/**
 * The browse order, empty for the default. Kept out of `QUERY_FIELDS` because its unset value is
 * `name`, not `all`: through `axisText` it would enter every default trip's signature and split
 * every stored ledger from the visit that continues it.
 */
function sortText(info) {
  const value = fieldText(info, 'sort');
  if (value === NAME_SORT) {
    return '';
  }
  return value;
}

/** Whether the page in hand was read cheapest-first, which is what breaks item contiguity. */
function sortsByPrice(info) {
  return sortText(info) !== '';
}

/** Whether the server collapsed the book to one row per item. See `COLLAPSE_LABEL`. */
function collapsesLowest(info) {
  return info?.collapseLowest === true;
}

/**
 * Whether anything narrows the page. The sort is excluded: it reorders and never cuts, so a
 * sorted page still holds every match. `collapsedUndercut` turns on this.
 */
function filtersApplied(info) {
  return QUERY_FIELDS.some((name) => axisText(info, name) !== '');
}

/** The lines that have something to say: every note builder answers null in the ordinary case. */
function spoken(lines) {
  return lines.filter((note) => note !== null);
}

/** Copper as TEXT, for the tooltip lines and the strip. A bar's figure takes the amount. */
function money(amount) {
  return woc.ui.money(amount);
}

function unitAgo(count, unit) {
  if (count === 1) {
    return `1 ${unit} ago`;
  }
  return `${String(count)} ${unit}s ago`;
}

/**
 * How old a reading is, in the coarsest useful unit. Wall clock on both sides: this spans page
 * loads.
 */
function agoText(at) {
  if (!Number.isFinite(at) || at <= 0) {
    return 'never';
  }
  const ms = Math.max(0, woc.wallClock() - at);
  if (ms < MINUTE_MS) {
    return 'moments ago';
  }
  if (ms < HOUR_MS) {
    return unitAgo(Math.floor(ms / MINUTE_MS), 'minute');
  }
  if (ms < DAY_MS) {
    return unitAgo(Math.floor(ms / HOUR_MS), 'hour');
  }
  return unitAgo(Math.floor(ms / DAY_MS), 'day');
}

/**
 * `agoText` in the fewest characters ("6h"), for a row's second line. Tooltips use the long form.
 */
function briefAgo(at) {
  if (!Number.isFinite(at) || at <= 0) {
    return 'never';
  }
  const ms = Math.max(0, woc.wallClock() - at);
  if (ms < MINUTE_MS) {
    return 'now';
  }
  if (ms < HOUR_MS) {
    return `${String(Math.floor(ms / MINUTE_MS))}m`;
  }
  if (ms < DAY_MS) {
    return `${String(Math.floor(ms / HOUR_MS))}h`;
  }
  return `${String(Math.floor(ms / DAY_MS))}d`;
}

/** What somebody published about an id, or null while nobody has. */
function known(itemId) {
  return names.get(itemId) ?? null;
}

/** Provenance for the PICTURE rather than the item's name, so every use of it says so. */
function artName(itemId) {
  if (itemId === '') {
    return null;
  }
  return woc.ui.icon.itemArtName(itemId);
}

/** The heroic tag, `lorebind`'s own so two addons name one item the same way. */
const HEROIC_TAG = '[HEROIC]';

/**
 * Never blank. A publisher outranks the loader, whose name is an art file's.
 *
 * The heroic tag is required: a heroic variant is a separate id with its own price and series but
 * the same display name, so untagged the panel shows two identically named rows at very different
 * prices. The tag rides `heroicOf` from `lorebind`; without a publisher the rows fall back to raw
 * ids, which at least differ.
 */
function nameOf(itemId) {
  const record = known(itemId);
  const name = record?.name ?? artName(itemId) ?? itemId;
  if (record?.heroicOf === undefined || record.heroicOf === '') {
    return name;
  }
  return `${name} ${HEROIC_TAG}`;
}

/** One published record, checked: a bus payload is another addon's idea of the shape. */
function parseItem(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const itemId = text(payload.id);
  const name = text(payload.name);
  if (itemId === '' || name === '') {
    return null;
  }
  return {
    id: itemId,
    name,
    quality: text(payload.quality),
    kind: text(payload.kind),
    // The only thing separating two rows with the same display name. See `nameOf`.
    heroicOf: text(payload.heroicOf),
    // Outranks the shipped table: a running lorebind may be generated from a newer game.
    sellValue: positiveOr(payload.sellValue, null),
  };
}

/** A price somebody else stated, or the fallback. Zero is not a floor and neither is a negative. */
function positiveOr(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }
  return fallback;
}

/** One row of the shipped table, checked: `woc.data` proves only that the file is JSON. */
function readFloor(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const itemId = text(value.id);
  if (itemId === '') {
    return null;
  }
  return {
    id: itemId,
    sellValue: positiveOr(value.sellValue, null),
    buyValue: positiveOr(value.buyValue, null),
    noVendorSell: value.noVendorSell === true,
  };
}

/**
 * The table, or null. A failure costs only the two certain signals, so it is reported and survived.
 */
function readFloors(value) {
  if (typeof value !== 'object' || value === null || !Array.isArray(value.items)) {
    return null;
  }
  const rows = [];
  for (const entry of value.items) {
    const row = readFloor(entry);
    if (row !== null) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    return null;
  }
  return { version: text(value.gameVersion), rows };
}

/**
 * What a vendor pays per unit, or null. Null covers no row, no `sellValue`, and `noVendorSell`;
 * all three mean the same to a trader, and the last keeps refused items from being offered as a
 * guaranteed sale.
 */
function vendorFloor(itemId) {
  const held = floors.get(itemId);
  if (held === undefined || held.noVendorSell) {
    return null;
  }
  const published = known(itemId)?.sellValue ?? null;
  return published ?? held.sellValue;
}

/**
 * The lowest price at which the item is available forever, per unit, or null: the Merchant's own
 * never-depleting stock or the vendor's shop price. An ask above either can never sell.
 */
function everCeiling(itemId, page) {
  // What a buyer can have this for instead. The Sell tab's floor is market-wide and is a valid
  // cap even when the cheapest copy is the player's own: nothing resells above it.
  return lowestOf([
    floors.get(itemId)?.buyValue ?? null,
    housePrice(itemId, page),
    stagedCeiling(itemId, page),
  ]);
}

/** The lowest of several prices, any of which may be missing, or null where all of them are. */
function lowestOf(values) {
  let low = null;
  for (const value of values) {
    if (value !== null && (low === null || value < low)) {
      low = value;
    }
  }
  return low;
}

/** The Sell tab's floor, where the answer in hand is about THIS item. See `stagedOf`. */
function stagedCeiling(itemId, page) {
  const { staged } = page;
  if (staged === null || staged.itemId !== itemId) {
    return null;
  }
  return staged.unit;
}

/** The Merchant's own standing stock for an item on this page, per unit, or null. */
function housePrice(itemId, page) {
  let low = null;
  for (const row of page.others) {
    if (row.house && row.itemId === itemId && (low === null || row.unit < low)) {
      low = row.unit;
    }
  }
  return low;
}

function remember(payload, from) {
  const record = parseItem(payload);
  if (record === null) {
    return false;
  }
  names.set(record.id, { ...record, from });
  return true;
}

function onItem(message) {
  if (remember(message.payload, message.from)) {
    schedulePaint();
  }
}

/**
 * The batch an ask is answered with. The `Array.isArray` guard is needed: a publisher with nothing
 * to say answers null. A bad entry is dropped without costing the rest.
 */
function onItems(payload, from) {
  if (!Array.isArray(payload)) {
    return;
  }
  let learned = 0;
  for (const entry of payload) {
    if (remember(entry, from)) {
      learned += 1;
    }
  }
  if (learned > 0) {
    schedulePaint();
  }
}

/** `price` is the whole stack's buyout, so a series built on it reads a stack size as a move. */
function unitPrice(price, count) {
  if (count <= 0) {
    return price;
  }
  return price / count;
}

/** A live row only: the seller and house flag are shown, never stored. */
function makeRow(row) {
  const count = Math.max(1, Math.round(numberOr(row.count, 1)));
  const price = Math.max(0, numberOr(row.price, 0));
  return {
    id: numberOr(row.id, 0),
    count,
    price,
    unit: unitPrice(price, count),
    seller: text(row.sellerName),
    house: row.house === true,
  };
}

/** The query as one comparable string, empty when nothing is set: it is stored on every visit. */
function querySignature(info) {
  const parts = QUERY_FIELDS.map((name) => axisText(info, name));
  const order = sortText(info);
  if (order !== '') {
    parts.push(order);
  }
  if (collapsesLowest(info)) {
    parts.push(COLLAPSE_KEY);
  }
  if (parts.every((part) => part === '')) {
    return '';
  }
  return parts.join('|');
}

/** The same query, as something a tooltip can say. */
function queryLabel(info) {
  const parts = QUERY_FIELDS.map((name) => axisText(info, name)).filter((part) => part !== '');
  if (sortsByPrice(info)) {
    parts.push(PRICE_SORT_LABEL);
  }
  if (collapsesLowest(info)) {
    parts.push(COLLAPSE_LABEL);
  }
  if (parts.length === 0) {
    return NO_QUERY;
  }
  return parts.join(', ');
}

/**
 * What kind of copy a listing is, in one word, or empty for the ordinary item. Any payload makes
 * a copy non-fungible, and the server trims it for strangers, so an empty object is a real answer:
 * the key's presence is the mark, and `marked` is the fallback word.
 */
function copyMark(instance) {
  if (typeof instance !== 'object' || instance === null) {
    return '';
  }
  if (text(instance.enchant) !== '') {
    return 'enchanted';
  }
  if (instance.rolled?.masterwork === true) {
    return 'masterwork';
  }
  if (text(instance.signer) !== '') {
    return 'signed';
  }
  return 'marked';
}

/** One row of the page, kept under this addon's own names rather than the game's. */
function captureRow(row) {
  const held = makeRow(row);
  held.itemId = text(row.itemId);
  held.mine = row.mine === true;
  held.mark = copyMark(row.instance);
  return held;
}

/** How many of something the server sent, when all that is drawn is the count. */
function countOf(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  return 0;
}

/** The page as held after the player walks away: a copy, since it must outlive the counter. */
function capture(info, now) {
  const queryText = querySignature(info);
  const { listings } = info;
  const rows = [];
  if (Array.isArray(listings)) {
    for (const row of listings) {
      rows.push(captureRow(row));
    }
  }
  return {
    at: now,
    query: queryText,
    queryText: queryLabel(info),
    page: Math.max(0, Math.round(numberOr(info.page, 0))),
    pageCount: Math.max(0, Math.round(numberOr(info.pageCount, 0))),
    byPrice: sortsByPrice(info),
    collapsed: collapsesLowest(info),
    filtered: filtersApplied(info),
    totalCount: Math.max(0, Math.round(numberOr(info.totalCount, 0))),
    cutPct: numberOr(info.cutPct, 0),
    maxListings: Math.max(0, Math.round(numberOr(info.maxListings, 0))),
    myListingCount: Math.max(0, Math.round(numberOr(info.myListingCount, 0))),
    collectionCopper: Math.max(0, numberOr(info.collectionCopper, 0)),
    collectionItems: countOf(info.collectionItems),
    kind: VISIT_ASKS,
    staged: stagedOf(info),
    mine: rows.filter((row) => row.mine),
    others: rows.filter((row) => !row.mine),
  };
}

/**
 * The Sell tab's price reference, as an (id, price) pair or null. The id says which item the
 * answer is about, so a stale answer for a previously staged item cannot be misattributed. A real
 * id with no price means nobody is selling that item.
 */
function stagedOf(info) {
  // biome-ignore lint/security/noSecrets: a field name copied off the game's wire, which the entropy heuristic cannot tell from a token
  const itemId = fieldText(info, 'sellPriceItemId');
  if (itemId === '') {
    return null;
  }
  const unit = numberOr(info.sellLowestPrice, 0);
  if (unit < MIN_ASK) {
    return { itemId, unit: null };
  }
  return { itemId, unit };
}

/** What each visit found, oldest first. Every figure drawn is per trip. */
function emptySeries(itemId) {
  return { itemId, at: 0, visits: [] };
}

/**
 * Checked, since a player can edit storage. Stored as an array in seconds to keep keys out of it.
 */
function parseVisit(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const at = numberOr(value[0], 0) * MS_PER_SECOND;
  const low = numberOr(value[1], -1);
  const high = numberOr(value[2], -1);
  if (at <= 0 || low < 0 || high < low) {
    return null;
  }
  // `first` is appended: a missing slot reads as `at`, an inference, which is why `mergeVisits`
  // keeps the fold rule as a fallback.
  const first = numberOr(value[4], 0) * MS_PER_SECOND;
  return {
    at,
    low,
    high,
    query: text(value[3]),
    first: startedAt(first, at),
    kind: visitKind(numberOr(value[5], VISIT_ASKS)),
  };
}

/** An unrecognised kind reads as the ordinary one: storage is player-editable. */
function visitKind(value) {
  if (value === VISIT_FLOOR) {
    return VISIT_FLOOR;
  }
  return VISIT_ASKS;
}

/** Whether a reading is a page's asks, the only kind a resale may be priced against. */
function isAskVisit(visit) {
  return visit.kind !== VISIT_FLOOR;
}

/** The recorded start, or `at` for a visit stored without `first`. */
function startedAt(first, at) {
  if (first > 0) {
    return first;
  }
  return at;
}

function storedVisit(visit) {
  const row = [
    Math.round(visit.at / MS_PER_SECOND),
    visit.low,
    visit.high,
    visit.query,
    Math.round(visit.first / MS_PER_SECOND),
  ];
  // Written only for the non-default kind, so browsed visits stay byte-identical. See `VISIT_ASKS`.
  if (visit.kind === VISIT_FLOOR) {
    row.push(VISIT_FLOOR);
  }
  return row;
}

function parseSeries(itemId, value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const record = emptySeries(itemId);
  for (const entry of value) {
    const visit = parseVisit(entry);
    if (visit !== null) {
      record.visits.push(visit);
    }
  }
  if (record.visits.length === 0) {
    return null;
  }
  record.visits.sort((a, b) => a.at - b.at);
  record.at = record.visits.at(-1)?.at ?? 0;
  return record;
}

/** Everything stored, as records, dropping anything that is not one. */
function parseLedger(value) {
  const held = new Map();
  if (typeof value !== 'object' || value === null) {
    return held;
  }
  const { items } = value;
  if (typeof items !== 'object' || items === null) {
    return held;
  }
  for (const [itemId, entry] of Object.entries(items)) {
    const record = parseSeries(itemId, entry);
    if (itemId !== '' && record !== null) {
      held.set(itemId, record);
    }
  }
  return held;
}

function storedLedger() {
  const items = {};
  for (const [itemId, record] of series) {
    items[itemId] = record.visits.map(storedVisit);
  }
  return { items };
}

/**
 * Listing ids are a per-boot counter, so price and count (immutable on a listing) must match too.
 */
function sameListing(held, row) {
  return held.price === row.price && held.count === row.count;
}

/** Drop everything older than the retention setting, oldest first, newest kept. */
function prunedVisits(visits, cutoff) {
  const kept = visits.filter((visit) => visit.at >= cutoff);
  kept.sort((a, b) => a.at - b.at);
  return kept.slice(-MAX_VISITS);
}

function cutoffAt(now) {
  return now - historyDays() * DAY_MS;
}

/**
 * House stock is priced by formula, so it is off by default: it would move the low with nobody
 * deciding anything. It stays in the undercut check, since a buyer can buy it.
 */
function recordable(row) {
  if (row.itemId === '') {
    return false;
  }
  // An enchanted, masterwork or signed copy is a different good under the plain item's id.
  if (row.mark !== '') {
    return false;
  }
  return recordingHouse() || !row.house;
}

/**
 * The cheapest and dearest ask per item over `others` only: the player's own ask is not a reading.
 */
function pageAsks(page) {
  const asks = new Map();
  for (const row of page.others) {
    if (recordable(row)) {
      // Whole copper: a total over a count is often fractional, and this is stored thousands of
      // times.
      const unit = Math.round(row.unit);
      const held = asks.get(row.itemId);
      if (held === undefined) {
        asks.set(row.itemId, { low: unit, high: unit });
      } else {
        held.low = Math.min(held.low, unit);
        held.high = Math.max(held.high, unit);
      }
    }
  }
  return asks;
}

/**
 * A page read soon after the last under the same query is the same trip: merging widens the
 * spread and moves the stamp. A reading is `{ at, query, kind }`; the Sell tab files under a
 * signature no browsed page produces, so the two never merge.
 */
function foldVisit(record, ask, reading) {
  const last = record.visits.at(-1);
  if (
    last !== undefined &&
    last.query === reading.query &&
    reading.at - last.at <= VISIT_WINDOW_MS
  ) {
    last.low = Math.min(last.low, ask.low);
    last.high = Math.max(last.high, ask.high);
    last.at = reading.at;
    return;
  }
  // `at` slides as the trip goes on; `first` never moves and is the identity two devices agree on.
  record.visits.push({
    at: reading.at,
    first: reading.at,
    low: ask.low,
    high: ask.high,
    query: reading.query,
    kind: reading.kind,
  });
}

/** One item's reading into its series, pruned to the retention setting on the way in. */
function foldReading(itemId, ask, reading) {
  const record = series.get(itemId) ?? emptySeries(itemId);
  foldVisit(record, ask, reading);
  record.visits = prunedVisits(record.visits, cutoffAt(reading.at));
  record.at = reading.at;
  series.set(itemId, record);
}

/** Write one page into the ledger, and answer whether anything moved. */
function foldPage(page) {
  let moved = false;
  for (const [itemId, ask] of pageAsks(page)) {
    foldReading(itemId, ask, page);
    moved = true;
  }
  return moved;
}

/**
 * The Sell tab's floor into the ledger, once per answer: the pair rides every snapshot while an
 * item is staged, so only a change of price or item is a new reading.
 */
function foldSell(page) {
  const { staged } = page;
  if (staged === null || staged.unit === null) {
    return false;
  }
  if (stagedSeen.itemId === staged.itemId && stagedSeen.unit === staged.unit) {
    return false;
  }
  stagedSeen.itemId = staged.itemId;
  stagedSeen.unit = staged.unit;
  foldReading(
    staged.itemId,
    { low: staged.unit, high: staged.unit },
    { at: page.at, query: SELL_KEY, kind: VISIT_FLOOR },
  );
  return true;
}

/** The least recently seen items, once the ledger is over its ceiling. */
function overflowIds() {
  if (series.size <= MAX_ITEMS) {
    return [];
  }
  const order = [...series.values()].sort((a, b) => a.at - b.at);
  return order.slice(0, series.size - MAX_ITEMS).map((record) => record.itemId);
}

function forget(itemIds) {
  for (const itemId of itemIds) {
    series.delete(itemId);
  }
}

function saveLedger() {
  saving.on = false;
  if (ledgerKey() !== loadedFor.ledger) {
    // The world moved since the change: what is held belongs to the old market. The reload fixes
    // it.
    return;
  }
  woc.storage.set(loadedFor.ledger, storedLedger()).catch((err) => {
    woc.warn('ledgerline: the ledger could not be saved', err);
  });
}

/**
 * At most once every `WRITE_HOLD_MS`, serialized when the timer fires, so a burst of browsing is
 * one write and nothing is stored stale. That is also why nothing is cloned.
 */
function keep() {
  if (saving.on) {
    return;
  }
  saving.on = true;
  woc.setTimeout(saveLedger, WRITE_HOLD_MS);
}

/**
 * The nearest honest thing to a remaining time, since no row carries an expiry. A stamp is
 * trusted only where price and count match too, since ids are reused after a restart.
 */
function foldOwn(page) {
  let moved = false;
  for (const row of page.mine) {
    const held = mineSeen.get(row.id);
    if (held === undefined || !sameListing(held, row)) {
      mineSeen.set(row.id, { price: row.price, count: row.count, seen: page.at });
      moved = true;
    }
  }
  return moved;
}

/** Drop own-listing stamps past the retention window, so the key cannot grow forever. */
function pruneOwn(now) {
  const cutoff = cutoffAt(now);
  for (const [id, held] of mineSeen) {
    if (held.seen < cutoff) {
      mineSeen.delete(id);
    }
  }
}

/**
 * Per character, unlike the ledger. Listing ids are a per-boot counter per server, so ids from
 * two realms collide under an account key.
 */
function keepOwn() {
  const stored = [...mineSeen.entries()].map(([id, held]) => ({ ...held, id }));
  woc.storage.character.set(MINE_KEY, stored).catch((err) => {
    woc.warn('ledgerline: the listing stamps could not be saved', err);
  });
}

/** When this addon first saw one of the player's own listings, or 0. */
function firstSeen(row) {
  const held = mineSeen.get(row.id);
  if (held === undefined || !sameListing(held, row)) {
    return 0;
  }
  return held.seen;
}

/** One item's completed sales, oldest first, in the order they were drained. */
function emptySold(itemId) {
  return { itemId, at: 0, sales: [] };
}

/**
 * Everything the row carries. Two identical sales stay indistinguishable; this answers only
 * whether the row at a position is still the one read there.
 */
function saleMark(row) {
  if (typeof row !== 'object' || row === null) {
    return '';
  }
  const count = numberOr(row.count, 0);
  const price = numberOr(row.price, 0);
  const proceeds = numberOr(row.proceeds, 0);
  return `${text(row.itemId)}|${String(count)}|${String(price)}|${String(proceeds)}|${text(row.buyerName)}`;
}

/**
 * Zero on a queue this has not read: shorter than last time means collected and restarted, and a
 * changed row at the anchor position means a different queue of the same length.
 */
function alreadyRead(rows, omitted) {
  if (cycle.read === 0 || omitted + rows.length < cycle.read) {
    return 0;
  }
  const at = cycle.read - 1 - omitted;
  if (at < 0) {
    // The cap dropped the anchor row, so the count is all there is; what it skips is lost.
    return cycle.read;
  }
  if (saleMark(rows[at]) !== cycle.anchor) {
    return 0;
  }
  return cycle.read;
}

/**
 * Write one drained row. Nothing is filtered on amount: a 1-copper sale nets zero after the cut
 * and is still a sale.
 */
function recordSale(row, now) {
  const itemId = text(row?.itemId);
  if (itemId === '') {
    return;
  }
  const count = Math.max(1, Math.round(numberOr(row.count, 1)));
  const price = Math.max(0, numberOr(row.price, 0));
  const record = sold.get(itemId) ?? emptySold(itemId);
  record.sales.push({
    at: now,
    count,
    price,
    proceeds: Math.max(0, numberOr(row.proceeds, 0)),
    buyer: text(row.buyerName),
    origin: install.id,
    unit: Math.round(unitPrice(price, count)),
  });
  record.at = now;
  sold.set(itemId, record);
}

/**
 * An absent field is not an empty queue: reading it as a collect would reset the position every
 * page and count every waiting sale again.
 */
function foldSales(info, now) {
  const rows = info.collectionSales;
  if (!Array.isArray(rows)) {
    return false;
  }
  const omitted = Math.max(0, Math.round(numberOr(info.collectionSalesOmitted, 0)));
  const read = alreadyRead(rows, omitted);
  // Not the server's figure: `collectionSalesOmitted` counts what the cap dropped, some of which
  // was already read here. Only the queue position says what this record is missing.
  const missed = Math.max(0, omitted - read);
  cycle.lost += missed;
  const fresh = rows.slice(Math.max(read, omitted) - omitted);
  for (const row of fresh) {
    recordSale(row, now);
  }
  const total = omitted + rows.length;
  // A position change is a change too: a collect must be written or a reload resumes mid-queue.
  const moved = missed > 0 || fresh.length > 0 || cycle.read !== total;
  cycle.read = total;
  cycle.anchor = saleMark(rows.at(-1));
  return moved;
}

/** Everything the panel says about one item's sales, from the rows that were drained. */
function soldStats(record) {
  const units = record.sales.map((entry) => entry.unit).sort((a, b) => a - b);
  const newest = record.sales.at(-1);
  return {
    low: units[0] ?? 0,
    high: units.at(-1) ?? 0,
    median: median(units, Math.floor(units.length / 2)),
    at: newest?.at ?? record.at,
    sales: record.sales.length,
    items: record.sales.reduce((total, entry) => total + entry.count, 0),
    gross: record.sales.reduce((total, entry) => total + entry.price, 0),
    net: record.sales.reduce((total, entry) => total + entry.proceeds, 0),
  };
}

/** The retention cutoff, raised where the whole-record ceiling bites first. */
function soldCutoff(now) {
  const stamps = [...sold.values()].flatMap((record) => record.sales.map((entry) => entry.at));
  stamps.sort((a, b) => a - b);
  const over = stamps.length - MAX_SALES;
  if (over <= 0) {
    return cutoffAt(now);
  }
  return Math.max(cutoffAt(now), stamps[over] ?? 0);
}

/** Hold the sale record to its cutoff, dropping an item that has nothing left. */
function trimSold(cutoff) {
  const emptied = [];
  for (const [itemId, record] of sold) {
    record.sales = record.sales.filter((entry) => entry.at >= cutoff);
    record.at = record.sales.at(-1)?.at ?? 0;
    if (record.sales.length === 0) {
      emptied.push(itemId);
    }
  }
  for (const itemId of emptied) {
    sold.delete(itemId);
  }
}

/** One stored sale, checked: storage is player-editable. */
function parseSale(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const at = numberOr(value[0], 0) * MS_PER_SECOND;
  const count = Math.max(1, Math.round(numberOr(value[1], 1)));
  const price = numberOr(value[2], -1);
  const proceeds = numberOr(value[3], -1);
  if (at <= 0 || price < 0 || proceeds < 0) {
    return null;
  }
  // Appended like `first`. An empty origin is a row from before origins, which can only be this
  // device.
  return {
    at,
    count,
    price,
    proceeds,
    buyer: text(value[4]),
    origin: text(value[5]),
    unit: Math.round(price / count),
  };
}

/** An array in seconds, like the visits. */
function storedSale(entry) {
  return [
    Math.round(entry.at / MS_PER_SECOND),
    entry.count,
    entry.price,
    entry.proceeds,
    entry.buyer,
    entry.origin,
  ];
}

/** One item's stored sales, oldest first, or null where none of them survived the check. */
function parseSoldRecord(itemId, value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const record = emptySold(itemId);
  for (const entry of value) {
    const parsed = parseSale(entry);
    if (parsed !== null) {
      record.sales.push(parsed);
    }
  }
  if (record.sales.length === 0) {
    return null;
  }
  record.sales.sort((a, b) => a.at - b.at);
  record.at = record.sales.at(-1)?.at ?? 0;
  return record;
}

/**
 * Which held visit an incoming one is, or null. `first` matches first: it never moves, so
 * re-importing a device's own file adds nothing. The fold rule behind it covers visits stored
 * before `first` existed, and is the same rule `foldVisit` applies live.
 */
function matchVisit(visits, visit) {
  const exact = visits.find((held) => held.query === visit.query && held.first === visit.first);
  if (exact !== undefined) {
    return exact;
  }
  const near = visits.find(
    (held) => held.query === visit.query && Math.abs(held.at - visit.at) <= VISIT_WINDOW_MS,
  );
  return near ?? null;
}

/**
 * Fold one incoming visit into a record and answer whether it was new. A matched visit is
 * widened, never overwritten, so import order does not matter.
 */
function absorbVisit(record, visit) {
  const held = matchVisit(record.visits, visit);
  if (held === null) {
    record.visits.push({ ...visit });
    return true;
  }
  held.low = Math.min(held.low, visit.low);
  held.high = Math.max(held.high, visit.high);
  held.at = Math.max(held.at, visit.at);
  held.first = Math.min(held.first, visit.first);
  return false;
}

/**
 * Merge an incoming ledger and report what it did. The retention cutoff applies to what arrives
 * too, or an old file restores readings the player's setting has dropped.
 */
function mergeLedger(incoming, cutoff) {
  let added = 0;
  let repeated = 0;
  for (const [itemId, record] of incoming) {
    const held = series.get(itemId) ?? emptySeries(itemId);
    for (const visit of record.visits.filter((entry) => entry.at >= cutoff)) {
      if (absorbVisit(held, visit)) {
        added += 1;
      } else {
        repeated += 1;
      }
    }
    if (held.visits.length > 0) {
      held.visits = prunedVisits(held.visits, cutoff);
      held.at = held.visits.at(-1)?.at ?? held.at;
      series.set(itemId, held);
    }
  }
  forget(overflowIds());
  return { added, repeated, items: incoming.size };
}

/**
 * Merge an incoming sale record per origin and per item, keeping the longer side. Rows have no id
 * and drains share a stamp, so content cannot dedup them; but one device's log for one item only
 * ever grows, so the longer copy is a superset. If two devices drained the same pending ledger,
 * that sale is recorded twice, and nothing in the payload can prove otherwise.
 */
function mergeSold(incoming) {
  let added = 0;
  for (const [itemId, record] of incoming) {
    const held = sold.get(itemId) ?? emptySold(itemId);
    const kept = byOrigin(held.sales);
    for (const [origin, rows] of byOrigin(record.sales)) {
      const have = kept.get(origin)?.length ?? 0;
      if (rows.length > have) {
        added += rows.length - have;
        kept.set(origin, rows);
      }
    }
    held.sales = [...kept.values()].flat().sort((a, b) => a.at - b.at);
    held.at = held.sales.at(-1)?.at ?? held.at;
    if (held.sales.length > 0) {
      sold.set(itemId, held);
    }
  }
  return added;
}

/** One item's sales split by the device that drained each, oldest first within a device. */
function byOrigin(sales) {
  const split = new Map();
  for (const entry of sales) {
    const rows = split.get(entry.origin) ?? [];
    rows.push(entry);
    split.set(entry.origin, rows);
  }
  for (const rows of split.values()) {
    rows.sort((a, b) => a.at - b.at);
  }
  return split;
}

/** Every item's stored sales, as records, dropping anything that is not one. */
function parseSold(value) {
  const held = new Map();
  if (typeof value !== 'object' || value === null) {
    return held;
  }
  for (const [itemId, entries] of Object.entries(value)) {
    const record = parseSoldRecord(itemId, entries);
    if (itemId !== '' && record !== null) {
      held.set(itemId, record);
    }
  }
  return held;
}

/** The sale record and the position in the queue, which are written and read as one value. */
function storedSold() {
  const sales = {};
  for (const [itemId, record] of sold) {
    sales[itemId] = record.sales.map(storedSale);
  }
  return { sales, read: cycle.read, anchor: cycle.anchor, lost: cycle.lost };
}

/**
 * The queue position is stored with the sales: after a reload, a fresh position would record the
 * same rows twice.
 */
function keepSold() {
  woc.storage.character.set(SOLD_KEY, storedSold()).catch((err) => {
    woc.warn('ledgerline: the sale record could not be saved', err);
  });
}

/** One vote per visit, taking each visit's low: the low is what the item can be had for. */
function statsFor(record) {
  const lows = record.visits.map((visit) => visit.low).sort((a, b) => a - b);
  const newest = record.visits.at(-1);
  // No `high`: nothing draws it, and a collapsed page has no spread to contribute to one.
  return {
    low: lows[0] ?? 0,
    median: median(lows, Math.floor(lows.length / 2)),
    latest: newest?.low ?? 0,
    at: newest?.at ?? record.at,
    visits: record.visits.length,
    queries: new Set(record.visits.map((visit) => visit.query)).size,
  };
}

function median(units, middle) {
  if (units.length === 0) {
    return 0;
  }
  if (units.length % 2 === 1) {
    return units[middle] ?? 0;
  }
  return ((units[middle - 1] ?? 0) + (units[middle] ?? 0)) / 2;
}

/**
 * What was paid, as its own pair of fields or nothing. Never folded into `unit`: a number made of
 * an ask and a sale is true of neither.
 */
function soldPart(itemId) {
  const record = sold.get(itemId);
  if (record === undefined || record.sales.length === 0) {
    return null;
  }
  const stats = soldStats(record);
  return { sold: Math.round(stats.median), sales: stats.sales };
}

/**
 * One item as the bus carries it, or null with no ask series. `unit` is the median of per-visit
 * lows; `low` and `latest` give a range's ends; `visits` says how much evidence stands behind it,
 * since one visit is one stranger's ask. An item with sales but no asks is left out: `unit` always
 * means an ask.
 */
function priceRecord(itemId) {
  const record = series.get(itemId);
  if (record === undefined || record.visits.length === 0) {
    return null;
  }
  const stats = statsFor(record);
  return {
    id: itemId,
    // Required: a consumer pooling across characters holds items on markets this ledger never saw.
    realm: realmNow(),
    unit: Math.round(stats.median),
    low: Math.round(stats.low),
    latest: Math.round(stats.latest),
    at: stats.at,
    visits: stats.visits,
    ...(soldPart(itemId) ?? {}),
  };
}

/** Every price known, as one batch, as the name publisher answers an ask. */
function everyPriceKnown() {
  const rows = [];
  for (const itemId of series.keys()) {
    const row = priceRecord(itemId);
    if (row !== null) {
      rows.push(row);
      onBus.set(itemId, priceMark(row));
    }
  }
  if (rows.length === 0) {
    return null;
  }
  return rows;
}

/** What changes exactly when a published figure does, so a repeat page emits nothing. */
function priceMark(row) {
  return `${String(row.unit)}/${String(row.low)}/${String(row.latest)}/${String(row.visits)}/${String(row.sold ?? -1)}`;
}

/**
 * The row for an id whose published figure has changed, or null. Gated on the figure, not on
 * `foldPage`, which reports a sliding stamp as a change at snapshot rate.
 */
function priceIfMoved(itemId) {
  const row = priceRecord(itemId);
  if (row === null || onBus.get(itemId) === priceMark(row)) {
    return null;
  }
  return row;
}

function publishPrices(page) {
  const seen = new Set([...page.mine, ...page.others].map((row) => row.itemId));
  for (const itemId of seen) {
    const row = priceIfMoved(itemId);
    if (row !== null) {
      onBus.set(itemId, priceMark(row));
      woc.bus.emit(PRICE_TOPIC, row);
    }
  }
}

/**
 * Every listing on this page into the visit's buffer, plus the page's own size. An existing row
 * is never edited, only restamped, so a price that appeared to change on the wire is not hidden.
 */
function foldScan(page) {
  // Own listings too: a buyer takes the cheapest copy whoever posted it. Without them the panel
  // tells a player to buy and resell at a price their own relisting already undercuts.
  // `buyableDeal` still refuses them as purchases.
  for (const row of [...page.mine, ...page.others]) {
    if (row.itemId !== '') {
      rememberOffer(row, page);
    }
  }
  noteCoverage(page);
  dropStale(page.at);
  trimScan();
}

/**
 * Forget listings this trip has stopped seeing. A stale cheap row does worse than linger: it
 * anchors resale pricing and makes an ordinary listing look like a bargain. Same window as a
 * visit, since that is how long one trip through the book lasts.
 */
function dropStale(now) {
  const cutoff = now - VISIT_WINDOW_MS;
  for (const [id, row] of scan) {
    if (row.lastSeen < cutoff) {
      scan.delete(id);
    }
  }
}

/** One listing into the buffer. A row is never edited, so re-seeing one moves the stamp alone. */
function rememberOffer(row, page) {
  const held = scan.get(row.id);
  if (held === undefined) {
    scan.set(row.id, { ...row, firstSeen: page.at, lastSeen: page.at, query: page.queryText });
    return;
  }
  held.lastSeen = page.at;
}

/** How much of each query has been read this visit: the honest limit on every figure. */
function noteCoverage(page) {
  const held = covered.get(page.query) ?? { label: page.queryText, pages: new Set() };
  held.pages.add(page.page);
  held.pageCount = page.pageCount;
  held.totalCount = page.totalCount;
  covered.set(page.query, held);
}

/** Stalest first: the book moves under a scan, so the oldest row is likeliest gone. */
function trimScan() {
  if (scan.size <= MAX_SCAN) {
    return;
  }
  const order = [...scan.values()].sort((a, b) => a.lastSeen - b.lastSeen);
  for (const row of order.slice(0, scan.size - MAX_SCAN)) {
    scan.delete(row.id);
  }
}

/** Walking away ends the visit and the scan. See `MAX_SCAN` for why none of it is stored. */
function clearScan() {
  scan.clear();
  covered.clear();
  announced.clear();
  // Walking away ends the trip the last Sell answer belonged to. Left set, the same floor
  // confirmed on a later visit would be deduplicated away.
  stagedSeen.itemId = '';
  stagedSeen.unit = -1;
}

/**
 * Pages read against pages there are, over every query this visit. Both are drawn, never a ratio.
 */
function coverageNow() {
  let read = 0;
  let total = 0;
  for (const held of covered.values()) {
    read += held.pages.size;
    total += Math.max(held.pages.size, held.pageCount);
  }
  return { read, total, queries: covered.size, listings: scan.size };
}

/**
 * Everything seen this visit for one item, cheapest first, without house stock or marked copies.
 */
function offersOf(itemId) {
  const rows = [];
  for (const row of scan.values()) {
    if (row.itemId === itemId && !row.house && row.mark === '') {
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.unit - b.unit);
}

/**
 * The resale anchor from the listings: the cheapest other offer, since to sell you must be the
 * cheapest. So only an item's cheapest listing can ever be a buy, with no separate test.
 */
function rivalAnchor(row) {
  const others = offersOf(row.itemId).filter((other) => other.id !== row.id);
  const [cheapest] = others;
  if (cheapest === undefined) {
    return null;
  }
  return { unit: cheapest.unit, evidence: others.length, mine: cheapest.mine === true };
}

/**
 * The recorded median, excluding the visit being folded now: `foldPage` writes the live page
 * first, and including it lets a cheap row drag down the baseline it is judged against. Needs at
 * least two prior visits.
 */
function recordedAnchor(itemId) {
  const record = series.get(itemId);
  if (record === undefined) {
    return null;
  }
  // Page readings only: a Sell floor includes house stock and the player's own listings, and a
  // resale is priced against what somebody else will pay. The Prices pane keeps every reading.
  const prior = record.visits.filter(isAskVisit).slice(0, -1);
  if (prior.length < THIN_EVIDENCE) {
    return null;
  }
  const lows = prior.map((visit) => visit.low).sort((a, b) => a - b);
  return { unit: median(lows, Math.floor(lows.length / 2)), evidence: prior.length };
}

/** No anchor may sit above a price the item can be bought at forever. See `everCeiling`. */
function cappedAnchor(anchor, ceiling) {
  if (anchor === null || ceiling === null) {
    return anchor;
  }
  return { ...anchor, unit: Math.min(anchor.unit, ceiling) };
}

/** What the stack clears if it is bought here and sold at `unit`, after the Merchant's cut. */
function resaleProfit(row, unit, cutPct) {
  return Math.floor(unit * row.count * (1 - cutPct / PERCENT)) - row.price;
}

function confidenceOf(evidence, firm) {
  if (evidence >= firm) {
    return 'firm';
  }
  return 'thin';
}

/** Whether the whole stack was priced as a single item: a typo, which says nothing about worth. */
function stackSlip(row, unit) {
  if (row.count <= 1 || unit <= 0) {
    return false;
  }
  return Math.abs(row.price - unit) <= unit * STACK_SLIP;
}

/**
 * What one of these normally costs: the dearest estimate. The resale anchor is the cheapest one,
 * and measuring a typo against that hides it as soon as a cheaper source wins.
 */
function typicalUnit(options) {
  return options.reduce((top, option) => Math.max(top, option.typical ?? option.unit), 0);
}

/** Every way this listing could make money, each with what it would clear. */
function optionsFor(row, page) {
  const ceiling = everCeiling(row.itemId, page);
  const options = [];
  const floor = vendorFloor(row.itemId);
  if (floor !== null) {
    // No cut: a vendor is not the Merchant, and the payout is a flat price per unit.
    const profit = floor * row.count - row.price;
    if (profit > 0) {
      options.push({ signal: 'vendor', unit: floor, profit, confidence: 'certain', evidence: 0 });
    }
  }
  for (const arm of resaleArms(row, page, ceiling)) {
    options.push(arm);
  }
  return options;
}

/**
 * One resale arm: the cheaper of the two anchors. Both estimate what somebody will pay, so taking
 * the richer picks the most optimistic source; on a thin item a lone high rival would turn a small
 * item into a top-sorted windfall. The vendor floor is a certainty, carried beside the figure and
 * never averaged into it.
 */
function resaleArms(row, page, ceiling) {
  // A marked copy has no resale arm: neither anchor prices its premium. The vendor arm in
  // `optionsFor` survives, since a vendor pays no premium either.
  if (row.mark !== '') {
    return [];
  }
  const arms = [
    resaleOption('page', cappedAnchor(rivalAnchor(row), ceiling), row, page),
    resaleOption('history', cappedAnchor(recordedAnchor(row.itemId), ceiling), row, page),
  ].filter((arm) => arm !== null);
  const cautious = arms.reduce(lowerAnchor, arms[0] ?? null);
  if (cautious === null) {
    return [];
  }
  // The dearest estimate rides along for `stackSlip`, never as an option of its own. See
  // `typicalUnit`.
  return [{ ...cautious, typical: arms.reduce((top, arm) => Math.max(top, arm.unit), 0) }];
}

/** Whichever of two anchors asks less for the item. */
function lowerAnchor(held, arm) {
  if (held === null || arm.unit < held.unit) {
    return arm;
  }
  return held;
}

/** How much evidence each resale anchor needs before it stops being called thin. */
const FIRM_FOR = new Map([
  ['page', FIRM_RIVALS],
  ['history', FIRM_VISITS],
]);

/** One resale arm, or null. Both arms share this so the cut arithmetic exists once. */
function resaleOption(signal, anchor, row, page) {
  if (anchor === null) {
    return null;
  }
  const profit = resaleProfit(row, anchor.unit, page.cutPct);
  if (profit <= 0) {
    return null;
  }
  return {
    signal,
    unit: anchor.unit,
    profit,
    confidence: confidenceOf(anchor.evidence, FIRM_FOR.get(signal) ?? FIRM_VISITS),
    evidence: anchor.evidence,
    mine: anchor.mine === true,
  };
}

/** Whichever of two ways to make money on one listing makes more of it. */
function richer(top, option) {
  if (option.profit > top.profit) {
    return option;
  }
  return top;
}

/**
 * What this listing is worth acting on, or null. The best expected profit decides the row; the
 * vendor floor rides beside it, so a safe 5 silver resale is not reported as its 20 copper floor.
 */
function dealFor(row, page) {
  const options = optionsFor(row, page);
  if (options.length === 0) {
    return null;
  }
  const best = options.reduce(richer);
  const guaranteed = options.find((option) => option.signal === 'vendor')?.profit ?? 0;
  return {
    key: String(row.id),
    row,
    signal: best.signal,
    unit: best.unit,
    profit: best.profit,
    confidence: best.confidence,
    evidence: best.evidence,
    againstMine: best.mine === true,
    guaranteed,
    stack: stackSlip(row, typicalUnit(options)),
  };
}

/**
 * A deal on a listing somebody could corner, or null. House stock never is: it never depletes, so
 * reselling it competes with a counter still selling tomorrow.
 */
function buyableDeal(row, page) {
  if (row.house || row.mine) {
    return null;
  }
  return dealFor(row, page);
}

/** Everything in the buffer worth buying, best first. */
function dealsNow(page) {
  const floorCopper = minProfit();
  const rows = [];
  for (const row of scan.values()) {
    const deal = buyableDeal(row, page);
    if (deal !== null && deal.profit >= floorCopper) {
      rows.push(deal);
    }
  }
  return rows.sort((a, b) => b.profit - a.profit || a.key.localeCompare(b.key));
}

/**
 * The item's first row on this page, its cheapest here under either order: name-sorted blocks are
 * contiguous and ascending, and a price-sorted page ascends overall. What lies off the page is
 * `verdictFor`'s problem.
 */
function blockStart(others, itemId) {
  return others.findIndex((row) => row.itemId === itemId && row.mark === '');
}

/**
 * `unknown` where the item has no block on this page, which is never evidence nobody sells it.
 * `partial` where a cheaper copy could be on an unread page: name-sorted, only when the block
 * starts at row 0 of a later page; price-sorted, on any page after 0. Page 0 price-sorted holds
 * the cheapest rows of the whole book.
 */
function verdictFor(row, page) {
  // A marked copy does not compete with plain rows of its id, so never call it undercut.
  if (row.mark !== '') {
    return { state: 'copy', rival: null };
  }
  // A collapsed page covers the whole matched book, so an own row that came back is the cheapest
  // copy anywhere. Undercut ones were dropped by the server. See `collapsedUndercut`.
  if (page.collapsed) {
    return { state: 'floor', rival: null };
  }
  const at = blockStart(page.others, row.itemId);
  if (at < 0) {
    return { state: 'unknown', rival: null };
  }
  const rival = page.others[at] ?? null;
  if (rival === null) {
    return { state: 'unknown', rival: null };
  }
  if (page.page > 0 && (at === 0 || page.byPrice)) {
    return { state: 'partial', rival };
  }
  if (rival.price < row.price) {
    return { state: 'undercut', rival };
  }
  return { state: 'cheapest', rival };
}

function undercutCount(page) {
  if (page.collapsed) {
    return collapsedUndercut(page);
  }
  return page.mine.filter((row) => verdictFor(row, page).state === 'undercut').length;
}

/**
 * How many of the player's listings the collapse dropped, i.e. were undercut. Counted via
 * `myListingCount`, which spans the whole book, so it is answerable only with no filter narrowing
 * the page; under one, "other item" and "undercut" are inseparable and this answers none.
 */
function collapsedUndercut(page) {
  if (page.filtered) {
    return 0;
  }
  return Math.max(0, page.myListingCount - page.mine.length);
}

/** On the crossing, or every page read while undercut would repeat it. */
function checkUndercut(page) {
  const count = undercutCount(page);
  if (count === 0) {
    alerted.on = false;
    return;
  }
  if (!(alerted.on || !alerting())) {
    alerted.on = true;
    woc.ui.toast(
      `Ledgerline: ${woc.fmt.count(count, 'listing')} of yours no longer the cheapest.`,
      {
        kind: 'warn',
      },
    );
  }
}

/**
 * Off `characterKey`, null until realm and name are known. Not off `net.state.realm`: the hello
 * frame can lose the race to world entry, filing the ledger under `offline`.
 */
function realmNow() {
  const key = text(woc.world.characterKey);
  const cut = key.indexOf('/');
  if (cut <= 0) {
    return '';
  }
  return key.slice(0, cut);
}

/**
 * Account-wide, since a price is a fact about the world, but scoped to one realm and deployment:
 * GM storage is one store across live, pbe and pbe2, and mixed economies average into nonsense.
 */
function ledgerKey() {
  const realm = realmNow();
  if (realm === '') {
    return `${LEDGER_PREFIX}/${woc.game.channel}/${NO_REALM}`;
  }
  return `${LEDGER_PREFIX}/${woc.game.channel}/${realm}`;
}

/** A property on `net.state` rather than a call, read defensively like anything of the game's. */
function reconnectCount() {
  return numberOr(woc.net.state?.reconnects, 0);
}

/**
 * The grace ends on a timer: a still-away player sends no second change, so waiting for one would
 * say "resyncing" forever. The client refills in about 50 ms; a `near` cancels the timer.
 */
const RESYNC_GRACE_MS = 2 * MS_PER_SECOND;

function endGrace() {
  if (resyncing.on) {
    resyncing.on = false;
    live.status = 'away';
    schedulePaint();
  }
}

/**
 * The first `away` after a reconnect is the client force-nulling its own mirror, so the held page
 * stays and the pane says so. Any other `away` is taken at face value at once.
 */
function onAway() {
  const count = reconnectCount();
  if (count !== lastRead.reconnects) {
    lastRead.reconnects = count;
    resyncing.on = true;
    woc.setTimeout(endGrace, RESYNC_GRACE_MS);
    return;
  }
  resyncing.on = false;
  live.status = 'away';
  clearScan();
}

function onNear(info) {
  const now = woc.wallClock();
  lastRead.reconnects = reconnectCount();
  resyncing.on = false;
  const arriving = live.status !== 'near';
  live.status = 'near';
  if (arriving && dealsFirst()) {
    // On arriving only, or the next snapshot drags a player off Prices back to Deals.
    tabs.select('deals');
    showPane('deals');
  }
  const page = capture(info, now);
  live.page = page;
  if (loaded.on) {
    recordPage(page);
    recordSales(info, now);
  }
  // After the fold: `recordedAnchor` must exclude the visit just written.
  foldScan(page);
  // After the fold too, and only where the ledger was written, or the bus gets the previous figure.
  if (loaded.on) {
    publishPrices(page);
  }
  announceDeals(page);
  checkUndercut(page);
}

/**
 * One toast per crossing, so paging over one good listing is one announcement. Off by default: a
 * notifier that fires every page gets switched off.
 */
function announceDeals(page) {
  const over = announceOver();
  if (over <= 0) {
    return;
  }
  const fresh = dealsNow(page).filter((deal) => deal.profit >= over && !announced.has(deal.key));
  const [best] = fresh;
  if (best === undefined) {
    return;
  }
  for (const deal of fresh) {
    announced.add(deal.key);
  }
  const what = `${nameOf(best.row.itemId)} clears ${money(best.profit)}`;
  woc.ui.toast(`Ledgerline: ${what}, ${woc.fmt.count(fresh.length, 'deal')} on this page.`);
  if (announcingAloud()) {
    woc.sound.play('ui_coin');
  }
}

/** Off the raw payload: the queue must be read exactly once before it empties. */
function recordSales(info, now) {
  if (foldSales(info, now)) {
    trimSold(soldCutoff(now));
    keepSold();
  }
}

/** Drain whatever the Merchant is showing right now, where there is a page to read it off. */
function readSales() {
  const state = woc.world.market;
  if (loaded.on && state.status === 'near' && state.info !== null) {
    recordSales(state.info, woc.wallClock());
  }
}

/** Start over on the pending ledger: one that was collected, or one never read. */
function resetCycle() {
  cycle.read = 0;
  cycle.anchor = '';
}

/**
 * The one pending-ledger signal that arrives without a page. A fall means everything was
 * collected. The badge is not gated on proximity, so a collect is seen after walking off.
 */
function onCollectPending() {
  if (woc.world.marketCollectPending === true) {
    readSales();
  } else if (loaded.on && cycle.read > 0) {
    resetCycle();
    keepSold();
  }
  schedulePaint();
}

function recordPage(page) {
  // Both, never short-circuited: a page that moved must not skip the Sell answer.
  const pageMoved = foldPage(page);
  const sellMoved = foldSell(page);
  forget(overflowIds());
  if (pageMoved || sellMoved) {
    keep();
  }
  pruneOwn(page.at);
  if (foldOwn(page)) {
    keepOwn();
  }
}

/** Recording happens only on `near`. See the header. */
function onMarket() {
  const state = woc.world.market;
  if (state.status === 'near' && state.info !== null) {
    onNear(state.info);
  } else if (state.status === 'away') {
    onAway();
  } else {
    live.status = 'unknown';
  }
  schedulePaint();
}

/** One key and one read. See the header for why not a key per item. */
async function loadLedger() {
  const key = ledgerKey();
  const stored = await woc.storage.get(key, null);
  if (!running.on) {
    return;
  }
  loadedFor.ledger = key;
  const cutoff = cutoffAt(woc.wallClock());
  for (const [itemId, record] of parseLedger(stored)) {
    record.visits = prunedVisits(record.visits, cutoff);
    if (record.visits.length > 0) {
      record.at = record.visits.at(-1)?.at ?? 0;
      series.set(itemId, record);
    }
  }
  forget(overflowIds());
}

async function loadOwn() {
  const stored = await woc.storage.character.get(MINE_KEY, []);
  if (!(running.on && Array.isArray(stored))) {
    return;
  }
  for (const entry of stored) {
    const id = numberOr(entry?.id, 0);
    const at = numberOr(entry?.seen, 0);
    if (id > 0 && at > 0) {
      mineSeen.set(id, {
        price: numberOr(entry?.price, 0),
        count: numberOr(entry?.count, 1),
        seen: at,
      });
    }
  }
  pruneOwn(woc.wallClock());
}

/**
 * One value, since the two are only true together: without the position every uncollected sale
 * is counted again, and without the record the position skips rows it never kept.
 */
async function loadSold() {
  const stored = await woc.storage.character.get(SOLD_KEY, null);
  if (!(running.on && typeof stored === 'object' && stored !== null)) {
    return;
  }
  cycle.read = Math.max(0, Math.round(numberOr(stored.read, 0)));
  cycle.anchor = text(stored.anchor);
  cycle.lost = Math.max(0, Math.round(numberOr(stored.lost, 0)));
  for (const [itemId, record] of parseSold(stored.sales)) {
    sold.set(itemId, record);
  }
  trimSold(soldCutoff(woc.wallClock()));
}

/**
 * Waits for a character (the ledger is keyed on realm). `loaded` is set even on a failed read so
 * the panel still works, and recording waits for it, or a page folded into an empty ledger
 * overwrites one still being read.
 */
async function startLedger() {
  await Promise.all([
    loadLedger().catch((err) => {
      woc.warn('ledgerline: the stored ledger could not be read', err);
    }),
    loadOwn().catch((err) => {
      woc.warn('ledgerline: the stored listing stamps could not be read', err);
    }),
    loadSold().catch((err) => {
      woc.warn('ledgerline: the stored sale record could not be read', err);
    }),
  ]);
  if (!running.on) {
    return;
  }
  loaded.on = true;
  // The reconnect baseline, so a reconnect before this started earns no grace.
  lastRead.reconnects = reconnectCount();
  // A watch key's first sample notifies nobody, so read the state once for a player already there.
  onMarket();
  // `publish` announced at registration while this read was in flight, with nothing to say.
  // Without this, an early subscriber hears nothing until the next Merchant visit.
  pricePublication.announce();
  draw();
}

/**
 * The one way in, keyed on the character, since a switch can move realm or seller. Everything
 * held is dropped, never merged, and nothing is written on the way out.
 */
function characterChanged() {
  const character = text(woc.world.characterKey);
  if (character === '' || character === loadedFor.character) {
    return;
  }
  const first = loadedFor.character === '';
  loadedFor.character = character;
  if (!first) {
    loaded.on = false;
    loadedFor.ledger = '';
    series.clear();
    // Cleared with the series, or an unbrowsed item keeps the old realm's mark and is withheld.
    onBus.clear();
    mineSeen.clear();
    // The Merchant keeps a collection per seller, so none of this carries over.
    sold.clear();
    resetCycle();
    cycle.lost = 0;
    live.page = null;
    draw();
  }
  startLedger().catch((err) => {
    woc.warn('ledgerline: the stored ledger could not be started', err);
  });
}

/**
 * Draw as soon as there is a world; only recording waits for a character. Read by hand: a watch
 * key's first sample notifies nobody.
 */
async function begin() {
  await woc.world.ready;
  if (!running.on) {
    return;
  }
  onMarket();
  characterChanged();
}

function fills(el) {
  el.style.flex = '1 1 auto';
  el.style.minHeight = '0';
  return el;
}

function scrolls(el) {
  fills(el);
  el.style.overflowY = 'auto';
  el.style.overscrollBehavior = 'contain';
  return el;
}

/**
 * A child that must not be squeezed by the list. `ui.column`, `ui.row` and `ui.line` carry this in
 * their own class; a tab strip, a field and a rule do not.
 */
function fixed(el) {
  el.style.flexShrink = '0';
  return el;
}

function column(className) {
  return woc.ui.column({ className, gap: PANE_GAP });
}

/** An `hr` where the list stops, or the note under it reads as a row with no price. */
function rule(parent) {
  const el = document.createElement('hr');
  el.className = 'woc-ledgerline-rule';
  el.style.border = 'none';
  el.style.borderTop = '1px solid var(--color-border-default, rgb(78 61 29))';
  el.style.opacity = '0.55';
  el.style.margin = '0';
  el.style.width = '100%';
  fixed(el);
  parent.appendChild(el);
  return el;
}

/** A sentence the pane says on its own line. */
function line(parent, role) {
  const el = woc.ui.line({ parent, className: 'woc-ledgerline-line' });
  el.dataset.role = role;
  return el;
}

function say(el, said) {
  woc.ui.show(el, said !== '');
  el.textContent = said;
}

/** The status strip: short labelled figures on one line, wrapping onto a second. */
function strip(parent, role) {
  const el = woc.ui.row({
    parent,
    className: 'woc-ledgerline-strip',
    wrap: true,
    align: 'baseline',
    // Two gaps (`wrapGap` is the vertical one), or a wrapped strip reads as two strips.
    gap: STRIP_GAP,
    wrapGap: STRIP_WRAP_GAP,
  });
  el.dataset.role = role;
  return el;
}

/** One labelled figure, hidden until it has something to say. */
function stat(parent, role, label) {
  const el = woc.ui.row({
    parent,
    className: 'woc-ledgerline-stat',
    align: 'baseline',
    gap: STAT_GAP,
  });
  el.dataset.role = role;
  el.style.whiteSpace = 'nowrap';
  const name = document.createElement('span');
  name.className = 'woc-ledgerline-stat-label';
  name.textContent = label;
  name.style.opacity = '0.55';
  name.style.fontSize = '11px';
  name.style.textTransform = 'uppercase';
  const figure = document.createElement('span');
  figure.className = 'woc-ledgerline-stat-value';
  figure.style.fontVariantNumeric = 'tabular-nums';
  el.append(name, figure);
  woc.ui.show(el, false);
  return { el, figure };
}

function setStat(chip, value) {
  woc.ui.show(chip.el, value !== '');
  chip.figure.textContent = value;
}

/**
 * Compact: a table of figures glanced at beside the Merchant window. Kit controls follow the
 * density.
 */
const frame = woc.ui.frame({
  id: 'ledger',
  title: 'Ledgerline',
  toggleKey: 'toggle',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'compact',
  closable: true,
  save: true,
  resizable: true,
  minWidth: MIN_WIDTH,
  minHeight: CHROME_HEIGHT + ROW_HEIGHT,
});

frame.body.style.display = 'flex';
frame.body.style.flexDirection = 'column';
frame.body.style.gap = '6px';
frame.body.style.minHeight = '0';
// A resizable frame's body must grow, or the height the player dragged out is dead space.
frame.body.style.flex = '1 1 auto';

const panes = new Map([
  ['deals', fills(column('woc-ledgerline-pane'))],
  ['prices', fills(column('woc-ledgerline-pane'))],
  ['mine', fills(column('woc-ledgerline-pane'))],
  ['sold', fills(column('woc-ledgerline-pane'))],
]);
for (const [name, pane] of panes) {
  pane.dataset.pane = name;
}

function showPane(active) {
  for (const [name, pane] of panes) {
    woc.ui.show(pane, name === active);
  }
}

const tabs = woc.ui.tabs({
  tabs: [
    // First, and the default at the counter: the only pane that says what to do.
    { id: 'deals', label: 'Deals' },
    { id: 'prices', label: 'Prices' },
    { id: 'mine', label: 'Yours' },
    // What was paid, a separate series from what is asked.
    { id: 'sold', label: 'Sold' },
  ],
  onSelect: (id) => {
    showPane(id);
    schedulePaint();
  },
});
fixed(tabs.el);
frame.body.appendChild(tabs.el);

/**
 * The shared strip above the panes: state, how much of the seller's cap is spent, and what waits
 * to be collected. The page number and cut are in the strip's tooltip; the game's own window shows
 * the page, and the cut rarely changes.
 */
const statusStrip = strip(frame.body, 'status');
const whereStat = stat(statusStrip, 'where', 'At');
const capStat = stat(statusStrip, 'cap', 'Listings');
const collectStat = stat(statusStrip, 'collect', 'Waiting');
const statusLine = line(frame.body, 'status-line');
/**
 * What the Sell tab was told, shown only while something is staged. Above the panes: it is about
 * what the player is doing now, the one moment this addon can speak to selling.
 */
const sellLine = line(frame.body, 'sell-line');
woc.ui.tooltip(sellLine, () => sellTip());
// The page number and the cut.
woc.ui.tooltip(statusStrip, () => stripTip());

for (const pane of panes.values()) {
  frame.body.appendChild(pane);
}

const searchField = woc.ui.field.text({
  label: 'Find an item',
  value: '',
  placeholder: 'part of a name or an id',
  onChange: (value) => {
    search.text = value;
    schedulePaint();
  },
});
fixed(searchField.el);
panes.get('prices')?.appendChild(searchField.el);

const dealTop = rule(panes.get('deals'));
const dealList = scrolls(column('woc-ledgerline-list'));
dealList.dataset.list = 'deals';
panes.get('deals')?.appendChild(dealList);
rule(panes.get('deals'));
const dealNote = line(panes.get('deals'), 'deals-note');

/**
 * The whole ledger as a file, with query strings interned: they repeat on every visit, and
 * interning cuts a full export by about a third. A digest is not an option, since it cannot merge.
 */
function exportedLedger() {
  const queries = [];
  const items = {};
  for (const [itemId, record] of series) {
    items[itemId] = record.visits.map((visit) => internedVisit(visit, queries));
  }
  return { queries, items };
}

/** One visit, with its query replaced by an index into the table being built beside it. */
function internedVisit(visit, queries) {
  return [
    Math.round(visit.at / MS_PER_SECOND),
    visit.low,
    visit.high,
    queryIndex(visit.query, queries),
    Math.round(visit.first / MS_PER_SECOND),
  ];
}

/** Where this query sits in the table, adding it if this is the first visit to carry it. */
function queryIndex(query, queries) {
  const at = queries.indexOf(query);
  if (at >= 0) {
    return at;
  }
  return queries.push(query) - 1;
}

/** The sale record as a file section, per character where the ledger is per realm. */
function exportedSold() {
  const items = {};
  for (const [itemId, record] of sold) {
    items[itemId] = record.sales.map(storedSale);
  }
  return items;
}

/**
 * Everything this addon would hand another device, plus the facts that say whose it is. Channel
 * and realm gate the merge, since mixing content across them is undetectable corruption. The
 * character gates only the sale half.
 */
function exportedFile() {
  return {
    file: FILE_PREFIX,
    v: FILE_VERSION,
    channel: woc.game.channel,
    realm: realmNow(),
    character: text(woc.world.characterKey),
    device: install.id,
    at: Math.round(woc.wallClock() / MS_PER_SECOND),
    ledger: exportedLedger(),
    sold: exportedSold(),
  };
}

/** One interned visit back into the shape the store and the merge both use. */
function importedVisit(value, queries) {
  if (!Array.isArray(value)) {
    return null;
  }
  const query = queries[Math.round(numberOr(value[3], -1))] ?? '';
  return parseVisit([value[0], value[1], value[2], query, value[4]]);
}

/** The ledger half of a file, as records, dropping anything that is not one. */
function importedLedger(payload) {
  const held = new Map();
  const queries = readQueries(payload);
  const items = readField(payload, 'items');
  if (typeof items !== 'object' || items === null) {
    return held;
  }
  for (const [itemId, rows] of Object.entries(items)) {
    const record = importedSeries(itemId, rows, queries);
    if (record !== null) {
      held.set(itemId, record);
    }
  }
  return held;
}

function readField(payload, name) {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  return payload[name];
}

function readQueries(payload) {
  const table = readField(payload, 'queries');
  if (!Array.isArray(table)) {
    return [];
  }
  return table.map(text);
}

function importedSeries(itemId, rows, queries) {
  if (itemId === '' || !Array.isArray(rows)) {
    return null;
  }
  const record = emptySeries(itemId);
  for (const row of rows) {
    const visit = importedVisit(row, queries);
    if (visit !== null) {
      record.visits.push(visit);
    }
  }
  if (record.visits.length === 0) {
    return null;
  }
  return record;
}

/** Why this file cannot be merged, or null. Every refusal names both sides. */
function refusal(payload) {
  if (readField(payload, 'file') !== FILE_PREFIX) {
    return 'that is not a Ledgerline export.';
  }
  if (readField(payload, 'v') !== FILE_VERSION) {
    return `that file is version ${text(String(readField(payload, 'v')))} and this build reads ${String(FILE_VERSION)}.`;
  }
  const channel = text(readField(payload, 'channel'));
  if (channel !== woc.game.channel) {
    return `that file is from ${channel || 'nowhere'} and you are on ${woc.game.channel}, which serves different content.`;
  }
  const realm = text(readField(payload, 'realm'));
  if (realm !== realmNow()) {
    return `that file is from ${realm || 'no realm'} and you are on ${realmNow() || 'no realm'}. A market is per realm.`;
  }
  return null;
}

/** A name a player can tell two of these apart by, in a folder, months later. */
function fileName() {
  const realm = realmNow() || NO_REALM;
  const day = new Date(woc.wallClock()).toISOString().slice(0, DATE_LENGTH);
  return `${FILE_PREFIX}-${woc.game.channel}-${realm}-${day}.json`;
}

/** Write the file out as a download: a third of a megabyte is unusable as a paste. */
function exportLedger() {
  const written = JSON.stringify(exportedFile());
  const url = URL.createObjectURL(new Blob([written], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName();
  link.click();
  URL.revokeObjectURL(url);
  const size = `${String(Math.round(written.length / BYTES_PER_KB))} kB`;
  woc.ui.toast(`Ledgerline: wrote ${woc.fmt.count(series.size, 'item')}, ${size}.`);
}

/**
 * Ask for a file and merge it. The input is rebuilt per press: a kept one fires no `change` when
 * the same file is picked twice.
 */
function askForFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file !== undefined) {
      readFile(file).catch((err) => {
        woc.warn('ledgerline: that file could not be read', err);
        woc.ui.toast('Ledgerline: that file could not be read.', { kind: 'error' });
      });
    }
  });
  input.click();
}

async function readFile(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    woc.ui.toast(`Ledgerline: that file is over ${String(MAX_IMPORT_MB)} MB.`, { kind: 'error' });
    return;
  }
  const payload = JSON.parse(await file.text());
  if (running.on) {
    importFile(payload);
  }
}

/** Merge a file, or say why not. Only unseen readings are added; nothing is replaced. */
function importFile(payload) {
  const refused = refusal(payload);
  if (refused !== null) {
    woc.ui.toast(`Ledgerline: ${refused}`, { kind: 'error' });
    return;
  }
  if (!loaded.on) {
    woc.ui.toast('Ledgerline: the stored ledger is still being read.', { kind: 'warn' });
    return;
  }
  const now = woc.wallClock();
  const read = mergeLedger(importedLedger(readField(payload, 'ledger')), cutoffAt(now));
  const sales = mergeSoldFrom(payload, now);
  keep();
  schedulePaint();
  woc.ui.toast(`Ledgerline: ${importReport(read, sales)}`);
}

/** The sale half, gated on the character where the ledger is gated on the realm. */
function mergeSoldFrom(payload, now) {
  if (text(readField(payload, 'character')) !== text(woc.world.characterKey)) {
    return null;
  }
  const added = mergeSold(parseSold(readField(payload, 'sold')));
  if (added > 0) {
    trimSold(soldCutoff(now));
    keepSold();
  }
  return added;
}

/** What the import did, in the words a player needs to decide whether it worked. */
function importReport(read, sales) {
  const parts = [addedText(read)];
  if (read.repeated > 0) {
    parts.push(`${String(read.repeated)} already known`);
  }
  if (sales === null) {
    parts.push('sales left alone, they belong to another character');
  } else if (sales > 0) {
    parts.push(`${woc.fmt.count(sales, 'sale')} of your own`);
  }
  return `${parts.join(', ')}.`;
}

function addedText(read) {
  if (read.added === 0) {
    return 'nothing new to add';
  }
  const items = woc.fmt.count(read.items, 'item');
  return `added ${woc.fmt.count(read.added, 'reading')} across ${items}`;
}

/**
 * The export and import buttons. Not a menu: `ui.menu` runs its handler after closing, outside
 * the user gesture a file input requires.
 */
function controlRow(parent) {
  const row = woc.ui.row({ parent, className: 'woc-ledgerline-controls', gap: STAT_GAP });
  row.dataset.role = 'transfer';
  return row;
}

function button(parent, label, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'woc-btn';
  el.textContent = label;
  el.dataset.action = label.toLowerCase();
  el.addEventListener('click', onClick);
  parent.appendChild(el);
  return el;
}

const priceTop = rule(panes.get('prices'));
const priceList = scrolls(column('woc-ledgerline-list'));
priceList.dataset.list = 'prices';
panes.get('prices')?.appendChild(priceList);
rule(panes.get('prices'));
const priceNote = line(panes.get('prices'), 'prices-note');
const transferRow = controlRow(panes.get('prices'));
button(transferRow, 'Export', () => {
  exportLedger();
});
button(transferRow, 'Import', () => {
  askForFile();
});

const mineTop = rule(panes.get('mine'));
const mineList = scrolls(column('woc-ledgerline-list'));
mineList.dataset.list = 'mine';
panes.get('mine')?.appendChild(mineList);
rule(panes.get('mine'));
const mineNote = line(panes.get('mine'), 'mine-note');

const soldTop = rule(panes.get('sold'));
const soldList = scrolls(column('woc-ledgerline-list'));
soldList.dataset.list = 'sold';
panes.get('sold')?.appendChild(soldList);
rule(panes.get('sold'));
const soldNote = line(panes.get('sold'), 'sold-note');

showPane(tabs.active());

/** The three lists by name, and what is on screen in each. */
const lists = new Map([
  ['deals', dealList],
  ['prices', priceList],
  ['mine', mineList],
  ['sold', soldList],
]);
/** Drawn only where there are rows, or an empty pane puts two rules together. */
const listTops = new Map([
  ['deals', dealTop],
  ['prices', priceTop],
  ['mine', mineTop],
  ['sold', soldTop],
]);
/**
 * One list per pane, since the loader orders a list within one parent. The tooltip is bound per
 * list, so a reused row keeps its hover.
 */
function rowsIn(list, tip) {
  return woc.ui.list({
    parent: list,
    key: (entry) => entry.key,
    create: (entry) => buildRow(entry.key, tip),
    update: (row, entry) => {
      row.update(entry.update);
    },
  });
}

const listRows = new Map([
  ['deals', rowsIn(dealList, dealTip)],
  ['prices', rowsIn(priceList, priceTip)],
  ['mine', rowsIn(mineList, mineTip)],
  ['sold', rowsIn(soldList, soldTip)],
]);

/** One bar and nothing around it: position against the item's own record is its `fraction`. */
function buildRow(key, tip) {
  const bar = woc.ui.bar({ className: 'woc-ledgerline-bar' });
  bar.el.dataset.row = key;
  woc.ui.tooltip(bar.el, () => tip(key));
  return bar;
}

/** An empty list takes no room, or it pushes the empty-state sentence to the bottom edge. */
function growWhen(list, filled) {
  list.style.flex = '0 1 auto';
  if (filled) {
    list.style.flex = '1 1 auto';
  }
}

/** Sync one pane's list, plus whether the list grows and whether its opening rule is drawn. */
function syncList(name, entries) {
  const list = lists.get(name) ?? priceList;
  const filled = entries.length > 0;
  growWhen(list, filled);
  const top = listTops.get(name);
  if (top !== undefined) {
    woc.ui.show(top, filled);
  }
  listRows.get(name)?.sync(entries);
}

/** The ledger, narrowed by the search field and ordered by what was seen last. */
function ledgerRows() {
  const needle = search.text.trim().toLowerCase();
  const matching = [...series.values()].filter((record) => matches(record, needle));
  matching.sort((a, b) => b.at - a.at);
  return matching;
}

function matches(record, needle) {
  if (needle === '') {
    return true;
  }
  return `${record.itemId} ${nameOf(record.itemId)}`.toLowerCase().includes(needle);
}

function priceEntry(record) {
  const stats = statsFor(record);
  return {
    key: record.itemId,
    update: {
      label: nameOf(record.itemId),
      icon: woc.ui.icon.item(record.itemId),
      quality: qualityOf(record.itemId),
      // No fill: one item's price is not a share of another's, and a position within its own
      // range is the same half fill on nearly every row, since market prices barely move.
      // Labelled, since a bare figure would read as the current price.
      value: { copper: Math.round(stats.low), prefix: 'low' },
      detail: `median ${money(Math.round(stats.median))}, ${woc.fmt.count(stats.visits, 'visit')}, ${briefAgo(stats.at)}`,
    },
  };
}

/** A warning about where a name came from, or null where it is trustworthy (nearly always). */
function nameNote(itemId) {
  if (known(itemId) !== null) {
    return null;
  }
  if (artName(itemId) !== null) {
    return {
      text: 'Named from its art file, which is not always what the game calls it.',
      tone: 'muted',
    };
  }
  return { text: 'No addon has published a name for this id.', tone: 'muted' };
}

/** Null for the ordinary case. Readings from several searches cover different parts of the book. */
function queryNote(stats) {
  if (stats.queries <= 1) {
    return null;
  }
  return {
    text: `Read under ${String(stats.queries)} different searches, which cover different parts of the book.`,
    tone: 'warn',
  };
}

/** The one place asks and sales meet: a labelled sentence, never a blended figure. */
function paidLine(itemId) {
  const record = sold.get(itemId);
  if (record === undefined) {
    return null;
  }
  const stats = soldStats(record);
  return {
    text: `You sold ${woc.fmt.count(stats.sales, 'sale')} at a median of ${money(Math.round(stats.median))} each, which is what was PAID rather than asked.`,
    tone: 'muted',
  };
}

/**
 * What this item has been going for, in one line. In a thin book the low, median and latest are
 * usually one number, so an unchanged price is said once. The dearest ask is never shown: nobody
 * buys at it.
 */
function priceLine(record, stats) {
  const lows = record.visits.map((visit) => visit.low);
  const seen = `over ${woc.fmt.count(stats.visits, 'visit')}, read ${agoText(stats.at)}`;
  if (stats.visits < THIN_EVIDENCE) {
    // "Unchanged" needs two readings to be a claim. One is just the price.
    return `${money(Math.round(stats.low))} each, ${seen}.`;
  }
  if (Math.min(...lows) === Math.max(...lows)) {
    return `${money(Math.round(stats.low))} each, unchanged ${seen}.`;
  }
  const range = `Low ${money(Math.round(stats.low))} each, median ${money(Math.round(stats.median))}`;
  return `${range}, latest ${money(Math.round(stats.latest))}, ${seen}.`;
}

function priceTip(itemId) {
  const record = series.get(itemId);
  if (record === undefined) {
    return { title: itemId, lines: ['This item is no longer in the ledger.'] };
  }
  const stats = statsFor(record);
  const lines = [priceLine(record, stats), queryNote(stats), paidLine(itemId), nameNote(itemId)];
  return { title: nameOf(itemId), icon: woc.ui.icon.item(itemId), lines: spoken(lines) };
}

/** What each signal anchored on, in tooltip words. The row's one-token form is `evidenceWord`. */
const ANCHOR_WORD = new Map([
  ['vendor', 'vendor pays'],
  ['page', 'next ask'],
  ['history', 'your median'],
]);

/**
 * What stands behind a row's figure, as a count: a grade like "thin" would be on almost every row.
 */
function evidenceWord(deal) {
  if (deal.signal === 'vendor') {
    return 'vendor floor';
  }
  if (deal.signal === 'page') {
    return woc.fmt.count(deal.evidence, 'rival');
  }
  return woc.fmt.count(deal.evidence, 'visit');
}

/**
 * The item's name plus what kind of copy it is, on the label: otherwise two same-named rows at
 * different prices read as a market disagreeing with itself.
 */
function markedName(row) {
  const name = nameOf(row.itemId);
  if (row.mark === '') {
    return name;
  }
  return `${name} (${row.mark})`;
}

/** How many of an item a row is, where saying so adds anything. */
function stackLabel(row) {
  if (row.count <= 1) {
    return markedName(row);
  }
  return `${markedName(row)} x${String(row.count)}`;
}

/**
 * The stack's cost and what the figure rests on, as a fixed-shape clause so rows compare by
 * position. The resale price is left to the tooltip: profit and cost are the decision.
 */
function dealDetail(deal) {
  const said = `buy ${money(deal.row.price)}, ${evidenceWord(deal)}`;
  if (deal.stack) {
    return `${said}, stack priced as one`;
  }
  return said;
}

/** The fill is profit against the best on screen, so the ranking reads off the widths. */
function dealEntry(deal, best) {
  return {
    key: deal.key,
    update: {
      label: stackLabel(deal.row),
      icon: woc.ui.icon.item(deal.row.itemId),
      quality: qualityOf(deal.row.itemId),
      fraction: shareOf(deal.profit, best),
      value: { copper: deal.profit, prefix: 'clears' },
      detail: dealDetail(deal),
    },
  };
}

/** A row's profit against the best on screen, or zero with no rows. */
function shareOf(profit, best) {
  if (best <= 0) {
    return 0;
  }
  return profit / best;
}

/** A tier somebody published, or null. Nothing in the loader knows what tier an item is. */
function qualityOf(itemId) {
  const quality = known(itemId)?.quality ?? '';
  if (quality === '') {
    return null;
  }
  return quality;
}

/** Which game the floor table was read from: a stale table keeps answering old prices silently. */
function floorVersion() {
  if (floorsFrom.version === '') {
    return 'an unnamed version';
  }
  return floorsFrom.version;
}

/** Where the anchor came from, at length, which the row's clause cannot carry. */
function anchorLines(deal) {
  if (deal.signal === 'vendor') {
    return [
      { text: 'A vendor pays that flatly, so this profit is not an estimate.', tone: 'good' },
      { text: `Floor read from game ${floorVersion()}.`, tone: 'muted' },
    ];
  }
  if (deal.signal === 'page') {
    if (deal.againstMine) {
      // The most useful thing to say about a thin item: the cheapest rival is the player's own
      // listing.
      return [
        { text: 'The cheapest competing listing is YOUR OWN.', tone: 'warn' },
        { text: 'Cancelling it would leave the next ask above this figure.', tone: 'muted' },
      ];
    }
    return [{ text: 'It sells only if nobody undercuts you first.', tone: 'warn' }];
  }
  return [
    { text: 'The median of your earlier visits, this one left out.', tone: 'muted' },
    { text: 'A recorded price is what was asked, not what anybody paid.', tone: 'warn' },
  ];
}

/** The guarantee, where there is one under an estimate that is worth more. */
function guaranteeLine(deal) {
  if (deal.guaranteed <= 0 || deal.signal === 'vendor') {
    return [];
  }
  return [
    {
      text: `A vendor would take it for ${money(deal.guaranteed)} clear, so this cannot lose.`,
      tone: 'good',
    },
  ];
}

function dealTip(key) {
  const deal = shown.deals.get(key);
  if (deal === undefined) {
    return { title: 'Gone', lines: ['That listing is no longer in this reading.'] };
  }
  const { row } = deal;
  const anchor = ANCHOR_WORD.get(deal.signal) ?? deal.signal;
  return {
    title: stackLabel(row),
    icon: woc.ui.icon.item(row.itemId),
    lines: [
      `${money(Math.round(row.unit))} each here, ${anchor} ${money(Math.round(deal.unit))}.`,
      `${money(row.price)} the stack, from ${sellerOf(row)}, seen ${agoText(row.lastSeen)}.`,
      ...anchorLines(deal),
      ...guaranteeLine(deal),
    ],
  };
}

/** Who is asking. A blank name means the wire sent none, not an anonymous seller. */
function sellerOf(row) {
  if (row.seller === '') {
    return 'a seller the page did not name';
  }
  return row.seller;
}

/** The honest limit on every figure in this pane, said once. */
function coverageText() {
  const seen = coverageNow();
  if (seen.read === 0) {
    return 'Nothing has been read at this counter yet.';
  }
  const pages = `${String(seen.read)} of ${String(seen.total)} pages`;
  const searches = woc.fmt.count(seen.queries, 'search');
  return `${pages} read over ${searches}, so not the whole book.`;
}

function dealsNoteText(count) {
  if (live.status !== 'near') {
    return 'Deals are found while you are standing at the Merchant. Walk up to one and page through the book.';
  }
  // Before the empty case: collapsed, there is no second-cheapest to judge against, and only this
  // sentence tells a scan with nothing to compare from a scan that found nothing.
  if (live.page?.collapsed === true) {
    return `With ${COLLAPSE_LABEL} on, every row is one item's floor, so nothing here has a cheaper rival to be judged against. Your own history and the vendor floor still do. ${coverageText()}`;
  }
  if (count === 0) {
    return `Nothing on what you have read clears ${money(minProfit())}. ${coverageText()}`;
  }
  return coverageText();
}

/** Nothing away from the counter: a deal must be a listing the player can still buy. */
function dealsShowing() {
  const { page } = live;
  if (page === null || live.status !== 'near') {
    return [];
  }
  return dealsNow(page);
}

/** The list and its sentence, ranked by what a stack clears, never by discount depth. */
function paintDeals() {
  const found = dealsShowing();
  shown.deals = new Map(found.map((deal) => [deal.key, deal]));
  const best = found[0]?.profit ?? 0;
  syncList(
    'deals',
    found.slice(0, MAX_ROWS).map((deal) => dealEntry(deal, best)),
  );
  say(dealNote, dealsNoteText(found.length));
}

function pricesNoteText(matching) {
  if (!loaded.on) {
    return 'Reading the stored ledger.';
  }
  if (series.size === 0) {
    return 'Nothing recorded yet. Every page you read at a Merchant is written down here; the market itself keeps no history at all.';
  }
  const held = `${woc.fmt.count(series.size, 'item')} recorded, keeping ${String(historyDays())} days.`;
  if (matching > MAX_ROWS) {
    return `${String(MAX_ROWS)} of ${String(matching)} matching shown. ${held} Narrow it above.`;
  }
  return held;
}

/** The list and its sentence from one reading of the ledger, passed down rather than re-queried. */
function paintPrices() {
  const matching = ledgerRows();
  syncList('prices', matching.slice(0, MAX_ROWS).map(priceEntry));
  say(priceNote, pricesNoteText(matching.length));
}

const VERDICT_TEXT = new Map([
  ['cheapest', 'cheapest on this page'],
  ['undercut', 'undercut'],
  ['partial', 'may be undercut'],
  ['unknown', 'not on this page'],
  ['copy', 'its own good, not the plain item'],
  ['floor', 'cheapest anywhere'],
]);

const VERDICT_TONE = new Map([
  ['cheapest', 'default'],
  ['undercut', 'danger'],
  ['partial', 'warn'],
  ['unknown', 'default'],
  ['copy', 'default'],
  ['floor', 'default'],
]);

/** A whole row of tone, or none at all. Never anything between: see `ownEntry`. */
function washFor(tone) {
  if (tone === 'default') {
    return 0;
  }
  return 1;
}

/** The stack, the unit price and the verdict. The first-seen stamp belongs in the tooltip. */
function ownDetail(row, verdict) {
  const said = `${String(row.count)} at ${money(Math.round(row.unit))} each`;
  const verdictText = VERDICT_TEXT.get(verdict.state) ?? '';
  if (verdictText === '') {
    return said;
  }
  return `${said}, ${verdictText}`;
}

function ownEntry(row, page) {
  const verdict = verdictFor(row, page);
  const tone = VERDICT_TONE.get(verdict.state) ?? 'default';
  return {
    key: String(row.id),
    update: {
      label: markedName(row),
      icon: woc.ui.icon.item(row.itemId),
      quality: qualityOf(row.itemId),
      value: { copper: row.price, prefix: 'asking' },
      tone,
      // A wash: the kit paints tone only on the fill, so a toned row needs one. One width reads as
      // none.
      fraction: washFor(tone),
      detail: ownDetail(row, verdict),
    },
  };
}

/** What the Merchant keeps of a sale, read off the page rather than written down. */
function netLine(row, page) {
  const kept = row.price * (page.cutPct / PERCENT);
  return `Sells for ${money(row.price)}, nets ${money(row.price - kept)} after the ${String(page.cutPct)}% cut.`;
}

function rivalLine(verdict) {
  const { rival } = verdict;
  if (rival === null) {
    return {
      text: 'No listing of this item is on the page you read, which under a search is most of the book. That is not evidence that nobody else is selling it.',
      tone: 'muted',
    };
  }
  return `Cheapest competing listing: ${money(rival.price)} for ${String(rival.count)}, by ${rival.seller}.`;
}

/** Why a verdict is uncertain, which is a different sentence under each browse order. */
function partialText(page) {
  if (page.byPrice) {
    return 'This page is sorted cheapest first, which spreads an item across the whole book, so a cheaper listing of it may be on any page before this one. Read page 1 to be sure.';
  }
  return 'This item is the first row of the page, so its cheaper listings may be on the page before this one. Read page 1 to be sure.';
}

function verdictLine(verdict, page) {
  if (verdict.state === 'partial') {
    return { text: partialText(page), tone: 'warn' };
  }
  // Undercut and cheapest are already on the row (word and wash); the tooltip does not repeat them.
  return null;
}

/** Reads the page live now: a tooltip outlives its row's reading, so a captured page goes stale. */
function mineTip(id) {
  const { page } = live;
  if (page === null) {
    return { title: 'Listing', lines: ['This listing is no longer on the page that was read.'] };
  }
  return ownTip(page, id);
}

function ownTip(page, id) {
  const row = page.mine.find((entry) => String(entry.id) === id);
  if (row === undefined) {
    return { title: 'Listing', lines: ['This listing is no longer on the page that was read.'] };
  }
  const verdict = verdictFor(row, page);
  return {
    title: nameOf(row.itemId),
    icon: woc.ui.icon.item(row.itemId),
    lines: spoken([
      netLine(row, page),
      rivalLine(verdict),
      verdictLine(verdict, page),
      {
        text: `First seen by you ${agoText(firstSeen(row))}, by this addon's own reckoning.`,
        tone: 'muted',
      },
    ]),
  };
}

/**
 * What a collapsed page can say about the player's own listings. Checked before the empty case in
 * `mineNoteText`: all-undercut empties the pane, which must not read as having no listings.
 */
function collapsedMineNote(page) {
  if (page.filtered) {
    return `With ${COLLAPSE_LABEL} on and a filter narrowing the page, the listings of yours that were undercut cannot be counted: nothing here separates them from the ones the filter left out.`;
  }
  const missing = collapsedUndercut(page);
  if (missing === 0) {
    return `With ${COLLAPSE_LABEL} on, every listing of yours is here, so nobody has undercut any of them.`;
  }
  return `With ${COLLAPSE_LABEL} on, ${woc.fmt.count(missing, 'listing')} of yours dropped off the page, each of them behind something cheaper.`;
}

function mineNoteText() {
  if (live.page === null) {
    return 'Walk up to a Merchant and your listings are read from the page it sends.';
  }
  if (live.page.collapsed) {
    return collapsedMineNote(live.page);
  }
  if (live.page.mine.length === 0) {
    return 'You had no listings at the Merchant when this page was read.';
  }
  if (live.status === 'near') {
    // The one thing no figure can say: what a verdict is drawn from and therefore cannot see.
    return 'Judged from this page alone, not the whole market.';
  }
  return `Read ${agoText(live.page.at)}. Everyone's listings may have moved since.`;
}

/**
 * The headline is gross per item, comparable with the asks on Prices. The net is labelled on the
 * detail line: summing the wrong one overstates by the cut.
 */
function soldEntry(record, best) {
  const stats = soldStats(record);
  return {
    key: record.itemId,
    update: {
      label: nameOf(record.itemId),
      icon: woc.ui.icon.item(record.itemId),
      quality: qualityOf(record.itemId),
      fraction: shareOf(stats.net, best),
      value: { copper: Math.round(stats.median), prefix: 'paid' },
      // "2 sales, 40 sold": two adjacent counts must say what each counts.
      detail: `${woc.fmt.count(stats.sales, 'sale')}, ${String(stats.items)} sold, ${money(stats.net)} net`,
    },
  };
}

function soldTip(itemId) {
  const record = sold.get(itemId);
  if (record === undefined) {
    return { title: itemId, lines: ['Nothing of this item is in the sale record.'] };
  }
  const stats = soldStats(record);
  return {
    title: nameOf(itemId),
    icon: woc.ui.icon.item(itemId),
    lines: spoken([
      `Paid ${money(Math.round(stats.low))} to ${money(Math.round(stats.high))} each, over ${woc.fmt.count(stats.sales, 'sale')}.`,
      `${String(stats.items)} sold for ${money(stats.gross)}, ${money(stats.net)} after the cut.`,
      {
        // Stamp and caveat together: the pending ledger has no clock, so this is drain time.
        text: `Read ${agoText(stats.at)}, which is when this drained it rather than when it sold.`,
        tone: 'muted',
      },
      nameNote(itemId),
    ]),
  };
}

/**
 * The gap in the record: what the Merchant's fifty-row cap dropped plus what got past between
 * readings. Silence would present a short list as complete.
 */
function missingText() {
  if (cycle.lost <= 0) {
    return '';
  }
  return ` At least ${woc.fmt.count(cycle.lost, 'sale')} of yours went before this could read them, so what is here does not add up to what you have earned.`;
}

function soldNoteText() {
  const missing = missingText();
  if (!loaded.on) {
    return 'Reading the stored sale record.';
  }
  if (sold.size === 0) {
    return `Nothing recorded yet. The Merchant itemizes your completed sales while their gold waits to be collected, and this copies each one down before you collect it.${missing}`;
  }
  // "Your own", said once here: the market keeps no record of anyone else's sales.
  return `${woc.fmt.count(sold.size, 'item')} of your own sales, keeping ${String(historyDays())} days.${missing}`;
}

function paintSold() {
  const records = [...sold.values()].sort((a, b) => b.at - a.at);
  const drawn = records.slice(0, MAX_ROWS);
  // Share of the biggest earner, not the newest, so the fill says which item actually pays.
  const best = drawn.reduce((top, record) => Math.max(top, soldStats(record).net), 0);
  syncList(
    'sold',
    drawn.map((record) => soldEntry(record, best)),
  );
  say(soldNote, soldNoteText());
}

function paintMine() {
  const { page } = live;
  if (page === null) {
    syncList('mine', []);
    say(mineNote, mineNoteText());
    return;
  }
  syncList(
    'mine',
    page.mine.map((row) => ownEntry(row, page)),
  );
  say(mineNote, mineNoteText());
}

/** Where the player is standing, which is never presented as an empty market. */
function whereText() {
  if (resyncing.on) {
    return 'resyncing';
  }
  if (live.status === 'near') {
    return 'the Merchant';
  }
  if (live.status === 'away') {
    return 'no counter';
  }
  return 'unknown';
}

/** What the strip says when there is no page at all, so a chip is simply not drawn. */
const NO_FIGURE = '';

/**
 * Drawn only where the figures could be misread. A fresh join resets the server-side query while
 * the window's controls still show it, so a filtered book can look whole.
 */
function statusText() {
  if (resyncing.on) {
    return 'The client cleared its own copy of the market, which it does for one snapshot after a reconnect. The page below is the last one read and is not being thrown away.';
  }
  if (live.status === 'unknown') {
    return 'Nothing has been read yet. The Merchant sends a page only while you are standing at one.';
  }
  if (live.status === 'away' && live.page === null) {
    return 'You are not at a Merchant, so there is no page to read. That is not an empty market.';
  }
  if (live.status === 'away') {
    return `You are not at a Merchant. Everything below is the page read ${agoText(live.page.at)}.`;
  }
  if (live.page === null || live.page.queryText === NO_QUERY) {
    return '';
  }
  // Only a filter narrows the match. A sort or the collapse only rearranges it, which is still
  // said, but calling it a search would claim a limit the player did not set.
  if (!live.page.filtered) {
    return `Reading the book, ${live.page.queryText}.`;
  }
  return `Searching ${live.page.queryText}: part of the book, not all of it.`;
}

function pageText(page) {
  if (page === null || page.pageCount <= 0) {
    return NO_FIGURE;
  }
  return `${String(page.page + 1)} / ${String(page.pageCount)}`;
}

function cutText(page) {
  if (page === null) {
    return NO_FIGURE;
  }
  return `${String(page.cutPct)}%`;
}

function capText(page) {
  if (page === null) {
    return NO_FIGURE;
  }
  return `${String(page.myListingCount)} / ${String(page.maxListings)}`;
}

/**
 * The flag is not gated on proximity but the amount is, so away from the counter this says only
 * what the last page said, or `something` with no page.
 */
function collectText(page) {
  if (woc.world.marketCollectPending !== true) {
    return NO_FIGURE;
  }
  if (page === null) {
    return 'something';
  }
  return `${money(page.collectionCopper)}, ${woc.fmt.count(page.collectionItems, 'item')}`;
}

/**
 * The per-unit ask to put under the floor, or why not. One copper under is safe: the server
 * rounds the floor's per-unit division up. Do not add an upper clamp: a listing's total cannot
 * exceed the Merchant's ceiling, so neither can a per-unit floor read off one.
 */
function askAdvice(staged, page) {
  const floor = staged.unit;
  if (floor === null) {
    return { kind: 'none' };
  }
  if (ownsFloor(staged.itemId, floor)) {
    return { kind: 'yours', floor };
  }
  const ask = floor - 1;
  const vendor = vendorFloor(staged.itemId);
  if (ask < MIN_ASK) {
    return { kind: 'copper', floor };
  }
  if (vendor !== null && ask < vendor) {
    return { kind: 'vendor', floor, vendor };
  }
  return { kind: 'ask', floor, ask, net: Math.floor(ask * (1 - page.cutPct / PERCENT)) };
}

/**
 * Whether the cheapest copy is the player's own, or the panel tells them to undercut themselves.
 * Compared under the server's rounding (up), or their own listing is missed by a copper.
 */
function ownsFloor(itemId, floor) {
  for (const row of scan.values()) {
    if (row.mine && row.itemId === itemId && Math.ceil(row.unit) === floor) {
      return true;
    }
  }
  return false;
}

/** One line while something is staged, and nothing at all the rest of the time. */
function sellText() {
  const staged = live.page?.staged ?? null;
  if (staged === null || live.status !== 'near') {
    return '';
  }
  return `Selling ${nameOf(staged.itemId)}: ${adviceText(askAdvice(staged, live.page))}`;
}

function adviceText(advice) {
  if (advice.kind === 'none') {
    return 'nobody is selling one, so there is no floor to go under.';
  }
  const floor = `floor ${money(advice.floor)} each`;
  if (advice.kind === 'yours') {
    return `${floor}, which is your own listing.`;
  }
  if (advice.kind === 'copper') {
    return `${floor}, and nothing can go under a copper.`;
  }
  if (advice.kind === 'vendor') {
    return `${floor}, under which a vendor pays ${money(advice.vendor)} and pays it today.`;
  }
  return `${floor}, ask ${money(advice.ask)} to be under it, netting ${money(advice.net)}.`;
}

/** The prose the line cannot carry, including the two caveats needed to read the figure right. */
function sellTip() {
  const staged = live.page?.staged ?? null;
  if (staged === null) {
    return { title: 'The Sell tab', lines: ['Nothing is staged to sell.'] };
  }
  return {
    title: nameOf(staged.itemId),
    icon: woc.ui.icon.item(staged.itemId),
    lines: spoken([
      `Read from ${SELL_LABEL} the moment you staged this, which is the only market-wide price the game will ever state. This addon cannot ask for it.`,
      floorNote(staged),
      {
        text: 'The figure is per item, and the book is ordered by what a whole stack costs, so a large stack priced well can still sit behind a cheap single copy.',
        tone: 'muted',
      },
      {
        text: 'The Merchant refuses a listing whose total is over 500 gold, so the most you can ask for each falls as the stack grows.',
        tone: 'muted',
      },
    ]),
  };
}

/** What the floor counts, so it is not read as the cheapest rival. */
function floorNote(staged) {
  if (staged.unit === null) {
    return { text: 'Nobody has one listed, so nothing here says what it is worth.', tone: 'warn' };
  }
  return {
    text: "It counts every listing of this, the Merchant's own stock and your own listings among them, because a buyer can take either instead of yours.",
    tone: 'warn',
  };
}

function paintStatus() {
  const { page } = live;
  setStat(whereStat, whereText());
  setStat(capStat, capText(page));
  setStat(collectStat, collectText(page));
  say(statusLine, statusText());
  say(sellLine, sellText());
}

/** The page number and cut, which the strip does not show. */
function stripTip() {
  const { page } = live;
  if (page === null) {
    return { title: 'This counter', lines: ['No page has been read at a Merchant yet.'] };
  }
  return {
    title: 'This counter',
    lines: [
      `Page ${pageText(page)} of the book, searching ${page.queryText}.`,
      `The Merchant takes ${cutText(page)} of a sale, which every figure here has already had taken off.`,
      { text: coverageText(), tone: 'muted' },
    ],
  };
}

/** `marketCollectPending` is not gated on proximity, so the badge is right in any zone. */
function paintTitle() {
  if (woc.world.marketCollectPending === true) {
    frame.setTitle('Ledgerline (to collect)');
    return;
  }
  frame.setTitle('Ledgerline');
}

function draw() {
  paintStatus();
  paintDeals();
  paintPrices();
  paintMine();
  paintSold();
  paintTitle();
}

/**
 * One repaint per frame however many ask, since a publisher's catch-up is a message per id.
 * `{ frame }` is safe: everything drawn, the title badge included, is inside the panel.
 */
const schedulePaint = woc.paint(draw, { frame });

// Separate keys: the page is gated on standing at the Merchant and the badge streams anywhere.
woc.world.on('market', onMarket);
woc.world.on('marketCollectPending', onCollectPending);

// The character says whose market history this is, and can change without a reload.
woc.world.on('characterKey', characterChanged);

// `follow` subscribes before asking: delivery is synchronous, so the reverse order misses an
// answer given inside the ask. Silence means nobody publishes names.
woc.bus.follow(ITEMS_TOPIC, onItems);
// The incremental push has no ask half, so a plain subscription covers it.
woc.bus.on(woc.bus.anySender, ITEM_TOPIC, onItem);

// Prices out, as the same batch-plus-push pair as `item`/`items`. `everyPriceKnown` returns null
// before the ledger is read; `startLedger` and a character switch announce again.
const pricePublication = woc.bus.publish(PRICES_TOPIC, everyPriceKnown);
woc.bus.emit(LEGACY_ASK_TOPIC);

woc.onSettingsChange(() => {
  // Applied at once, or a shortened retention looks like it does nothing.
  const cutoff = cutoffAt(woc.wallClock());
  const emptied = [];
  for (const [itemId, record] of series) {
    record.visits = prunedVisits(record.visits, cutoff);
    if (record.visits.length === 0) {
      emptied.push(itemId);
    }
  }
  if (emptied.length > 0) {
    forget(emptied);
    // A shortened retention has to survive the reload, or the next session reads back the lot.
    keep();
  }
  // The sale record follows the setting; the queue position does not, since it tracks the Merchant.
  const held = sold.size;
  trimSold(soldCutoff(woc.wallClock()));
  if (sold.size !== held) {
    keepSold();
  }
  alerted.on = false;
  draw();
});

// Every age on screen is relative, so they are rewritten on an interval rather than a loop.
woc.setInterval(() => {
  schedulePaint();
}, AGE_TICK_MS);

/**
 * This install's id, made once. `randomUUID` exists only in a secure context, so the fallback is
 * needed for a plain-http mirror, or that player's sales carry no origin.
 */
function newInstallId() {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === 'function') {
    return uuid.call(globalThis.crypto);
  }
  const noise = Math.random().toString(BASE_36).slice(RANDOM_START, RANDOM_END);
  return `local-${String(woc.wallClock())}-${noise}`;
}

async function learnInstall() {
  const stored = text(await woc.storage.get(INSTALL_KEY, ''));
  if (!running.on) {
    return;
  }
  if (stored !== '') {
    install.id = stored;
    return;
  }
  install.id = newInstallId();
  await woc.storage.set(INSTALL_KEY, install.id);
}

/**
 * The vendor floors. A failure costs only the two certain signals, so it is reported and survived.
 */
async function learnFloors() {
  const table = readFloors(await woc.data(FLOORS_FILE));
  if (table === null) {
    throw new Error(`${FLOORS_FILE} carries no "items" array of price rows`);
  }
  if (!running.on) {
    return;
  }
  floorsFrom.version = table.version;
  for (const row of table.rows) {
    floors.set(row.id, row);
  }
  schedulePaint();
}

/** Both art answers are provisional until the manifest lands. It never rejects. */
async function learnArt() {
  await woc.ui.icon.preloadItems();
  if (running.on) {
    schedulePaint();
  }
}

// Registered by hand: both starts below await something and could resume after teardown.
woc.onDispose(() => {
  running.on = false;
  // A write may be pending on a timer. Flushing is best effort, better than losing the last page.
  if (saving.on && loaded.on) {
    saveLedger();
  }
});

draw();
begin().catch((err) => {
  woc.warn('ledgerline: the world could not be read', err);
});
learnArt().catch((err) => {
  woc.warn('ledgerline: the item art manifest could not be read', err);
});
learnFloors().catch((err) => {
  woc.warn('ledgerline: the vendor floors could not be read, so no deal is certain', err);
});
learnInstall().catch((err) => {
  woc.warn(
    'ledgerline: this install could not be named, so an export cannot say where it came from',
    err,
  );
});
