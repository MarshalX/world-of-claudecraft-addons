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
// server sorts on under either order and therefore what the undercut check compares.
//
// BROWSE HAS TWO ORDERS as of game 0.37.1, and the second one changes what a page IS. Name-sorted
// (the default), an item's listings are contiguous and ascending, so the first copy on the page
// is the cheapest competitor and a block that did not start at row 0 started here. Price-sorted,
// the whole book ascends by total price across every item: page 0 is then the cheapest rows in
// the market, which is the strongest reading either order gives, and every page after it can hide
// a cheaper copy of anything. Both the undercut verdict and the recorded query carry the order,
// because a series folded across the two would be a median over one end of the book.
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
// IT TRAVELS AS A FILE, and the file MERGES. A visit carries two stamps rather than one: `at`
// slides forward as a trip is paged through, which is what keeps four pages one reading, and
// `first` is the moment the trip began and never moves, which is the only thing two copies of a
// ledger can agree on. Identity is `(first, query)`, so importing a device's own export adds
// nothing, and a file written mid-trip and imported after more browsing adds nothing either. A
// matched visit is widened rather than overwritten, so importing A then B leaves what importing
// B then A does. Both new fields are APPENDED to their positional rows and defaulted by their
// readers, so a store written before any of this reads with no migration pass at all.
//
// THE SALE RECORD CANNOT BE DEDUPED and is partitioned instead. A `MarketSaleRecord` has no id
// and no clock, and several sales drained in one go share the stamp this addon gives them, so two
// identical rows are indistinguishable from one row copied twice. Each row remembers which
// install drained it, an import keeps whichever side holds more of an origin's rows, and the one
// imprecision that survives is stated rather than hidden: two devices that both drained the same
// pending ledger record that sale twice, because nothing in the payload can prove they did not.
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

/** The vendor floor table this addon ships. Declared on the manifest, so `woc.data` will serve it. */
const FLOORS_FILE = 'floors.json';

/** Where this install's own id is kept, so an exported file can say which device wrote it. */
const INSTALL_KEY = 'install';

/** A kilobyte, for stating a file ceiling in the unit a person reads it in. */
const BYTES_PER_KB = 1024;

/** `2026-08-10`, the leading date of an ISO stamp, for naming a file. */
const DATE_LENGTH = 10;

/** Digits and letters, and the slice of one random fraction that is not `0.`. */
const BASE_36 = 36;
const RANDOM_START = 2;
const RANDOM_END = 10;

/**
 * The shape number an exported file carries.
 *
 * Read before anything else and refused when it is not understood, which is the opposite of how
 * the STORE is versioned: a store is this addon's own and grows by appending to positional rows
 * that its reader defaults, while a file is written by a build that may be newer than the one
 * reading it, and guessing at a shape somebody else wrote is how a merge corrupts a ledger.
 */
const FILE_VERSION = 1;

/** What an exported file calls itself, so a player can tell two of them apart in a folder. */
const FILE_PREFIX = 'ledgerline';

/**
 * The most a file may be before it is refused unread.
 *
 * A full ledger at every ceiling this addon keeps is around a third of a megabyte, so this is
 * several times the largest honest file and still small enough that a mistaken pick (a video, a
 * disk image) fails immediately rather than locking the tab up in `JSON.parse`.
 */
const MAX_IMPORT_MB = 4;
const MAX_IMPORT_BYTES = MAX_IMPORT_MB * BYTES_PER_KB * BYTES_PER_KB;

/**
 * Every listing seen at ONE visit to the counter, which is what makes a scan a scan.
 *
 * A page replaces the last one on the wire, so without this the panel forgets page 2 the moment
 * the player reaches page 3 and a deal can only ever be found on the page being looked at. The
 * ceiling is on listings rather than items because the book is paged 50 rows at a time and a
 * player working a filter reads a few hundred; the oldest reading goes first, since the book
 * moves under a scan and the stalest row is the one most likely to be gone.
 */
const MAX_SCAN = 1500;

/**
 * How many OTHER listings of an item have to be in hand before their second-cheapest is treated
 * as a price rather than as one stranger's opinion, and how many prior visits before a recorded
 * median is. Three of either is where a figure stops being a coin flip; two is drawn and said to
 * be thin; one is not a comparison at all and fires nothing.
 */
const FIRM_RIVALS = 3;
const FIRM_VISITS = 3;
const THIN_EVIDENCE = 2;

/**
 * How close a stack's TOTAL has to sit to a plausible unit price before the cheapness is
 * reported as a typo rather than as a bargain. A tenth: the fat-finger this catches is a whole
 * stack posted at one item's price, which lands within rounding of the anchor rather than near
 * it.
 */
const STACK_SLIP = 0.1;

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

