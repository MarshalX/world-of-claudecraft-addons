/// <reference types="@woc-addons/types" />

// Ledgerline: a price history for a market that keeps almost none.
//
// The server keeps no history OF THE BOOK: no table of what an item goes for, no query for one,
// and a listing simply exists until it sells or expires. So the ledger is not something this
// addon reads, it is what this addon IS, and it is exactly as complete as the browsing behind
// it. Nothing here can act either, since there is no send API.
//
// ONLY `near` IS EVER RECORDED, which is the worst bug this feature can have. `world.market` is
// three-state: `near` carries the page, `away` means the player walked off, `unknown` means
// nothing has decoded. Recording `away` as an empty market erases the ledger three steps from
// the counter; presenting it as one tells a player in a town that nobody is selling anything.
// One `away` after a reconnect is neither, and `onAway` is the guard.
//
// A VISIT is the unit rather than a listing. A reading is `[when, cheapest, dearest, query]` per
// item per trip, several pages in one trip merge into one, and every figure is one vote per
// visit. A median over listings is a median weighted by who happened to be selling that day.
//
// `price` is the total buyout for the STACK. Every series divides by `count` first, or a stack
// of 20 against a single reads as a price movement; the total is kept too, since it is what the
// server sorts on and therefore what the undercut check compares.
//
// The player's own completed sales are the one real sold-price record the game keeps, and it is
// a pickup queue rather than an archive: `collectionSales` is capped at fifty with the overflow
// in `collectionSalesOmitted`, and is EMPTIED the moment the player collects. A row carries no
// id and no clock, so its only identity is its POSITION in the queue, which is what `foldSales`
// is built on. Two failures destroy a record silently: counting a row twice inflates a series
// that exists to be ground truth, and reading the drain as an empty market deletes everything.
// Every stamp is when this addon DRAINED the row, never when the sale happened, and says so.
//
// What was PAID and what is being ASKED are two series and are never folded into one. They meet
// on one labelled tooltip line, so a reader can see the gap.
//
// The query echo is the signal that the query reset: a fresh join resets the server-side query
// while the window's own controls survive, so every entry carries the query that produced it and
// an item read under more than one says so.
//
// Names are not required and not available: no API says what an item is called. A publisher on
// the bus outranks `ui.icon.itemArtName`, which is provenance for a picture. BOTH topics are
// subscribed to, since the batch is what an ask is answered with and taking only `item` leaves
// the catch-up arriving and doing nothing.
//
// "First seen by you" is this addon's own record and is labelled as one: no wired row carries an
// expiry, so it never appears beside the word "expires". The cut and the cap are read off every
// page rather than written down, so a release that moves either is followed for free.
//
// It is ALL ONE KEY. A namespace is a prefix on one flat GM store, so a key per item costs
// `storage.keys()` a scan of everything the loader holds, a bridge round trip each on the way in
// and a cross-tab watcher left behind for each. Writes are held and coalesced.
//
// Storage is per ACCOUNT, because a market is a realm: a price your alt saw is a price you saw.
// The sale record and the listing stamps are per CHARACTER, because the Merchant keeps a
// collection per seller. Every stamp is `woc.wallClock()`, never `woc.now()`: a monotonic reading
// stored in one session and read in the next is a moment in the future with nothing to say so.

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

/**
 * The size bound beside the setting's time bound, since the whole ledger is read and written as
 * one value. Thirty visits is a month of looking twice a day, and more points than the trend
 * line has pixels.
 */
const MAX_ITEMS = 400;
const MAX_VISITS = 30;

/**
 * One ceiling over the whole record rather than one per item: a player selling ore daily and a
 * sword yearly must not lose the sword to the ore.
 */
const MAX_SALES = 400;

/**
 * How long a trip counts as ONE reading. Four pages flipped in a minute are one visit, or the
 * trend line pictures the browsing rather than the market. A different query starts a new visit
 * whatever the clock says.
 */
const VISIT_MINUTES = 10;
const VISIT_WINDOW_MS = VISIT_MINUTES * MINUTE_MS;

/**
 * A ceiling on the write RATE rather than a delay on the last change: the whole ledger is one
 * value, so every write is a full serialization and a broadcast to every tab. It costs this much
 * unsaved browsing if the tab closes mid-page, which is why disposal writes too.
 */
const WRITE_HOLD_MS = 2 * MS_PER_SECOND;

/** How many item rows are drawn before the pane asks the player to narrow it. */
const MAX_ROWS = 40;

/** What the kit's layout boxes are spaced at here: a pane's rows, and a stat's two words. */
const PANE_GAP = 4;
const STAT_GAP = 4;
/**
 * The status strip's two gaps: close together down the page and far apart across it, because
 * the strip is one line of figures that wraps onto a second rather than two lines of anything.
 */
const STRIP_GAP = 10;
const STRIP_WRAP_GAP = 2;

/** The frame, and the floor it may be dragged down to. */
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 480;
const MIN_WIDTH = 320;
/**
 * Everything that is not the scrolling list, at its worst case. Stated rather than measured: a
 * size floor is settled when the frame is built, before there is a layout to measure.
 */
const CHROME_HEIGHT = 240;
const ROW_HEIGHT = 48;

/** The sparkline, which is the one thing on screen the kit has no widget for. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SPARK_WIDTH = 140;
const SPARK_HEIGHT = 16;
const SPARK_PAD = 2;
/**
 * Two visits is the fewest that can be a line. One draws NOTHING rather than a dot: a mark on an
 * empty box reads as a flat price, and the reading count beside it already says it was seen once.
 */
