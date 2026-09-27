/// <reference types="@woc-addons/types" />

// Satchel: where your things are, across every character on the account. It answers what the
// client cannot: what another character holds, what is in a bank or mailbox you are not standing
// at (both reads are proximity gated), and how many of something you own and where.
//
// Every pane is drawn from a record, refreshed from the live world before every paint for the
// character in play. An alt's bank and a walked-away bank are the same case, and both must show
// their age: an old reading is never presented as current.
//
// Only `near` is ever recorded. `world.bank` and `world.mail` are three-state, and writing on
// `away` erases a character's bank the moment they walk off.
//
// The key is `world.characterKey`, as `woc.storage.character` uses, prefixed with the channel
// (the loader prefixes only its own namespaces, and a PBE copy shares realm and name). Storage is
// account-wide, one key per character: a per-character store could only answer about the one in
// play, and one blob would rewrite every character on every write. Stamps are `woc.wallClock()`,
// since a monotonic reading restored into a fresh page is a moment in 1970.
//
// The lock is recorded because you cannot log in as someone else to check it. Only your own bags
// and bank carry it: the server trims payloads elsewhere, so a parcel counts as unlocked and every
// line says which stores it counted. Nothing here can toggle one: `net` is read-only.
//
// The vault is a count per material against one shared cap, with no cells or free-slot figure.
// Only `special` holds stacks, and nothing else may reach the stack reader, or the Bags pane
// offers a merge into a 400 stack. Vault counts fold into the Items pane totals.
//
// The bank's split is sent; the carried one is derived. `capacity - slots.length` offers room the
// bank will refuse, so both panes go through one `freeSpace`, which prefers a sent split.
//
// A cell is an entry and an item is a total. Used slots is `inventory.length`, never the sum of
// counts, or 300 ore overdraws 52 cells; the Items pane sums.
//
// No API names an item. `ui.icon.item` answers null for an id with no file, so a blank face means
// no art, not a wrong id. `ui.icon.itemArtName` names a picture; a bus publisher outranks it, it
// outranks the raw id, and the tooltip says which was used.
//
// Capacity is pooled into one number, and `bagCapacity` has no watch key, so this subscribes to
// `bags`. `InvSlot.slot` is honoured and recorded, so an alt's bags draw as that alt arranged
// them. The observed stack maximum is a lower bound and says so.
//
// That pooled number is not a fit answer: carried cells are a general pool and a materials-only
// pool, and the game derives the split per render. `bags.json` (from `generate.mjs`, regenerated
// on a game release) ships the facts behind it. `Free` is general headroom, materials-only room
// is its own chip, and without the split the panel falls back to the pooled figure and says so.
//
// No sort, merge, sell or withdraw: those are commands and the loader sends none, so any tooltip
// about an action says nothing here can do it. Market prices belong to their own addon.
//
// Bus contract: `item` is one record, `items` a batch. Subscribe with `woc.bus.anySender`, never a
// hardcoded fqid, since a fork publishes under another name and `message.from` is what a tooltip
// credits. Ask once and draw without waiting; silence is ordinary.
//
// A price has no source but those records, so every total is arithmetic over what somebody
// published. An unpriced item is left out, never added at zero; every total says how many kinds
// it priced; with none priced the chip is not drawn, since `0c` would be a claim. It is a vendor
// price, a floor, and every sentence says so. It shows on the square as well as the index row.
//
// A published tier is a kit axis: `quality` colours a bar's label and a tile's border. The three
// id-derived marks (split, spare, carried) sit on a corner pip, since a tone beats a tier and none
// of them is urgent. Tone on a square means the one urgent thing a bag has.
//
// Three layout rules that bite together. Hide with `woc.ui.show` (a class), so a grid comes back
// a grid. The frame is sized, its body told to fill it and its panes scroll, since only a window's
// body is filled by the loader. A row in a scrolling list must not shrink, or rows are squashed
// and clipped with no scrollbar.
//
// Pane figures are short labelled chips on one wrapping line. The purse is the one full row,
// because the kit draws money. Age and last-reading caveats stay as sentences.
//
// A chip cannot carry a tone (it is two spans this file builds), so the free-slot warning is a
// colour on the figure plus the kit's tone on the empty squares.

/**
 * The square is the loader's, which is the game's, and the gap is the game's 4. No column count:
 * the grid is a wrapping track list. The floor is stated because a frame's bounds are fixed when
 * it is built.
 */
const CELL_SIZE = woc.ui.itemCell;
const CELL_GAP = 4;
const MIN_COLUMNS = 6;
const MIN_ROWS = 3;

/** What the kit's layout boxes are spaced at here: a pane's rows, and a chip's two words. */
const PANE_GAP = 3;
const STAT_GAP = 4;
/** The strip's gaps: tight vertically, wide horizontally, as one line of figures that wraps. */
const STRIP_GAP = 10;
const STRIP_WRAP_GAP = 2;

/**
 * Eight squares across, so a 16-slot backpack is exactly two rows and a full 72 exactly nine. The
 * five tabs fit on one line inside it.
 */
const FRAME_WIDTH = 380;
/** Five rows of squares under the chrome: the whole backpack, and 40 of the 72 a player holds. */
const FRAME_HEIGHT = 460;
/** Counted twice across the width. It belongs to `.woc-addon-frame`, not to a density. */
const FRAME_PADDING = 8;
/**
 * Everything but the scrolling pane, measured in a browser at 189px on the Bags tab (title, tabs,
 * selector, strip, purse and gaps). A floor is fixed before layout exists, and Vitest cannot
 * check it.
 */
const CHROME_HEIGHT = 190;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;

/**
 * A stamp answers when this was last read, not last changed, so it is refreshed this often;
 * writing every paint would be a storage write at snapshot rate.
 */
const STAMP_REFRESH_MS = MINUTE_MS;

/** One key per character per deployment; the rest is `characterKey()`. */
const CHARACTER_PREFIX = 'char/';

/** A character's four stores, in display order. The vault is counts: see `liveVault`. */
const SOURCES = ['bags', 'bank', 'mail', 'vault'];

/** Rungs on the vault ladder: what a bought count is out of. */
const VAULT_RUNGS = 5;

/**
 * The Items pane's orders. `MAX_ITEM_ROWS` truncates whatever order it is given, so a sorted list
 * gives a real top 40 where alphabetical gives an arbitrary slice. Nothing sorts by id.
 */
const SORTS = [
  { label: 'Name', by: 'name' },
  { label: 'Copies', by: 'copies' },
  { label: 'Worth', by: 'worth' },
  { label: 'Cells', by: 'cells' },
  { label: 'Last seen', by: 'seen' },
];
const SORT_NAMES = SORTS.map((sort) => sort.label);

/** What the character filter calls the unfiltered state. Never a character's own name. */
const EVERY_CHARACTER = 'Everyone';

/** How many index rows are drawn before the pane asks the player to narrow it. */
const MAX_ITEM_ROWS = 40;
/** How many characters a row's own line names before it counts the rest. */
const MAX_PLACE_HINTS = 2;
/** How wide the two Items dropdowns ask to be, before the strip gives the line back. */
const SORT_WIDTH = 96;

/** What the search box and the character selector ask for, before giving the line back. */
const SEARCH_WIDTH = 120;
const PICKER_WIDTH = 140;

/** The window's own name, which the unread badge is appended to. See `paintTitle`. */
const FRAME_TITLE = 'Satchel';

// `item` is one record and `items` is the batch an ask is answered with.
const ITEM_TOPIC = 'item';
const ITEMS_TOPIC = 'items';

/**
 * The market price protocol, in the same two shapes. A separate topic: a second publisher on
 * `item` would replace the catalogue's record wholesale, and a dated per-realm observation must
 * never look like a catalogue constant.
 */
const PRICE_TOPIC = 'price';
const PRICES_TOPIC = 'prices';

/** The older ask topic, sent beside the one `follow` derives. Drop next release. */
const LEGACY_ASK_TOPIC = 'item:ask';

/**
 * The kit's `warn` and `danger`, transcribed: a chip is two spans this file builds, and only a
 * kit widget can be given a tone.
 */
const WARN_COLOR = 'rgb(200 168 56)';
const DANGER_COLOR = 'rgb(255 143 133)';

/**
 * The kit's six tiers. Anything else a publisher sends is passed as null: the kit colours nothing
 * outside this set, and null makes that a decision.
 */
const QUALITY_TIERS = new Set(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary']);

/**
 * The corner pip for split, spare and carried. None is urgent, and a tile's tone beats its tier
 * for the border, so these stay off the border and it shows the tier.
 */
const MARK_COLOR = 'rgb(200 168 56)';
const MARK_PX = 5;

/**
 * The lock mark, drawn as a path: an emoji or font glyph is not reliable in a grid of painted art.
 * Bottom-left, where the game paints its own, clear of the stack count. The amber is the game's
 * lock tint, and the shape carries it for anyone who cannot see the colour.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCK_PATH =
  'M4 7V5a3 3 0 0 1 6 0v2h.4A1.6 1.6 0 0 1 12 8.6v3.8A1.6 1.6 0 0 1 10.4 14H3.6A1.6 1.6 0 0 1 2 12.4V8.6A1.6 1.6 0 0 1 3.6 7H4Zm1.6 0h2.8V5a1.4 1.4 0 0 0-2.8 0v2Z';
const LOCK_COLOR = 'rgb(224 162 74)';
const LOCK_PX = 11;

/** Marks an occupied cell by its fill. Never write `borderColor` inline: the tone class owns it. */
const OCCUPIED_FILL = 'rgb(255 255 255 / 7%)';
const EMPTY_FILL = 'transparent';
const OCCUPIED_EDGE = 'solid';
const EMPTY_EDGE = 'dashed';
const OCCUPIED_OPACITY = '1';
const EMPTY_OPACITY = '0.4';
/**
 * An empty cell is faint so a full grid reads full; 0.4 would also fade the warning tone's border.
 */
const LAST_OPACITY = '0.85';

/** An art name names the picture, so a square drawn from one says so in its tooltip. */
const ART_NOTE = {
  text: 'Named from its art file, which is not always what the game calls it.',
  tone: 'muted',
};

/** The one kind of item this addon carries the game's own name for, and why it has one. */
const BAG_NOTE = {
  text: "Named from this addon's own bag table, read out of the game's item list.",
  tone: 'muted',
};

/**
 * The carried pool split, which no API answers. Regenerate on a game release: nothing reports a
 * bag's slot count moving.
 */
const POOLS_FILE = 'bags.json';
/** Bag item id to what it adds and to which pool. Empty until the table lands. */
const bagKinds = new Map();
/** Every id the game counts as a material, which is what a materials-only bag will take. */
const materialIds = new Set();
/**
 * The backpack cells, socket count and largest bag, zero until the table lands (`poolsKnown`).
 * Never literals: a stale one looks fine.
 */
const poolTable = { backpackSlots: 0, sockets: 0, biggest: 0, version: '' };

/** Item id to what somebody published about it, plus who published it. */
const names = new Map();
/** Item id to the market figure somebody published, plus who published it. See `parsePrice`. */
const prices = new Map();
/**
 * The largest stack ever seen, the only obtainable stack maximum. A lower bound, so it never
 * promises room that is not there. Stored records feed it too.
 */
const largest = new Map();

/** A flag in a cell, so a handler and the paint path cannot hold different copies of it. */
function cell(value) {
  return { on: value };
}

/** Every character this account has been seen playing, keyed by `world.characterKey`. */
const records = new Map();
/** What was last written per character, so an unchanged record is not rewritten. */
const persisted = new Map();
/** Set once the stored records have been read, or once reading them has failed. */
const loaded = cell(false);
/** Set at world entry, which is the first moment a record can be filed under anybody. */
const ready = cell(false);
/** Cleared on disable, so an awaited continuation cannot draw into a dead frame. */
const running = cell(true);
/** Whether the free-slot warning has already fired for this trip below the line. */
const warned = cell(false);

/** The last thing the game said arrived or left, verbatim. See `recentLine`. */
const recent = { text: '' };
/** The window title as last written, so `setTitle` is called only on a change. */
const titleShown = { text: FRAME_TITLE };
/** Which character the three detail panes are showing. See `viewedKey`. */
const selection = { key: '', follow: cell(true) };
/**
 * What the Items pane asks for. `who` is a character key or '' for everybody, and filters the
 * places under a row, not the rows: asking about Sena means Sena's copies and worth.
 */
const filters = { sort: 'name', who: '' };

/** The index behind the rows on screen, so a tooltip describes the row it is over. */
const found = {
  index: new Map(),
  /** The index as the filter sees it, which is the same object while nothing is filtered. */
  view: new Map(),
  worth: { copper: 0, priced: 0, kinds: 0 },
};
/** Letter bodies for the character in play only; the stored form drops them. */
const bodies = new Map();

/** How few free slots is worth saying something about. */
function threshold() {
  return Math.max(0, Math.round(woc.settings['warn-free']));
}

/** Whether anything at all is written down. Off means this session and no further. */
function remembering() {
  return woc.settings.remember;
}

function text(value) {
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

/** A string that spells a price is not a price: coercing another addon's bug makes it a fact. */
function positive(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

/** A number somebody else stored, or the fallback. Everything here is untrusted input. */
function numberOr(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

/** Every stack in the bags, or an empty list before the world is up. */
function inventory() {
  const held = woc.world.inventory;
  if (held === null) {
    return [];
  }
  return held;
}

function entryId(entry) {
  return text(entry?.itemId);
}

/** How many of something one cell holds. A cell with no count is one of a thing. */
function entryCount(entry) {
  const count = Number(entry?.count);
  if (Number.isFinite(count) && count > 0) {
    return count;
  }
  return 1;
}

/**
 * Whether the player locked this copy; only their own bags and bank carry the flag. Locked blocks
 * salvage, reagent draws and vendor sales, and this addon can only report it. Read off the entry,
 * so stored and live cells agree. Mail payloads are trimmed by the server, so a mail cell is
 * unlocked as far as anyone knows.
 */
function isLocked(entry) {
  return entry?.locked === true;
}

/** How many of a cell's units are protected: a cell is locked whole. */
function lockedUnits(entry, count) {
  if (isLocked(entry)) {
    return count;
  }
  return 0;
}

/**
 * The pooled total, or null before the world can answer. Read, not derived: deriving needs bag
 * content this addon cannot reach. Right for `used / total`, wrong for what will fit.
 */
function capacity() {
  const total = woc.world.bagCapacity;
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    return total;
  }
  return null;
}

/** Whether the shipped table has been read at all, which every split answer is gated on. */
function poolsKnown() {
  return poolTable.backpackSlots > 0 && bagKinds.size > 0;
}

function isMaterial(itemId) {
  return materialIds.has(itemId);
}

/**
 * The two pool budgets as the game splits them (`poolCapacityOf` in src/sim/bag_pools.ts). Null
 * for a bag the table lacks, never a guess: that is a release ahead of a regeneration.
 */
function poolsOf(sockets) {
  if (!poolsKnown()) {
    return null;
  }
  const pools = { general: poolTable.backpackSlots, materials: 0, unknown: '' };
  for (const itemId of sockets) {
    if (itemId !== '') {
      const bag = bagKinds.get(itemId);
      if (bag === undefined) {
        pools.unknown = itemId;
      } else if (bag.materialsOnly) {
        pools.materials += bag.slots;
      } else {
        pools.general += bag.slots;
      }
    }
  }
  return pools;
}

/**
 * Which pool each used cell is charged to, as the game does it (`poolOccupancyOf`): materials fill
 * the materials pool first and spill into general.
 */
function occupancyOf(stacks, pools) {
  let material = 0;
  for (const stack of stacks) {
    if (isMaterial(entryId(stack))) {
      material += 1;
    }
  }
  const materialsUsed = Math.min(material, pools.materials);
  return { generalUsed: stacks.length - materialsUsed, materialsUsed };
}

/** One shape for every arm, so a caller reads the same five fields whichever answered. */
function spaceOf(free, materials, reason, unknown) {
  return { free, materials, split: reason === '', reason, unknown };
}

/**
 * The free-slot answer for any store. `free` is general headroom, true of any item; `materials` is
 * the extra only a material reaches. `split` is false when the pools could not be derived and
 * `free` is the pooled subtraction; `reason` says which of four ways, and only the two stale-table
 * ones are worth a sentence on screen.
 */
function freeSpace(snap) {
  const pooled = Math.max(0, snap.total - snap.used);
  // A sent split first (the bank's): nothing to derive, nothing to go stale.
  const sent = snap.pools ?? null;
  if (sent !== null) {
    const free = Math.max(0, sent.general - sent.generalUsed);
    return spaceOf(free, Math.max(0, sent.materials - sent.materialsUsed), '', '');
  }
  // Only carried bags record `sockets`; a bank list here would read as a stale table.
  if (!Array.isArray(snap.sockets)) {
    return spaceOf(pooled, 0, 'no-sockets', '');
  }
  const pools = poolsOf(snap.sockets);
  if (pools === null) {
    return spaceOf(pooled, 0, 'no-table', '');
  }
  if (pools.unknown !== '') {
    return spaceOf(pooled, 0, 'unknown-bag', pools.unknown);
  }
  // A derived budget disagreeing with the game's means a stale table; which bag moved is
  // unknowable.
  if (pools.general + pools.materials !== snap.total) {
    return spaceOf(pooled, 0, 'budget', '');
  }
  const used = occupancyOf(snap.stacks, pools);
  const free = Math.max(0, pools.general - used.generalUsed);
  return spaceOf(free, Math.max(0, pools.materials - used.materialsUsed), '', '');
}

/** The live bags' general headroom, which is what the warning is about. Null before the world. */
function freeCells() {
  const total = capacity();
  if (total === null) {
    return null;
  }
  const stacks = inventory();
  return freeSpace({
    total,
    used: stacks.length,
    stacks,
    sockets: parseSockets(woc.world.bags),
  }).free;
}

/** `world.characterKey` read, not rebuilt, plus the channel prefix. See the header. */
function characterKey() {
  const who = text(woc.world.characterKey);
  if (who === '') {
    return '';
  }
  return `${woc.game.channel}/${who}`;
}

/**
 * An amount a sentence is about, in the loader's split so addons spell prices alike. A figure the
 * eye lands on is `{ copper }` on a readout instead.
 */
function money(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'unknown';
  }
  return woc.ui.money(amount);
}

function unitAgo(count, unit) {
  return `${woc.fmt.count(count, unit)} ago`;
}

/** The coarsest unit that still says something. The wall clock, since this spans page loads. */
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
 * Null for an id with no file, for art from an unnamed generated batch (most), and until the
 * manifest lands.
 */
function artName(itemId) {
  if (itemId === '') {
    return null;
  }
  return woc.ui.icon.itemArtName(itemId);
}

/**
 * Never blank. A publisher outranks the bag table, which outranks the art name; `titleCase` of
 * the id is the last-resort guess. The tooltip says which was used.
 */
function nameOf(itemId) {
  return known(itemId)?.name ?? bagName(itemId) ?? artName(itemId) ?? woc.fmt.titleCase(itemId);
}

/** A bag's name from the shipped table: the game's item table, so above the art name. */
function bagName(itemId) {
  const name = bagKinds.get(itemId)?.name ?? '';
  if (name === '') {
    return null;
  }
  return name;
}

/**
 * The published vendor price, or null. Zero means absent inside the record, which is safe only
 * because publishers omit what they cannot state, keeping unpriced items out of totals.
 */
function sellOf(itemId) {
  const said = known(itemId)?.sellValue ?? 0;
  if (said <= 0) {
    return null;
  }
  return said;
}

/**
 * What a published market figure says this goes for on a character's realm, or null. Stock is
 * pooled across characters on different markets, so a price from another realm is refused and
 * every total says how many kinds it left out.
 */
function marketOf(itemId, realm) {
  const said = prices.get(itemId) ?? null;
  if (said === null || said.realm !== realm) {
    return null;
  }
  return said;
}

/** The realm a recorded character is on, or '' for a record older than realm tracking. */
function realmOf(key) {
  return records.get(key)?.realm ?? '';
}

/** The realm of whoever the three per-character panes are pointed at. */
function viewedRealm() {
  return viewedRecord()?.realm ?? '';
}

/**
 * Every total draws its `priced` count too: a total over two kinds of nine looks complete.
 * Two totals: a vendor floor is what an item is certainly worth, a market median what it would
 * probably fetch. `thin` counts market figures resting on a single reading; they are included and
 * disclosed.
 */
function addVendor(sums, itemId, held) {
  const each = sellOf(itemId);
  if (each === null) {
    return;
  }
  sums.priced += 1;
  sums.copper += each * held;
}

function addMarket(sums, itemId, held, realm) {
  const asked = marketOf(itemId, realm);
  if (asked === null) {
    return;
  }
  sums.marketPriced += 1;
  sums.market += asked.unit * held;
  if (asked.visits <= 1) {
    sums.thin += 1;
  }
}

function worthOf(counts) {
  const sums = { copper: 0, priced: 0, kinds: 0, market: 0, marketPriced: 0, thin: 0 };
  for (const [itemId, held, realm] of counts) {
    sums.kinds += 1;
    addVendor(sums, itemId, held);
    addMarket(sums, itemId, held, realm ?? '');
  }
  return sums;
}

/** One store's stacks as the `[id, count, realm]` triples `worthOf` adds up. */
function storeCounts(stacks, realm) {
  return [...stacksIn(stacks)].map(([itemId, counts]) => [itemId, counts.held, realm]);
}

/**
 * Off the index the Items pane built this frame. One entry per item per realm, since a row pools
 * characters who may be on different markets.
 */
function countsFrom(rows) {
  const byRealm = new Map();
  for (const [itemId, row] of rows) {
    for (const spot of row.places) {
      const realm = realmOf(spot.key);
      const key = `${realm}\u0000${itemId}`;
      const held = byRealm.get(key) ?? { itemId, realm, count: 0 };
      held.count += spot.count;
      byRealm.set(key, held);
    }
  }
  return [...byRealm.values()].map((held) => [held.itemId, held.count, held.realm]);
}

/** The whole account, unfiltered: the roster total must never follow the Items pane's filter. */
function accountCounts() {
  return countsFrom(found.index);
}

/** A bus payload is `unknown`: an id and a name are required, the rest reads as absent. */
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
    kind: text(payload.kind),
    quality: text(payload.quality),
    source: text(payload.source),
    sellValue: positive(payload.sellValue),
  };
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
 * to say answers null.
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

/**
 * One market figure, checked: `id`, `realm`, `unit` and `at` required. A row without a realm is
 * refused here and only here: stock spans realms, and a blank realm would match a character
 * recorded before realms were stored.
 */
function parsePrice(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const itemId = text(payload.id);
  const realm = text(payload.realm);
  const unit = positive(payload.unit);
  const at = positive(payload.at);
  // `positive` reads absent and nonsense alike as 0. A price of nothing is not a price.
  if (itemId === '' || realm === '' || unit <= 0 || at <= 0) {
    return null;
  }
  return {
    id: itemId,
    realm,
    unit,
    at,
    low: positive(payload.low),
    latest: positive(payload.latest),
    // Defaults to one: a publisher that omits it has still seen the item once.
    visits: Math.max(1, Math.round(numberOr(payload.visits, 1))),
    sold: positive(payload.sold),
    sales: Math.max(0, Math.round(numberOr(payload.sales, 0))),
  };
}

function rememberPrice(payload, from) {
  const record = parsePrice(payload);
  if (record === null) {
    return false;
  }
  prices.set(record.id, { ...record, from });
  return true;
}

function onPrice(message) {
  if (rememberPrice(message.payload, message.from)) {
    schedulePaint();
  }
}

/** The batch, with `onItems`'s `Array.isArray` guard for the same reason. */
function onPrices(payload, from) {
  if (!Array.isArray(payload)) {
    return;
  }
  let learned = 0;
  for (const entry of payload) {
    if (rememberPrice(entry, from)) {
      learned += 1;
    }
  }
  if (learned > 0) {
    schedulePaint();
  }
}

/**
 * The wire and stored shapes match, so live and stored paths share every reader. The lock is the
 * one difference: the wire nests it in the copy's payload, which is stored flat to avoid an object
 * per cell. Both spellings are read.
 */
function parseStack(value) {
  const itemId = entryId(value);
  if (itemId === '') {
    return null;
  }
  const stack = { itemId, count: entryCount(value) };
  const at = Number(value?.slot);
  if (Number.isInteger(at) && at >= 0) {
    stack.slot = at;
  }
  // Appended and written only when true, so old records need no migration and unlocked cells cost
  // nothing.
  if (value?.instance?.locked === true || value?.locked === true) {
    stack.locked = true;
  }
  // Written only where present, like the lock: it tells two vault rows of one item id apart.
  const recipe = text(value?.craftedRecipeId);
  if (recipe !== '') {
    stack.recipe = recipe;
  }
  return stack;
}

function parseStacks(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const stacks = [];
  for (const entry of value) {
    const stack = parseStack(entry);
    if (stack !== null) {
      stacks.push(stack);
    }
  }
  return stacks;
}

/** The bag sockets, as item ids with null for an empty one. */
function parseSockets(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((itemId) => text(itemId));
}

function parseIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((itemId) => typeof itemId === 'string' && itemId !== '');
}

