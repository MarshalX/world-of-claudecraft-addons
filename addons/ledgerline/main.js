/// <reference types="@woc-addons/types" />

// Ledgerline: a price history for a market that keeps none.
//
// The server keeps nothing. There is no history table, no sold-price record and no query
// for either, and a listing simply exists until somebody buys it or it expires. So a price
// history is not something this addon reads, it is something this addon is: every page the
// player browses at the Merchant is written down, and the ledger is exactly as complete as
// the browsing behind it. Nothing here can act either, since there is no send API, so
// every figure below is a record of what the player saw and the panes say so wherever a
// reader might take a row for a button.
//
// Only `near` is ever recorded, which is the single worst bug this feature can have.
// `world.market` is three-state: `near` carries the page, `away` means the player is not
// at the Merchant, and `unknown` means nothing has decoded yet. Recording `away` as an
// empty market would erase the ledger the moment the player took three steps, and
// presenting it as one would tell a player standing in a town that nobody is selling
// anything. One `away` after a reconnect is neither, and the guard for it is at `onAway`.
//
// `price` is the total buyout for the whole stack rather than a unit price. Every series
// here divides by `count` before comparing anything, because a stack of 20 against a
// single is a stack size rather than a price movement. Both figures are kept: the total is
// what the server sorts on and therefore what the undercut check compares, and the unit is
// what a series is drawn from.
//
// The query echo is the signal that the query reset. The payload echoes `filter`,
// `itemType`, `subtype`, `armorClass`, `primaryStat` and `rarity` because a fresh join
// resets the server-side query while the window's own controls survive, so the player
// believes a filter is applied that no longer is. Every recorded entry carries the query
// that produced it, and an item whose readings came from more than one query says so.
//
// The undercut check needs no item names, because the server's own ordering settles it:
// see `blockStart` for the ordering and `verdictFor` for the two answers it refuses to
// give.
//
// Names are not required and are not available. No API answers what an item is called,
// since the item table is bundled inside the game's own chunk. `ui.icon.itemArtName` gives
// the name the art file was filed under, which is provenance for the picture rather than
// the item's name, and an addon publishing on the bus outranks it. The ledger is complete
// without a single name; a name that turns up moves a label.
//
// "First seen by you" is this addon's own record and is labelled as one. A listing expires
// at 48 hours and no wired row carries an expiry: a row is an id, a seller, an item, a
// count, a price, whether it is yours, whether it is the house's, and sometimes an
// instance. So the nearest honest substitute is when this addon first saw the row, and it
// never appears beside the word "expires".
//
// The cut and the cap are read, never written down. `cutPct` and `maxListings` are echoed
// back on every page, so a release that moves either is followed for free.
//
// A visit is the unit of the ledger rather than a listing, and that is the data model. A
// page of twelve asks for one ore says one thing about that ore: what it was going for
// when you looked. So a reading is `[when, cheapest, dearest, query]` per item per trip to
// the counter, several pages read in one trip merge into one reading, and every figure on
// screen is one vote per visit. A median over listings is a median weighted by how many
// people happened to be selling that day.
//
// It is all one key. A namespace is a prefix on one flat GM store shared by every addon,
// so a key per item costs `storage.keys()` a scan of everything the loader holds, one
// bridge round trip per item on the way in, and a cross-tab value-change watcher left
// behind for each. Writes are held for a moment and coalesced, since the whole value is
// rewritten and a player flipping pages would otherwise write on every flip.
//
// Storage is per account rather than per character, because a market is a realm rather
// than a character: a price your alt saw is a price you saw. Every stamp comes from
// `woc.wallClock()`, never `woc.now()`, because a monotonic reading stored in one session
// and read in the next is a moment in the future with nothing to indicate it.

/** The whole price history for one market, in ONE key. See `ledgerKey`. */
const LEDGER_PREFIX = 'ledger';
/** What a market with no realm behind it is filed under. See `ledgerKey`. */
const NO_REALM = 'offline';
/** Where the first-seen stamps for the player's OWN listings live. One small key. */
const MINE_KEY = 'mine-seen';

/** The topic registry's item record, and the ask a late subscriber sends. */
const ITEM_TOPIC = 'item';
const ASK_TOPIC = 'item:ask';

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

const DEFAULT_HISTORY_DAYS = 30;

/**
 * How much of the ledger is held at all, and both figures are drawn rather than hidden.
 *
 * The retention setting bounds it in time and these bound it in size, because a player who
 * browses an unfiltered book for a week has seen thousands of ids and the whole thing is
 * read and written as one value. The item dropped at the ceiling is the one seen least
 * recently; the visit dropped is the oldest.
 *
 * Thirty visits is a month of looking twice a day, drawn into a line about a hundred and
 * forty pixels wide: past that the points are closer together than the pixels.
 */
const MAX_ITEMS = 400;
const MAX_VISITS = 30;