const MIN_SPARK_POINTS = 2;

/** The filter axes the server echoes, in the game's own field names rather than ones of ours. */
const QUERY_FIELDS = ['filter', 'itemType', 'subtype', 'armorClass', 'primaryStat', 'rarity'];

/** What a query with nothing set is called, so a series can say which it came from. */
const NO_QUERY = 'the whole book';

/** A flag in a cell, so a handler and the paint path cannot hold different copies of it. */
function cell(value) {
  return { on: value };
}

/** Item id to what somebody published about it, plus who published it. */
const names = new Map();
/** Item id to its recorded series. See `emptySeries`. */
const series = new Map();
/** Whether a write is already waiting on its timer. See `keep`. */
const saving = cell(false);
/** Listing id to the first time this addon saw one of the player's OWN listings. */
const mineSeen = new Map();
/** Item id to the sales of it drained off the Merchant's ledger. See `emptySold`. */
const sold = new Map();

/**
 * How far into the CURRENT pending ledger this has read. `read` counts sales rather than
 * indexing the wire's array, which is only a window over that count. `anchor` is the last row
 * read, catching the case the count cannot: a collect plus exactly as many fresh sales leaves
 * the count where it was. `lost` is cumulative, and is the answer to how complete the record is.
 */
const cycle = { read: 0, anchor: '', lost: 0 };

/** Set once the stored ledger has been read, or once reading it has failed. */
const loaded = cell(false);
/**
 * Whose the held data is. A switch inside one session can move either, and one realm's prices
 * written into another realm's key cannot be told apart afterwards.
 */
const loadedFor = { ledger: '', character: '' };
/** Cleared on disable, so an awaited continuation cannot draw into a dead frame. */
const running = cell(true);
/** Whether the undercut warning has already fired for this trip above the line. */
const alerted = cell(false);

/**
 * The last page read, CAPTURED rather than referenced: the reading has to outlive walking away,
 * and the client is free to replace its own array.
 */
const live = { status: 'unknown', page: null };
/** Whether the held page is being resynced after a reconnect. See `onAway`. */
const resyncing = cell(false);
/** The reconnect count as of the last market reading. See the header. */
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
 * One field of the game's own payload, by a name held in a variable. The computed access is
 * the point: a literal key here would be this project naming a field it does not own.
 */
function fieldText(source, name) {
  if (typeof source !== 'object' || source === null) {
    return '';
  }
  return text(source[name]);
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
 * How old a reading is, in the coarsest unit that still says something. The wall clock on
 * both sides, which is why a stamp is taken from `woc.wallClock()`: this subtraction spans
 * page loads.
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

/**
 * Never blank. A publisher outranks the loader here, which inverts the usual order: what the
 * loader has is an art file's name and says so in its own documentation.
 */
function nameOf(itemId) {
  return known(itemId)?.name ?? artName(itemId) ?? itemId;
}

/**
 * One published record, checked. A bus payload is `unknown` and is another addon's idea of
 * the shape, so an id and a name are required and everything else is optional.
 */
function parseItem(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const itemId = text(payload.id);
  const name = text(payload.name);
  if (itemId === '' || name === '') {
    return null;
  }
  return { id: itemId, name, quality: text(payload.quality), kind: text(payload.kind) };
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
 * The batch an ask is answered with. The `Array.isArray` guard is load-bearing rather than
 * defensive: a publisher answers every ask, and a publisher with nothing to say sends a null.
 * A bad entry is dropped rather than costing the other eight hundred.
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

/**
 * A LIVE row only: the ledger keeps what a page said about an item rather than the listings it
 * said it with, so the seller and the house flag are read on screen and never written down.
 */
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

/**
 * The query that produced a page, as one comparable string. Empty rather than five separators
 * joining six blanks: it is stored on every visit of every item.
 */
function querySignature(info) {
  const parts = QUERY_FIELDS.map((name) => fieldText(info, name));
  if (parts.every((part) => part === '')) {
    return '';
  }
  return parts.join('|');
}

/** The same query, as something a tooltip can say. */
function queryLabel(info) {
  const parts = QUERY_FIELDS.map((name) => fieldText(info, name)).filter((part) => part !== '');
  if (parts.length === 0) {
    return NO_QUERY;
  }
  return parts.join(', ');
}

/** One row of the page, kept under this addon's own names rather than the game's. */
function captureRow(row) {
  const held = makeRow(row);
  held.itemId = text(row.itemId);
  held.mine = row.mine === true;
  return held;
}

/** How many of something the server sent, when all that is drawn is the count. */
function countOf(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  return 0;
}

/**
 * The page, as this addon holds it after the player walks away. A copy rather than the
 * game's own object: this reading has to outlive standing at the counter.
 */
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
    totalCount: Math.max(0, Math.round(numberOr(info.totalCount, 0))),
    cutPct: numberOr(info.cutPct, 0),
    maxListings: Math.max(0, Math.round(numberOr(info.maxListings, 0))),
    myListingCount: Math.max(0, Math.round(numberOr(info.myListingCount, 0))),
    collectionCopper: Math.max(0, numberOr(info.collectionCopper, 0)),
    collectionItems: countOf(info.collectionItems),
    mine: rows.filter((row) => row.mine),
    others: rows.filter((row) => !row.mine),
  };
}