/**
 * The filter axes the server echoes, in the game's own field names rather than ones of ours.
 *
 * `filter` is free text and is empty when unset. The other five are ENUMS whose unset value is
 * the word `all`, which is not a filter and must never be read as one: taken literally, a player
 * who has filtered nothing gets "Searching all, all, all, all, all" across the top of the panel.
 */
const QUERY_FIELDS = ['filter', 'itemType', 'subtype', 'armorClass', 'primaryStat', 'rarity'];

/** What the five enum axes carry when nothing is chosen. `defaultMarketQuery` in the game's sim. */
const NO_FILTER = 'all';

/** What a query with nothing set is called, so a series can say which it came from. */
const NO_QUERY = 'the whole book';

/** The order Browse has always used, and still defaults to: display name, then price. */
const NAME_SORT = 'name';

/** What the second order is called on screen, since `price` alone does not say which end. */
const PRICE_SORT_LABEL = 'cheapest first';

/** A flag in a cell, so a handler and the paint path cannot hold different copies of it. */
function cell(value) {
  return { on: value };
}

/** Item id to what somebody published about it, plus who published it. */
const names = new Map();
/** Item id to its recorded series. See `emptySeries`. */
const series = new Map();
/** Item id to `{ sellValue?, buyValue?, noVendorSell? }`, off the shipped table. See `readFloors`. */
const floors = new Map();
/** Which game the floor table was read from, because a price is a claim about a version. */
const floorsFrom = { version: '' };
/**
 * This install's own id, which is what lets a sale record say which device drained it.
 *
 * Account-wide rather than per character, because it identifies the STORE rather than the player.
 * If a userscript manager is syncing values then two machines share this id, and that is correct
 * rather than a flaw: they share the store too, so there is nothing between them to import.
 */
const install = { id: '' };
/**
 * Listing id to what was seen of it at this visit to the counter. MEMORY ONLY, and deliberately:
 * it is a photograph of a book that moves, so a persisted one would be presented as current an
 * hour after it stopped being true.
 */
const scan = new Map();
/** Query signature to which pages of it have been read this visit, and how big it said it was. */
const covered = new Map();
/** Listing ids already announced this visit, so paging back over one is not a second toast. */
const announced = new Set();
/**
 * What each pane last DREW, for the tooltips to read.
 *
 * A tooltip's content function runs when the pointer arrives, which is after the paint that put
 * the row there, so it cannot recompute from the buffer without risking answering about a
 * different reading than the one under the pointer.
 */
const shown = { deals: new Map() };
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
 * One field of the game's own payload, by a name held in a variable. The computed access is
 * the point: a literal key here would be this project naming a field it does not own.
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
 * The browse ORDER, and empty for the one Browse has always used.
 *
 * Read on its own rather than as a seventh entry in `QUERY_FIELDS`, because its unset value is
 * `name` where every enum axis there spells nothing-chosen as `all`. Run through `axisText` it
 * would put the word into the signature of every default-sorted trip, which is every trip ever
 * recorded: a ledger written before this line would stop matching the visit that continues it,
 * and a trip flipped through while this shipped would split in two. Empty for the default keeps
 * every existing signature byte-identical, and only a price-sorted reading is new.
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

/**
 * The lines that had something to say.
 *
 * Every note builder answers null for the ordinary case, so a tooltip is assembled by listing
 * every line it COULD carry and letting the ones with nothing to add drop out. That is what
 * keeps a tooltip at two lines on a row where nothing is unusual and at five on one where four
 * things are.
 */
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

/**
 * The same age as `agoText`, in the fewest characters that still say it.
 *
 * A row's second line is read by the column it sits in rather than as a sentence, so "6 hours
 * ago" is five words where "6h" is the fact. The long form stays, for the tooltips, where the
 * line IS a sentence.
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

/**
 * The tag a heroic variant wears, which is `lorebind`'s own so that two addons naming one item
 * name it the same way.
 */
const HEROIC_TAG = '[HEROIC]';

/**
 * Never blank. A publisher outranks the loader here, which inverts the usual order: what the
 * loader has is an art file's name and says so in its own documentation.
 *
 * THE TAG IS NOT DECORATION. A heroic upgrade is a separate item with a separate id, a separate
 * price and a separate series, and the game gives the pair ONE display name: 63 of them at game
 * 0.35.1. Untagged, a book with both in it draws two rows called Wildheart Tuskblade at prices a
 * long way apart, and there is nothing on screen to say why, so the panel reads as though it is
 * reporting one item twice and disagreeing with itself. Worse on a deal row, where the profit is
 * true and the player cannot tell which of the two listings it was worked out for.
 *
 * It rides on `heroicOf`, which `lorebind` publishes, so an installed publisher is what makes
 * the pair separable at all: `ui.icon.itemArtName` has one name for both. Without one the rows
 * fall back to the raw ids, which differ, so the failure degrades into something ugly and
 * truthful rather than into something tidy and wrong.
 */