/**
 * How long a trip to the counter lasts, for the purpose of being one reading.
 *
 * A player at the Merchant flips through several pages and often searches twice, and every
 * one of those is a separate payload carrying the same asks. They are one visit rather
 * than four, or a trend line has four points a minute apart followed by nothing for a day,
 * which is a picture of the browsing rather than of the market. A reading whose query
 * differs starts a new visit whatever the clock says.
 */
const VISIT_MINUTES = 10;
const VISIT_WINDOW_MS = VISIT_MINUTES * MINUTE_MS;

/**
 * How long a change waits before it is written down.
 *
 * The whole ledger is one value, so a write is a whole serialization and a broadcast to
 * every other tab. It is a ceiling on the rate rather than a delay on the last change:
 * whatever has arrived when the timer fires goes in the same write, and anything after it
 * opens a new window. What that costs is up to this much unsaved browsing if the tab is
 * closed mid-page, which is why disposal writes as well.
 */
const WRITE_HOLD_MS = 2 * MS_PER_SECOND;

/** How many item rows are drawn before the pane asks the player to narrow it. */
const MAX_ROWS = 40;

/** The frame, and the floor it may be dragged down to. */
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 480;
const MIN_WIDTH = 320;
/**
 * What the shortest useful frame spends on everything that is not the scrolling list: the
 * title bar, the tab strip, the status strip, the sentence under it, the search field and
 * the footer. The worst case, so it counts the sentence, which is drawn only where it has
 * something to say.
 *
 * Stated rather than measured, because a size floor is settled once when the frame is
 * built and cannot come from a layout that does not exist yet. The floor is one row, never
 * the number of rows on screen.
 */
const CHROME_HEIGHT = 240;
const ROW_HEIGHT = 48;

/** The sparkline, which is the one thing on screen the kit has no widget for. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SPARK_WIDTH = 140;
const SPARK_HEIGHT = 16;
const SPARK_PAD = 2;
/**
 * Two visits is the fewest that can be a line, and one draws nothing at all. Nothing rather
 * than a dot: a single point says only that the item was seen once, which the reading count
 * beside it already says, and a mark on an empty box reads as a flat price.
 */
const MIN_SPARK_POINTS = 2;

/**
 * The filter axes the server echoes back, in the order the pane names them. An array of the
 * game's own field names rather than an object keyed by them, read through `fieldText`,
 * because a record literal of them would be this addon claiming to have chosen them.
 */
const QUERY_FIELDS = ['filter', 'itemType', 'subtype', 'armorClass', 'primaryStat', 'rarity'];

/** What a query with nothing set is called, so a series can say which it came from. */
const NO_QUERY = 'the whole book';

/**
 * A flag that changes, in a cell. The factory keeps the value a boolean rather than the
 * literal it starts as: a property initialized to `false` reads as the type `false`, so
 * every later test of it is reported as a condition that can never be true.
 */
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

/** Set once the stored ledger has been read, or once reading it has failed. */
const loaded = cell(false);
/**
 * Which market and character the held data belongs to. Switching characters inside one
 * session can move both: another character on the same realm reads the same ledger and
 * different stamps, and one on another realm reads neither. Held so that a switch is
 * noticed rather than assumed away, since one realm's prices written into another realm's
 * key cannot be told apart afterwards.
 */
const loadedFor = { ledger: '', character: '' };
/** Cleared on disable, so an awaited continuation cannot draw into a dead frame. */
const running = cell(true);
/** One repaint per frame however many things asked for one. */
const scheduled = cell(false);
/** Whether the undercut warning has already fired for this trip above the line. */
const alerted = cell(false);

/**
 * The last page read at the Merchant, and where the player stands. `page` is a capture of
 * the game's page rather than the object itself: the reading has to outlive walking away
 * from the counter, and the client is free to replace its own array.
 */
const live = { status: 'unknown', page: null };
/** Whether the held page is being resynced after a reconnect. See `onAway`. */
const resyncing = cell(false);
/** The reconnect count as of the last market reading. See the header. */
const lastRead = { reconnects: 0 };
/** What the search field holds, which narrows the ledger rather than the market. */
const search = { text: '' };