/**
 * What each VISIT found, oldest first. Every figure the panel draws is per trip, so none of
 * them needs the individual asks that produced it.
 */
function emptySeries(itemId) {
  return { itemId, at: 0, visits: [] };
}

/**
 * Checked, since a player can edit storage. An ARRAY in seconds rather than the shape held in
 * memory: this is one value over every item ever browsed, so field names would be most of it.
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
  return { at, low, high, query: text(value[3]) };
}

function storedVisit(visit) {
  return [Math.round(visit.at / MS_PER_SECOND), visit.low, visit.high, visit.query];
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
 * The id alone is not enough: it is a per-boot counter, so a restart lets a fresh listing
 * inherit a held number. Price and count are immutable on a live listing.
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
 * The house is the Merchant's own stock at the game's own formula, so it is off by default: a
 * shelf price folded into player asks moves the low with nobody having decided anything. It
 * stays in the undercut check regardless, since a buyer can buy it.
 */
function recordable(row) {
  if (row.itemId === '') {
    return false;
  }
  return recordingHouse() || !row.house;
}

/**
 * The cheapest and dearest ask per item, over `others` ALONE: a price the player chose is not a
 * reading of the market, and folding it in puts their own hope into the low they judge it by.
 */
function pageAsks(page) {
  const asks = new Map();
  for (const row of page.others) {
    if (recordable(row)) {
      // Whole copper: a unit price is a total over a stack size, so it arrives fractional as
      // often as not, at a precision the game does not have and bytes stored thousands of times.
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
 * A page read close behind the last, under the same query, is the same TRIP. Merging widens the
 * spread and moves the stamp, so four pages are one point at the time the player finished.
 */
function foldVisit(record, ask, page) {
  const last = record.visits.at(-1);
  if (last !== undefined && last.query === page.query && page.at - last.at <= VISIT_WINDOW_MS) {
    last.low = Math.min(last.low, ask.low);
    last.high = Math.max(last.high, ask.high);
    last.at = page.at;
    return;
  }
  record.visits.push({ at: page.at, low: ask.low, high: ask.high, query: page.query });
}

/** Write one page into the ledger, and answer whether anything moved. */
function foldPage(page) {
  const cutoff = cutoffAt(page.at);
  let moved = false;
  for (const [itemId, ask] of pageAsks(page)) {
    const record = series.get(itemId) ?? emptySeries(itemId);
    foldVisit(record, ask, page);
    record.visits = prunedVisits(record.visits, cutoff);
    record.at = page.at;
    series.set(itemId, record);
    moved = true;
  }
  return moved;
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
    // The world moved between the change and the timer. Whatever is held belongs to the
    // market that was open then, and the reload below is what brings the right one back.
    return;
  }
  woc.storage.set(loadedFor.ledger, storedLedger()).catch((err) => {
    woc.warn('ledgerline: the ledger could not be saved', err);
  });
}

/**
 * At most once every `WRITE_HOLD_MS`, serialized when the TIMER fires rather than when the
 * change arrived, so a window of browsing rides one write and nothing is stored stale. That is
 * also why nothing is cloned: no record can be mutated between being handed over and stored.
 */
function keep() {
  if (saving.on) {
    return;
  }
  saving.on = true;
  woc.setTimeout(saveLedger, WRITE_HOLD_MS);
}

/**
 * The nearest honest thing to a remaining time, since no wired row carries an expiry. A stamp is
 * trusted only where the price and count match too, since an id is reused after a restart.
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
 * Per CHARACTER, the opposite call from the ledger: a price belongs to the realm, "my listings"
 * to one character. Listing ids are a per-boot counter on one server, so ids from two realms
 * collide and an account key would hand a fresh listing the age of whatever else held it.
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
 * Everything the row carries, since the whole of it is what says it is the same row. Two sales
 * of one ore to one buyer at one price are indistinguishable, and this never tells those apart:
 * it answers only whether the row at a POSITION is still the one read there.
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
 * Zero on a queue this has not read: one SHORTER than where it left off was collected and
 * started again, and one whose row at that position has changed is a different queue of the
 * same length.
 */
function alreadyRead(rows, omitted) {
  if (cycle.read === 0 || omitted + rows.length < cycle.read) {
    return 0;
  }
  const at = cycle.read - 1 - omitted;
  if (at < 0) {
    // The cap dropped the row last read, so the count is all there is and what it skips past is
    // counted as lost.
    return cycle.read;
  }
  if (saleMark(rows[at]) !== cycle.anchor) {
    return 0;
  }
  return cycle.read;
}

/**
 * Write one drained row down. Nothing is filtered on the amounts: a 1-copper listing against
 * the Merchant's cut nets zero and still leaves a row, and the game's own Collect tab reads
 * the ledger specifically so that sale is not stranded unshown.
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
    unit: Math.round(unitPrice(price, count)),
  });
  record.at = now;
  sold.set(itemId, record);
}

/**
 * An ABSENT field is not an empty queue, which is what the first guard is for: a server
 * predating the ledger sends neither, and reading that as a collect resets the position on
 * every page and counts every waiting sale again.
 */
function foldSales(info, now) {
  const rows = info.collectionSales;
  if (!Array.isArray(rows)) {
    return false;
  }
  const omitted = Math.max(0, Math.round(numberOr(info.collectionSalesOmitted, 0)));
  const read = alreadyRead(rows, omitted);
  // Sales dropped before this could read them, which is NOT the server's own figure and must
  // not be presented as it: `collectionSalesOmitted` counts what the cap dropped, some of which
  // was read and kept here first. Only the queue position answers what is missing from THIS
  // record. The game's Collect tab quotes a third number again.
  const missed = Math.max(0, omitted - read);
  cycle.lost += missed;
  const fresh = rows.slice(Math.max(read, omitted) - omitted);
  for (const row of fresh) {
    recordSale(row, now);
  }
  const total = omitted + rows.length;
  // The POSITION moving is a change too: a collect records nothing and must still be written,
  // or a reload reads the new queue from where the collected one left off.
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

/** What each sale fetched per item, in the order they were drained, which is what a line is. */
function soldTrend(record) {
  return record.sales.map((entry) => entry.unit);
}

/**
 * The retention setting, raised where the whole-record ceiling bites first. One reading of every
 * stamp rather than a sort per item, since the ceiling is over the record.
 */
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

/** One stored sale, checked, because a player can edit what is in storage. */
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
  return { at, count, price, proceeds, buyer: text(value[4]), unit: Math.round(price / count) };
}

/** An array in seconds, for the economy the visits are stored with. */
function storedSale(entry) {
  return [
    Math.round(entry.at / MS_PER_SECOND),
    entry.count,
    entry.price,
    entry.proceeds,
    entry.buyer,
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
 * The position rides the sales, because it has to survive a RELOAD: a player who comes back
 * before collecting meets the same uncollected rows, and a fresh position records them twice.
 */
function keepSold() {
  woc.storage.character.set(SOLD_KEY, storedSold()).catch((err) => {
    woc.warn('ledgerline: the sale record could not be saved', err);
  });
}

/**
 * One vote per VISIT in every figure, which is a change of meaning rather than a consequence of
 * storing less: a median over listings is weighted by who happened to be selling. The low of a
 * visit rather than its median, since the low is what the item can be had for.
 */
function statsFor(record) {
  const lows = record.visits.map((visit) => visit.low).sort((a, b) => a - b);
  const newest = record.visits.at(-1);
  return {
    low: lows[0] ?? 0,
    // The top of the SPREAD rather than of the trend line. Both are drawn and they differ.
    high: record.visits.reduce((top, visit) => Math.max(top, visit.high), 0),
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

/** The cheapest ask at each visit, oldest first, which is what a trend is. */
function trendOf(record) {
  return record.visits.map((visit) => visit.low);
}

/**
 * The server sorts the others section by display name then price, so an item's listings are
 * contiguous and ascending and the first is the cheapest competitor. No name table needed.
 */
function blockStart(others, itemId) {
  return others.findIndex((row) => row.itemId === itemId);
}

/**
 * `unknown` where the item has no block on this page, which under a filter is most of the market
 * and is never evidence that nobody is selling. `partial` where the block starts at the first
 * row of a page after the first, since the rows before it may be cheaper.
 */
function verdictFor(row, page) {
  const at = blockStart(page.others, row.itemId);
  if (at < 0) {
    return { state: 'unknown', rival: null };
  }
  const rival = page.others[at] ?? null;
  if (rival === null) {
    return { state: 'unknown', rival: null };
  }
  if (at === 0 && page.page > 0) {
    return { state: 'partial', rival };
  }
  if (rival.price < row.price) {
    return { state: 'undercut', rival };
  }
  return { state: 'cheapest', rival };
}

function undercutCount(page) {
  return page.mine.filter((row) => verdictFor(row, page).state === 'undercut').length;
}

/** On the CROSSING rather than the state, or every page read while undercut would say it again. */
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
 * Off `characterKey`, which is null until realm and name are both known. NOT off
 * `net.state.realm`: the hello frame and world entry are different signals, so a ledger keyed
 * from it loads under `offline` whenever the read wins the race and writes nothing after.
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
 * Account-wide rather than `storage.character`, since a price is a fact about the world. Scoped
 * to one realm and one deployment all the same: two economies in one ledger average into a low
 * that is true of neither, and GM storage is one store across live, pbe and pbe2.
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
 * The grace ends on a TIMER rather than on the next reading: a watch key fires on a change, so a
 * player who is still away sends no second one and the panel would say "resyncing" for the rest
 * of the session. The client refills about fifty milliseconds later; a `near` cancels it.
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
}

function onNear(info) {
  const now = woc.wallClock();
  lastRead.reconnects = reconnectCount();
  resyncing.on = false;
  live.status = 'near';
  const page = capture(info, now);
  live.page = page;
  if (loaded.on) {
    recordPage(page);
    recordSales(info, now);
  }
  checkUndercut(page);
}

/**
 * Off the RAW payload rather than the captured page: a capture holds what a page said about an
 * item, and a queue that must be read exactly once before it empties is a different thing.
 */
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
 * The one signal about the pending ledger that arrives with no page in front of it. A FALL means
 * everything waiting was taken, so the queue is empty whatever a page says. The badge is ungated
 * by proximity where the page is not, so a collect is noticed by a player who walked off.
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
  const moved = foldPage(page);
  forget(overflowIds());
  if (moved) {
    keep();
  }
  pruneOwn(page.at);
  if (foldOwn(page)) {
    keepOwn();
  }
}

/** Recording happens only on `near`, which is the rule the whole feature turns on. */
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

/**
 * One key and one read. A key per item cannot work: `storage.keys()` scans every value the
 * loader holds for every addon, and each read is a bridge round trip and a watcher left behind.
 */
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
 * One value because they are only true TOGETHER: a record without the position counts every
 * uncollected sale again, and a position without the record skips sales it has no rows for.
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
 * Waits for a character, since the ledger is keyed on the realm and the stamps are per
 * character. `loaded` is set even on a failed read, so a player without storage still gets a
 * live panel; RECORDING waits for it, or a page folded into an empty ledger overwrites a
 * history that was merely still being read.
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
  // The reconnect baseline, so a player who reconnected before this started gets no grace.
  lastRead.reconnects = reconnectCount();
  // A watch key reports a CHANGE and its first sample is the baseline, so a player already at
  // the Merchant gets no handler call. This read is what says which of the three states it is.
  onMarket();
  draw();
}

/**
 * The one way in, and it is the CHARACTER rather than the world: a switch can move either half
 * of the store. Everything held is dropped rather than merged, and nothing is written on the way
 * out, which would be one realm's ledger under whatever key the new one derives.
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
 * Draw as soon as there is a world, character or not: only the recording waits. The character is
 * read by hand here because this is the first sample of a watch key, which notifies nobody.
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
 * Anything that is not one of the kit's own boxes and must not be squeezed by the list beside
 * it. `ui.column`, `ui.row` and `ui.line` carry this in their own class; a tab strip, a field
 * and a rule do not.
 */
function fixed(el) {
  el.style.flexShrink = '0';
  return el;
}

function column(className) {
  return woc.ui.column({ className, gap: PANE_GAP });
}

/**
 * An edge where the list STOPS, since the note under it otherwise reads as one more row with no
 * price. The rows carry no separators of their own, which would be furniture the list's length.
 * An `hr`, which comes with the separator role.
 */
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
    // TWO gaps, close together down the page and far apart across it, or a strip that has
    // wrapped onto a second line reads as two strips. `wrapGap` is the down axis and defaults
    // to `gap`; both are the kit's own declaration, so a density still reaches either.
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
 * The one thing on screen the kit has no widget for. It SPANS the row, stretched by
 * `preserveAspectRatio="none"`, or a fixed box draws the series into the left third and reads
 * as a chart that was cut off. `non-scaling-stroke` is what that costs and is not optional: a
 * stretched viewBox scales the axes differently, so a plain stroke comes out thick on the
 * verticals. The filled area is there because a hairline in a row of text reads as an underline.
 */
function buildSpark() {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('class', 'woc-ledgerline-spark');
  el.setAttribute('viewBox', `0 0 ${String(SPARK_WIDTH)} ${String(SPARK_HEIGHT)}`);
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('aria-hidden', 'true');
  // A strip along the bottom of the row's own box rather than the whole background: a line free
  // to cross the box strikes the text through. Inert, or it eats the row's hover.
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.bottom = '0';
  // An `svg` with no width sizes itself from its viewBox, so the offsets alone draw a 140px
  // chart in the corner of a 400px row.
  el.style.width = '100%';
  el.style.height = `${String(SPARK_HEIGHT)}px`;
  el.style.pointerEvents = 'none';
  el.style.opacity = '0.6';
  const area = document.createElementNS(SVG_NS, 'polygon');
  area.setAttribute('fill', 'currentColor');
  area.setAttribute('opacity', '0.1');
  const path = document.createElementNS(SVG_NS, 'polyline');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  path.setAttribute('stroke-linejoin', 'round');
  el.append(area, path);
  return { el, area, path };
}

/** Where one reading sits in the box, with a flat series drawn down the middle. */
function sparkPoint(value, at, span, range) {
  const x = at * span;
  const top = SPARK_HEIGHT - SPARK_PAD;
  if (range.high <= range.low) {
    return `${x.toFixed(1)},${(SPARK_HEIGHT / 2).toFixed(1)}`;
  }
  const share = (value - range.low) / (range.high - range.low);
  const y = top - share * (SPARK_HEIGHT - SPARK_PAD * 2);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

/** The same line, closed along the bottom, which is what makes it read as a chart. */
function areaPoints(points) {
  const last = SPARK_WIDTH.toFixed(1);
  const floor = SPARK_HEIGHT.toFixed(1);
  return `0.0,${floor} ${points.join(' ')} ${last},${floor}`;
}

function paintSpark(spark, values) {
  const enough = values.length >= MIN_SPARK_POINTS;
  spark.el.style.display = 'none';
  if (!enough) {
    return;
  }
  spark.el.style.display = 'block';
  const range = { low: Math.min(...values), high: Math.max(...values) };
  // Edge to edge: a pad on the x axis is a gap at each end of a line meant to fill the row.
  const span = SPARK_WIDTH / (values.length - 1);
  const points = values.map((value, at) => sparkPoint(value, at, span, range));
  spark.path.setAttribute('points', points.join(' '));
  spark.area.setAttribute('points', areaPoints(points));
}

/**
 * A frame rather than a window, since the player TOGGLES it: the two differ by the ARIA role.
 * Both size bounds are stated, because a frame that states neither takes its opening size as its
 * floor and a bound cannot be restated once the frame is built.
 */
const frame = woc.ui.frame({
  id: 'ledger',
  title: 'Ledgerline',
  toggleKey: 'toggle',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'comfortable',
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
// A frame's body does not grow, since a frame is normally sized by what it draws. A resizable
// one is the exception, or the height the player dragged out is dead space under the content.
frame.body.style.flex = '1 1 auto';

const panes = new Map([
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
    { id: 'prices', label: 'Prices' },
    { id: 'mine', label: 'Yours' },
    // What was PAID, which is a different series from what is asked. See the header.
    { id: 'sold', label: 'Sold' },
  ],
  onSelect: (id) => {
    showPane(id);
    schedulePaint();
  },
});
fixed(tabs.el);
frame.body.appendChild(tabs.el);

/** The shared strip, above both panes: where the player is and what the server said. */
const statusStrip = strip(frame.body, 'status');
const whereStat = stat(statusStrip, 'where', 'At');
const pageStat = stat(statusStrip, 'page', 'Page');
const cutStat = stat(statusStrip, 'cut', 'Cut');
const capStat = stat(statusStrip, 'cap', 'Listings');
const collectStat = stat(statusStrip, 'collect', 'Waiting');
const statusLine = line(frame.body, 'status-line');

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

const priceTop = rule(panes.get('prices'));
const priceList = scrolls(column('woc-ledgerline-list'));
priceList.dataset.list = 'prices';
panes.get('prices')?.appendChild(priceList);
rule(panes.get('prices'));
const priceNote = line(panes.get('prices'), 'prices-note');

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
  ['prices', priceList],
  ['mine', mineList],
  ['sold', soldList],
]);
/** Drawn only where there are rows, or an empty pane puts two rules together. */
const listTops = new Map([
  ['prices', priceTop],
  ['mine', mineTop],
  ['sold', soldTop],
]);
/**
 * One list per pane, since the loader orders a list inside ONE parent. The tooltip is bound per
 * list rather than per sync, so it is the pane's reader rather than whichever reading built the
 * row, and a reused row keeps the hover a re-inserted element would lose.
 */
function rowsIn(list, tip) {
  return woc.ui.list({
    parent: list,
    key: (entry) => entry.key,
    create: (entry) => buildRow(entry.key, tip),
    update: (row, entry) => {
      row.bar.update(entry.update);
      paintSpark(row.spark, entry.trend);
    },
  });
}

const listRows = new Map([
  ['prices', rowsIn(priceList, priceTip)],
  ['mine', rowsIn(mineList, mineTip)],
  ['sold', rowsIn(soldList, soldTip)],
]);

/**
 * The kit's bar, standing on its item's trend: the chart is the row's BACKGROUND rather than a
 * band under it, so it costs no height, and a full-width box between rows would read as a
 * divider that happens to slope. No kit fill on a price row: a fill's width means a share of
 * something, and one item's price is not a share of another's. See `ownEntry` for the exception.
 */
function buildRow(key, tip) {
  const el = woc.ui.column({ className: 'woc-ledgerline-row', gap: 0 });
  el.dataset.row = key;
  el.style.position = 'relative';
  // The strip the chart sits in, kept even by a row with no chart: rows that changed height as
  // a second reading landed would make the list twitch while a page is being read.
  el.style.paddingBottom = `${String(SPARK_HEIGHT)}px`;
  const bar = woc.ui.bar({ className: 'woc-ledgerline-bar' });
  const spark = buildSpark();
  // The chart first, so the text paints over it: both are positioned and neither has a z-index.
  el.append(spark.el, bar.el);
  woc.ui.tooltip(el, () => tip(key));
  // The list put the wrapper in and takes it out; this owes the widget inside it.
  return {
    el,
    bar,
    spark,
    destroy: () => {
      bar.destroy();
    },
  };
}

/**
 * An empty list takes NO room, or it grows into the height the player dragged out and pushes the
 * sentence explaining why it is empty to the bottom edge.
 */
function growWhen(list, filled) {
  list.style.flex = '0 1 auto';
  if (filled) {
    list.style.flex = '1 1 auto';
  }
}

/**
 * Sync one pane's list to a reading, plus the two things around it that are not rows: whether
 * the list grows, and whether the rule that opens it is drawn.
 */
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
    trend: trendOf(record),
    update: {
      label: nameOf(record.itemId),
      icon: woc.ui.icon.item(record.itemId),
      // Labelled: a bare figure at the end of a row reads as the price, and this is the
      // cheapest per item anybody has been seen asking.
      value: { copper: Math.round(stats.low), prefix: 'low' },
      detail: `median ${money(Math.round(stats.median))}, ${woc.fmt.count(stats.visits, 'visit')}, last ${agoText(stats.at)}`,
    },
  };
}

/** Where a name came from, said plainly, because two of the three are not the item's. */
function nameNote(itemId) {
  const record = known(itemId);
  if (record !== null) {
    return { text: `Name published by ${record.from}.`, tone: 'muted' };
  }
  if (artName(itemId) !== null) {
    return {
      text: 'Named from its art file, which is not always what the game calls it.',
      tone: 'muted',
    };
  }
  return { text: 'No addon has published a name for this id.', tone: 'muted' };
}

function queryNote(stats) {
  if (stats.queries <= 1) {
    return { text: 'Every reading came from one search.', tone: 'muted' };
  }
  return {
    text: `Readings came from ${String(stats.queries)} different searches, so they cover different parts of the book.`,
    tone: 'warn',
  };
}

/**
 * The one place the two series meet, and a labelled SENTENCE rather than a figure folded into
 * the ones above: a number made of an ask and a sale is true of neither.
 */
function paidLine(itemId) {
  const record = sold.get(itemId);
  if (record === undefined) {
    return null;
  }
  const stats = soldStats(record);
  return {
    text: `You have sold ${woc.fmt.count(stats.sales, 'sale')} of this, at a median of ${money(Math.round(stats.median))} each. That is what was paid; the figures above are what was asked.`,
    tone: 'muted',
  };
}

function priceTip(itemId) {
  const record = series.get(itemId);
  if (record === undefined) {
    return { title: itemId, lines: ['This item is no longer in the ledger.'] };
  }
  const stats = statsFor(record);
  const lines = [
    `Low ${money(Math.round(stats.low))} each, median ${money(Math.round(stats.median))}, high ${money(Math.round(stats.high))}.`,
    `Latest ${money(Math.round(stats.latest))} each, read ${agoText(stats.at)}.`,
    `${woc.fmt.count(stats.visits, 'visit')} to the counter, and the low of each is one point of the line.`,
    {
      text: 'Every figure here is one vote per visit rather than one per listing, so a busy day does not outweigh a quiet one. Several pages read in one trip are one visit.',
      tone: 'muted',
    },
    queryNote(stats),
    {
      text: 'Prices are per item: a listing sells its whole stack for one price, and this divides by the count.',
      tone: 'muted',
    },
  ];
  const paid = paidLine(itemId);
  if (paid !== null) {
    lines.push(paid);
  }
  lines.push(nameNote(itemId));
  return { title: nameOf(itemId), icon: woc.ui.icon.item(itemId), lines };
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
    return `Showing ${String(MAX_ROWS)} of ${String(matching)} matching. ${held} Narrow it with the search above.`;
  }
  return held;
}