function nameOf(itemId) {
  const record = known(itemId);
  const name = record?.name ?? artName(itemId) ?? itemId;
  if (record?.heroicOf === undefined || record.heroicOf === '') {
    return name;
  }
  return `${name} ${HEROIC_TAG}`;
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
  return {
    id: itemId,
    name,
    quality: text(payload.quality),
    kind: text(payload.kind),
    // The id this one upgrades, which is the ONLY thing separating two rows that carry the same
    // display name. See `nameOf`.
    heroicOf: text(payload.heroicOf),
    // A publisher's floor OUTRANKS the shipped table, because a running lorebind may have been
    // regenerated against a newer game than this addon's own file was.
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

/**
 * One row of the shipped table, checked. `woc.data` hands back `unknown`: the loader proves the
 * file is JSON when it fetches it and says nothing about what is inside.
 */
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
 * The table, or null. A failure here costs the two CERTAIN signals and nothing else, so it is
 * reported and the addon carries on: everything the ledger itself does is unaffected.
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
 * What a vendor pays per unit, or null where nothing can be claimed.
 *
 * Null covers three different facts that must not be told apart by the caller, because all three
 * mean the same thing to a trader: no table row, a row with no `sellValue`, and a row the vendor
 * refuses outright. The last is why `noVendorSell` is in the file at all: without it the two
 * hundred items a vendor will not touch would each be offered as a guaranteed sale.
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
 * The lowest price at which the item is available FOREVER, per unit, or null.
 *
 * Two sources and they are the same fact: the Merchant's own standing stock, which never
 * depletes and never expires, and the vendor's shop price. An ask above either can never sell,
 * because the buyer walks to a counter that will still be selling it tomorrow. The house rows
 * arrive on the page, so that half needs no table.
 */
function everCeiling(itemId, page) {
  const shop = floors.get(itemId)?.buyValue ?? null;
  const house = housePrice(itemId, page);
  if (shop === null) {
    return house;
  }
  if (house === null) {
    return shop;
  }
  return Math.min(shop, house);
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
  const parts = QUERY_FIELDS.map((name) => axisText(info, name));
  const order = sortText(info);
  if (order !== '') {
    parts.push(order);
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
    byPrice: sortsByPrice(info),
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
  // `first` is APPENDED, so a ledger written before it existed reads with no migration pass at
  // all: the slot is empty and the reader supplies the only value it can, which is the stamp it
  // does have. That reading is an inference rather than a record, which is why `mergeVisits`
  // keeps the fold rule as a fallback instead of trusting identity alone.
  const first = numberOr(value[4], 0) * MS_PER_SECOND;
  return { at, low, high, query: text(value[3]), first: startedAt(first, at) };
}

/** The recorded start, or the only stamp a ledger written before `first` existed can offer. */
function startedAt(first, at) {
  if (first > 0) {
    return first;
  }
  return at;
}

function storedVisit(visit) {
  return [
    Math.round(visit.at / MS_PER_SECOND),
    visit.low,
    visit.high,
    visit.query,
    Math.round(visit.first / MS_PER_SECOND),
  ];
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
  // `at` slides as the trip goes on, which is what keeps four pages one visit; `first` is the
  // moment the trip started and never moves, which is what gives the visit an identity two
  // devices can agree on. See `mergeVisits`.
  record.visits.push({
    at: page.at,
    first: page.at,
    low: ask.low,
    high: ask.high,
    query: page.query,
  });
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
    origin: install.id,
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
  // APPENDED like `first` above. An empty origin is a row drained before origins existed, which
  // can only have been this device: the store is local and nothing else has ever written to it.
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

/** An array in seconds, for the economy the visits are stored with. */
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
 * Which held visit an incoming one IS, or null for one this ledger has never seen.
 *
 * Two rules, and the order is the whole of the delta guarantee. `first` is the moment a trip
 * began and never moves, so two copies of one reading agree on it however much paging happened
 * afterwards: that is what makes re-importing a device's own file add nothing. The fold rule
 * behind it is for readings recorded before `first` existed, whose inferred start moved with the
 * trip, and it is the same rule `foldVisit` applies live, so a match here is a match the addon
 * would have made anyway had both readings arrived on one device.
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
 * Fold one incoming visit into a record, and answer whether it was new.
 *
 * A matched visit is WIDENED rather than overwritten, which is what makes the merge order-free:
 * the two copies are readings of one trip, so the union of what each saw is the trip, and
 * importing A then B leaves exactly what importing B then A does.
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
 * Merge a whole incoming ledger into the one in memory, and say what it did.
 *
 * The retention cutoff is applied to what ARRIVES as well as to what is kept, or a file exported
 * two months ago would put back the readings the player's own setting has since dropped.
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
 * Merge an incoming sale record, per ORIGIN and per item, keeping whichever side holds more.
 *
 * A `MarketSaleRecord` carries no id and no clock, and several sales drained in one go share the
 * stamp this addon gives them, so two rows identical in every field are indistinguishable from
 * one row copied twice. Nothing content-based can dedup them. What CAN be relied on is that one
 * device's log for one item only ever grows: it is appended to as the Merchant's queue is
 * drained and never edited. So the longer of two copies is a superset of the shorter, keeping it
 * loses nothing, and re-importing an older file changes nothing at all.
 *
 * The imprecision that survives is real rather than hidden: if two devices both stood at the
 * Merchant and drained the same pending ledger, that sale is on record twice under two origins,
 * because nothing in the payload can prove it was not two sales.
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

/**
 * Every listing on this page into the visit's buffer, and what the page said about its own size.
 *
 * A row is never edited once it exists, so re-seeing one moves nothing but the stamp. Deliberate:
 * a price that appeared to change would be the wire surprising us, and overwriting it here is how
 * that would go unnoticed.
 */
function foldScan(page) {
  // YOUR OWN LISTINGS TOO. They are not something to buy, and `buyableDeal` refuses them, but
  // they are absolutely competition: a buyer takes the cheapest copy on the counter and does not
  // care whose it is. Left out, the panel prices a resale against strangers alone, so a player
  // who has just bought a cheap copy and relisted it is told to buy another and sell it at a
  // price their own listing is already undercutting. That is the case this fold exists for.
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
 * Forget a listing this trip has stopped seeing.
 *
 * Walking away is not the only way a reading goes stale, and it is not the common one: a player
 * can stand at the counter for an hour, and a row read at the start of it may have been bought
 * long since. Worse, a stale row is not merely absent from the display, it ANCHORS one: the
 * cheapest thing in the buffer is what a resale is priced against, so yesterday's cheap listing
 * makes today's ordinary one look like a bargain and quietly beats the live page it should be
 * losing to. The same window a visit is folded over, for the same reason: it is how long one
 * trip through the book lasts.
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

/** How much of each query has been read this visit, which is the honest limit on every figure. */
function noteCoverage(page) {
  const held = covered.get(page.query) ?? { label: page.queryText, pages: new Set() };
  held.pages.add(page.page);
  held.pageCount = page.pageCount;
  held.totalCount = page.totalCount;
  covered.set(page.query, held);
}

/** The stalest reading goes first: the book moves under a scan, so the oldest row is the likeliest gone. */
function trimScan() {
  if (scan.size <= MAX_SCAN) {
    return;
  }
  const order = [...scan.values()].sort((a, b) => a.lastSeen - b.lastSeen);
  for (const row of order.slice(0, scan.size - MAX_SCAN)) {
    scan.delete(row.id);
  }
}

/** A visit is a scan, and walking away ends it. See `MAX_SCAN` for why none of this is stored. */
function clearScan() {
  scan.clear();
  covered.clear();
  announced.clear();
}

/** Pages read against pages there are, over every query this visit. Both are drawn, never a ratio. */
function coverageNow() {
  let read = 0;
  let total = 0;
  for (const held of covered.values()) {
    read += held.pages.size;
    total += Math.max(held.pages.size, held.pageCount);
  }
  return { read, total, queries: covered.size, listings: scan.size };
}

/** Everything seen this visit for one item, cheapest first, the Merchant's own stock left out. */
function offersOf(itemId) {
  const rows = [];
  for (const row of scan.values()) {
    if (row.itemId === itemId && !row.house) {
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.unit - b.unit);
}

/**
 * What a resale could fetch per unit against the listings themselves, or null.
 *
 * The cheapest OTHER offer, which is the whole rule: to sell you have to be the cheapest, so what
 * you can ask is set by whoever is still there once you have bought this one. It follows that
 * only the cheapest listing of an item can ever be a buy, and that falls out of the arithmetic
 * rather than needing a test of its own.
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
 * The recorded median, EXCLUDING the visit being folded right now.
 *
 * `foldPage` writes the live page into the series before anything reads it, so a median over
 * every visit includes the very row being judged: one cheap listing drags down the baseline it
 * is then found to be under, and the panel reports a bargain it invented. The last visit is
 * therefore dropped, and two priors are the fewest that can be a comparison at all.
 */
function recordedAnchor(itemId) {
  const record = series.get(itemId);
  if (record === undefined) {
    return null;
  }
  const prior = record.visits.slice(0, -1);
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

/**
 * Whether the whole stack was priced as though it were a single item.
 *
 * Worth naming on the row rather than leaving as a bargain, because it tells the player the
 * cheapness is somebody's typo and not a trap, and a typo is the one kind of underpricing that
 * says nothing at all about what the item is worth.
 */
function stackSlip(row, unit) {
  if (row.count <= 1 || unit <= 0) {
    return false;
  }
  return Math.abs(row.price - unit) <= unit * STACK_SLIP;
}

/**
 * What ONE of these normally costs, which is not the same question the resale anchor answers.
 *
 * The resale anchor is deliberately the most cautious price any source will stand behind, and
 * measuring a typo against it hides the typo: a stack of twenty posted at one item's price stops
 * looking like one the moment a cheaper anchor is chosen, and the row loses the label naming the
 * only kind of underpricing that says nothing about what the item is worth. The DEAREST estimate
 * is the right reference here for the same reason the cheapest is right there.
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
 * ONE resale arm: the CHEAPEST price either source says the item can be had for.
 *
 * Both arms are estimates of the same thing, what somebody will actually pay, so where both fire
 * they are not alternatives to choose the better of. Taking the richer one systematically picks
 * whichever source is currently most optimistic, and on a thin item that is one stranger's
 * asking price: a lone rival at fifty gold against a recorded median of nine turns a nine gold
 * item into a thirty-eight gold profit, which then sorts to the top of the list ahead of every
 * well-evidenced row on it. The lower of the two is what the item can be sold for today.
 *
 * The vendor floor is not in here and must not be: it is a CERTAINTY rather than an estimate of
 * the same quantity, and it is carried beside the figure rather than averaged into it.
 */
function resaleArms(row, page, ceiling) {
  const arms = [
    resaleOption('page', cappedAnchor(rivalAnchor(row), ceiling), row, page),
    resaleOption('history', cappedAnchor(recordedAnchor(row.itemId), ceiling), row, page),
  ].filter((arm) => arm !== null);
  const cautious = arms.reduce(lowerAnchor, arms[0] ?? null);
  if (cautious === null) {
    return [];
  }
  // The dearest estimate rides along on the arm that won. It is not a price this addon will
  // recommend anything at, which is why it is not an option of its own; it is what one of these
  // NORMALLY costs, and `stackSlip` needs that to recognise a whole stack posted at one item's
  // price. Measured against the cautious anchor instead, a typo stops looking like one exactly
  // when a cheaper source wins, which is when the row most needs to say what happened.
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

/**
 * One resale arm, or null. The two differ only in where the anchor came from and what backs it,
 * so they share this: a second copy of the cut arithmetic is a second place it can be wrong.
 */
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
 * What this listing is worth doing something about, or null.
 *
 * The BEST expected profit decides the row, and the vendor floor rides beside it rather than
 * replacing it: a stack that clears 20 copper at a vendor and 5 silver on a resale is a 5 silver
 * row that also cannot lose money, and reporting the 20 would bury it under rows worth less.
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
 * A deal on a listing somebody could actually corner, or null.
 *
 * The Merchant's own stock is never one: it never depletes, so buying it moves no price and
 * reselling it competes with a counter that will still be selling tomorrow.
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
 * The first row of the item on this page, which is its cheapest one here under EITHER order.
 *
 * Name-sorted, the server groups an item's listings and sorts them by price, so the block is
 * contiguous and ascending. Price-sorted, the whole page ascends by price across every item, so
 * the rows are scattered and the first one found is still the cheapest of them. No name table is
 * needed either way. What the two orders do NOT share is what lies off the page, which is what
 * `verdictFor` has to answer for.
 */
function blockStart(others, itemId) {
  return others.findIndex((row) => row.itemId === itemId);
}

/**
 * `unknown` where the item has no block on this page, which under a filter is most of the market
 * and is never evidence that nobody is selling. `partial` where cheaper rows of the same item
 * could be on a page that was not read, which each order reaches differently.
 *
 * Name-sorted, that is only the block starting at the very first row of a later page, because a
 * contiguous block starting anywhere else began here. Price-sorted, an item's rows are spread
 * across the whole book by price, so ANY later page can have a cheaper copy behind it whatever
 * row the block starts at, and the block-start guard cannot see it. Page 0 of a price-sorted
 * book is the opposite case and the strongest reading either order gives: it holds the cheapest
 * rows of the whole book, so a copy found there is the cheapest anywhere.
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
  if (page.page > 0 && (at === 0 || page.byPrice)) {
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
  clearScan();
}

function onNear(info) {
  const now = woc.wallClock();
  lastRead.reconnects = reconnectCount();
  resyncing.on = false;
  const arriving = live.status !== 'near';
  live.status = 'near';
  if (arriving && dealsFirst()) {
    // On ARRIVING rather than on every page, or a player who switched to Prices at the counter
    // would be dragged back to Deals by the next snapshot.
    tabs.select('deals');
    showPane('deals');
  }
  const page = capture(info, now);
  live.page = page;
  if (loaded.on) {
    recordPage(page);
    recordSales(info, now);
  }
  // AFTER the fold, because the recorded anchor is the one that has to exclude the visit being
  // written; before it, `recordedAnchor` would be dropping a visit that is not there yet.
  foldScan(page);
  announceDeals(page);
  checkUndercut(page);
}

/**
 * One toast for what this page just put in front of the player, on the CROSSING rather than the
 * state: paging back and forth over one good listing is one announcement, not a stream of them.
 * Silent by default, because a notifier that fires on every page is one that gets switched off.
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
 * The panel. COMPACT rather than the game's own scale: this is a table of figures a player
 * glances at while working the Merchant's window beside it, and at the comfortable scale a
 * screenful is five rows. The kit's own controls and tabs follow the density for free.
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
// A frame's body does not grow, since a frame is normally sized by what it draws. A resizable
// one is the exception, or the height the player dragged out is dead space under the content.
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
    // First, and the default while the player is standing at the counter: it is the only pane
    // that says what to DO, and the other three are all archives of one kind or another.
    { id: 'deals', label: 'Deals' },
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
/**
 * THREE figures, where there were five.
 *
 * Page and cut left. The page number is on the game's own market window, three inches to the
 * left of this panel and larger, and the cut is a constant a player learns once; both are still
 * read off every page, and both are still said, in the tooltip on the title where a fact that
 * matters twice a year belongs. What is left is the state this panel is in, how much of the
 * seller's cap is spent, and what is waiting to be collected, which is the one figure here that
 * asks the player to go and do something.
 */
const statusStrip = strip(frame.body, 'status');
const whereStat = stat(statusStrip, 'where', 'At');
const capStat = stat(statusStrip, 'cap', 'Listings');
const collectStat = stat(statusStrip, 'collect', 'Waiting');
const statusLine = line(frame.body, 'status-line');
// Where the page number and the cut went. On the strip rather than on the title bar, because the
// strip is this addon's own element and is the place those two figures used to be.
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
 * The whole ledger as a file, with the query strings interned.
 *
 * A query is stored on every visit and is the same handful of strings over and over, so it is
 * most of an uncompressed archive: interning takes a full ledger from around 489 kB to 332 kB
 * without dropping a single reading. Dropping readings is the alternative and it is not one,
 * because a digest of lows and medians cannot be MERGED, and a file that cannot merge cannot be
 * imported twice without duplicating everything it carries.
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

/** The sale record as a file section, which is per character where the ledger is per realm. */
function exportedSold() {
  const items = {};
  for (const [itemId, record] of sold) {
    items[itemId] = record.sales.map(storedSale);
  }
  return items;
}

/**
 * Everything this addon would hand another device, and the four facts that say whose it is.
 *
 * The channel and the realm are a GATE rather than a label: a market is per realm and the two
 * channels serve different content, so merging one into another is a corruption nothing
 * afterwards can find. The character gates the sale half alone, since the Merchant keeps a
 * collection per seller.
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

/**
 * Why this file cannot be merged, or null.
 *
 * Every branch NAMES both sides. A refusal that only says no leaves a player holding a file they
 * believe in with no way to find out what is wrong with it.
 */
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

/**
 * Write the file out.
 *
 * A download rather than something to copy: a full ledger is a third of a megabyte, which is
 * nothing as a file and unusable as a paste, and the only way to make it pasteable is to drop
 * to a digest, which cannot be merged.
 */
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
 * Ask for a file and merge it.
 *
 * The input is built and thrown away per press rather than kept: a file input remembers its last
 * pick and does not fire `change` when the same file is chosen twice, which is exactly what
 * somebody re-syncing does.
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

/**
 * Merge a file, or say why not.
 *
 * DELTA, always. Every reading is matched against what is already held and only what is new is
 * added, so importing the same file twice, or a device's own export, changes nothing and says so.
 * Nothing here replaces anything.
 */
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

/** The sale half, gated on the CHARACTER where the ledger is gated on the realm. */
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
 * The two controls that move a ledger between machines.
 *
 * Buttons rather than a menu, because `ui.menu` runs its handler AFTER the menu has closed and a
 * file input clicked outside a user gesture is refused; the click on a button is the gesture.
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

/**
 * ONE bar and nothing around it.
 *
 * There was a wrapper here, holding the bar over a 16px lane for a trend line drawn as the row's
 * background. It cost every row in every pane that lane whether or not anything was drawn in it,
 * which on a panel that is four lists of rows is most of the panel's height, and the line itself
 * answered nothing quantitative: no stated range, an opacity that read as a stray sloped
 * divider, and it crossed the boundary between rows. What the line was for, where today's price
 * sits against its own record, is a `fraction` now, which the kit already draws and which costs
 * no height at all.
 */
function buildRow(key, tip) {
  const bar = woc.ui.bar({ className: 'woc-ledgerline-bar' });
  bar.el.dataset.row = key;
  woc.ui.tooltip(bar.el, () => tip(key));
  return bar;
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
    update: {
      label: nameOf(record.itemId),
      icon: woc.ui.icon.item(record.itemId),
      quality: qualityOf(record.itemId),
      // NO FILL, and the reason is the one the row builder used to give for having none: a fill
      // is a SHARE of something, and one item's price is not a share of another's. A fill of
      // "where today sits inside this item's own range" looked like the exception and is not,
      // because a market price mostly does not move: a listing lives 48 hours and a thin book
      // reprices slowly, so the range is empty and every row on screen draws the same half fill.
      // A magnitude that is identical on every row is not a magnitude. Deals and Sold keep
      // theirs, because a share of the best profit and a share of what you earned are real
      // shares; this pane's magnitude is the price itself, in the figure at the end of the row.
      // Labelled: a bare figure at the end of a row reads as the price, and this is the
      // cheapest per item anybody has been seen asking.
      value: { copper: Math.round(stats.low), prefix: 'low' },
      detail: `median ${money(Math.round(stats.median))}, ${woc.fmt.count(stats.visits, 'visit')}, ${briefAgo(stats.at)}`,
    },
  };
}

/** Where a name came from, said plainly, because two of the three are not the item's. */
/**
 * Null where the name is trustworthy, which is nearly always.
 *
 * It used to answer "Name published by lorebind" on every row that had one, and a line that is
 * on every tooltip is not a tooltip line: it is the addon telling the player how it works, once
 * per hover, forever. What is left is the two cases that are a WARNING about this item.
 */
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
    text: `You sold ${woc.fmt.count(stats.sales, 'sale')} at a median of ${money(Math.round(stats.median))} each, which is what was PAID rather than asked.`,
    tone: 'muted',
  };
}

/**
 * What this item has been going for, in ONE line.
 *
 * It was two, reporting a low, a median, a latest and a high. In a thin book that is the same
 * number four times: a listing lives 48 hours, few items have more than a listing or two, and
 * the cheapest ask simply does not move between visits, so the tooltip spent four figures saying
 * one thing. Where it HAS moved the figures differ and are all drawn; where it has not, saying so
 * once is the whole of what is known.
 *
 * The dearest ask is dropped either way. It is the top of the spread rather than of the trend,
 * so it sits beside three figures it is not comparable with, and nobody buys at it.
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

/**
 * What each signal ANCHORED on, in the words a TOOLTIP uses. The row says it in one token; see
 * `evidenceWord`.
 */
const ANCHOR_WORD = new Map([
  ['vendor', 'vendor pays'],
  ['page', 'next ask'],
  ['history', 'your median'],
]);

/**
 * What stands behind a row's figure, counted rather than graded.
 *
 * This replaced the words thin, firm and certain, and the reason is what a real market looks
 * like: most items have one or two listings, so "thin" was on every row of every screenful and a
 * value that never varies is not information. A count varies, is shorter, and says the same
 * thing without asking anybody to learn what the grade meant.
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

/** How many of an item a row is, where saying so adds anything. */
function stackLabel(row) {
  if (row.count <= 1) {
    return nameOf(row.itemId);
  }
  return `${nameOf(row.itemId)} x${String(row.count)}`;
}

/**
 * A fixed-shape clause rather than a sentence, which is the whole point: three fields in the
 * same order on every row, so two rows can be compared by looking at one position rather than
 * by reading both of them.
 */
/**
 * What the stack costs, and what that figure rests on. Two fields, and no word that would be the
 * same on every row.
 *
 * The RESALE price is not here on purpose. It was, and with the buy price and the profit already
 * on the row it made a three-number second line under a two-number first one, which is a table
 * nobody can read at a glance. The profit is the decision, the cost is whether the player can
 * act on it, and the price the profit was worked out against is verification, which belongs
 * under the pointer.
 */
function dealDetail(deal) {
  const said = `buy ${money(deal.row.price)}, ${evidenceWord(deal)}`;
  if (deal.stack) {
    return `${said}, stack priced as one`;
  }
  return said;
}

/**
 * The fill is the row's profit against the best on screen, which is a real share and is the one
 * a ranked list wants: the eye reads the ordering off the widths without reading a figure.
 */
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

/** A row's profit against the best on screen. Zero where there is no best, which is no rows. */
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

/**
 * Which game the floor table was read from, said rather than assumed.
 *
 * A vendor price is a claim about a VERSION: content re-prices, and a table stamped two releases
 * back goes on answering with the old number and nothing on the wire disagrees with it.
 */
function floorVersion() {
  if (floorsFrom.version === '') {
    return 'an unnamed version';
  }
  return floorsFrom.version;
}

/** Where the anchor came from, at length, which is the half a three-field clause cannot carry. */
function anchorLines(deal) {
  if (deal.signal === 'vendor') {
    return [
      { text: 'A vendor pays that flatly, so this profit is not an estimate.', tone: 'good' },
      { text: `Floor read from game ${floorVersion()}.`, tone: 'muted' },
    ];
  }
  if (deal.signal === 'page') {
    if (deal.againstMine) {
      // The most useful thing this pane can say about a thin item, and the only place it can be
      // said: the cheapest thing standing between this and a sale is the player's own listing.
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

/** Who is asking. A blank name is a row the wire sent without one rather than an anonymous seller. */
function sellerOf(row) {
  if (row.seller === '') {
    return 'a seller the page did not name';
  }
  return row.seller;
}

/** The honest limit on every figure in this pane, in one sentence, in one place. */
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
  if (count === 0) {
    return `Nothing on what you have read clears ${money(minProfit())}. ${coverageText()}`;
  }
  return coverageText();
}

/** Nothing at all away from the counter: a deal is a listing somebody can still walk over and buy. */
function dealsShowing() {
  const { page } = live;
  if (page === null || live.status !== 'near') {
    return [];
  }
  return dealsNow(page);
}

/**
 * The list, and the sentence under it. Ranked by what a stack clears, never by how deep the
 * discount is: nine tenths off a three copper item is twenty seven copper.
 */
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

/**
 * The stack, the unit price and the verdict, and nothing else.
 *
 * The stamp this used to carry ("first seen by you 6 hours ago") was the longest clause on the
 * longest line in the panel, and it is this addon's own record of when it noticed the listing
 * rather than anything the game says about it. That belongs under the pointer.
 */
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
      label: nameOf(row.itemId),
      icon: woc.ui.icon.item(row.itemId),
      quality: qualityOf(row.itemId),
      value: { copper: row.price, prefix: 'asking' },
      tone,
      // A wash rather than a measurement: the kit paints a tone on the FILL and nowhere else,
      // so a toned row with no fill is a verdict nobody can see. One width, so it reads as none.
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
  // Undercut and cheapest are BOTH already on the row, in the word the detail line ends with and
  // in the wash behind it, and the line above this one names the rival and its price. Saying
  // either again is the tooltip repeating the thing the player is pointing at.
  return null;
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

function mineNoteText() {
  if (live.page === null) {
    return 'Walk up to a Merchant and your listings are read from the page it sends.';
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
 * The headline is the GROSS per item, which is what compares with the asks on the Prices tab.
 * The net is on the detail line and labelled: summing the wrong one overstates by the cut.
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
      // "2 sales, 40 sold" rather than "2x, 40 sold": two counts side by side need one of them
      // to say what it counts, or the pair reads as a quantity times a quantity.
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
        // The stamp and its caveat in ONE line, because a stamp with no caveat reads as when the
        // sale happened: the Merchant's pending ledger carries no clock, so this is when this
        // addon drained the row and several sales read in one go share it.
        text: `Read ${agoText(stats.at)}, which is when this drained it rather than when it sold.`,
        tone: 'muted',
      },
      nameNote(itemId),
    ]),
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
  // "Your own" is the one thing a reader could get wrong here, and it belongs in the ONE line
  // under the list rather than on every row's tooltip: the market keeps no record of what
  // anybody else sold anything for, so nothing on this tab is a market rate.
  return `${woc.fmt.count(sold.size, 'item')} of your own sales, keeping ${String(historyDays())} days.${missing}`;
}

function paintSold() {
  const records = [...sold.values()].sort((a, b) => b.at - a.at);
  const drawn = records.slice(0, MAX_ROWS);
  // The share is against the biggest EARNER on screen rather than the most recent, so the fill
  // answers which item has actually been paying, which the newest-first ordering does not.
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
  setStat(capStat, capText(page));
  setStat(collectStat, collectText(page));
  say(statusLine, statusText());
}

/** The two figures the strip no longer spends a line on. See `statusStrip`. */
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
  paintDeals();
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

/**
 * This install's id, made once and kept.
 *
 * `randomUUID` is only defined in a secure context, and a player on a plain http mirror of the
 * game is in an insecure one, so the fallback is not decoration: without it that player's sale
 * rows would carry no origin at all and an import could not tell theirs from a file's.
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
 * The vendor floors, which are the only prices here that come from anywhere but browsing.
 *
 * A failure costs the two CERTAIN signals and nothing else, so it is reported and the panel
 * carries on: every figure the ledger itself draws is inferred from pages and is unaffected.
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
learnFloors().catch((err) => {
  woc.warn('ledgerline: the vendor floors could not be read, so no deal is certain', err);
});
learnInstall().catch((err) => {
  woc.warn(
    'ledgerline: this install could not be named, so an export cannot say where it came from',
    err,
  );
});