function settingNumber(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function settingFlag(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

/**
 * How long a reading is kept. Read straight through: the manifest declares the bounds and
 * the loader coerces against them, so a second clamp here would be dead code.
 */
function historyDays() {
  return settingNumber('history-days', DEFAULT_HISTORY_DAYS);
}

function recordingHouse() {
  return settingFlag('record-house', false);
}

function alerting() {
  return settingFlag('undercut-alert', true);
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

/**
 * Copper as text, which is the loader's own split rather than this addon's. `ui.money` is
 * the one split now, and the rows below do better still: a bar's figure takes an amount and
 * is drawn with the game's own coins, so this is left with the places that take text, which
 * is a tooltip line and the status strip.
 */
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

/**
 * The name the item's ART file was filed under, or null.
 *
 * Provenance for the picture rather than the item's name, so wherever it is used the
 * tooltip says where it came from.
 */
function artName(itemId) {
  if (itemId === '') {
    return null;
  }
  return woc.ui.icon.itemArtName(itemId);
}

/**
 * The best name there is, and the raw id when there is none. Never blank. A publisher
 * first and the loader second, which is the opposite of the usual ordering and is right
 * here for one reason: what the loader has is not the item's name and says so in its own
 * documentation. A publisher's is.
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

function onItem(message) {
  const record = parseItem(message.payload);
  if (record === null) {
    return;
  }
  names.set(record.id, { ...record, from: message.from });
  schedulePaint();
}

/**
 * What one listing costs per item in it. `price` is the total buyout for the whole stack,
 * so a series built on it compares a stack of 20 against a single and calls the difference
 * a price movement.
 */
function unitPrice(price, count) {
  if (count <= 0) {
    return price;
  }
  return price / count;
}

/**
 * One listing off the page, under this addon's own names. A live row only: the ledger keeps
 * what a page said about an item rather than the listings it said it with, so a seller's
 * name and the house flag are read while the page is on screen and never written down.
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
 * The signature of the query that produced a page, as one comparable string. Empty when
 * nothing is applied rather than five bare separators joining six empty fields, since it is
 * stored on every visit of every item and the whole book is the common case.
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
 * One item's history: what each visit to the counter found, oldest first.
 *
 * A visit rather than a listing is the unit, and that is the whole data model. The panel
 * draws a low, a median, a high, a latest and a line with one point per trip, and not one
 * of those needs the individual asks that produced them.
 */
function emptySeries(itemId) {
  return { itemId, at: 0, visits: [] };
}

/**
 * One stored visit, checked, because a player can edit what is in storage.
 *
 * An array rather than an object, and the one place in the addon where the stored shape is
 * not the shape in memory: the ledger is one value holding every item a player has browsed,
 * so the field names would be most of the file. The seconds are the same economy, since
 * nothing on screen is finer than a minute.
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

/** The whole ledger, in the shape it is stored in. */
function storedLedger() {
  const items = {};
  for (const [itemId, record] of series) {
    items[itemId] = record.visits.map(storedVisit);
  }
  return { items };
}

/**
 * Whether two readings are the same listing. The id alone is not enough: it comes from a
 * monotonic per-boot counter, so after a server restart a fresh listing can inherit a
 * number this addon already holds. Price and count are immutable on a live listing, so a
 * row that matches an id and not those is a different listing.
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
 * Whether a row belongs in the ledger at all. The house is the Merchant's own standing
 * stock, priced by the game's own formula rather than by anybody's judgement, so it is off
 * by default: a shelf price folded into a series of player asks moves the low and the
 * median without anyone having decided anything. It stays in the undercut check whatever
 * this says, because a buyer can buy it and it therefore competes.
 */
function recordable(row) {
  if (row.itemId === '') {
    return false;
  }
  return recordingHouse() || !row.house;
}

/**
 * What this page said about each item on it: the cheapest ask and the dearest. Over
 * `others` alone, which is where the player's own listings are kept out of the series: a
 * price the player chose is not a reading of what the market is asking, and folding it in
 * would put their own hopeful price into the low they are judging it against.
 */
function pageAsks(page) {
  const asks = new Map();
  for (const row of page.others) {
    if (recordable(row)) {
      // Whole copper. A unit price is a total divided by a stack size, so it arrives
      // fractional as often as not, and 51.3 is both three bytes of a value stored
      // thousands of times and a precision the game does not have.
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
 * Fold one page's reading of one item into its visits. A page read close behind the last
 * one, under the same query, is the same trip to the counter rather than a new one. Merging
 * takes the wider of the two spreads and moves the stamp forward, so a trip that covered
 * four pages is one point at the time the player finished looking.
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
 * Write the ledger down, at most once every `WRITE_HOLD_MS`. The state is serialized when
 * the timer fires rather than when the change arrived, so everything a player read during
 * the window rides one write and nothing is queued behind a stale copy. That is also why
 * nothing is cloned: there is no window in which a live record could be mutated between
 * being handed over and being stored.
 */
function keep() {
  if (saving.on) {
    return;
  }
  saving.on = true;
  woc.setTimeout(saveLedger, WRITE_HOLD_MS);
}

/**
 * Remember when each of the player's own listings was first seen, which is the nearest
 * honest thing to a remaining time, because no wired row carries an expiry. A stored stamp
 * is only trusted where the price and count match too, since a listing id is reused after a
 * server restart.
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
 * The stamps are the character's, so they live in the character's own store.
 *
 * The opposite call from the ledger one line up, and for the opposite reason: a price is
 * the market's and belongs to everybody on the realm, while "my listings" is genuinely one
 * character's. A listing id also comes from a per-boot counter on one server, so ids from
 * two realms collide by construction, and an account-wide key would hand a fresh listing
 * the age of whatever held that number somewhere else.
 *
 * A per-character write refuses before world entry, which is why this is never reached
 * there: nothing is recorded until the ledger has loaded, and that waits for the world.
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

/**
 * Everything the panel says about one item, from its visits.
 *
 * One vote per visit in every figure here, which is a deliberate change of meaning rather
 * than a consequence of storing less. A median over every listing ever seen is a median
 * weighted by how many people happened to be selling: a trip that found twelve asks
 * outvotes six trips that found two. A median over the cheapest ask of each visit answers
 * the question a player is actually asking.
 *
 * The low of a visit rather than its median, because the low is the price the item can be
 * had for and the one the next seller undercuts.
 */
function statsFor(record) {
  const lows = record.visits.map((visit) => visit.low).sort((a, b) => a - b);
  const newest = record.visits.at(-1);
  return {
    low: lows[0] ?? 0,
    // The dearest ask of any visit, which is the top of the spread rather than the top of
    // the trend line: both are drawn, and they are different facts.
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
 * Where an item's block starts among the rows that are not the player's own. The server
 * sorts that section by the item's display name and then by price, so one item's listings
 * are contiguous and ascending and the block's first row is the cheapest competing listing.
 * No name table is needed for any of it.
 */
function blockStart(others, itemId) {
  return others.findIndex((row) => row.itemId === itemId);
}

/**
 * What the page can honestly say about one of the player's own listings. `unknown` where
 * the item has no block on this page, which under a filter is most of the market and is
 * never evidence that nobody else is selling. `partial` where the block begins at the very
 * first row of the others section on a page after the first, because the rows before it are
 * on the previous page and one of them may be cheaper.
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

/**
 * Say something once when a listing stops being the cheapest, and re-arm when none is. On
 * the crossing rather than on the state, or every page read while undercut would say it
 * again. Only ever computed from a page read at the Merchant, since it is the only place
 * the competing rows exist.
 */
function checkUndercut(page) {
  const count = undercutCount(page);
  if (count === 0) {
    alerted.on = false;
    return;
  }
  if (!(alerted.on || !alerting())) {
    alerted.on = true;
    woc.ui.toast(`Ledgerline: ${countedListings(count)} of yours no longer the cheapest.`, {
      kind: 'warn',
    });
  }
}

function countedListings(count) {
  if (count === 1) {
    return '1 listing';
  }
  return `${String(count)} listings`;
}

function countedItems(count) {
  if (count === 1) {
    return '1 item';
  }
  return `${String(count)} items`;
}

/** A browse of the counter, which is what the trend line has one point per. */
function countedVisits(count) {
  if (count === 1) {
    return '1 visit';
  }
  return `${String(count)} visits`;
}

/**
 * The realm in play, off the loader's own character key. `characterKey` is `realm/name` and
 * is null until both are known, which is exactly the moment this addon can say which market
 * it is keeping a history of. The realm also rides `net.state.realm`, and reading it there
 * is wrong: the hello frame and world entry are different signals, so a ledger keyed from
 * it loads under `offline` whenever the read wins the race and then writes nothing for the
 * rest of the session.
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
 * Which market this ledger is of: the deployment and the realm, in the key.
 *
 * Account-wide on purpose, which is why this is not `woc.storage.character`: a price is a
 * fact about the world rather than about who was standing at the counter.
 *
 * Scoped to one market for the same reason, which is not the same thing. The realm is the
 * world: names are unique per realm in the game's own model and a market belongs to one, so
 * two realms in one ledger would be two economies averaged into a low that is true of
 * neither. The deployment is a second, coarser split of the same kind, because GM storage
 * is one store for the userscript across live, pbe and pbe2.
 */
function ledgerKey() {
  const realm = realmNow();
  if (realm === '') {
    return `${LEDGER_PREFIX}/${woc.game.channel}/${NO_REALM}`;
  }
  return `${LEDGER_PREFIX}/${woc.game.channel}/${realm}`;
}

/**
 * The reconnect count, which is a property on `net.state` rather than a call. Read
 * defensively, like everything reached through the loader's view of the game.
 */
function reconnectCount() {
  return numberOr(woc.net.state?.reconnects, 0);
}

/**
 * The grace only ends on a timer, which is not the obvious design.
 *
 * The obvious one is to grant grace to the first `away` after a reconnect and take the next
 * one at face value, and it does not work: a watch key fires on a change, so a player who
 * is still away sends no second reading. A player who reconnected at the counter and then
 * walked off before the refill would leave the panel saying "resyncing" for the rest of the
 * session.
 *
 * The client refills its mirror from the next snapshot about fifty milliseconds later, so a
 * couple of seconds is generous and still short enough that a player never reads a stale
 * label. A `near` inside the window cancels it.
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
 * One `away` after a reconnect is the client's own resync rather than the player walking
 * off. The mirror is force-nulled on reconnect and refilled from the next snapshot, so the
 * held page stays and the pane says it is resyncing rather than blanking. Any `away` that
 * is not the first one after a reconnect is taken at face value immediately.
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
  }
  checkUndercut(page);
}

/** Fold one page into the ledger and write it down. */
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

/**
 * The market moved: a page arrived, the player walked off, or the query reset. Recording
 * happens only on `near`, which is the rule the whole feature turns on.
 */
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
 * Read the ledger back: one key, and one read. A key per item cannot work here, because
 * `storage.keys()` scans every value the loader holds for every addon and each key read
 * costs a round trip over the bridge and leaves a cross-tab watcher behind for the rest of
 * the session.
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
 * Read what is stored for whoever is playing, then draw.
 *
 * The read waits for a character, and both halves of the store are the reason: the ledger
 * is keyed on the realm, which is half of `world.characterKey`, and the stamps are per
 * character. Nothing is lost by waiting, since a page can only be read at a Merchant.
 *
 * The read failing is not a reason to show nothing: `loaded` is set either way, so a player
 * whose storage is unavailable still gets a live panel for the pages they read this
 * session. Recording waits for it, because folding a page into an empty ledger and then
 * writing it would overwrite a history that was merely still being read.
 */
async function startLedger() {
  await Promise.all([
    loadLedger().catch((err) => {
      woc.warn('ledgerline: the stored ledger could not be read', err);
    }),
    loadOwn().catch((err) => {
      woc.warn('ledgerline: the stored listing stamps could not be read', err);
    }),
  ]);
  if (!running.on) {
    return;
  }
  loaded.on = true;
  // The baseline for the reconnect guard is taken here, at the first reading, so a player
  // who had already reconnected before this addon started is not handed a grace window.
  lastRead.reconnects = reconnectCount();
  // A watch key reports a change, and the first sample is the baseline it changes from, so
  // a player who was already at the Merchant when this addon started gets no handler call.
  // One read here is what tells the panel which of the three states it is in.
  onMarket();
  draw();
}

/**
 * The one way in, and it is the character rather than the world. A switch can move both
 * halves of the store: another character on the same realm shares the ledger and not the
 * stamps, and one on another realm shares neither. Everything held is dropped rather than
 * merged, because what is in memory is one market's. Nothing is written on the way out:
 * every change was already written within a couple of seconds, and a save here would be a
 * save of one realm's ledger under whatever key the new one derives.
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
    live.page = null;
    draw();
  }
  startLedger().catch((err) => {
    woc.warn('ledgerline: the stored ledger could not be started', err);
  });
}

/**
 * Show the market as soon as there is a world, whether or not there is a character yet. The
 * panel is honest before the ledger loads: it says what it is reading and draws the page in
 * front of the player, and only the recording waits. This is also the first sample of a
 * watch key that notifies nobody, which is why the character is read here by hand.
 */
async function begin() {
  await woc.world.ready;
  if (!running.on) {
    return;
  }
  onMarket();
  characterChanged();
}

/** Show or hide an element, BOTH ways, restoring the display it was built with. */
const displays = new WeakMap();

function displayAs(el, display) {
  displays.set(el, display);
  el.style.display = display;
  return el;
}

function setShown(el, shown) {
  el.hidden = !shown;
  el.style.display = 'none';
  if (shown) {
    el.style.display = displays.get(el) ?? 'flex';
  }
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

function fixed(el) {
  el.style.flexShrink = '0';
  return el;
}

function column(className) {
  const el = document.createElement('div');
  el.className = className;
  el.style.flexDirection = 'column';
  el.style.gap = '4px';
  displayAs(el, 'flex');
  setShown(el, true);
  return el;
}

/**
 * A rule across the pane, above the list and above the sentence under it.
 *
 * The rows carry no separators of their own: a line between every two items is furniture
 * the length of the list. What the panel needs is an edge where the list stops, since the
 * note under it is a different kind of thing and without a rule it reads as one more row
 * with no price. An `hr` rather than a styled div, because that is what it is, and it comes
 * with the separator role for free.
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
  displayAs(el, 'block');
  parent.appendChild(el);
  return el;
}

/** A sentence the pane says on its own line. */
function line(parent, role) {
  const el = document.createElement('div');
  el.className = 'woc-ledgerline-line';
  el.dataset.role = role;
  el.style.lineHeight = '1.35';
  fixed(el);
  parent.appendChild(el);
  return el;
}

function say(el, said) {
  setShown(el, said !== '');
  el.textContent = said;
}

/** The status strip: short labelled figures on one line, wrapping onto a second. */
function strip(parent, role) {
  const el = document.createElement('div');
  el.className = 'woc-ledgerline-strip';
  el.dataset.role = role;
  el.style.flexWrap = 'wrap';
  el.style.alignItems = 'baseline';
  el.style.gap = '2px 10px';
  displayAs(el, 'flex');
  fixed(el);
  parent.appendChild(el);
  return el;
}

/** One labelled figure, hidden until it has something to say. */
function stat(parent, role, label) {
  const el = document.createElement('div');
  el.className = 'woc-ledgerline-stat';
  el.dataset.role = role;
  el.style.gap = '4px';
  el.style.alignItems = 'baseline';
  el.style.whiteSpace = 'nowrap';
  fixed(el);
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
  parent.appendChild(el);
  displayAs(el, 'flex');
  setShown(el, false);
  return { el, figure };
}

function setStat(chip, value) {
  setShown(chip.el, value !== '');
  chip.figure.textContent = value;
}

/**
 * The trend chart, which is the one thing on screen the kit has no widget for.
 *
 * It spans the row: the width is the element's and the geometry is the viewBox's, with
 * `preserveAspectRatio="none"` to stretch one onto the other, so the same three readings
 * fill whatever width the player has dragged the panel out to. A fixed box under a wider
 * row draws the whole series into the left third, which reads as a chart that was cut off.
 *
 * `non-scaling-stroke` is what that costs and is not optional: a stretched viewBox scales x
 * and y by different factors, so a plain 1.5px stroke comes out thick on the verticals and
 * thin on the horizontals.
 *
 * The area under the line is drawn as well, at a low opacity, because a hairline alone in a
 * row of text reads as an underline or a divider. Both are `currentColor`, so the whole
 * thing inherits whatever the frame's density, theme and row tone give it, and there is no
 * axis of any kind.
 */
function buildSpark() {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('class', 'woc-ledgerline-spark');
  el.setAttribute('viewBox', `0 0 ${String(SPARK_WIDTH)} ${String(SPARK_HEIGHT)}`);
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('aria-hidden', 'true');
  // A strip along the bottom of the row's own box, inside it rather than after it. Its own
  // strip rather than the whole row's background: a line free to cross the box crosses the
  // text, and a line through a word reads as a word struck out. It sits inside the row so
  // that it belongs to the row above it. Inert, or a chart under a row would eat the row's
  // own hover.
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.bottom = '0';
  // Stated rather than left to the two offsets: an `svg` with no width sizes itself from
  // its viewBox, so `left: 0; right: 0` alone draws a 140px chart in the corner of a 400px
  // row and looks like a series that has been cut off.
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
  // Edge to edge rather than inset: the box is the row's width, so a pad on the x axis is a
  // gap at the start and end of a line that is meant to fill it.
  const span = SPARK_WIDTH / (values.length - 1);
  const points = values.map((value, at) => sparkPoint(value, at, span, range));
  spark.path.setAttribute('points', points.join(' '));
  spark.area.setAttribute('points', areaPoints(points));
}

/**
 * The panel. A frame rather than a window, because the player toggles it with a keybind:
 * the two differ by the ARIA role and a close button is `closable` on either. Resizable,
 * since what it draws is a list that can outrun any fixed height, with both bounds stated
 * because a frame that states neither takes its opening size as its floor. The floor is one
 * row, since a bound cannot be restated after the frame is built.
 */
const frame = woc.ui.frame({
  id: 'ledger',
  title: 'Ledgerline',
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
// The body of a frame does not grow: the loader's own sheet gives one `flex: 0 1 auto` and
// fills only a window's, because a frame is normally sized by what it draws. A frame the
// player can resize is the exception, and without this the panel keeps its content at the
// top and leaves the height they dragged out as dead space under it.
frame.body.style.flex = '1 1 auto';

const panes = new Map([
  ['prices', fills(column('woc-ledgerline-pane'))],
  ['mine', fills(column('woc-ledgerline-pane'))],
]);
for (const [name, pane] of panes) {
  pane.dataset.pane = name;
}

function showPane(active) {
  for (const [name, pane] of panes) {
    setShown(pane, name === active);
  }
}

const tabs = woc.ui.tabs({
  tabs: [
    { id: 'prices', label: 'Prices' },
    { id: 'mine', label: 'Yours' },
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

showPane(tabs.active());

/** The two lists by name, and what is on screen in each. */
const lists = new Map([
  ['prices', priceList],
  ['mine', mineList],
]);
/**
 * The rule that opens each list, which is the one that comes and goes. The footer rule is
 * always drawn, since the sentence under it always says something. This one is drawn only
 * when there are rows to open, or an empty pane would put two rules together with nothing
 * between them.
 */
const listTops = new Map([
  ['prices', priceTop],
  ['mine', mineTop],
]);
/** A repaint reuses a row rather than replacing it: a re-inserted element loses hover. */
const listRows = new Map([
  ['prices', new Map()],
  ['mine', new Map()],
]);

function place(list, el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}

/**
 * One row: the kit's bar, standing on its item's trend.
 *
 * The chart is the row's background rather than a band under it. Behind the figures it is
 * what it is: the price of this item over time, with this item's name and price standing on
 * it, costing no height at all. A box beside the text draws the series into the left third
 * of the row, and the same box at full width between rows reads as a divider that happens
 * to slope.
 *
 * A price row carries no kit fill, and that is deliberate: a fill's width means a share of
 * something, and one item's price is not a share of another item's. The one place a fill is
 * drawn is a listing of your own that needs looking at, where it is a full-width wash
 * rather than a width anybody could read a number off. See `ownEntry`.
 */
function buildRow(list, key, tip) {
  const el = document.createElement('div');
  el.className = 'woc-ledgerline-row';
  el.dataset.row = key;
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.position = 'relative';
  // The strip the chart is drawn in, which is the row's own space rather than a gap between
  // rows. A row with no chart keeps it: rows that changed height as their second reading
  // landed would make the list twitch while a page is being read.
  el.style.paddingBottom = `${String(SPARK_HEIGHT)}px`;
  const bar = woc.ui.bar({ className: 'woc-ledgerline-bar' });
  const spark = buildSpark();
  // The chart first, so the row's own text paints over it: both are positioned, and with no
  // z-index on either that is decided by document order.
  el.append(spark.el, bar.el);
  list.appendChild(el);
  woc.ui.tooltip(el, () => tip(key));
  return { el, bar, spark };
}

function destroyRow(row) {
  row.bar.destroy();
  row.el.remove();
}

/**
 * A list takes the room it needs and an empty one takes none. The list is what grows into
 * whatever height the player dragged the panel out to, so an empty one grows into all of it
 * and pushes the sentence explaining why it is empty to the bottom edge. Emptying it hands
 * that room back and the sentence sits under the field, where the rows would have been.
 */
function growWhen(list, filled) {
  list.style.flex = '0 1 auto';
  if (filled) {
    list.style.flex = '1 1 auto';
  }
}

/** Sync one list to a reading: drop what has gone, build what is new, place the rest. */
function syncList(name, entries, tip) {
  const held = listRows.get(name) ?? new Map();
  const list = lists.get(name) ?? priceList;
  const filled = entries.length > 0;
  growWhen(list, filled);
  const top = listTops.get(name);
  if (top !== undefined) {
    setShown(top, filled);
  }
  const wanted = new Set(entries.map((entry) => entry.key));
  for (const [key, row] of held) {
    if (!wanted.has(key)) {
      destroyRow(row);
      held.delete(key);
    }
  }
  for (const [at, entry] of entries.entries()) {
    const row = held.get(entry.key) ?? buildRow(list, entry.key, tip);
    held.set(entry.key, row);
    row.bar.update(entry.update);
    paintSpark(row.spark, entry.trend);
    place(list, row.el, at);
  }
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
      // Said rather than left to be inferred: a bare figure at the end of a row reads as
      // the price, and this one is the cheapest per item anybody has been seen asking.
      value: { copper: Math.round(stats.low), prefix: 'low' },
      detail: `median ${money(Math.round(stats.median))}, ${countedVisits(stats.visits)}, last ${agoText(stats.at)}`,
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

function priceTip(itemId) {
  const record = series.get(itemId);
  if (record === undefined) {
    return { title: itemId, lines: ['This item is no longer in the ledger.'] };
  }
  const stats = statsFor(record);
  return {
    title: nameOf(itemId),
    icon: woc.ui.icon.item(itemId),
    lines: [
      `Low ${money(Math.round(stats.low))} each, median ${money(Math.round(stats.median))}, high ${money(Math.round(stats.high))}.`,
      `Latest ${money(Math.round(stats.latest))} each, read ${agoText(stats.at)}.`,
      `${countedVisits(stats.visits)} to the counter, and the low of each is one point of the line.`,
      {
        text: 'Every figure here is one vote per visit rather than one per listing, so a busy day does not outweigh a quiet one. Several pages read in one trip are one visit.',
        tone: 'muted',
      },
      queryNote(stats),
      {
        text: 'Prices are per item: a listing sells its whole stack for one price, and this divides by the count.',
        tone: 'muted',
      },
      nameNote(itemId),
    ],
  };
}

function pricesNoteText(matching) {
  if (!loaded.on) {
    return 'Reading the stored ledger.';
  }
  if (series.size === 0) {
    return 'Nothing recorded yet. Every page you read at a Merchant is written down here; the market itself keeps no history at all.';
  }
  const held = `${countedItems(series.size)} recorded, keeping ${String(historyDays())} days.`;
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
  syncList('prices', matching.slice(0, MAX_ROWS).map(priceEntry), priceTip);
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
      // A wash rather than a measurement, and the only place this addon draws a fill at
      // all. The kit paints a tone on the fill and nowhere else, so a toned row with no fill
      // is a verdict the player cannot see. It is the same width on every row that has one,
      // so there is no quantity to misread it as.
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
        // The line under a listing is the item's, and saying so matters more here than in
        // the price list: everything else on this row is the player's own asking price, so a
        // line beside it reads as the history of what they have charged.
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
    // The cap is already a figure in the strip, so this line spends itself on the one thing
    // no figure can say: what a verdict is drawn from and therefore cannot see.
    return 'Judged from the page you are reading now, which is not the whole market.';
  }
  return `Read ${agoText(live.page.at)}, at the Merchant. Your listings and everyone else's may have moved since.`;
}

function paintMine() {
  const { page } = live;
  if (page === null) {
    syncList('mine', [], () => '');
    say(mineNote, mineNoteText());
    return;
  }
  syncList(
    'mine',
    page.mine.map((row) => ownEntry(row, page)),
    (id) => ownTip(page, id),
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
 * The one sentence, drawn only when it has something to say.
 *
 * Every state where the figures above it could be misread gets one, and the state where
 * they cannot gets none: standing at the counter with no search applied, "Searching the
 * whole book." is a line spent saying that nothing unusual is going on. `say` hides an
 * empty line rather than leaving a gap.
 *
 * A search is worth the line, and it is the reason the query echo is read at all: a fresh
 * join resets the server-side query while the window's own controls keep showing it, so a
 * player can be looking at a filtered book believing it is the whole one.
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
 * What is waiting to be collected, off the same page every other figure here is off. The
 * flag is ungated by proximity and the amount is not, so a player who has walked away knows
 * there is something and knows only what the last page said it was. A page with nothing to
 * say it from says `something` rather than a number nobody has read.
 */
function collectText(page) {
  if (woc.world.marketCollectPending !== true) {
    return NO_FIGURE;
  }
  if (page === null) {
    return 'something';
  }
  return `${money(page.collectionCopper)}, ${countedItems(page.collectionItems)}`;
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
 * The collection badge. `marketCollectPending` is ungated by proximity, so this is right in
 * another zone entirely rather than only at the counter, which is why it is worth drawing:
 * the thing a player forgets is the gold they walked away from.
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
  paintTitle();
}

/**
 * One repaint per frame, however many things asked for one. A publisher catching this addon
 * up answers the ask with a message per id, and a repaint per message would be a hundred
 * rebuilds of the same list inside one frame.
 */
function schedulePaint() {
  if (scheduled.on) {
    return;
  }
  scheduled.on = true;
  woc.requestAnimationFrame(() => {
    scheduled.on = false;
    draw();
  });
}

// The page and the badge are separate keys: the page is gated on standing at the Merchant
// and the badge streams everywhere, which is what makes a title badge work with the pane
// closed and in another zone entirely.
woc.world.on('market', onMarket);
woc.world.on('marketCollectPending', () => {
  schedulePaint();
});

// The character is what says which market this is a history OF, and a player can change
// it without reloading the page. See `characterChanged`.
woc.world.on('characterKey', characterChanged);

// The subscription first and the ask second, because delivery is synchronous: a publisher
// that answers inside this emit call reaches a handler that already exists, and one
// registered afterwards would miss its own answer. Silence is ordinary.
woc.bus.on(woc.bus.anySender, ITEM_TOPIC, onItem);
woc.bus.emit(ASK_TOPIC);

woc.keys.bind('toggle', () => {
  frame.toggle();
});

woc.onSettingsChange(() => {
  // A shorter retention is a smaller ledger, applied at once rather than at the next page:
  // a player who cuts it to a day and still sees a month of rows would reasonably conclude
  // the setting does nothing.
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
    // Written down rather than left in memory: a retention the player shortened has to
    // survive the reload, or the next session reads back everything they cut.
    keep();
  }
  alerted.on = false;
  draw();
});

// Every age on screen is relative, so the panel rewrites them on a slow interval rather
// than joining the frame loop.
woc.setInterval(() => {
  schedulePaint();
}, AGE_TICK_MS);

/**
 * Read the item art manifest once, then repaint. Both art answers are provisional until it
 * lands: `ui.icon.item` hands back a hopeful URL and `ui.icon.itemArtName` hands back null.
 * It never rejects and nothing waits for it.
 */
async function learnArt() {
  await woc.ui.icon.preloadItems();
  if (running.on) {
    schedulePaint();
  }
}

// The one thing registered by hand. Everything else lives inside a kit widget or the frame
// body and is drained on disable, but both starts below are awaiting something and either
// continuation could otherwise resume against a frame already torn down.
woc.onDispose(() => {
  running.on = false;
  // A write may be sitting on its timer, and the timer is about to be disposed with
  // everything else. Whether it lands is not something an addon can insist on here, but the
  // alternative is knowingly dropping the last page the player read.
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