/**
 * The list and the sentence under it, from one reading of the ledger. Taken once and passed
 * down rather than asked for again: narrowing sorts every held item, and the note that
 * reports how many matched would be asking the same question a third time.
 */
function paintPrices() {
  const matching = ledgerRows();
  syncList('prices', matching.slice(0, MAX_ROWS).map(priceEntry));
  say(priceNote, pricesNoteText(matching.length));
}

/** What the ledger says about the item one of the player's own listings is for. */
function ownTrend(itemId) {
  const record = series.get(itemId);
  if (record === undefined) {
    return [];
  }
  return trendOf(record);
}

const VERDICT_TEXT = new Map([
  ['cheapest', 'cheapest on this page'],
  ['undercut', 'undercut'],
  ['partial', 'may be undercut'],
  ['unknown', 'not on this page'],
]);

const VERDICT_TONE = new Map([
  ['cheapest', 'default'],
  ['undercut', 'danger'],
  ['partial', 'warn'],
  ['unknown', 'default'],
]);

/** A whole row of tone, or none at all. Never anything between: see `ownEntry`. */
function washFor(tone) {
  if (tone === 'default') {
    return 0;
  }
  return 1;
}

function ownEntry(row, page) {
  const verdict = verdictFor(row, page);
  const tone = VERDICT_TONE.get(verdict.state) ?? 'default';
  const stamp = firstSeen(row);
  return {
    key: String(row.id),
    trend: ownTrend(row.itemId),
    update: {
      label: nameOf(row.itemId),
      icon: woc.ui.icon.item(row.itemId),
      value: { copper: row.price, prefix: 'asking' },
      tone,
      // A wash rather than a measurement: the kit paints a tone on the FILL and nowhere else,
      // so a toned row with no fill is a verdict nobody can see. One width, so it reads as none.
      fraction: washFor(tone),
      detail: `${String(row.count)} for ${money(Math.round(row.unit))} each, ${VERDICT_TEXT.get(verdict.state) ?? ''}, first seen by you ${agoText(stamp)}`,
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

function verdictLine(verdict) {
  if (verdict.state === 'partial') {
    return {
      text: 'This item is the first row of the page, so its cheaper listings may be on the page before this one. Read page 1 to be sure.',
      tone: 'warn',
    };
  }
  if (verdict.state === 'undercut') {
    return { text: 'Somebody is asking less than you are.', tone: 'danger' };
  }
  if (verdict.state === 'cheapest') {
    return { text: 'Yours is the cheapest of the listings on this page.', tone: 'good' };
  }
  return { text: 'Nothing on this page to compare against.', tone: 'muted' };
}

/**
 * Asks about the page that is live NOW. A tooltip outlives the reading that built its row, so a
 * closed-over page answers from page one all evening.
 */
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
    lines: [
      netLine(row, page),
      rivalLine(verdict),
      verdictLine(verdict),
      {
        // Everything else on this row is the player's OWN price, so the line beside it reads
        // as a history of what they have charged unless it says otherwise.
        text: 'The line under the row is what the item has been going for, at the cheapest ask of each of your visits. It is not a record of your own price.',
        tone: 'muted',
      },
      {
        text: `First seen by you ${agoText(firstSeen(row))}. That is this addon's own record: no listing carries an expiry, so nothing here can say when it goes.`,
        tone: 'muted',
      },
      {
        text: 'Nothing here can cancel or relist. This is a record, not a control.',
        tone: 'muted',
      },
    ],
  };
}

function mineNoteText() {
  if (live.page === null) {
    return 'Walk up to a Merchant and your listings are read from the page it sends.';
  }
  if (live.page.mine.length === 0) {
    return 'You had no listings at the Merchant when this page was read.';
  }
  if (live.status === 'near') {
    // The one thing no figure can say: what a verdict is drawn from and therefore cannot see.
    return 'Judged from the page you are reading now, which is not the whole market.';
  }
  return `Read ${agoText(live.page.at)}, at the Merchant. Your listings and everyone else's may have moved since.`;
}

/**
 * The headline is the GROSS per item, which is what compares with the asks on the Prices tab.
 * The net is on the detail line and labelled: summing the wrong one overstates by the cut.
 */
function soldEntry(record) {
  const stats = soldStats(record);
  return {
    key: record.itemId,
    trend: soldTrend(record),
    update: {
      label: nameOf(record.itemId),
      icon: woc.ui.icon.item(record.itemId),
      value: { copper: Math.round(stats.median), prefix: 'paid' },
      detail: `${woc.fmt.count(stats.sales, 'sale')}, ${String(stats.items)} sold, ${money(stats.net)} after the cut, last read ${agoText(stats.at)}`,
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
    lines: [
      `Paid ${money(Math.round(stats.low))} to ${money(Math.round(stats.high))} each, over ${woc.fmt.count(stats.sales, 'sale')}.`,
      `${String(stats.items)} sold for ${money(stats.gross)}, which came to ${money(stats.net)} after the Merchant's cut.`,
      {
        text: 'These are your own completed sales. The market keeps no record of what anybody else sold anything for, so nothing here is a market rate.',
        tone: 'muted',
      },
      {
        text: 'A sale is stamped when this addon read it rather than when it happened: the Merchant itemizes the gold waiting to be collected and that ledger carries no clock, so several sales read in one go share a stamp.',
        tone: 'muted',
      },
      {
        text: 'What was paid, which is a different fact from the asking prices on the Prices tab. Neither is folded into the other.',
        tone: 'muted',
      },
      nameNote(itemId),
    ],
  };
}

/**
 * The gap in the record: the Merchant's ledger holds fifty rows and counts what it dropped, and
 * this adds what got past it between readings. Silence presents a short list as a complete one.
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
  return `${woc.fmt.count(sold.size, 'item')} sold, keeping ${String(historyDays())} days.${missing}`;
}

function paintSold() {
  const records = [...sold.values()].sort((a, b) => b.at - a.at);
  syncList('sold', records.slice(0, MAX_ROWS).map(soldEntry));
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
 * Drawn only where the figures above it could be misread, and `say` hides it otherwise rather
 * than leaving a gap. A search earns the line: a fresh join resets the server-side query while
 * the window's controls keep showing it, so a filtered book can look like the whole one.
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
  return `Searching ${live.page.queryText}, so this page is part of the book rather than all of it.`;
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
 * The FLAG is ungated by proximity and the amount is not, so a player who walked away knows
 * there is something and only what the last page said it was. With no page: `something`.
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

function paintStatus() {
  const { page } = live;
  setStat(whereStat, whereText());
  setStat(pageStat, pageText(page));
  setStat(cutStat, cutText(page));
  setStat(capStat, capText(page));
  setStat(collectStat, collectText(page));
  say(statusLine, statusText());
}

/**
 * `marketCollectPending` is ungated by proximity, so the badge is right in another zone. What a
 * player forgets is the gold they walked away from.
 */
function paintTitle() {
  if (woc.world.marketCollectPending === true) {
    frame.setTitle('Ledgerline (to collect)');
    return;
  }
  frame.setTitle('Ledgerline');
}

function draw() {
  paintStatus();
  paintPrices();
  paintMine();
  paintSold();
  paintTitle();
}

/**
 * One repaint per frame however many ask, since a publisher's catch-up is a message per id.
 * `{ frame }` is safe here because everything this draws is inside the panel, the title badge
 * included: a closed frame has no title bar either.
 */
const schedulePaint = woc.paint(draw, { frame });

// Separate keys: the page is gated on standing at the Merchant and the badge streams anywhere.
woc.world.on('market', onMarket);
woc.world.on('marketCollectPending', onCollectPending);

// The character says which market this is a history OF, and it can change with no reload.
woc.world.on('characterKey', characterChanged);

// `follow` subscribes and then asks, which is the order that matters: delivery is synchronous,
// so a publisher answering inside the ask would reach a handler that does not exist yet.
// Silence is ordinary and means nobody is publishing names.
woc.bus.follow(ITEMS_TOPIC, onItems);
// The incremental form is a push with no ask half, so a plain subscription is all of it.
woc.bus.on(woc.bus.anySender, ITEM_TOPIC, onItem);
// The older ask topic, sent beside the one `follow` derives. Drop next release.
woc.bus.emit(LEGACY_ASK_TOPIC);

woc.onSettingsChange(() => {
  // Applied at once rather than at the next page, or a player who cut it to a day still sees a
  // month of rows and concludes the setting does nothing.
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
  // The sale record answers to the same setting; the queue position does not, since where this
  // has read to is a question about the Merchant rather than about the record.
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

/** Both art answers are provisional until the manifest lands. It never rejects. */
async function learnArt() {
  await woc.ui.icon.preloadItems();
  if (running.on) {
    schedulePaint();
  }
}

// The one thing registered by hand: both starts below are awaiting something and either
// continuation could otherwise resume against a frame already torn down.
woc.onDispose(() => {
  running.on = false;
  // A write may be sitting on a timer about to be disposed. Whether it lands is not something
  // an addon can insist on; the alternative is dropping the last page the player read.
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