/**
 * The id is a string: it is a row key, and a number round-tripped into a DOM attribute can go
 * missing.
 */
function parseLetter(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const id = String(value.id ?? '');
  if (id === '' || id === 'undefined') {
    return null;
  }
  return {
    id,
    senderName: text(value.senderName),
    subject: text(value.subject),
    copper: numberOr(value.copper, 0),
    items: parseStacks(value.items),
    read: value.read === true,
  };
}

function parseLetters(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const letters = [];
  for (const entry of value) {
    const letter = parseLetter(entry);
    if (letter !== null) {
      letters.push(letter);
    }
  }
  return letters;
}

/** What every source has: when it was read, how full it was, and what was in it. */
function baseSnapshot() {
  return { at: 0, used: 0, total: 0, stacks: [] };
}

function emptyBags() {
  return { ...baseSnapshot(), sockets: [] };
}

/**
 * The bank's budget rides with it, since expansion cost varies by character. `pools` is the sent
 * split, null on older records, which read back as the pooled figure and say so.
 */
function emptyBank() {
  return {
    ...baseSnapshot(),
    bought: 0,
    granted: 0,
    next: null,
    pools: null,
    // Never `sockets`: `freeSpace` would measure a bank list against the backpack and report a
    // stale table.
    socketBags: [],
    unlocked: 0,
    nextSocket: null,
  };
}

/**
 * The one store with no slot budget: `stock` counts per material against the shared `cap`, and
 * `stacks` holds only identity-bearing rows. `used` and `total` stay zero.
 */
function emptyVault() {
  return { ...baseSnapshot(), stock: [], upgrades: 0, cap: 0, next: null };
}

/** The mailbox's terms ride with it, as the bank's do. */
function emptyMail() {
  return { ...baseSnapshot(), letters: [], unread: 0, postage: 0, attachments: 0, flight: 0 };
}

// Keyed by the display names, pairing each source's empty shape with its parser.
const SOURCE_EMPTY = new Map([
  ['bags', emptyBags],
  ['bank', emptyBank],
  ['mail', emptyMail],
  ['vault', emptyVault],
]);

function emptySource(source) {
  return (SOURCE_EMPTY.get(source) ?? baseSnapshot)();
}

function parseBase(value, into) {
  into.at = numberOr(value?.at, 0);
  into.used = numberOr(value?.used, 0);
  into.total = numberOr(value?.total, 0);
  into.stacks = parseStacks(value?.stacks);
  return into;
}

function parseBags(value) {
  const snap = parseBase(value, emptyBags());
  snap.sockets = parseSockets(value?.sockets);
  return snap;
}

function parseBank(value) {
  const snap = parseBase(value, emptyBank());
  snap.bought = numberOr(value?.bought, 0);
  snap.granted = numberOr(value?.granted, 0);
  snap.next = expansionCost(value?.next);
  snap.pools = parsePools(value?.pools);
  snap.socketBags = parseSockets(value?.socketBags);
  snap.unlocked = numberOr(value?.unlocked, 0);
  snap.nextSocket = expansionCost(value?.nextSocket);
  return snap;
}

/** A recorded split, or null. All four numbers or none: a half-read split never existed. */
function parsePools(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const pools = {
    general: numberOr(value.general, -1),
    materials: numberOr(value.materials, -1),
    generalUsed: numberOr(value.generalUsed, -1),
    materialsUsed: numberOr(value.materialsUsed, -1),
  };
  if (Object.values(pools).some((one) => one < 0)) {
    return null;
  }
  return pools;
}

/**
 * One row of vault stock, checked. A zero count is dropped: the game holds absent materials at
 * zero.
 */
function parseStockRow(value) {
  const itemId = text(value?.itemId);
  const count = numberOr(value?.count, 0);
  if (itemId === '' || count <= 0) {
    return null;
  }
  return { itemId, count };
}

function parseStock(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(parseStockRow).filter((row) => row !== null);
}

function parseVault(value) {
  const snap = parseBase(value, emptyVault());
  snap.stock = parseStock(value?.stock);
  snap.upgrades = numberOr(value?.upgrades, 0);
  snap.cap = numberOr(value?.cap, 0);
  snap.next = expansionCost(value?.next);
  return snap;
}

/**
 * Checked on type, not coerced: `Number(null)` is 0, which would make a nonexistent expansion free.
 */
function expansionCost(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function parseMail(value) {
  const snap = parseBase(value, emptyMail());
  snap.letters = parseLetters(value?.letters);
  snap.unread = numberOr(value?.unread, 0);
  snap.postage = numberOr(value?.postage, 0);
  snap.attachments = numberOr(value?.attachments, 0);
  snap.flight = numberOr(value?.flight, 0);
  return snap;
}

const SOURCE_PARSERS = new Map([
  ['bags', parseBags],
  ['bank', parseBank],
  ['mail', parseMail],
  ['vault', parseVault],
]);

function parseSource(source, value) {
  const parser = SOURCE_PARSERS.get(source);
  if (parser === undefined) {
    return emptySource(source);
  }
  return parser(value);
}

function emptyRecord(key) {
  return {
    key,
    name: '',
    // Class and level, for the roster. Older records read as empty and zero, drawn as nothing.
    templateId: '',
    level: 0,
    /**
     * The realm this character is on, which decides whether a published market price applies.
     * Recorded, not parsed out of `characterKey` (documented opaque). Read off `net.state`,
     * safe here because nothing is written before `characterKey` is set, after the hello frame.
     */
    realm: '',
    copper: 0,
    at: 0,
    equipped: [],
    sources: {
      bags: emptyBags(),
      bank: emptyBank(),
      mail: emptyMail(),
      vault: emptyVault(),
    },
  };
}

/** Checked: storage is player-editable. A record with no name is not a character and is dropped. */
function parseRecord(key, value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = emptyRecord(key);
  record.name = text(value.name);
  if (record.name === '') {
    return null;
  }
  record.templateId = text(value.templateId);
  record.level = numberOr(value.level, 0);
  record.realm = text(value.realm);
  record.copper = numberOr(value.copper, 0);
  record.at = numberOr(value.at, 0);
  record.equipped = parseIds(value.equipped);
  const stored = value.sources;
  for (const source of SOURCES) {
    record.sources[source] = parseSource(source, stored?.[source]);
  }
  return record;
}

/**
 * `{ cells, held, locked }` per item, recording the largest stack seen: every store passes
 * through here. `locked` counts units, comparable with `held`; a locked copy never merges, so a
 * cell is never double-counted.
 */
function stacksIn(entries) {
  const held = new Map();
  for (const entry of entries) {
    const itemId = entryId(entry);
    if (itemId !== '') {
      const count = entryCount(entry);
      const seen = held.get(itemId) ?? { cells: 0, held: 0, locked: 0 };
      held.set(itemId, {
        cells: seen.cells + 1,
        held: seen.held + count,
        locked: seen.locked + lockedUnits(entry, count),
      });
      largest.set(itemId, Math.max(largest.get(itemId) ?? 0, count));
    }
  }
  return held;
}

/** Feed the observed maxima from a record read back out of storage. */
function learnFrom(record) {
  for (const source of SOURCES) {
    stacksIn(record.sources[source].stacks);
  }
}

/**
 * At least this many merge, measured against the largest stack seen. An item never seen above one
 * answers zero without claiming it does not stack.
 */
function mergeable(itemId, held) {
  const biggest = largest.get(itemId) ?? 0;
  if (biggest <= 0) {
    return 0;
  }
  return Math.max(0, held.cells - Math.ceil(held.held / biggest));
}

/** What a grid with nothing behind it yet reads as. See `paintBank`. */
function emptyView() {
  return { held: new Map(), split: new Set(), spare: new Set(), carried: new Set(), reclaim: 0 };
}

/**
 * Taken once per paint. Every mark comes from ids alone. `alsoIn` is one-directional: the bank
 * marks what is also carried, never the reverse, since a mark that vanishes when the bank reading
 * does reads as a fault.
 */
function readStore(entries, worn, alsoIn) {
  const held = stacksIn(entries);
  const view = { held, split: new Set(), spare: new Set(), carried: new Set(), reclaim: 0 };
  for (const [itemId, counts] of held) {
    if (counts.cells > 1) {
      view.split.add(itemId);
    }
    if (worn.has(itemId)) {
      view.spare.add(itemId);
    }
    if (alsoIn.has(itemId)) {
      view.carried.add(itemId);
    }
    view.reclaim += mergeable(itemId, counts);
  }
  return view;
}

/** The item ids currently worn, so a spare copy in the bags can say so. */
function equippedIds() {
  const worn = woc.world.equipment;
  if (typeof worn !== 'object' || worn === null) {
    return [];
  }
  return Object.values(worn).filter((itemId) => typeof itemId === 'string' && itemId !== '');
}

/** The bags as they are right now, in the shape a stored one has. */
function liveBags(now) {
  const snap = emptyBags();
  snap.at = now;
  snap.stacks = parseStacks(inventory());
  snap.used = snap.stacks.length;
  snap.total = capacity() ?? 0;
  snap.sockets = parseSockets(woc.world.bags);
  return snap;
}

function liveBank(info, now) {
  const snap = emptyBank();
  snap.at = now;
  snap.stacks = parseStacks(info.slots);
  snap.used = snap.stacks.length;
  snap.total = Math.max(numberOr(info.capacity, 0), snap.stacks.length);
  snap.bought = numberOr(info.purchasedSlots, 0);
  snap.granted = numberOr(info.bonusSlots, 0);
  snap.next = expansionCost(info.nextExpansionCost);
  snap.pools = livePools(info);
  snap.socketBags = parseSockets(info.socketBags);
  snap.unlocked = numberOr(info.socketsUnlocked, 0);
  snap.nextSocket = expansionCost(info.nextSocketCost);
  return snap;
}

/** The bank's own pool split, or null on a payload that does not carry one. */
function livePools(info) {
  return parsePools({
    general: info.generalCapacity,
    materials: info.materialsCapacity,
    generalUsed: info.generalUsed,
    materialsUsed: info.materialsUsed,
  });
}

/**
 * The vault, sent as a record keyed by material id. Sorted here, so the stored copy is sorted too
 * (the server returns it reordered). Only `special` becomes `stacks`: counts in `stock` must never
 * reach the stack maximum the Bags pane merges against.
 */
function liveVault(info, now) {
  const snap = emptyVault();
  snap.at = now;
  snap.stacks = parseStacks(info.special);
  snap.stock = stockRows(info.stock);
  snap.upgrades = numberOr(info.upgrades, 0);
  snap.cap = numberOr(info.perMaterialCap, 0);
  snap.next = expansionCost(info.nextUpgradeCost);
  return snap;
}

function stockRows(stock) {
  if (typeof stock !== 'object' || stock === null) {
    return [];
  }
  const rows = Object.entries(stock).map(([itemId, count]) => parseStockRow({ itemId, count }));
  return rows.filter((row) => row !== null).sort((a, b) => a.itemId.localeCompare(b.itemId));
}

/**
 * Attachments are flattened into `stacks`: a parcel is owned but unseen, and the index asks every
 * source the same question. Letters are kept for the Mail pane.
 */
function liveMail(info, now) {
  const snap = emptyMail();
  snap.at = now;
  snap.letters = parseLetters(info.messages);
  for (const letter of snap.letters) {
    snap.stacks.push(...letter.items);
  }
  snap.used = snap.letters.length;
  snap.total = numberOr(info.totalCount, snap.letters.length);
  snap.unread = numberOr(info.unread, 0);
  snap.postage = numberOr(info.postage, 0);
  snap.attachments = numberOr(info.maxAttachments, 0);
  snap.flight = numberOr(info.deliverySeconds, 0);
  return snap;
}

/** The bodies of the letters on screen, which the stored form drops. See `bodies`. */
function holdBodies(messages) {
  bodies.clear();
  if (!Array.isArray(messages)) {
    return;
  }
  for (const message of messages) {
    bodies.set(String(message?.id), text(message?.body));
  }
}

/**
 * The bags stream, so they always fold in. Bank and mail fold in only on `near`: recording what
 * the server sends for an absent counter would erase the store.
 */
function syncLive() {
  const key = characterKey();
  if (!loaded.on || key === '') {
    return;
  }
  const now = woc.wallClock();
  const record = records.get(key) ?? emptyRecord(key);
  record.key = key;
  // Kept on a blank: `parseRecord` drops a nameless row, so writing one deletes the character.
  const name = text(woc.world.player?.name);
  if (name !== '') {
    record.name = name;
  }
  // Kept on a blank too. A level never goes down and a class never changes.
  const templateId = text(woc.world.player?.templateId);
  if (templateId !== '') {
    record.templateId = templateId;
  }
  record.level = Math.max(record.level, numberOr(woc.world.player?.level, 0));
  const realm = text(woc.net.state?.realm);
  if (realm !== '') {
    record.realm = realm;
  }
  record.copper = numberOr(woc.world.copper, 0);
  record.equipped = equippedIds();
  record.at = now;
  record.sources.bags = liveBags(now);
  const { bank, mail } = woc.world;
  if (bank.status === 'near' && bank.info !== null) {
    record.sources.bank = liveBank(bank.info, now);
  }
  if (mail.status === 'near' && mail.info !== null) {
    record.sources.mail = liveMail(mail.info, now);
    holdBodies(mail.info.messages);
  }
  // Its own status: an undecodable vault arrives as `away` while the bank is `near`, and using the
  // bank's status would write an empty vault over a full one.
  const { vault } = woc.world;
  if (vault.status === 'near' && vault.info !== null) {
    record.sources.vault = liveVault(vault.info, now);
  }
  records.set(key, record);
  keep(key, record);
}

/**
 * A string that changes exactly when the store's content does. `stock` and the budget are
 * included, or a vault's signature is constant and a deposit is never written.
 */
function snapshotSignature(snap) {
  const stacks = snap.stacks.map((s) => `${s.itemId}x${String(s.count)}@${String(s.slot ?? -1)}`);
  const letters = snap.letters?.map((l) => `${l.id}:${String(l.read)}`) ?? [];
  const stock = snap.stock?.map((row) => `${row.itemId}x${String(row.count)}`) ?? [];
  const budget = `${String(snap.cap ?? 0)}:${String(snap.upgrades ?? 0)}:${socketText(snap)}`;
  return (
    `${String(snap.used)}/${String(snap.total)}|${stacks.join(',')}|${letters.join(',')}` +
    `|${stock.join(',')}|${budget}`
  );
}

/** The bank's own bags and how many sockets are open. */
function socketText(snap) {
  return `${String(snap.unlocked ?? 0)}:${(snap.socketBags ?? []).join('/')}`;
}

function recordSignature(record) {
  const stores = SOURCES.map((source) => snapshotSignature(record.sources[source]));
  return [
    record.name,
    record.templateId,
    record.realm,
    String(record.level),
    String(record.copper),
    record.equipped.join('|'),
    ...stores,
  ].join(';');
}

/**
 * Written on a change or a stale stamp, so an age stays honest while the player stands still. A
 * rejection is only logged: a storage toast mid-fight is worse than a missing row.
 */
function keep(key, record) {
  if (!(ready.on && remembering())) {
    return;
  }
  const signature = recordSignature(record);
  const last = persisted.get(key);
  const fresh = last !== undefined && record.at - last.at < STAMP_REFRESH_MS;
  if (last?.signature === signature && fresh) {
    return;
  }
  persisted.set(key, { signature, at: record.at });
  // A copy: the live record is mutated every paint, and an async write would store its later state.
  woc.storage.set(`${CHARACTER_PREFIX}${key}`, structuredClone(record)).catch((err) => {
    woc.warn('satchel: a character record could not be saved', err);
  });
}

function forgetKeys(keys) {
  for (const key of keys) {
    records.delete(key);
    persisted.delete(key);
  }
  Promise.all(keys.map((key) => woc.storage.delete(`${CHARACTER_PREFIX}${key}`))).catch((err) => {
    woc.warn('satchel: a character record could not be cleared', err);
  });
}

function forgetOthers() {
  const here = characterKey();
  forgetKeys([...records.keys()].filter((key) => key !== here));
  draw();
}

/**
 * Turning the record off deletes what is stored. The character in play stays in memory so the
 * pane being looked at does not go blank.
 */
function dropStored() {
  const here = characterKey();
  forgetKeys([...records.keys()].filter((key) => key !== here));
  persisted.delete(here);
  woc.storage.delete(`${CHARACTER_PREFIX}${here}`).catch((err) => {
    woc.warn('satchel: a character record could not be cleared', err);
  });
}

async function loadRecords() {
  const cells = (await woc.storage.keys()).filter((name) => name.startsWith(CHARACTER_PREFIX));
  const values = await Promise.all(cells.map((name) => woc.storage.get(name, null)));
  if (!running.on) {
    return;
  }
  for (const [at, value] of values.entries()) {
    const key = text(cells[at]).slice(CHARACTER_PREFIX.length);
    const record = parseRecord(key, value);
    if (key !== '' && record !== null) {
      records.set(key, record);
      learnFrom(record);
    }
  }
}

/**
 * `loaded` is set even on a failed read, so a panel draws either way. `ready` gates only writes:
 * before world entry a record would be filed under whoever logs in next.
 */
async function startRecords() {
  await loadRecords().catch((err) => {
    woc.warn('satchel: the stored characters could not be read', err);
  });
  if (!running.on) {
    return;
  }
  loaded.on = true;
  draw();
  await woc.world.ready;
  if (!running.on) {
    return;
  }
  ready.on = true;
  draw();
}

/** `min-height: 0` is the easy half to forget: without it forty rows push the frame open. */
function fills(el) {
  el.style.flex = '1 1 auto';
  el.style.minHeight = '0';
  return el;
}

/** The one list or grid in a pane: it takes the leftover height and scrolls in it. */
function scrolls(el) {
  fills(el);
  el.style.overflowY = 'auto';
  el.style.overscrollBehavior = 'contain';
  return el;
}

/** Chrome inside a pane: a bar, a strip, a sentence. It keeps its own height. */
function fixed(el) {
  el.style.flexShrink = '0';
  return el;
}

/**
 * `muted` also shrinks the text, so a sentence beside the chips reads as part of the footer. A
 * tone, not a style, so a density can reach it.
 */
function line(parent, role) {
  const el = woc.ui.line({ parent, className: 'woc-satchel-line', tone: 'muted' });
  el.dataset.role = role;
  return el;
}

/** A sentence inside a strip must shrink, or its longest line pushes the strip past the panel. */
function wrapping(el) {
  el.style.flexShrink = '1';
  el.style.minWidth = '0';
  return el;
}

function say(el, said) {
  woc.ui.show(el, said !== '');
  el.textContent = said;
}

/**
 * A kit field on one line, its label shrunk to a caption. Layout only: never size the control
 * itself, or the inline style opts it out of the coarse-pointer tap-target floor.
 */
function inline(field, width) {
  const row = field.el;
  row.style.flexDirection = 'row';
  row.style.alignItems = 'center';
  row.style.gap = '6px';
  const label = row.querySelector('.woc-field-label');
  if (label !== null) {
    label.style.flex = '0 0 auto';
    label.style.fontSize = '11px';
    label.style.letterSpacing = '0.04em';
    label.style.textTransform = 'uppercase';
    label.style.opacity = '0.75';
  }
  const control = row.querySelector('.woc-input');
  if (control !== null) {
    control.style.flex = `1 1 ${String(width)}px`;
  }
  return fixed(row);
}

function column(className) {
  return woc.ui.column({ className, gap: PANE_GAP });
}

/** Baseline-aligned: an 11px label beside a full-size figure, centred, sits on neither's line. */
function strip(parent, role) {
  const el = woc.ui.row({
    parent,
    className: 'woc-satchel-strip',
    wrap: true,
    align: 'baseline',
    // Close down, far across, or a wrapped strip reads as two strips.
    gap: STRIP_GAP,
    wrapGap: STRIP_WRAP_GAP,
  });
  el.dataset.role = role;
  return el;
}

/** Hidden until it has something to say. */
function stat(parent, role, label) {
  const el = woc.ui.row({
    parent,
    className: 'woc-satchel-stat',
    align: 'baseline',
    gap: STAT_GAP,
  });
  el.dataset.role = role;
  // A chip wraps whole rather than between its two words.
  el.style.whiteSpace = 'nowrap';
  const name = document.createElement('span');
  name.className = 'woc-satchel-stat-label';
  name.textContent = label;
  name.style.opacity = '0.55';
  name.style.fontSize = '11px';
  name.style.letterSpacing = '0.04em';
  name.style.textTransform = 'uppercase';
  const figure = document.createElement('span');
  figure.className = 'woc-satchel-stat-value';
  figure.style.fontVariantNumeric = 'tabular-nums';
  figure.style.fontSize = '13px';
  el.append(name, figure);
  woc.ui.show(el, false);
  return { el, name, figure };
}

/**
 * The chip's label, which follows the figure's meaning: a vendor floor and a market median differ.
 */
function setStatLabel(chip, label) {
  chip.name.textContent = label;
}

/** A figure, or nothing at all, which takes the whole chip off the strip. */
function setStat(chip, value) {
  woc.ui.show(chip.el, value !== '');
  chip.figure.textContent = value;
}

/** The three colours a chip's figure comes in. `default` is whatever the panel's text is. */
const CHIP_TONES = new Map([
  ['warn', WARN_COLOR],
  ['danger', DANGER_COLOR],
]);

/** Urgency on a chip. The attribute rides beside the colour so a suite reads the decision. */
function setStatTone(chip, tone) {
  chip.el.dataset.tone = tone;
  chip.figure.style.color = CHIP_TONES.get(tone) ?? '';
}

function addRow(tip, entry) {
  const bar = woc.ui.bar({ icon: entry.icon, className: 'woc-satchel-row' });
  bar.el.dataset.row = entry.key;
  // A flex column squashes before it scrolls. The kit's sheet has this for `.woc-bar`, but a
  // suite cannot read a stylesheet.
  fixed(bar.el);
  woc.ui.tooltip(bar.el, () => tip(entry.key));
  return bar;
}

/** Keyed on what the row is about, so a reused row keeps its hover. */
function group(name, tip) {
  const el = column('woc-satchel-list');
  el.dataset.list = name;
  return {
    el,
    rows: woc.ui.list({
      parent: el,
      key: (entry) => entry.key,
      create: (entry) => addRow(tip, entry),
      update: (bar, entry) => {
        bar.update(entry.update);
      },
    }),
  };
}

/**
 * Two of these, since a deposit box is cells too. `plan` and `view` are held, so a tooltip
 * describes the square under the pointer, not whatever the store holds by then.
 */
function createGrid(name) {
  const el = document.createElement('div');
  el.className = 'woc-satchel-grid';
  el.dataset.grid = name;
  el.style.display = 'grid';
  // A fixed track, not the game's `minmax(42px, 1fr)`: a stretched track stretches the square.
  el.style.gridTemplateColumns = `repeat(auto-fill, ${String(CELL_SIZE)}px)`;
  el.style.gap = `${String(CELL_GAP)}px`;
  el.style.justifyContent = 'center';
  el.style.alignContent = 'start';
  scrolls(el);
  const grid = { el, plan: [], view: emptyView(), last: 'default' };
  // Keyed on the slot, whose position is its identity: a growing store builds only the squares it
  // gained, a shrinking one destroys only those it lost.
  grid.cells = woc.ui.list({
    parent: el,
    key: (slot) => String(slot.at),
    create: (slot) => createCell(grid, slot.at),
    update: (tile, slot) => {
      paintCell(tile, slot.entry, grid.view, grid.last);
    },
  });
  return grid;
}

/** The cell the player dragged this stack into, or null when it points outside the grid. */
function slotHint(entry, total) {
  const at = Number(entry?.slot);
  if (Number.isInteger(at) && at >= 0 && at < total) {
    return at;
  }
  return null;
}

/** Everything with a hint, in its hinted cell. Returns what could not be placed. */
function placeHinted(plan, entries) {
  const spill = [];
  for (const entry of entries) {
    const at = slotHint(entry, plan.length);
    if (at === null || plan[at] !== null) {
      spill.push(entry);
    } else {
      plan[at] = entry;
    }
  }
  return spill;
}

/** Everything else, into what is left, in the order the store listed it. */
function fillSpill(plan, spill) {
  const queue = [...spill];
  for (const [at, held] of plan.entries()) {
    if (held === null && queue.length > 0) {
      plan[at] = queue.shift();
    }
  }
}

/** One planner for both grids: the bank's absent hints are handled as no hints. */
function cellPlan(snap) {
  const total = Math.max(snap.total, snap.stacks.length);
  const plan = Array.from({ length: total }, () => null);
  fillSpill(plan, placeHinted(plan, snap.stacks));
  return plan;
}

/** How wide a row of this many squares is, the gaps between them included. */
function gridWidth(columns) {
  return columns * CELL_SIZE + (columns - 1) * CELL_GAP;
}

/**
 * Resizable across. Both bounds are stated, since an unstated floor defaults to the opening size,
 * and a bound cannot be restated later, so the floor must hold for every tab.
 */
const frame = woc.ui.frame({
  id: 'bags',
  title: FRAME_TITLE,
  toggleKey: 'toggle',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'comfortable',
  closable: true,
  save: true,
  resizable: true,
  minWidth: gridWidth(MIN_COLUMNS) + FRAME_PADDING * 2,
  minHeight: CHROME_HEIGHT + MIN_ROWS * (CELL_SIZE + CELL_GAP),
});

// A column body, so the pane takes the frame's leftover height and hands it to the one scroller.
frame.body.style.display = 'flex';
frame.body.style.flexDirection = 'column';
frame.body.style.gap = '6px';
frame.body.style.minHeight = '0';
// A resizable frame's body must grow (the loader fills only a window's body), or the dragged-out
// height is dead space under the panes.
frame.body.style.flex = '1 1 auto';

const panes = new Map([
  ['items', fills(column('woc-satchel-pane'))],
  ['bags', fills(column('woc-satchel-pane'))],
  ['bank', fills(column('woc-satchel-pane'))],
  ['vault', fills(column('woc-satchel-pane'))],
  ['mail', fills(column('woc-satchel-pane'))],
  ['roster', fills(column('woc-satchel-pane'))],
]);
for (const [name, pane] of panes) {
  pane.dataset.pane = name;
}

/** The four panes the character selector applies to. The other two span characters. */
const DETAIL_PANES = new Set(['bags', 'bank', 'vault', 'mail']);

/**
 * The character selector. Rebuilt only when the roster changes: a control replaced mid-use loses
 * focus, and this would otherwise be replaced at snapshot rate.
 */
const pickerRow = column('woc-satchel-picker');
const picker = { field: null, labels: [], keys: new Map() };

function showPane(active) {
  for (const [name, pane] of panes) {
    woc.ui.show(pane, name === active);
  }
  paintPicker();
}

const tabs = woc.ui.tabs({
  tabs: [
    { id: 'items', label: 'Items' },
    { id: 'bags', label: 'Bags' },
    { id: 'bank', label: 'Bank' },
    // Beside the Bank, where the game puts it.
    { id: 'vault', label: 'Vault' },
    { id: 'mail', label: 'Mail' },
    { id: 'roster', label: 'Roster' },
  ],
  onSelect: showPane,
});

function displayName(record) {
  if (record.name !== '') {
    return record.name;
  }
  return record.key;
}

function labelFor(record, here) {
  if (record.key === here) {
    return `${displayName(record)} (here)`;
  }
  return displayName(record);
}

/**
 * Unique by construction: two same-named characters on two realms would collapse into one option.
 */
function uniqueLabel(record, here, used) {
  const base = labelFor(record, here);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const label = `${base} [${record.key}]`;
  used.add(label);
  return label;
}

/** This character first, then everyone else by name. */
function characterOrder() {
  const here = characterKey();
  return [...records.values()].sort((a, b) => {
    if (a.key === here || b.key === here) {
      return Number(b.key === here) - Number(a.key === here);
    }
    return displayName(a).localeCompare(displayName(b));
  });
}

function characterOptions() {
  const here = characterKey();
  const used = new Set();
  return characterOrder().map((record) => ({
    key: record.key,
    label: uniqueLabel(record, here, used),
  }));
}

/**
 * Follows the character in play by default, through a switch. A deliberate pick stops following
 * until the one in play is picked again.
 */
function viewedKey() {
  const here = characterKey();
  if (!selection.follow.on && records.has(selection.key)) {
    return selection.key;
  }
  return here;
}

function viewingSelf() {
  const here = characterKey();
  return here !== '' && viewedKey() === here;
}

function viewedRecord() {
  return records.get(viewedKey()) ?? null;
}

function viewedSource(source) {
  return viewedRecord()?.sources[source] ?? emptySource(source);
}

function pickCharacter(label) {
  const key = picker.keys.get(label);
  selection.follow.on = key === undefined || key === characterKey();
  selection.key = key ?? '';
  draw();
}

function sameLabels(next) {
  return next.length === picker.labels.length && next.every((l, at) => l === picker.labels[at]);
}

function currentLabel() {
  const key = viewedKey();
  for (const [label, forKey] of picker.keys) {
    if (forKey === key) {
      return label;
    }
  }
  return picker.labels[0] ?? '';
}

function buildPicker(options) {
  picker.field?.destroy();
  picker.labels = options.map((option) => option.label);
  picker.keys = new Map(options.map((option) => [option.label, option.key]));
  picker.field = woc.ui.field.select({
    label: 'Character',
    value: currentLabel(),
    options: picker.labels,
    onChange: pickCharacter,
  });
  picker.field.el.dataset.role = 'picker';
  inline(picker.field, PICKER_WIDTH);
  pickerRow.appendChild(picker.field.el);
}

/** Hidden with only one character recorded: a single option is not a choice. */
function paintPicker() {
  const options = characterOptions();
  woc.ui.show(pickerRow, DETAIL_PANES.has(tabs.active()) && options.length > 1);
  if (!sameLabels(options.map((option) => option.label))) {
    buildPicker(options);
    return;
  }
  picker.field?.set(currentLabel());
}

const itemsPane = panes.get('items');
const bagsPane = panes.get('bags');
const bankPane = panes.get('bank');
const vaultPane = panes.get('vault');
const mailPane = panes.get('mail');
const rosterPane = panes.get('roster');

const bagGrid = createGrid('bags');
const bankGrid = createGrid('bank');
/** The bank's own socketed bags, four squares, drawn as the item cells they are. */
const bankSocketGrid = createGrid('bank-sockets');
/** The vault's identity-bearing rows, the only part of a vault that is stacks. */
const vaultGrid = createGrid('vault');

/** Search, sort and filter on one wrapping line, matching lorebind's `findStrip` flex values. */
const findStrip = woc.ui.row({
  parent: itemsPane,
  className: 'woc-satchel-find',
  wrap: true,
  align: 'center',
  gap: STRIP_GAP,
  wrapGap: PANE_GAP,
});
fixed(findStrip);

const search = woc.ui.field.text({
  label: 'Search',
  value: '',
  placeholder: 'name or id',
  onChange: () => {
    schedulePaint();
  },
});
search.el.dataset.role = 'search';
inline(search, SEARCH_WIDTH);
// The search takes the whole first line: the three controls need ~485px of 364, so the strip
// wraps regardless, and this makes the wrap deliberate.
search.el.style.flex = '1 1 100%';
findStrip.appendChild(search.el);

const sortField = woc.ui.field.select({
  label: 'Sort',
  value: SORT_NAMES[0],
  options: [...SORT_NAMES],
  onChange: (next) => {
    filters.sort = SORTS.find((sort) => sort.label === next)?.by ?? 'name';
    schedulePaint();
  },
});
sortField.el.dataset.role = 'sort';
inline(sortField, SORT_WIDTH);
sortField.el.style.flex = `1 1 ${String(SORT_WIDTH)}px`;
findStrip.appendChild(sortField.el);

/** Whose things to count, rebuilt only when the roster changes, like the Bags selector. */
const whoPicker = { field: null, labels: [], keys: new Map() };

function whoOptions() {
  const used = new Set();
  const here = characterKey();
  const options = [{ label: EVERY_CHARACTER, key: '' }];
  for (const record of characterOrder()) {
    options.push({ label: uniqueLabel(record, here, used), key: record.key });
  }
  return options;
}

function pickWho(label) {
  filters.who = whoPicker.keys.get(label) ?? '';
  schedulePaint();
}

function buildWho(options) {
  whoPicker.field?.destroy();
  whoPicker.labels = options.map((option) => option.label);
  whoPicker.keys = new Map(options.map((option) => [option.label, option.key]));
  whoPicker.field = woc.ui.field.select({
    label: 'Held by',
    value: whoLabel(),
    options: whoPicker.labels,
    onChange: pickWho,
  });
  whoPicker.field.el.dataset.role = 'who';
  inline(whoPicker.field, PICKER_WIDTH);
  whoPicker.field.el.style.flex = `1 1 ${String(PICKER_WIDTH)}px`;
  findStrip.appendChild(whoPicker.field.el);
}

/** The label for whoever is selected, falling back to everybody when they stop being recorded. */
function whoLabel() {
  for (const [label, key] of whoPicker.keys) {
    if (key === filters.who) {
      return label;
    }
  }
  return EVERY_CHARACTER;
}

/** Like the Bags selector, the filter is hidden with only one character recorded. */
function paintFilters() {
  const options = whoOptions();
  const labels = options.map((option) => option.label);
  if (whoPicker.labels.join('|') !== labels.join('|')) {
    buildWho(options);
  }
  const many = records.size > 1;
  const el = whoPicker.field?.el;
  if (el !== undefined) {
    woc.ui.show(el, many);
  }
  // Reset when the selected character stops being recorded (`Forget other characters`).
  if (!many && filters.who !== '') {
    filters.who = '';
  }
  whoPicker.field?.set(whoLabel());
}
const itemsRows = group('items', (key) => itemTipFor(key));
scrolls(itemsRows.el);
itemsPane.appendChild(itemsRows.el);
const itemsStrip = strip(itemsPane, 'items-strip');
const shownStat = stat(itemsStrip, 'items-shown', 'Kinds');
const heldStat = stat(itemsStrip, 'items-held', 'Copies');
const worthStat = stat(itemsStrip, 'items-worth', 'Worth');
const itemsNote = line(itemsPane, 'items-note');

// Every scalar here is a chip on a strip. A grid pane puts its strip above the grid: a list fills
// its pane so a trailing strip is a footer, but a grid is only as tall as its stacks and a strip
// after it floats mid-panel. The age sits in the strip so a wide pane reads as one line.
const bagsStrip = strip(bagsPane, 'bags-strip');
const bagsAgeLine = wrapping(line(bagsStrip, 'bags-age'));
const slotsStat = stat(bagsStrip, 'slots', 'Slots');
// The same pair of words the Roster strip uses for the same pair of figures.
const freeStat = stat(bagsStrip, 'free', 'Free');
/**
 * Beside `Free`, not added in: a reagent satchel's headroom does not fit anything. Drawn only for
 * a character carrying one.
 */
const materialsStat = stat(bagsStrip, 'materials', 'Materials');
const marksStat = stat(bagsStrip, 'marks', 'Marked');
const socketsStat = stat(bagsStrip, 'sockets', 'Sockets');
const bagsWorthStat = stat(bagsStrip, 'bags-worth', 'Worth');
// The purse is the one kit row that stays: the kit draws `{ copper }` as coins, a chip takes text.
const purse = woc.ui.bar({ label: 'Carrying', className: 'woc-satchel-purse' });
purse.el.dataset.role = 'purse';
fixed(purse.el);
bagsPane.appendChild(purse.el);
bagsPane.appendChild(bagGrid.el);
const recentLine = line(bagsPane, 'recent');
const bagsNote = line(bagsPane, 'bags-note');

const bankBody = fills(column('woc-satchel-bank'));
// Inside the body, so it hides with the grid: figures for a bank never visited mean nothing.
const bankStrip = strip(bankBody, 'bank-strip');
const bankAgeLine = wrapping(line(bankStrip, 'bank-age'));
const bankSlotsStat = stat(bankStrip, 'bank-slots', 'Slots');
const bankFreeStat = stat(bankStrip, 'bank-free', 'Free');
const bankMarksStat = stat(bankStrip, 'bank-marks', 'Marked');
// `Slots` is how many there are; this is what buying more costs.
const bankTermsStat = stat(bankStrip, 'bank-terms', 'Expansion');
const bankWorthStat = stat(bankStrip, 'bank-worth', 'Worth');
// A chip, not the Bags pane's row: here the purse is context, most useful on an alt's bank.
const bankPurseStat = stat(bankStrip, 'bank-purse', 'Carrying');
// The same two chips the Bags pane uses, read off the wire rather than derived.
const bankMaterialsStat = stat(bankStrip, 'bank-materials', 'Materials');
// Unlocking a socket adds no slots, so this chip is the only figure that reports the purchase.
const bankSocketsStat = stat(bankStrip, 'bank-sockets', 'Sockets');
bankBody.append(bankSocketGrid.el, bankGrid.el);
bankPane.appendChild(bankBody);
const bankNote = line(bankPane, 'bank-note');

// Laid out like the Bank: a material count against the shared cap is a bar, an identity-bearing
// stack is a square.
const vaultBody = fills(column('woc-satchel-vault'));
const vaultStrip = strip(vaultBody, 'vault-strip');
const vaultAgeLine = wrapping(line(vaultStrip, 'vault-age'));
const vaultKindsStat = stat(vaultStrip, 'vault-kinds', 'Materials');
const vaultHeldStat = stat(vaultStrip, 'vault-held', 'Copies');
const vaultCapStat = stat(vaultStrip, 'vault-cap', 'Cap each');
const vaultRungsStat = stat(vaultStrip, 'vault-rungs', 'Rungs');
const vaultTermsStat = stat(vaultStrip, 'vault-terms', 'Upgrade');
const vaultWorthStat = stat(vaultStrip, 'vault-worth', 'Worth');
const vaultRows = group('vault', (key) => vaultRowTip(key));
scrolls(vaultRows.el);
vaultBody.append(vaultRows.el, vaultGrid.el);
vaultPane.appendChild(vaultBody);
// Whether crafting can draw from the vault here: live only, never stored.
const vaultDrawLine = wrapping(line(vaultPane, 'vault-draw'));
const vaultNote = line(vaultPane, 'vault-note');

const mailStateLine = line(mailPane, 'mail-state');
const mailRows = group('mail', (key) => mailTip(key));
scrolls(mailRows.el);
mailPane.appendChild(mailRows.el);
const mailStrip = strip(mailPane, 'mail-strip');
const mailAgeLine = wrapping(line(mailStrip, 'mail-age'));
const postageStat = stat(mailStrip, 'mail-postage', 'Postage');
const attachmentsStat = stat(mailStrip, 'mail-attachments', 'Per letter');
const flightStat = stat(mailStrip, 'mail-flight', 'In flight');
/** Copper waiting in letters: the only store that holds coin. */
const postStat = stat(mailStrip, 'mail-post', 'In the post');
const mailPurseStat = stat(mailStrip, 'mail-purse', 'Carrying');

// A kit row, like the purse, since its figure is money; it also lines up with the per-character
// rows.
const accountBar = woc.ui.bar({ label: 'Every character', className: 'woc-satchel-account' });
accountBar.el.dataset.role = 'account';
fixed(accountBar.el);
rosterPane.appendChild(accountBar.el);
const rosterStrip = strip(rosterPane, 'roster-strip');
const rosterCountStat = stat(rosterStrip, 'roster-characters', 'Characters');
const rosterSlotsStat = stat(rosterStrip, 'roster-slots', 'Slots');
const rosterFreeStat = stat(rosterStrip, 'roster-free', 'Free');
const accountWorthStat = stat(rosterStrip, 'account-worth', 'Worth');
/**
 * Beside the account's coin, not added in: `Every character` sums purses, and an attachment is
 * carried by nobody. The bar's tooltip points here.
 */
const postedStat = stat(rosterStrip, 'account-post', 'In the post');
const rosterRows = group('roster', (key) => rosterTip(key));
scrolls(rosterRows.el);
rosterPane.appendChild(rosterRows.el);
const rosterNote = line(rosterPane, 'roster-note');

const forget = document.createElement('button');
forget.type = 'button';
forget.className = 'woc-btn';
forget.dataset.role = 'forget';
forget.textContent = 'Forget other characters';
forget.style.alignSelf = 'flex-start';
fixed(forget);
/**
 * Confirm before forgetting other characters: there is no undo, and restoring a row means logging
 * in as that character. The message counts what will go. A dismissal resolves to the cancel id or
 * null.
 */
function confirmForget() {
  const others = [...records.keys()].filter((key) => key !== characterKey());
  if (others.length === 0) {
    return;
  }
  woc.ui
    .alert({
      title: 'Forget other characters',
      message: `${woc.fmt.count(others.length, 'character')} will be dropped, along with every bag, bank and mailbox reading recorded for them. Nothing here can read them back: each one returns only when that character is played again.`,
      buttons: [
        { id: 'forget', label: 'Forget them', primary: true },
        { id: 'keep', label: 'Keep them', cancel: true },
      ],
    })
    .then((answer) => {
      if (answer === 'forget') {
        forgetOthers();
      }
    })
    .catch((err) => {
      woc.warn('satchel: the confirmation could not be shown', err);
    });
}

forget.addEventListener('click', confirmForget);
rosterPane.appendChild(forget);

fixed(tabs.el);
fixed(pickerRow);
frame.body.append(
  tabs.el,
  pickerRow,
  itemsPane,
  bagsPane,
  bankPane,
  vaultPane,
  mailPane,
  rosterPane,
);
showPane(tabs.active());

/** The question the addon exists to answer. Counts are summed, the opposite of used cells. */
function buildIndex() {
  const index = new Map();
  // `characterOrder`, so the places under a row start with the character in play.
  for (const record of characterOrder()) {
    for (const source of SOURCES) {
      addPlaces(index, record, source);
    }
  }
  return index;
}

function addPlaces(index, record, source) {
  const snap = record.sources[source];
  for (const [itemId, counts] of stacksIn(snap.stacks)) {
    addPlace(index, { record, source, snap, itemId }, counts);
  }
  if (source === 'vault') {
    addVaultPlaces(index, record, snap);
  }
}

/** One place under one row, which every store adds through so the totals cannot diverge. */
function addPlace(index, at, counts) {
  const row = index.get(at.itemId) ?? { total: 0, locked: 0, places: [] };
  row.total += counts.held;
  row.locked += counts.locked;
  row.places.push({
    key: at.record.key,
    name: displayName(at.record),
    source: at.source,
    count: counts.held,
    cells: counts.cells,
    locked: counts.locked,
    at: at.snap.at,
  });
  index.set(at.itemId, row);
}

/**
 * The vault's counts into the Items totals, never through `stacksIn`: its largest-stack record
 * would make the Bags pane offer merges into impossible stacks. `cells: 0` is exact.
 */
function addVaultPlaces(index, record, snap) {
  for (const row of snap.stock) {
    addPlace(
      index,
      { record, source: 'vault', snap, itemId: row.itemId },
      { held: row.count, cells: 0, locked: 0 },
    );
  }
}

function matches(itemId, needle) {
  if (needle === '') {
    return true;
  }
  return `${nameOf(itemId)} ${itemId}`.toLowerCase().includes(needle);
}

/**
 * The rows as the filter sees them. Never filter the index in place: the roster's account total
 * reads `found.index` on the same paint. A row with no place left under the filter is dropped.
 */
function viewRows(index) {
  if (filters.who === '') {
    return index;
  }
  const rows = new Map();
  for (const [itemId, row] of index) {
    const places = row.places.filter((spot) => spot.key === filters.who);
    if (places.length > 0) {
      rows.set(itemId, {
        total: places.reduce((sum, spot) => sum + spot.count, 0),
        locked: places.reduce((sum, spot) => sum + spot.locked, 0),
        places,
      });
    }
  }
  return rows;
}

/** How many cells a row is spending. */
function cellsOf(row) {
  return row.places.reduce((sum, spot) => sum + spot.cells, 0);
}

/** When the newest reading behind a row was taken, which is how old its figures are. */
function seenAt(row) {
  return row.places.reduce((newest, spot) => Math.max(newest, spot.at), 0);
}

/**
 * A row's worth in the same source the pane's total uses, never a mixture: market and vendor
 * figures differ by tens, so mixing would misrank. Unpriced rows sink under market figures and
 * say so.
 */
function unitAt(itemId, realm, marketing) {
  if (marketing) {
    return marketOf(itemId, realm)?.unit ?? 0;
  }
  return sellOf(itemId) ?? 0;
}

function rowWorth(row, marketing) {
  let copper = 0;
  for (const spot of row.places) {
    copper += unitAt(spot.itemId, realmOf(spot.key), marketing) * spot.count;
  }
  return copper;
}

/** Descending on every figure: each asks which are the biggest. */
const SORT_KEYS = new Map([
  ['copies', (row) => row.total],
  ['cells', (row) => cellsOf(row)],
  ['seen', (row) => seenAt(row)],
]);

function orderBy(rows, ids, by, marketing) {
  if (by === 'worth') {
    return ids.sort((a, b) => worthAt(rows, b, marketing) - worthAt(rows, a, marketing));
  }
  const key = SORT_KEYS.get(by);
  if (key === undefined) {
    return ids.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }
  return ids.sort((a, b) => key(rows.get(b)) - key(rows.get(a)));
}

function worthAt(rows, itemId, marketing) {
  const row = rows.get(itemId);
  if (row === undefined) {
    return 0;
  }
  return rowWorth({ ...row, places: withIds(row.places, itemId) }, marketing);
}

/** The item id onto each place, which `rowWorth` needs and the index keeps in the key. */
function withIds(places, itemId) {
  return places.map((spot) => ({ ...spot, itemId }));
}

/**
 * Alphabetical by default ("where is my X"). Other orders are the player's pick, and the note says
 * which.
 */
function itemOrder(rows, needle, marketing) {
  const ids = [...rows.keys()].filter((itemId) => matches(itemId, needle));
  // Named first whatever the order, so ties are stable and readable.
  ids.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return orderBy(rows, ids, filters.sort, marketing);
}

/** One entry per character: the same fold the row already does over cells, one level up. */
function byCharacter(places) {
  const who = new Map();
  for (const spot of places) {
    const seen = who.get(spot.key) ?? { name: spot.name, count: 0 };
    seen.count += spot.count;
    who.set(spot.key, seen);
  }
  return [...who.values()];
}

/** The same fold one level across: where the copies are, rather than whose they are. */
function bySource(places) {
  const where = new Map();
  for (const spot of places) {
    where.set(spot.source, (where.get(spot.source) ?? 0) + spot.count);
  }
  return [...where].map(([source, count]) => `${source} ${String(count)}`);
}

/**
 * Who holds a row's copies, named to a limit and counted after it. On a one-character account it
 * names the stores instead, since the name alone would repeat the row's own figure.
 */
function placesText(places) {
  if (records.size < 2) {
    return bySource(places).join(', ');
  }
  const who = byCharacter(places);
  const named = who.slice(0, MAX_PLACE_HINTS).map((one) => `${one.name} ${String(one.count)}`);
  const rest = who.length - named.length;
  if (rest > 0) {
    named.push(`+${String(rest)} more`);
  }
  return named.join(', ');
}

/**
 * The row's second line, which follows the sort, so the figure the order was taken on is on
 * screen. Under name and copies the places text already is.
 */
function detailFor(itemId, row, marketing) {
  if (filters.sort === 'worth') {
    return worthDetail(itemId, row, marketing);
  }
  if (filters.sort === 'cells') {
    return `${String(row.total)} in ${woc.fmt.count(cellsOf(row), 'cell')}`;
  }
  if (filters.sort === 'seen') {
    return `last read ${agoText(seenAt(row))}`;
  }
  return placesText(row.places);
}

/** The figure the worth order was taken on, or why this row has none and sank to the bottom. */
function worthDetail(itemId, row, marketing) {
  const copper = rowWorth({ ...row, places: withIds(row.places, itemId) }, marketing);
  if (copper > 0) {
    return money(copper);
  }
  if (marketing) {
    return 'no recorded price';
  }
  return 'no published price';
}

/**
 * One aggregated row: an item, every copy on the account, and where. `most` is the largest total
 * on screen, so the fill reads as a share of the biggest pile.
 */
function itemEntry(itemId, most, marketing) {
  const row = found.view.get(itemId) ?? { total: 0, locked: 0, places: [] };
  const icon = woc.ui.icon.item(itemId);
  return {
    key: itemId,
    icon,
    update: {
      label: nameOf(itemId),
      icon,
      value: String(row.total),
      detail: detailFor(itemId, row, marketing),
      fraction: fractionOf(fillValue(itemId, marketing), most),
      // Tier colours the name on a bar. Without it, filled rows would read as selected rows.
      quality: qualityOf(itemId),
      tone: 'default',
    },
  };
}

/** The clause a place adds when some copies are protected, or nothing. */
function lockedClause(locked) {
  if (locked > 0) {
    return `, ${String(locked)} locked`;
  }
  return '';
}

function placeLines(places) {
  return places.map((spot) => ({
    text:
      `${spot.name}, ${spot.source}: ${String(spot.count)}${cellClause(spot)}` +
      `${lockedClause(spot.locked)}, read ${agoText(spot.at)}`,
  }));
}

/** How many cells the copies spend; zero (a vault count) drops the clause. */
function cellClause(spot) {
  if (spot.cells <= 0) {
    return ' held';
  }
  return ` in ${woc.fmt.count(spot.cells, 'cell')}`;
}

/** What one item is worth, each and in total. Empty when unpriced, the ordinary case. */
function worthLine(itemId, total) {
  const each = sellOf(itemId);
  if (each === null) {
    return '';
  }
  return `A vendor pays ${money(each)} each, ${money(each * total)} for all ${String(total)}.`;
}

/**
 * How old a market figure is and how much stands behind it. Distinct from the store's stamp,
 * which says when the bags were read, not when the counter was.
 */
function evidenceText(said) {
  const trips = `${woc.fmt.count(said.visits, 'reading')}, newest ${agoText(said.at)}`;
  if (said.visits > 1) {
    return `${trips}.`;
  }
  return `${trips}. One reading is one seller's asking price on one day.`;
}

/** What was paid, where published, never folded into the figure above it. */
function paidLine(said) {
  if (said.sold <= 0 || said.sales <= 0) {
    return [];
  }
  return [
    {
      text: `You have been paid a median of ${money(said.sold)} each over ${woc.fmt.count(said.sales, 'sale')}, which is what somebody actually gave rather than what is being asked.`,
      tone: 'muted',
    },
  ];
}

/** What this item goes for on one realm, or nothing where unpriced there. See `marketOf`. */
function marketLines(itemId, realm, count, what) {
  const said = marketOf(itemId, realm);
  if (said === null) {
    return [];
  }
  const total = said.unit * count;
  return [
    `The counter: ${money(said.unit)} each, ${money(total)} for ${what}.`,
    { text: evidenceText(said), tone: 'muted' },
    ...paidLine(said),
  ];
}

/** `47 across 2 characters`, or the bare total when only one holds any. */
function spreadText(row) {
  const who = byCharacter(row.places).length;
  if (who === 1) {
    return `${String(row.total)} in all, on one character`;
  }
  return `${String(row.total)} in all, across ${String(who)} characters`;
}

/**
 * How many copies are locked, silent at zero (the ordinary state). It names the stores counted,
 * since mail attachments arrive without the flag and count as unlocked.
 */
function lockedLine(row) {
  if (row.locked <= 0) {
    return '';
  }
  return `${String(row.locked)} of ${String(row.total)} locked against salvage, crafting and vendor sale. Mail cannot say, so a copy in the post is not counted.`;
}

/**
 * The copies of a row on a market with a published price, and how many are elsewhere: a row pools
 * realms, so `row.total` is the wrong multiplier for a market figure.
 */
function pricedHere(row) {
  const said = prices.get(row.itemId) ?? null;
  if (said === null) {
    return { count: 0, elsewhere: 0 };
  }
  let count = 0;
  for (const spot of row.places) {
    if (realmOf(spot.key) === said.realm) {
      count += spot.count;
    }
  }
  return { count, elsewhere: row.total - count };
}

/** What `pricedHere` had to leave out, which is nothing on a one-realm account. */
function elsewhereLine(elsewhere) {
  if (elsewhere <= 0) {
    return [];
  }
  return [
    {
      text: `${String(elsewhere)} of these are on another realm, whose counter nothing has priced, so they are not in that figure.`,
      tone: 'muted',
    },
  ];
}

function rowMarketLines(row) {
  const { count, elsewhere } = pricedHere(row);
  if (count <= 0) {
    return [];
  }
  const realm = prices.get(row.itemId)?.realm ?? '';
  return [
    ...marketLines(row.itemId, realm, count, `all ${String(count)}`),
    ...elsewhereLine(elsewhere),
  ];
}

function itemTipFor(itemId) {
  // The view, so a row filtered to one character describes that character's copies.
  const row = found.view.get(itemId);
  if (row === undefined) {
    return itemId;
  }
  const lines = [`Item id: ${itemId}`, spreadText(row)];
  lines.push(...placeLines(row.places));
  const locked = lockedLine(row);
  if (locked !== '') {
    lines.push({ text: locked, tone: 'warn' });
  }
  const worth = worthLine(itemId, row.total);
  if (worth !== '') {
    lines.push(worth);
  }
  lines.push(...rowMarketLines({ ...row, itemId }));
  lines.push(...nameLines(itemId));
  lines.push({ text: 'Nothing here can move, mail or sell an item.', tone: 'muted' });
  return { title: nameOf(itemId), icon: woc.ui.icon.item(itemId), lines };
}

/**
 * Only what a figure cannot say: the states with no count, and the cap, or the fortieth row reads
 * as the last item on the account.
 */
function itemsNoteText(shown, total) {
  if (records.size === 0) {
    return 'Nothing recorded yet. Log in on a character and their bags appear here.';
  }
  if (total === 0) {
    return emptyText();
  }
  if (shown < total) {
    // Names the order: a cap is only an answer when it is the top of something.
    return `The first ${String(shown)} by ${sortLabel().toLowerCase()}. Search or pick a character for the rest.`;
  }
  return '';
}

/** Why the list is empty, one sentence for each of the two ways. */
function emptyText() {
  if (filters.who !== '') {
    return `Nothing on ${displayName(records.get(filters.who) ?? emptyRecord(''))} matches that.`;
  }
  return 'No item on any character matches that.';
}

/** The word the player picked, for the sentence under the list. */
function sortLabel() {
  return SORTS.find((sort) => sort.by === filters.sort)?.label ?? 'name';
}

/** `40 / 57` while the list is capped, and the plain total while it is not. */
function shownText(shown, total) {
  if (total === 0) {
    return '';
  }
  if (shown < total) {
    return `${String(shown)} / ${String(total)}`;
  }
  return String(total);
}

/** Every copy of everything, counted rather than measured. See `heldTip`. */
function heldText(order) {
  let total = 0;
  for (const itemId of order) {
    total += found.view.get(itemId)?.total ?? 0;
  }
  if (total === 0) {
    return '';
  }
  return String(total);
}

/** The rows the search matched, folded per realm the way `accountCounts` folds every row. */
function matchedCounts(order) {
  const wanted = new Set(order);
  return countsFrom(found.view).filter(([itemId]) => wanted.has(itemId));
}

/**
 * What a row's fill measures: whatever the list is ordered on, so bar, second line and order are
 * one fact. `seen` gets no fill: an age has no zero point, so every bar would be nearly full.
 */
function fillValue(itemId, marketing) {
  const row = found.view.get(itemId);
  if (row === undefined || filters.sort === 'seen') {
    return 0;
  }
  if (filters.sort === 'worth') {
    return rowWorth({ ...row, places: withIds(row.places, itemId) }, marketing);
  }
  if (filters.sort === 'cells') {
    return cellsOf(row);
  }
  return row.total;
}

/**
 * The largest of everything the filters matched, not of the rows drawn, or the row cap silently
 * rescales every bar. Moving with the search and filter is fine: the player did that.
 */
function largestOf(order, marketing) {
  let most = 0;
  for (const itemId of order) {
    most = Math.max(most, fillValue(itemId, marketing));
  }
  return most;
}

/**
 * Whether the pane draws market figures, which decides what a worth sort ranks on. Read from the
 * whole account, so a search matching only unpriced rows does not change the order's meaning.
 */
function showingMarket() {
  return marketFirst(worthOf(accountCounts()));
}

function paintItems() {
  found.index = buildIndex();
  found.view = viewRows(found.index);
  paintFilters();
  const onMarket = showingMarket();
  const needle = search.value().trim().toLowerCase();
  const order = itemOrder(found.view, needle, onMarket);
  const shown = order.slice(0, MAX_ITEM_ROWS);
  const most = largestOf(order, onMarket);
  itemsRows.rows.sync(shown.map((itemId) => itemEntry(itemId, most, onMarket)));
  setStat(shownStat, shownText(shown.length, order.length));
  setStat(heldStat, heldText(order));
  // Over everything matched, like the count beside it, not stopped at the row cap.
  found.worth = worthOf(matchedCounts(order));
  paintWorth(worthStat, found.worth);
  say(itemsNote, itemsNoteText(shown.length, order.length));
}

function shownTip() {
  return {
    title: 'Kinds',
    lines: [
      `Distinct items matching, across every character recorded. At most ${String(MAX_ITEM_ROWS)} rows are drawn at once.`,
      { text: 'A row counts every copy on the account, wherever it is.', tone: 'muted' },
      {
        text: 'A stack split over four cells is one row, not four: cells are what the Bags pane counts.',
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(shownStat.el, shownTip);

function heldTip() {
  return {
    title: 'Copies',
    lines: [
      'Every copy of every matching item added up, wherever it sits: bags, bank, and parcels still waiting in the mail.',
      {
        text: 'Bank and mail are only as fresh as the last visit to one. Each row says how old its reading is.',
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(heldStat.el, heldTip);

/**
 * How the budget is arrived at. Before the table lands the ceiling half is left off, not guessed.
 */
function poolingLine() {
  const start = `Pooled: ${String(poolTable.backpackSlots)} in the backpack plus whatever your ${String(poolTable.sockets)} bag sockets add`;
  if (poolTable.biggest <= 0) {
    return `${start}.`;
  }
  const ceiling = poolTable.backpackSlots + poolTable.sockets * poolTable.biggest;
  return `${start}, up to ${String(ceiling)} with the largest bag in every one.`;
}

function capacityTip() {
  const lines = [
    { text: 'One cell is one stack, however much is in it.', tone: 'muted' },
    { text: 'Every free cell is a dashed square in the grid below.', tone: 'muted' },
    {
      text: 'Nothing here can sort, move or sell: the loader never sends a command.',
      tone: 'muted',
    },
  ];
  if (poolsKnown()) {
    lines.unshift(poolingLine());
  }
  return { title: 'Slots', lines };
}
woc.ui.tooltip(slotsStat.el, capacityTip);

/** Which reading `Free` is; the pooled fallback must announce itself. */
function freeReadingLine(space, source) {
  if (space.split) {
    return {
      text: 'What anything will fit in. A reagent satchel holds materials only, and its room is counted separately.',
      tone: 'muted',
    };
  }
  if (source !== 'bags') {
    // The bank's split is sent, so only a record stored before it was recorded reaches here.
    return {
      text: 'Every cell. This reading was taken before this addon recorded the split, so a materials-only satchel socketed here is counted in with the rest.',
      tone: 'muted',
    };
  }
  return {
    text: `Every cell pooled together, because ${unreadableReason(space)} So a reagent satchel's room is counted in here, and only materials can use it.`,
    tone: 'muted',
  };
}

/** Which of the three ways the split is unavailable, named. */
function unreadableReason(space) {
  if (space.unknown !== '') {
    return `this addon does not recognise ${nameOf(space.unknown)} and cannot say which pool it feeds.`;
  }
  if (!poolsKnown()) {
    return 'the bag table this addon ships has not been read yet.';
  }
  return 'the bag table this addon ships disagrees with the game about how many cells these bags hold.';
}

/** The free figure's colour, said in words. */
function freeTipFor(source) {
  const space = freeSpace(viewedSource(source));
  return {
    title: 'Free',
    lines: [
      `${woc.fmt.count(space.free, 'cell')} with nothing in them.`,
      freeReadingLine(space, source),
      {
        text: `The figure turns at ${woc.fmt.count(threshold(), 'cell')} left, which is your own setting, and the last free squares in the grid turn with it.`,
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(freeStat.el, () => freeTipFor('bags'));

/**
 * What only a material can reach. The set is the game's derivation, not guessable, so the tooltip
 * gives its size.
 */
function materialsTip() {
  const space = freeSpace(viewedSource('bags'));
  return {
    title: 'Materials',
    lines: [
      `${woc.fmt.count(space.materials, 'cell')} in a reagent satchel, which nothing but a material will go into.`,
      {
        text: `Ores, herbs, hides, cloth, logs, fish and reagents: ${String(materialIds.size)} items the game counts as materials, read from its own tables at ${poolTable.version}.`,
        tone: 'muted',
      },
      {
        text: 'A material takes one of these before it takes a general cell, so this room is spent first.',
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(materialsStat.el, materialsTip);

function socketLine(itemId, at) {
  const label = `Socket ${String(at + 1)}`;
  if (typeof itemId !== 'string' || itemId === '') {
    return { text: `${label}: empty`, tone: 'muted' };
  }
  return `${label}: ${nameOf(itemId)}`;
}

function socketTip() {
  const { sockets } = viewedSource('bags');
  if (sockets.length === 0) {
    return { title: 'Bag sockets', lines: [{ text: 'Nothing recorded yet.', tone: 'muted' }] };
  }
  return { title: 'Bag sockets', lines: sockets.map((itemId, at) => socketLine(itemId, at)) };
}
woc.ui.tooltip(socketsStat.el, socketTip);

/** Where the figure came from: a stored one is as old as its reading. */
function moneyTip() {
  const record = viewedRecord();
  if (record === null) {
    return { title: 'Carrying', lines: [{ text: 'Nothing recorded yet.', tone: 'muted' }] };
  }
  return {
    title: 'Carrying',
    lines: [
      `What ${displayName(record)} was carrying when their bags were last read, ${agoText(record.at)}.`,
      { text: 'Counted in copper, the way the game counts it.', tone: 'muted' },
    ],
  };
}
woc.ui.tooltip(purse.el, moneyTip);

/** `1 of 2 kinds priced`: says the figure beside it is partial. */
function pricedText(sums) {
  return `${String(sums.priced)} of ${String(sums.kinds)} kinds priced`;
}

/**
 * Which figure a chip shows: market where there is one, since the vendor floor is too small to
 * act on. The vendor total moves to the tooltip as the certain figure. The label changes with it:
 * a figure must not change meaning silently.
 */
function marketFirst(sums) {
  return sums.marketPriced > 0;
}

/**
 * Drawn or removed, never `0c`: with no prices published that would claim everything is worthless.
 * `pricedText` goes in the tooltip.
 */
function paintWorth(chip, sums) {
  if (marketFirst(sums)) {
    setStatLabel(chip, 'Market');
    setStat(chip, money(sums.market));
    return;
  }
  setStatLabel(chip, 'Worth');
  if (sums.priced <= 0) {
    setStat(chip, '');
    return;
  }
  setStat(chip, money(sums.copper));
}

/** `2 of 9 kinds`, and what an evidence count of one means, or nothing where none is thin. */
function thinLine(sums) {
  if (sums.thin <= 0) {
    return [];
  }
  return [
    {
      text: `${String(sums.thin)} of ${String(sums.marketPriced)} rest on a single reading, which is one seller's asking price on one day.`,
      tone: 'warn',
    },
  ];
}

/** The vendor total, kept beside the market one. See `marketFirst`. */
function floorLine(sums) {
  if (sums.priced <= 0) {
    return [{ text: 'Nobody has published what a vendor pays for any of this.', tone: 'muted' }];
  }
  return {
    text: `A vendor would pay ${money(sums.copper)} for it, over ${pricedText(sums)}. That is a floor rather than what it would fetch, and it is the only certain figure here.`,
    tone: 'muted',
  };
}

/** What every worth figure has to say about itself, wherever it is drawn. */
function worthTipFor(said, sums) {
  if (marketFirst(sums)) {
    return {
      title: 'Market',
      lines: [
        said.market,
        {
          text: `${String(sums.marketPriced)} of ${String(sums.kinds)} kinds have a recorded price, and what nobody has seen on the counter is left out rather than counted at nothing.`,
          tone: 'muted',
        },
        ...thinLine(sums),
        floorLine(sums),
        { text: 'Nothing here can sell an item.', tone: 'muted' },
      ],
    };
  }
  return {
    title: 'Worth',
    lines: [
      said.vendor,
      {
        text: `${pricedText(sums)}. What nobody priced is left out rather than counted at nothing.`,
        tone: 'muted',
      },
      { text: 'Nothing here can sell an item.', tone: 'muted' },
    ],
  };
}

/** The stacks behind one of the two per-character rows, or none before anybody is recorded. */
function viewedCounts(source) {
  if (viewedRecord() === null) {
    return [];
  }
  return storeCounts(viewedSource(source).stacks, viewedRealm());
}

woc.ui.tooltip(bagsWorthStat.el, () =>
  worthTipFor(
    {
      vendor: 'These bags at what a vendor pays for each thing in them.',
      market: 'These bags at what each thing in them has been going for on the counter.',
    },
    worthOf(viewedCounts('bags')),
  ),
);

woc.ui.tooltip(bankWorthStat.el, () =>
  worthTipFor(
    {
      vendor: 'This bank at what a vendor pays for each thing in it.',
      market: 'This bank at what each thing in it has been going for on the counter.',
    },
    worthOf(viewedCounts('bank')),
  ),
);

// Every store, unlike the slot total beside it (bags only, since a bank is recorded only on a
// visit). A thing owned is owned wherever it was last seen, and the line says so.
woc.ui.tooltip(accountWorthStat.el, () =>
  worthTipFor(
    {
      vendor:
        'Every store of every character recorded, bank and mailbox included, at what a vendor pays.',
      market:
        'Every store of every character recorded, at what each thing has been going for on their own realm.',
    },
    worthOf(accountCounts()),
  ),
);

woc.ui.tooltip(worthStat.el, () =>
  worthTipFor(
    {
      vendor: 'What the rows matching the search are worth to a vendor.',
      market: 'What the rows matching the search have been going for on the counter.',
    },
    found.worth,
  ),
);

/**
 * What to say about names without calling anything wrong. Both silences are ordinary: the art
 * manifest names only its curated entries, and a name publisher may be absent or disabled.
 */
function namingLine() {
  if (names.size === 0) {
    return 'Its art file carries no name and nothing is publishing names over the bus, so the label above is this id read back as words.';
  }
  return `Its art file carries no name and it is not among the ${String(names.size)} ids published over the bus so far, so the label above is this id read back as words.`;
}

/** What a publisher said about an item, in one line, skipping what it left out. */
function itemFacts(record) {
  const parts = [];
  if (record.kind !== '') {
    parts.push(record.kind);
  }
  if (record.quality !== '') {
    parts.push(record.quality);
  }
  if (record.source !== '') {
    parts.push(`from ${record.source}`);
  }
  if (parts.length === 0) {
    return { text: 'Named, with nothing else published about it.', tone: 'muted' };
  }
  return parts.join(', ');
}

/** Where this square's name came from, or that nothing has one for it. */
function nameLines(itemId) {
  const record = known(itemId);
  if (record !== null) {
    return [itemFacts(record), { text: `Named by ${record.from}`, tone: 'muted' }];
  }
  if (bagName(itemId) !== null) {
    return [BAG_NOTE];
  }
  if (artName(itemId) !== null) {
    return [ART_NOTE];
  }
  return [{ text: namingLine(), tone: 'muted' }];
}

/** What a merge would free, at the precision an observed maximum allows. */
function freeLine(frees) {
  if (frees > 0) {
    return `Merging them by hand would free ${woc.fmt.count(frees, 'cell')}.`;
  }
  return {
    text: 'Merging them would free nothing, measured against the largest stack seen.',
    tone: 'muted',
  };
}

/** What this panel marks, spelled out for the cell under the pointer. */
function markLines(view, itemId) {
  const lines = [];
  const held = view.held.get(itemId);
  if (held !== undefined && held.cells > 1) {
    lines.push(`${woc.fmt.count(held.cells, 'cell')}, ${String(held.held)} held`);
    lines.push(freeLine(mergeable(itemId, held)));
  }
  if (view.spare.has(itemId)) {
    lines.push({ text: 'This character is wearing one of these as well.', tone: 'warn' });
  }
  if (view.carried.has(itemId)) {
    lines.push({ text: 'This character is carrying one of these too.', tone: 'warn' });
  }
  return lines;
}

/**
 * What a vendor pays for this square, each (to compare stacks) and total (to judge the trip).
 */
function cellWorthLine(itemId, count) {
  const each = sellOf(itemId);
  if (each === null) {
    return [];
  }
  if (count <= 1) {
    return [`A vendor pays ${money(each)}.`];
  }
  return [`A vendor pays ${money(each)} each, ${money(each * count)} for this cell.`];
}

/**
 * Both figures on one square, labelled, never merged. Vendor first as the certain one; the market
 * line says its age and evidence. A blend would be true of neither.
 */
function priceLines(itemId, count) {
  return [
    ...cellWorthLine(itemId, count),
    ...marketLines(itemId, viewedRealm(), count, 'this cell'),
  ];
}

/** What made this stack, where kept: it tells two vault squares of one item id apart. */
function recipeLines(entry) {
  const recipe = text(entry?.recipe);
  if (recipe === '') {
    return [];
  }
  return [{ text: `Crafted from ${woc.fmt.titleCase(recipe)}, which is why it is its own row.` }];
}

function itemTip(view, entry) {
  const itemId = entryId(entry);
  const count = entryCount(entry);
  const lines = [`Item id: ${itemId}`, `${String(count)} in this cell`];
  lines.push(...recipeLines(entry));
  lines.push(...nameLines(itemId));
  lines.push(...priceLines(itemId, count));
  lines.push(...markLines(view, itemId));
  lines.push({ text: 'Nothing here can move, merge or sell an item.', tone: 'muted' });
  return { title: nameOf(itemId), icon: woc.ui.icon.item(itemId), lines };
}

/** From the last paint's plan, so it describes the square under the pointer. */
function cellTip(grid, at) {
  const entry = grid.plan[at];
  if (entry === null || entry === undefined) {
    return {
      title: 'Empty cell',
      lines: [{ text: 'Room for one more stack.', tone: 'muted' }],
    };
  }
  return itemTip(grid.view, entry);
}

/** A tile, not a bar: a cell is art. */
function createCell(grid, at) {
  const tile = woc.ui.tile({ className: 'woc-satchel-cell', size: CELL_SIZE });
  tile.el.dataset.cell = String(at);
  woc.ui.tooltip(tile.el, () => cellTip(grid, at));
  return tile;
}

/** A count worth drawing: "1" on every single item is noise. */
function countFor(entry) {
  const count = entryCount(entry);
  if (count > 1) {
    return count;
  }
  return null;
}

/** Whether this square carries one of the three marks. See `readStore`. */
function isMarked(itemId, view) {
  return view.split.has(itemId) || view.spare.has(itemId) || view.carried.has(itemId);
}

/**
 * The tier a publisher gave this id, or null. It borders the square, as the game's own bag does.
 * Anything outside the kit's enum is refused.
 */
function qualityOf(itemId) {
  const said = known(itemId)?.quality ?? '';
  if (!QUALITY_TIERS.has(said)) {
    return null;
  }
  return said;
}

/** What a square announces: the item, and the lock where there is one. */
function cellName(itemId, locked) {
  if (locked) {
    return `${nameOf(itemId)}, locked`;
  }
  return nameOf(itemId);
}

/**
 * The padlock on one cell, built once and then shown or hidden: the grid repaints on every world
 * change, and rebuilding it would allocate per cell per frame.
 */
function lockMark(tile) {
  const held = tile.el.querySelector('[data-satchel-lock]');
  if (held !== null) {
    return held;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 14 16');
  svg.setAttribute('fill', 'currentColor');
  // Hidden from assistive technology: the cell's accessible name already says locked.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.satchelLock = '';
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', LOCK_PATH);
  svg.appendChild(path);
  svg.style.position = 'absolute';
  svg.style.left = '2px';
  svg.style.bottom = '1px';
  svg.style.width = `${String(LOCK_PX)}px`;
  svg.style.height = `${String(LOCK_PX)}px`;
  svg.style.color = LOCK_COLOR;
  svg.style.filter = 'drop-shadow(0 1px 1px rgb(0 0 0))';
  svg.style.pointerEvents = 'none';
  tile.el.appendChild(svg);
  return svg;
}

function paintLock(tile, locked) {
  const held = tile.el.querySelector('[data-satchel-lock]');
  if (!locked) {
    if (held !== null) {
      held.style.display = 'none';
    }
    return;
  }
  lockMark(tile).style.display = 'block';
}

/** The pip, built and kept like the padlock. Top left, opposite the count. */
function markPip(tile) {
  const held = tile.el.querySelector('[data-satchel-mark]');
  if (held !== null) {
    return held;
  }
  const pip = document.createElement('span');
  pip.dataset.satchelMark = '';
  pip.style.position = 'absolute';
  pip.style.left = '3px';
  pip.style.top = '3px';
  pip.style.width = `${String(MARK_PX)}px`;
  pip.style.height = `${String(MARK_PX)}px`;
  pip.style.borderRadius = '50%';
  pip.style.backgroundColor = MARK_COLOR;
  pip.style.boxShadow = '0 0 2px rgb(0 0 0)';
  pip.style.pointerEvents = 'none';
  // Silent, like the padlock: the tooltip spells out what it stands for.
  pip.setAttribute('aria-hidden', 'true');
  tile.el.appendChild(pip);
  return pip;
}

function paintMark(tile, marked) {
  const held = tile.el.querySelector('[data-satchel-mark]');
  if (!marked) {
    if (held !== null) {
      held.style.display = 'none';
    }
    return;
  }
  markPip(tile).style.display = 'block';
}

/** A toned empty square is drawn nearly solid, or the faintness takes its colour with it. */
function emptyOpacity(last) {
  if (last === 'default') {
    return EMPTY_OPACITY;
  }
  return LAST_OPACITY;
}

/**
 * The label is unset, not left alone, or a reused cell announces its previous item. `null` is
 * unnamed; '' is a blank name. `last` marks the player's last few cells, the only toned state.
 */
function clearCell(tile, last) {
  tile.update({ label: null, icon: null, count: null, quality: null, tone: last });
  tile.el.style.backgroundColor = EMPTY_FILL;
  tile.el.style.borderStyle = EMPTY_EDGE;
  tile.el.style.opacity = emptyOpacity(last);
  tile.el.dataset.item = '';
  paintLock(tile, false);
  paintMark(tile, false);
}

function fillCell(tile, entry, view) {
  const itemId = entryId(entry);
  const locked = isLocked(entry);
  tile.update({
    // The lock rides the accessible name: a tile is announced as one image.
    label: cellName(itemId, locked),
    icon: woc.ui.icon.item(itemId),
    count: countFor(entry),
    quality: qualityOf(itemId),
    tone: 'default',
  });
  tile.el.style.backgroundColor = OCCUPIED_FILL;
  tile.el.style.borderStyle = OCCUPIED_EDGE;
  tile.el.style.opacity = OCCUPIED_OPACITY;
  tile.el.dataset.item = itemId;
  paintLock(tile, locked);
  paintMark(tile, isMarked(itemId, view));
}

function paintCell(tile, entry, view, last) {
  if (tile === undefined) {
    return;
  }
  if (entry === null) {
    clearCell(tile, last);
    return;
  }
  fillCell(tile, entry, view);
}

/**
 * The warning tone on the empty squares too, where the player is looking. Every free cell, not a
 * subset: no particular empty square is the last one.
 */
function emptyTone(free) {
  if (free <= 0) {
    return 'default';
  }
  return toneFor(free);
}

function paintGrid(grid, plan, view, free) {
  // Held before the sync: `update` paints from `grid.view`, and a tooltip reads later.
  grid.plan = plan;
  grid.view = view;
  grid.last = emptyTone(free);
  grid.cells.sync(plan.map((entry, at) => ({ at, entry })));
}

/** What the marked cells add up to, as short figures, or nothing. `marksTip` spells them out. */
function marksText(view) {
  const parts = [];
  if (view.split.size > 0) {
    parts.push(`${String(view.split.size)} split`);
  }
  if (view.reclaim > 0) {
    parts.push(`${String(view.reclaim)} to free`);
  }
  if (view.spare.size > 0) {
    parts.push(`${String(view.spare.size)} worn`);
  }
  if (view.carried.size > 0) {
    parts.push(`${String(view.carried.size)} carried`);
  }
  return parts.join(', ');
}

/** Agreement, because one of a thing and three of it take different verbs. */
function isAre(count) {
  if (count === 1) {
    return 'is';
  }
  return 'are';
}

/** The marks spelled out; the strip's chip counts them. */
function markSentences(view) {
  const lines = [];
  if (view.split.size > 0) {
    lines.push(
      `${woc.fmt.count(view.split.size, 'item')} here ${isAre(view.split.size)} in more than one cell.`,
    );
    lines.push(freeLine(view.reclaim));
  }
  if (view.spare.size > 0) {
    lines.push(
      `${woc.fmt.count(view.spare.size, 'item')} here ${isAre(view.spare.size)} also equipped.`,
    );
  }
  if (view.carried.size > 0) {
    lines.push(
      `${woc.fmt.count(view.carried.size, 'item')} here ${isAre(view.carried.size)} also in the bags.`,
    );
  }
  return lines;
}

function marksTip(grid) {
  return {
    title: 'Marked',
    lines: [
      ...markSentences(grid.view),
      { text: 'Nothing here can move, merge or sell an item.', tone: 'muted' },
    ],
  };
}
woc.ui.tooltip(marksStat.el, () => marksTip(bagGrid));
woc.ui.tooltip(bankMarksStat.el, () => marksTip(bankGrid));

/** A share, guarded against a NaN reaching a style property. */
function fractionOf(part, total) {
  if (total <= 0) {
    return 0;
  }
  return part / total;
}

function toneFor(free) {
  if (free <= 0) {
    return 'danger';
  }
  if (free <= threshold()) {
    return 'warn';
  }
  return 'default';
}

/**
 * How old a reading is. The live case says live, never "moments ago": one is being refreshed,
 * the other may already be wrong.
 */
function ageText(snap, live) {
  if (live) {
    return 'Live.';
  }
  if (snap.at <= 0) {
    return 'Never read.';
  }
  return `Last read ${agoText(snap.at)}.`;
}

function whoseText(record) {
  if (viewingSelf()) {
    return '';
  }
  return `${displayName(record)}: `;
}

/**
 * The `Materials` figure, or nothing. No satchel and an unplaceable satchel both read blank; the
 * `Free` tooltip says which.
 */
function materialsText(space) {
  if (!space.split || space.materials <= 0) {
    return '';
  }
  return String(space.materials);
}

function paintBagsFigures(snap) {
  const space = freeSpace(snap);
  setStat(slotsStat, `${String(snap.used)} / ${String(snap.total)}`);
  setStat(freeStat, String(space.free));
  setStatTone(freeStat, toneFor(space.free));
  setStat(materialsStat, materialsText(space));
}

/** `1 / 4`, with what is in each of them one hover away. See `socketTip`. */
function socketsText(snap) {
  const filled = snap.sockets.filter((itemId) => itemId !== '').length;
  const total = Math.max(snap.sockets.length, poolTable.sockets);
  return `${String(filled)} / ${String(total)}`;
}

// On the line, not only the tooltip: a figure acted on without hovering carries its own caveat.
const POOLED_TAIL = ', so the free count is every cell pooled together.';

// Only the stale-table reasons speak: no sockets needs no sentence, and a pending fetch resolves
// itself.
const SPLIT_NOTES = new Map([
  ['unknown-bag', ` A bag here is not recognised${POOLED_TAIL}`],
  [
    'budget',
    ` These bags hold a different number of cells than this addon's table says${POOLED_TAIL}`,
  ],
]);

function splitNoteFor(snap) {
  return SPLIT_NOTES.get(freeSpace(snap).reason) ?? '';
}

/** Nobody is playing, or nobody has been here: no figures and one sentence. */
function clearBags() {
  // No cells, so no free count for the tone.
  paintGrid(bagGrid, [], emptyView(), 0);
  say(bagsNote, noRecordText());
  say(bagsAgeLine, '');
  say(recentLine, '');
  for (const chip of [slotsStat, freeStat, materialsStat, marksStat, socketsStat, bagsWorthStat]) {
    setStat(chip, '');
  }
  woc.ui.show(purse.el, false);
}

function paintBags() {
  const record = viewedRecord();
  const live = viewingSelf();
  woc.ui.show(bagGrid.el, record !== null);
  if (record === null) {
    clearBags();
    return;
  }
  const snap = record.sources.bags;
  paintBagsFigures(snap);
  const view = readStore(snap.stacks, new Set(record.equipped), new Set());
  paintGrid(bagGrid, cellPlan(snap), view, freeSpace(snap).free);
  say(bagsNote, '');
  say(bagsAgeLine, `${whoseText(record)}${ageText(snap, live)}${splitNoteFor(snap)}`);
  setStat(marksStat, marksText(view));
  setStat(socketsStat, socketsText(snap));
  woc.ui.show(purse.el, true);
  purse.update({ value: { copper: record.copper } });
  paintWorth(bagsWorthStat, worthOf(storeCounts(snap.stacks, record.realm)));
  say(recentLine, liveRecent(live));
}

/** The game's own narration, which is only about the character in play. */
function liveRecent(live) {
  if (!live) {
    return '';
  }
  return recent.text;
}

/** What has been bought, what was granted, and what the next expansion costs. */
function expansionText(snap) {
  const parts = [];
  if (snap.bought > 0) {
    parts.push(`${String(snap.bought)} bought`);
  }
  if (snap.granted > 0) {
    parts.push(`${String(snap.granted)} granted`);
  }
  if (snap.next === null) {
    parts.push('all bought');
    return parts.join(', ');
  }
  parts.push(`next ${money(snap.next)}`);
  return parts.join(', ');
}

/** The same figures as sentences, and where each of them came from. */
function expansionLines(snap) {
  const lines = [
    `${woc.fmt.count(snap.bought, 'cell')} bought and ${woc.fmt.count(snap.granted, 'cell')} granted.`,
  ];
  if (snap.next === null) {
    lines.push('Every expansion has been bought.');
    return lines;
  }
  lines.push(`The next expansion costs ${money(snap.next)}${claudiumClause()}`);
  return lines;
}

/**
 * The Claudium price beside the gold one. Absent on the wire when its service is unreachable,
 * which means show gold only, not that the rung is unbuyable. Live only, never recorded.
 */
function claudiumClause() {
  const price = woc.world.bank.info?.nextRungClaudiumPrice;
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    return '.';
  }
  return `, or ${String(price)} Claudium.`;
}

/** The per-source breakdown, skipping a source that has granted nothing yet. */
function bonusLines() {
  const state = woc.world.bank;
  if (state.info === null || !Array.isArray(state.info.bonusSources)) {
    return [];
  }
  return state.info.bonusSources
    .filter((source) => numberOr(source?.slots, 0) > 0)
    .map((source) => ({
      text: `${text(source?.id)}: ${woc.fmt.count(numberOr(source?.slots, 0), 'cell')}`,
      tone: 'muted',
    }));
}

function bankTip() {
  const snap = viewedSource('bank');
  return {
    title: 'Bank',
    lines: [
      `${String(snap.total)} slots: the base allowance, plus what has been bought, plus what the account was granted.`,
      { text: 'One slot is one stack, the same as a bag cell.', tone: 'muted' },
      ...bonusLines(),
      { text: 'Nothing here can move an item into or out of the bank.', tone: 'muted' },
    ],
  };
}
woc.ui.tooltip(bankSlotsStat.el, bankTip);
woc.ui.tooltip(bankFreeStat.el, () => freeTipFor('bank'));

/** The expansion budget, in full, under the chip that carries its figures. */
function bankTermsTip() {
  const snap = viewedSource('bank');
  return {
    title: 'Expansion',
    lines: [
      ...expansionLines(snap),
      ...bonusLines(),
      { text: 'Nothing here can buy one.', tone: 'muted' },
    ],
  };
}
woc.ui.tooltip(bankTermsStat.el, bankTermsTip);

/**
 * Never "it is empty": the server sends nothing for a counter nobody is at. A note about
 * freshness, since what is drawn meanwhile is the last reading.
 */
function gateText(status, counter, live, drawn) {
  if (!live || status === 'near') {
    return '';
  }
  if (status === 'unknown') {
    return 'Not in the world yet.';
  }
  if (drawn) {
    return `Not at ${counter}: this is the last reading, not a live one.`;
  }
  return `Not at ${counter}.`;
}

/** Why a pane has nothing to draw: nobody is playing, or nobody has been here. */
function noRecordText() {
  if (characterKey() === '') {
    return 'Not in the world yet.';
  }
  return 'Nothing recorded for this character yet.';
}

function bankNoteText(record, snap, live) {
  if (record === null) {
    return noRecordText();
  }
  const gate = gateText(woc.world.bank.status, 'a banker', live, snap.at > 0);
  if (snap.at > 0) {
    return gate;
  }
  return sentences(['No bank reading yet. Stand at a banker once and it is recorded.', gate]);
}

/**
 * Drawn from the last `near` reading whatever the status; recording `away` is refused in
 * `syncLive`.
 */
function paintBank() {
  const record = viewedRecord();
  const snap = viewedSource('bank');
  const live = viewingSelf();
  const drawn = record !== null && snap.at > 0;
  woc.ui.show(bankBody, drawn);
  say(bankNote, bankNoteText(record, snap, live));
  if (!drawn) {
    // No cells, so no free count for the tone.
    paintGrid(bankGrid, [], emptyView(), 0);
    say(bankAgeLine, '');
    paintGrid(bankSocketGrid, [], emptyView(), 0);
    for (const chip of [
      bankSlotsStat,
      bankFreeStat,
      bankMaterialsStat,
      bankMarksStat,
      bankSocketsStat,
      bankTermsStat,
      bankPurseStat,
      bankWorthStat,
    ]) {
      setStat(chip, '');
    }
    return;
  }
  // Never `capacity - slots.length`: a general deposit can be refused while materials has room.
  const space = freeSpace(snap);
  setStat(bankSlotsStat, `${String(snap.used)} / ${String(snap.total)}`);
  setStat(bankFreeStat, String(space.free));
  setStatTone(bankFreeStat, toneFor(space.free));
  setStat(bankMaterialsStat, materialsText(space));
  const carried = new Set(stacksIn(record.sources.bags.stacks).keys());
  const view = readStore(snap.stacks, new Set(record.equipped), carried);
  paintGrid(bankGrid, cellPlan(snap), view, space.free);
  paintGrid(bankSocketGrid, socketPlan(snap), emptyView(), 0);
  say(bankAgeLine, `${whoseText(record)}${ageText(snap, live && isNear(woc.world.bank))}`);
  setStat(bankMarksStat, marksText(view));
  setStat(bankSocketsStat, bankSocketsText(snap));
  setStat(bankTermsStat, expansionText(snap));
  setStat(bankPurseStat, purseText(record));
  paintWorth(bankWorthStat, worthOf(storeCounts(snap.stacks, record.realm)));
}

/**
 * Every socket as a square, locked included: the index is the socket number, so dropping empty
 * ones would shift bags under the wrong label.
 */
function socketPlan(snap) {
  return snap.socketBags.map((itemId) => {
    if (itemId === '') {
      return null;
    }
    return { itemId, count: 1 };
  });
}

function bankSocketsText(snap) {
  if (snap.socketBags.length === 0) {
    return '';
  }
  return `${String(snap.unlocked)} / ${String(snap.socketBags.length)}`;
}

function bankSocketLine(itemId, at) {
  const label = `Socket ${String(at + 1)}`;
  if (itemId === '') {
    return { text: `${label}: empty`, tone: 'muted' };
  }
  return `${label}: ${nameOf(itemId)}`;
}

function bankSocketsTip() {
  const snap = viewedSource('bank');
  const lines = snap.socketBags
    .slice(0, snap.unlocked)
    .map((itemId, at) => bankSocketLine(itemId, at));
  const locked = snap.socketBags.length - snap.unlocked;
  if (locked > 0) {
    lines.push({ text: `${woc.fmt.count(locked, 'socket')} still locked.`, tone: 'muted' });
  }
  lines.push(bankSocketCostLine(snap));
  lines.push({
    text: 'Opening a socket adds no slots on its own: it is empty until a bag goes into it.',
    tone: 'muted',
  });
  return { title: 'Sockets', lines: lines.filter((one) => one !== '') };
}
woc.ui.tooltip(bankSocketsStat.el, bankSocketsTip);

function bankSocketCostLine(snap) {
  if (snap.nextSocket === null) {
    return { text: 'Every socket is open.', tone: 'muted' };
  }
  return `The next socket costs ${money(snap.nextSocket)}.`;
}

function bankMaterialsTip() {
  const snap = viewedSource('bank');
  const space = freeSpace(snap);
  if (!space.split) {
    return {
      title: 'Materials',
      lines: [
        {
          text: 'This reading was taken before this addon could read the bank\u2019s two pools, so there is no split to show.',
          tone: 'muted',
        },
      ],
    };
  }
  return {
    title: 'Materials',
    lines: [
      `${woc.fmt.count(space.materials, 'slot')} that only a material will go into.`,
      {
        text: 'A socketed reagent satchel adds materials-only room here, exactly as one in a bag socket does for what you carry.',
        tone: 'muted',
      },
      { text: 'Free beside it is what anything will fit in.', tone: 'muted' },
    ],
  };
}
woc.ui.tooltip(bankMaterialsStat.el, bankMaterialsTip);

function isNear(state) {
  return state.status === 'near';
}

/**
 * One stock row as a bar against the shared cap. Not clamped above 1: an over-cap stock is real.
 */
function vaultEntry(row, cap) {
  return {
    key: row.itemId,
    icon: woc.ui.icon.item(row.itemId),
    update: {
      label: nameOf(row.itemId),
      quality: known(row.itemId)?.quality ?? '',
      detail: vaultDetail(row, cap),
      fraction: fractionOf(row.count, cap),
      tone: vaultTone(row, cap),
    },
  };
}

function vaultDetail(row, cap) {
  if (cap <= 0) {
    return String(row.count);
  }
  return `${String(row.count)} / ${String(cap)}`;
}

/** Full is per material and the only urgency a row has. */
function vaultTone(row, cap) {
  if (cap > 0 && row.count >= cap) {
    return 'danger';
  }
  return 'default';
}

function vaultRowTip(itemId) {
  const snap = viewedSource('vault');
  const row = snap.stock.find((one) => one.itemId === itemId);
  if (row === undefined) {
    return itemId;
  }
  return {
    title: nameOf(itemId),
    lines: [
      vaultHeldLine(row, snap.cap),
      ...nameLines(itemId),
      worthLine(itemId, row.count),
      {
        text: 'One cap covers every material, so this one being full says nothing about the rest.',
        tone: 'muted',
      },
      { text: 'Nothing here can deposit or withdraw: the loader sends no command.', tone: 'muted' },
    ].filter((one) => one !== ''),
  };
}

function vaultHeldLine(row, cap) {
  if (cap <= 0) {
    return `${String(row.count)} in the vault.`;
  }
  if (row.count >= cap) {
    return `${String(row.count)} of ${String(cap)}: full, so the vault takes no more of this one.`;
  }
  return `${String(row.count)} of ${String(cap)}, with room for ${String(cap - row.count)} more.`;
}

/** Sentences joined with one space, skipping any that has nothing to say. */
function sentences(parts) {
  return parts.filter((part) => part !== '').join(' ');
}

/**
 * The one mail fact with no proximity gate, about the player rather than the viewed character:
 * `world.mailUnread` streams everywhere, so the badge works away from the mailbox.
 */
function unreadText() {
  const unread = woc.world.mailUnread;
  if (typeof unread !== 'number' || !Number.isFinite(unread)) {
    return '';
  }
  if (unread === 0) {
    return 'No unread letters.';
  }
  if (unread === 1) {
    return '1 unread letter.';
  }
  return `${String(unread)} unread letters.`;
}

/**
 * In the title, since the badge must show with the Mail tab closed and a tab cannot be relabelled.
 * Written only on a change, or `setTitle` runs at snapshot rate.
 */
function paintTitle() {
  const unread = woc.world.mailUnread;
  let wanted = FRAME_TITLE;
  if (typeof unread === 'number' && Number.isFinite(unread) && unread > 0) {
    wanted = `${FRAME_TITLE} (${String(unread)} unread)`;
  }
  if (wanted !== titleShown.text) {
    titleShown.text = wanted;
    frame.setTitle(wanted);
  }
}

function letterCount(count) {
  if (count === 1) {
    return '1 letter';
  }
  return `${String(count)} letters`;
}

/** What is attached to a letter, skipping what it does not carry. */
function attachmentText(letter) {
  const parts = [];
  if (letter.copper > 0) {
    parts.push(money(letter.copper));
  }
  if (letter.items.length > 0) {
    parts.push(woc.fmt.count(letter.items.length, 'item'));
  }
  if (parts.length === 0) {
    return '';
  }
  return `Attached: ${parts.join(', ')}`;
}

function mailSubject(letter) {
  if (letter.subject === '') {
    return '(no subject)';
  }
  return letter.subject;
}

/** A full row for an unread letter, an empty one for a letter already read. */
function unreadFill(unread) {
  if (unread) {
    return 1;
  }
  return 0;
}

function unreadTone(unread) {
  if (unread) {
    return 'warn';
  }
  return 'default';
}

/**
 * One letter. The fill marks it unread, making unread letters findable in a box of up to a hundred.
 */
function mailEntry(letter) {
  return {
    key: letter.id,
    icon: null,
    update: {
      label: mailSubject(letter),
      value: letter.senderName,
      detail: attachmentText(letter),
      fraction: unreadFill(!letter.read),
      tone: unreadTone(!letter.read),
    },
  };
}

/** What is in the parcel, by the best name each id has. */
function parcelLines(items) {
  return items.map((stack) => `${nameOf(stack.itemId)} x${String(stack.count)}`);
}

function letterById(key) {
  return viewedSource('mail').letters.find((letter) => letter.id === key) ?? null;
}

function mailTip(key) {
  const letter = letterById(key);
  if (letter === null) {
    return key;
  }
  const lines = [`From ${letter.senderName}`];
  const body = text(bodies.get(key));
  if (body !== '' && viewingSelf()) {
    lines.push({ text: body, tone: 'muted' });
  }
  lines.push(...parcelLines(letter.items));
  lines.push({ text: 'Nothing here can open a letter or take what is in it.', tone: 'muted' });
  return { title: mailSubject(letter), lines };
}

/**
 * Sending terms, read off the payload, as three strip figures. The tooltip says they are the
 * terms for sending, which the figures alone do not.
 */
function paintMailTerms(snap, drawn) {
  setStat(postageStat, drawnText(drawn, money(snap.postage)));
  setStat(attachmentsStat, drawnText(drawn, woc.fmt.count(snap.attachments, 'item')));
  setStat(flightStat, drawnText(drawn, `${String(snap.flight)}s`));
  // Hidden at zero, like every money figure here: an empty mailbox is not news.
  setStat(postStat, postText(snap, drawn));
}

/** A figure only where there is one. */
function postText(snap, drawn) {
  const post = postCopper(snap);
  if (!drawn || post <= 0) {
    return '';
  }
  return money(post);
}

/** What the letters in one mailbox are carrying between them. See `postStat`. */
function postCopper(snap) {
  return snap.letters.reduce((total, letter) => total + letter.copper, 0);
}

/** The same over every recorded character, as the roster's chip counts. */
function postedCopper() {
  let total = 0;
  for (const record of records.values()) {
    total += postCopper(record.sources.mail);
  }
  return total;
}

/** A figure, or nothing at all while there is no reading behind it. */
function drawnText(drawn, value) {
  if (drawn) {
    return value;
  }
  return '';
}

function mailTermsTip() {
  const snap = viewedSource('mail');
  return {
    title: 'Sending a letter',
    lines: [
      `Postage is ${money(snap.postage)}, up to ${woc.fmt.count(snap.attachments, 'item')} a letter, ${String(snap.flight)}s in flight.`,
      { text: 'Read off the mailbox rather than written down here.', tone: 'muted' },
      { text: 'Nothing here can send one.', tone: 'muted' },
    ],
  };
}
for (const chip of [postageStat, attachmentsStat, flightStat]) {
  woc.ui.tooltip(chip.el, mailTermsTip);
}

/** The unread figure for whoever is being looked at: live for you, stored for an alt. */
function unreadLine(record, snap, live) {
  if (live) {
    return unreadText();
  }
  if (record === null) {
    return '';
  }
  return `${String(snap.unread)} unread for ${displayName(record)}.`;
}

/** How many copies of everything the vault holds, counts and identity rows alike. */
function vaultHeld(snap) {
  const stock = snap.stock.reduce((sum, row) => sum + row.count, 0);
  return snap.stacks.reduce((sum, entry) => sum + entryCount(entry), stock);
}

/** Both lists as the `[id, count, realm]` triples `worthOf` adds up. See `storeCounts`. */
function vaultCounts(snap, realm) {
  const counts = snap.stock.map((row) => [row.itemId, row.count, realm]);
  return [...counts, ...storeCounts(snap.stacks, realm)];
}

function vaultKindsText(snap) {
  return String(snap.stock.length + snap.stacks.length);
}

/** Bought out of the ladder: a rung count alone does not say how far it goes. */
function vaultRungsText(snap) {
  return `${String(snap.upgrades)} / ${String(VAULT_RUNGS)}`;
}

function vaultTermsText(snap) {
  if (snap.next === null) {
    return 'bought';
  }
  return money(snap.next);
}

function vaultTermsTip() {
  const snap = viewedSource('vault');
  const lines = [`${vaultRungsText(snap)} rungs bought, each one raising the cap for everything.`];
  if (snap.next === null) {
    lines.push('Every rung has been bought.');
  } else {
    lines.push(`The next rung costs ${money(snap.next)}.`);
  }
  lines.push({ text: 'Nothing here can buy one.', tone: 'muted' });
  return { title: 'Upgrade', lines };
}
woc.ui.tooltip(vaultTermsStat.el, vaultTermsTip);
woc.ui.tooltip(vaultRungsStat.el, vaultTermsTip);

function vaultCapTip() {
  const snap = viewedSource('vault');
  return {
    title: 'Cap each',
    lines: [
      `${String(snap.cap)} of EVERY material, which is one ceiling shared by all of them.`,
      {
        text: 'So a full vault is a sentence about one material: room for iron and none for copper is ordinary.',
        tone: 'muted',
      },
      { text: 'A row turns red at its own cap.', tone: 'muted' },
    ],
  };
}
woc.ui.tooltip(vaultCapStat.el, vaultCapTip);

function vaultKindsTip() {
  const snap = viewedSource('vault');
  return {
    title: 'Materials',
    lines: [
      `${woc.fmt.count(snap.stock.length, 'material')} held as a count, and ${woc.fmt.count(snap.stacks.length, 'stack')} that cannot be counted with them.`,
      {
        text: 'A crafted or signed stack keeps an identity, so it is its own square below rather than adding to a total.',
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(vaultKindsStat.el, vaultKindsTip);

/**
 * Whether crafting may draw from the vault here. An empty record means allowed and empty; null
 * means refused here. Emptiness must never read as refused.
 */
function drawText(live) {
  if (!live) {
    return '';
  }
  const stock = woc.world.craftVaultStock;
  if (stock === null) {
    return 'Crafting cannot draw from the vault where you are: not in a battleground, arena, delve, dungeon, raid or rift.';
  }
  const kinds = Object.keys(stock).length;
  if (kinds === 0) {
    return 'Crafting can draw from the vault here, and there is nothing in it to draw.';
  }
  return `Crafting can draw ${woc.fmt.count(kinds, 'material')} from the vault here.`;
}

function vaultNoteText(record, snap, live) {
  if (record === null) {
    return noRecordText();
  }
  const gate = gateText(woc.world.vault.status, 'a banker', live, snap.at > 0);
  if (snap.at > 0) {
    return gate;
  }
  return sentences(['No vault reading yet. Stand at a banker once and it is recorded.', gate]);
}

function clearVault() {
  vaultRows.rows.sync([]);
  paintGrid(vaultGrid, [], emptyView(), 0);
  say(vaultAgeLine, '');
  for (const chip of [
    vaultKindsStat,
    vaultHeldStat,
    vaultCapStat,
    vaultRungsStat,
    vaultTermsStat,
    vaultWorthStat,
  ]) {
    setStat(chip, '');
  }
}

/** Drawn from the last `near` reading whatever the status is, as the Bank pane is. */
function paintVault() {
  const record = viewedRecord();
  const snap = viewedSource('vault');
  const live = viewingSelf();
  const drawn = record !== null && snap.at > 0;
  woc.ui.show(vaultBody, drawn);
  say(vaultNote, vaultNoteText(record, snap, live));
  say(vaultDrawLine, drawText(live));
  if (!drawn) {
    clearVault();
    return;
  }
  vaultRows.rows.sync(snap.stock.map((row) => vaultEntry(row, snap.cap)));
  const carried = new Set(stacksIn(record.sources.bags.stacks).keys());
  paintGrid(vaultGrid, snap.stacks, readStore(snap.stacks, new Set(record.equipped), carried), 0);
  say(vaultAgeLine, `${whoseText(record)}${ageText(snap, live && isNear(woc.world.vault))}`);
  setStat(vaultKindsStat, vaultKindsText(snap));
  setStat(vaultHeldStat, String(vaultHeld(snap)));
  setStat(vaultCapStat, String(snap.cap));
  setStat(vaultRungsStat, vaultRungsText(snap));
  setStat(vaultTermsStat, vaultTermsText(snap));
  paintWorth(vaultWorthStat, worthOf(vaultCounts(snap, record.realm)));
}

function paintMail() {
  const record = viewedRecord();
  const snap = viewedSource('mail');
  const live = viewingSelf();
  const drawn = record !== null && snap.at > 0;
  mailRows.rows.sync(snap.letters.map((letter) => mailEntry(letter)));
  paintMailTerms(snap, drawn);
  setStat(mailPurseStat, purseText(record));
  say(mailAgeLine, mailAgeText(record, snap, live));
  say(
    mailStateLine,
    sentences([unreadLine(record, snap, live), boxText(drawn, snap), gateNote(live, drawn)]),
  );
}

/** The viewed character's own coin, or nothing at all before anybody is recorded. */
function purseText(record) {
  if (record === null) {
    return '';
  }
  return money(record.copper);
}

function boxText(drawn, snap) {
  if (!drawn) {
    return '';
  }
  return `${letterCount(snap.total)} in the box.`;
}

function gateNote(live, drawn) {
  return gateText(woc.world.mail.status, 'a mailbox', live, drawn);
}

function mailAgeText(record, snap, live) {
  if (record === null) {
    return noRecordText();
  }
  if (snap.at <= 0) {
    return 'No mailbox reading yet. Stand at a mailbox once and it is recorded.';
  }
  return `${whoseText(record)}${ageText(snap, live && isNear(woc.world.mail))}`;
}

/** `40 Warrior`, or as much as was recorded; nothing for an older record. */
function whoText(record) {
  const parts = [];
  if (record.level > 0) {
    parts.push(String(record.level));
  }
  if (record.templateId !== '') {
    parts.push(woc.fmt.titleCase(record.templateId));
  }
  return parts.join(' ');
}

/** Everything a row says about a character under its name, skipping what is not recorded. */
function rosterDetail(record, snap) {
  const parts = [whoText(record), `${String(snap.used)} / ${String(snap.total)} cells`];
  if (record.at > 0) {
    // On the row: a total from days ago is not one to act on.
    parts.push(`seen ${agoText(record.at)}`);
  }
  return parts.filter((part) => part !== '').join(', ');
}

/**
 * One meaning per bar: how full that character is. The fill is the share of cells in use and the
 * tone goes amber then red with it. Not the free share (that inverts on sight) and not a share of
 * coin (the exact coin is drawn at the end of the row).
 */
function rosterEntry(record, here) {
  const snap = record.sources.bags;
  return {
    key: record.key,
    icon: null,
    update: {
      label: labelFor(record, here),
      value: { copper: record.copper },
      detail: rosterDetail(record, snap),
      // The fill stays pooled (how full); the tone uses the general-pool reading, as Bags does.
      fraction: fractionOf(snap.used, snap.total),
      tone: toneFor(freeSpace(snap).free),
    },
  };
}

/** One line per store, so the ages that matter are all in one place. */
function storeLines(record) {
  return SOURCES.map((source) => {
    const snap = record.sources[source];
    if (snap.at <= 0) {
      return { text: `${source}: never read`, tone: 'muted' };
    }
    return `${source}: ${storeSize(source, snap)}, read ${agoText(snap.at)}`;
  });
}

/** How much a store holds in its own unit: a stack count would say a full vault held nothing. */
function storeSize(source, snap) {
  if (source === 'vault') {
    return `${woc.fmt.count(snap.stock.length + snap.stacks.length, 'material')}`;
  }
  return `${String(snap.stacks.length)} stacks`;
}

function rosterTip(key) {
  const record = records.get(key);
  if (record === undefined) {
    return key;
  }
  const snap = record.sources.bags;
  // No "last seen": it is on the row, and repeating it makes the reader cross-check.
  return {
    title: displayName(record),
    lines: [
      `Carrying ${money(record.copper)}`,
      // What the bar measures, spelled out.
      {
        text: `The bar is how full their bags are: ${String(snap.used)} of ${String(snap.total)} cells.`,
        tone: 'muted',
      },
      ...storeLines(record),
    ],
  };
}

function rosterNoteText() {
  if (!remembering()) {
    return 'Remembering is off, so nothing is written down and only this session is shown.';
  }
  if (records.size < 2) {
    return 'Only this character so far. Log in on another and it appears here.';
  }
  return '';
}

/**
 * Bags only, as the tooltip says: banks are recorded only on a visit, so including them makes the
 * total jump. Rows keep their own stamps and the tooltip names the oldest.
 */
function rosterTotals() {
  // `free` is summed per character: `total - used` is wrong for anyone with a reagent satchel.
  const sums = { characters: 0, used: 0, total: 0, free: 0, copper: 0, oldest: 0 };
  for (const record of records.values()) {
    const snap = record.sources.bags;
    sums.characters += 1;
    sums.used += snap.used;
    sums.total += Math.max(snap.total, snap.used);
    sums.free += freeSpace(snap).free;
    sums.copper += record.copper;
    if (snap.at > 0 && (sums.oldest === 0 || snap.at < sums.oldest)) {
      sums.oldest = snap.at;
    }
  }
  return sums;
}

/** What is in the post, said on the figure it is not part of: the bar counts purses only. */
function postedTipLine() {
  const posted = postedCopper();
  if (posted <= 0) {
    return [];
  }
  return [
    {
      text: `${money(posted)} more is attached to letters in a recorded mailbox, which nobody is carrying and which is on the strip as its own figure.`,
      tone: 'muted',
    },
  ];
}

/** The account's mail money, or nothing where no recorded mailbox is holding any. */
function postedText() {
  const posted = postedCopper();
  if (posted <= 0) {
    return '';
  }
  return money(posted);
}

/** How old the oldest reading behind a total is. */
function oldestLine(at) {
  if (at <= 0) {
    return { text: 'None of these has a bag reading yet.', tone: 'muted' };
  }
  return { text: `The oldest of these readings was taken ${agoText(at)}.`, tone: 'muted' };
}

function rosterSummaryTip() {
  const sums = rosterTotals();
  return {
    title: 'Every character',
    lines: [
      `${String(sums.characters)} recorded, holding ${String(sums.used)} of ${String(sums.total)} bag cells between them.`,
      `${money(sums.copper)} CARRIED across the account.`,
      ...postedTipLine(),
      oldestLine(sums.oldest),
      {
        text: 'Bags only. A bank or a mailbox is recorded only for a visit to one, so neither is counted here.',
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(accountBar.el, rosterSummaryTip);
woc.ui.tooltip(rosterStrip, rosterSummaryTip);

function paintRosterTotals(sums) {
  woc.ui.show(rosterStrip, sums.characters > 0);
  woc.ui.show(accountBar.el, sums.characters > 0);
  accountBar.update({ value: { copper: sums.copper } });
  paintWorth(accountWorthStat, worthOf(accountCounts()));
  setStat(rosterCountStat, String(sums.characters));
  setStat(rosterSlotsStat, `${String(sums.used)} / ${String(sums.total)}`);
  setStat(rosterFreeStat, String(sums.free));
  setStatTone(rosterFreeStat, toneFor(sums.free));
  setStat(postedStat, postedText());
}

function paintRoster() {
  const here = characterKey();
  const sums = rosterTotals();
  rosterRows.rows.sync(characterOrder().map((record) => rosterEntry(record, here)));
  paintRosterTotals(sums);
  say(rosterNote, rosterNoteText());
}

function draw() {
  syncLive();
  paintPicker();
  paintItems();
  paintBags();
  paintBank();
  paintVault();
  paintMail();
  paintRoster();
  paintTitle();
}

/**
 * One repaint per frame however many ask. No `{ frame }`: `draw` starts with `syncLive`, which
 * records this character's stores, so it must run with the panel closed.
 */
const schedulePaint = woc.paint(draw);

/**
 * On the crossing, or every loot while full would chime. Off the live bags whoever is viewed: the
 * warning is about the player.
 */
function checkWarning() {
  const free = freeCells();
  if (free === null) {
    return;
  }
  if (free > threshold()) {
    warned.on = false;
    return;
  }
  if (!warned.on) {
    warned.on = true;
    if (woc.settings['warn-cue']) {
      woc.sound.alert();
    }
  }
}

function onWorldChange() {
  checkWarning();
  schedulePaint();
}

/**
 * Somebody else is playing now. The game switches characters without a reload, so this must be
 * told. The picker follows unless the player pointed it elsewhere.
 */
function onCharacterChange() {
  schedulePaint();
}

// `bagCapacity` has no watch key (`world.on` throws on unknown keys); it moves with `inventory`.
// Equipment is watched for the spare mark.
woc.world.on('inventory', onWorldChange);
woc.world.on('bags', onWorldChange);
woc.world.on('copper', onWorldChange);
woc.world.on('equipment', onWorldChange);
woc.world.on('characterKey', onCharacterChange);

// The counters and the badge. `bank`, `vault` and `mail` move on arriving and leaving, the moment
// worth recording; `mailUnread` moves anywhere. The vault has its own key: a deposit made
// standing still fires nothing else.
woc.world.on('bank', schedulePaint);
woc.world.on('vault', schedulePaint);
woc.world.on('mail', schedulePaint);
woc.world.on('mailUnread', schedulePaint);
// Moves on entering or leaving an instance, which moves no other key here.
woc.world.on('craftVaultStock', schedulePaint);

// The game's own narration, which names the item an inventory change cannot.
woc.net.onEvent('loot', (event) => {
  const said = text(event?.text);
  if (said !== '') {
    recent.text = said;
    schedulePaint();
  }
});

/** The bulk junk sweep carries no item id: a plain refresh signal. */
function vendorLine(action, itemId) {
  if (itemId === '') {
    return `Vendor: ${action}`;
  }
  return `Vendor: ${action} ${nameOf(itemId)}`;
}

woc.net.onEvent('vendor', (event) => {
  const action = text(event?.action);
  if (action !== '') {
    recent.text = vendorLine(action, text(event?.itemId));
    schedulePaint();
  }
});

// `follow` subscribes before asking: delivery is synchronous, so the reverse order misses an
// answer given inside the ask.
woc.bus.follow(ITEMS_TOPIC, onItems);
// Prices, subscribed like names. Either publisher may be absent; silence is ordinary.
woc.bus.follow(PRICES_TOPIC, onPrices);
woc.bus.on(woc.bus.anySender, PRICE_TOPIC, onPrice);
// The incremental push has no ask half, so a plain subscription covers it.
woc.bus.on(woc.bus.anySender, ITEM_TOPIC, onItem);
woc.bus.emit(LEGACY_ASK_TOPIC);

woc.onSettingsChange(() => {
  if (!remembering()) {
    dropStored();
  }
  // A new threshold is a new question, so the warning gets to fire again.
  warned.on = false;
  draw();
});

/** One bag row from the shipped table, checked: `woc.data` proves only that the file is JSON. */
function readBag(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const itemId = text(value.id);
  const slots = numberOr(value.slots, 0);
  if (itemId === '' || slots <= 0) {
    return null;
  }
  return { id: itemId, name: text(value.name), slots, materialsOnly: value.materialsOnly === true };
}

/**
 * The table, or null. A failure costs only the pool split: the free figure falls back to the
 * pooled reading and says so.
 */
function readPools(value) {
  if (typeof value !== 'object' || value === null || !Array.isArray(value.bags)) {
    return null;
  }
  const backpackSlots = numberOr(value.backpackSlots, 0);
  const bags = value.bags.map(readBag).filter((bag) => bag !== null);
  if (backpackSlots <= 0 || bags.length === 0 || !Array.isArray(value.materials)) {
    return null;
  }
  return {
    version: text(value.gameVersion),
    backpackSlots,
    sockets: numberOr(value.bagSockets, 0),
    bags,
    materials: value.materials.map((entry) => text(entry?.id)).filter((id) => id !== ''),
  };
}

/** The two facts about a carried bag that no API here can answer. See `poolTable`. */
async function learnPools() {
  const table = readPools(await woc.data(POOLS_FILE));
  if (table === null) {
    throw new Error(`${POOLS_FILE} carries no "backpackSlots", "bags" and "materials"`);
  }
  if (!running.on) {
    return;
  }
  poolTable.version = table.version;
  poolTable.backpackSlots = table.backpackSlots;
  poolTable.sockets = table.sockets;
  for (const bag of table.bags) {
    bagKinds.set(bag.id, bag);
    poolTable.biggest = Math.max(poolTable.biggest, bag.slots);
  }
  for (const itemId of table.materials) {
    materialIds.add(itemId);
  }
  schedulePaint();
}

/**
 * Art answers are provisional until the manifest lands. One request covers every item; never
 * rejects.
 */
async function learnArt() {
  await woc.ui.icon.preloadItems();
  if (running.on) {
    schedulePaint();
  }
}

// Registered by hand: the three starts below await something and could resume after teardown.
woc.onDispose(() => {
  running.on = false;
});

draw();
startRecords().catch((err) => {
  woc.warn('satchel: the character records could not be started', err);
});
learnPools().catch((err) => {
  woc.warn('satchel: the bag table could not be read, so the pool split is not drawn', err);
});
learnArt().catch((err) => {
  woc.warn('satchel: the item art manifest could not be read', err);
});
