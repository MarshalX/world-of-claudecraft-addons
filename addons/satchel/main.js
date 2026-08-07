/// <reference types="@woc-addons/types" />

// Satchel: where your things are, across every character on the account.
//
// The game's own bag window aggregates your bags already, so this exists for the three
// questions the client cannot answer: what is on another character, since only the one you are
// logged in as exists on the client; what is in your bank or mail when you are not standing at
// one, since both reads are proximity gated; and how many of something you own and where.
//
// Every pane is drawn from a RECORD, refreshed from the live world before every paint for the
// character in play. That is what makes an alt's bank and a walked-away bank readable, which are
// the same case, and what the panes owe for it is AGE: a bank from three days ago is useful and
// must never be presented as current.
//
// ONLY `near` IS EVER RECORDED, which is the worst bug this feature can have. `world.bank` and
// `world.mail` are three-state, and writing a snapshot on `away` erases a character's bank the
// moment they walk away from it.
//
// The key is `world.characterKey`, which is what `woc.storage.character` files under, so two
// addons keeping a per-character record cannot disagree about whose a row is. The CHANNEL is
// prefixed here because the loader adds it only to its own namespaces, and a character and its
// PBE copy share a realm and a name. Storage is account-wide, ONE KEY PER CHARACTER: a
// per-character store answers only about the character in play, which is the opposite of the
// feature, and one blob makes every write a rewrite of every other character's row. The stamp is
// `woc.wallClock()`, since a monotonic reading restored into a fresh page is a moment in 1970.
//
// A CELL is an entry and an ITEM is a total, and the two must never share an answer. Used slots
// is `inventory.length` and never the sum of the counts, or a player carrying 300 ore is told
// their 52 cells are overdrawn; the Items pane asks the opposite question and does sum.
//
// The ART is reachable and the NAME is not: an id resolves to no name, quality, kind or price
// anywhere on this API. `ui.icon.item` answers null for an id with no file, so a blank face
// means no art exists rather than a wrong id, and `ui.icon.itemArtName` is provenance for the
// picture rather than the item's name. A publisher on the bus outranks it, it outranks the raw
// id, and the tooltip says which was used.
//
// Capacity is POOLED and handed over as one number; `bagCapacity` has no watch key of its own,
// so this subscribes to `bags`. `InvSlot.slot` is a placement hint, honoured and recorded, so an
// alt's bags are drawn the way that alt arranged them. The observed stack maximum is a LOWER
// BOUND and says so, since no published field carries one, which errs towards not promising room
// that is not there.
//
// There is no sort and there cannot be one: sorting, merging, selling and withdrawing are all
// commands and the loader sends none, so every tooltip describing something a player might want
// to act on says nothing here can. The market is absent for a different reason: a price history
// is its own addon, and two panels recording the same pages would disagree about what was seen.
//
// THE BUS CONTRACT, which this addon was the first consumer of. `item` is one record and `items`
// is a batch. Subscribe with `woc.bus.anySender` and never a hardcoded fqid, since the same
// addon from a fork publishes under another name and `message.from` is what a tooltip credits.
// Ask once and draw without waiting. Silence is ORDINARY: the index is complete without a name.
//
// A price rides the same records and has NO other source, so every total is arithmetic over what
// somebody else published. An item nobody priced is left OUT rather than added at nothing, every
// total says how many of its kinds it could price, and with nothing priced the row is not drawn,
// since `0c` over a full bag is a claim rather than a silence. It is a VENDOR price, a floor
// rather than what the thing would fetch, and every sentence about one says so.
//
// Three layout rules that only bite together. Hiding is `woc.ui.show`, a class rather than a
// display, so a grid comes back a grid. The frame is sized, its body told to fill it and its
// panes scroll, since a frame is content-sized unless it says otherwise and the loader fills
// only a WINDOW's body. And a row in a scrolling list must not shrink, or forty rows in a list
// half that tall are squashed with their text clipped and no scrollbar to say so.
//
// The figures in a pane are short labelled chips on one wrapping line. What is NOT a chip is the
// panel's honesty rather than its arithmetic: how old a reading is, and that it is the last one
// rather than a live one, stay on screen as sentences.

/** The backpack, the socket count and the ceiling, for the sentence that explains pooling. */
const BACKPACK_SLOTS = 16;
const BAG_SOCKETS = 4;
const MAX_SLOTS = 72;

/**
 * The square, and the floor a resize may take the grid to. No column count: the grid is a
 * wrapping track list, so the browser refits it. The floor is stated because a frame's bounds
 * are settled when it is built, and a grid two squares across is a list drawn the hard way.
 */
const CELL_SIZE = 32;
const CELL_GAP = 3;
const MIN_COLUMNS = 6;
const MIN_ROWS = 3;

/** What the kit's layout boxes are spaced at here: a pane's rows, and a chip's two words. */
const PANE_GAP = 3;
const STAT_GAP = 4;
/**
 * The strip's two gaps: close together down the page and far apart across it, because a strip
 * that wraps is still one line of figures rather than two lines of anything.
 */
const STRIP_GAP = 10;
const STRIP_WRAP_GAP = 2;

/** Wide enough for five tabs on one row: measured at 279px of the 324 the padding leaves. */
const FRAME_WIDTH = 340;
/** Tall enough for a backpack of 16 squares, its bar, its strip and the tabs above. */
const FRAME_HEIGHT = 420;
/** Carried twice by the width. It belongs to `.woc-addon-frame` rather than to a density. */
const FRAME_PADDING = 8;
/**
 * Everything that is not the scrolling pane, measured in a browser at 229px on the Bags tab. A
 * floor is settled when the frame is built, before there is a layout to measure, and nothing
 * under Vitest can check it. The worth row is deliberately OUT of it: it is drawn only once
 * something publishes a price, so reserving its 23px is dead space for a player with no
 * publisher installed.
 */
const CHROME_HEIGHT = 230;

const PERCENT = 100;
/** Widths, at the precision the kit writes its own fill at. */
const WIDTH_DECIMALS = 2;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;

/**
 * A stamp answers when this was last READ rather than when it last changed, so a player who
 * stood at their bank a minute ago is not told the reading is an hour old. Writing every paint
 * would be a storage write at snapshot rate.
 */
const STAMP_REFRESH_MS = MINUTE_MS;

/** One key per character per deployment; the rest is `characterKey()`. */
const CHARACTER_PREFIX = 'char/';

/** The three stores a character has, in the order every display lists them. */
const SOURCES = ['bags', 'bank', 'mail'];

/** How many index rows are drawn before the pane asks the player to narrow it. */
const MAX_ITEM_ROWS = 40;
/** How many characters a row's own line names before it counts the rest. */
const MAX_PLACE_HINTS = 2;
/** What the search box and the character selector ask for, before giving the line back. */
const SEARCH_WIDTH = 120;
const PICKER_WIDTH = 140;

/** The window's own name, which the unread badge is appended to. See `paintTitle`. */
const FRAME_TITLE = 'Satchel';

// `item` is one record and `items` is the batch an ask is answered with.
const ITEM_TOPIC = 'item';
const ITEMS_TOPIC = 'items';

/** The older ask topic, sent beside the one `follow` derives. Drop next release. */
const LEGACY_ASK_TOPIC = 'item:ask';

/** The warning band, in the kit's own danger colour: it marks a limit, not a target. */
const BAND_COLOR = 'rgb(255 143 133 / 30%)';

/**
 * What tells an occupied cell from an empty one WITHOUT the art, which is often missing, and
 * without a count, which a stack of one does not draw. Never `borderColor`: that is the tone's,
 * and an inline write would beat the class that sets it.
 */
const OCCUPIED_FILL = 'rgb(255 255 255 / 7%)';
const EMPTY_FILL = 'transparent';
const OCCUPIED_EDGE = 'solid';
const EMPTY_EDGE = 'dashed';
const OCCUPIED_OPACITY = '1';
const EMPTY_OPACITY = '0.4';

/**
 * An art name is provenance for the PICTURE, so a square drawn from one has to say so. The
 * tooltip is where: a tile's accessible name is one string with no room to qualify anything.
 */
const ART_NOTE = {
  text: 'Named from its art file, which is not always what the game calls it.',
  tone: 'muted',
};

/** Item id to what somebody published about it, plus who published it. */
const names = new Map();
/**
 * The largest single stack ever seen, which is the only stack maximum obtainable since no field
 * carries one. A LOWER bound, which is the safe direction: it never promises room that is not
 * there. Stored records feed it too, so it does not reset every page load.
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
/** The index behind the rows on screen, so a tooltip describes the row it is over. */
const found = { index: new Map(), worth: { copper: 0, priced: 0, kinds: 0 } };
/**
 * Bodies for the character in play, which the stored form drops: the longest field a letter has,
 * worth nothing to the index, and readable only at the pillar anyway.
 */
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

/**
 * A string that spells a price is not a price: the payload is another addon's idea of the shape,
 * and coercing one turns a bug on its side into a figure the player reads as a fact.
 */
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
 * The pooled total, or null before the world can answer. Read rather than derived: the only
 * way to compute one would be to know how many cells each equipped bag adds, which is item
 * content nothing here can reach.
 */
function capacity() {
  const total = woc.world.bagCapacity;
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    return total;
  }
  return null;
}

function freeCells() {
  const total = capacity();
  if (total === null) {
    return null;
  }
  return Math.max(0, total - inventory().length);
}

/**
 * `world.characterKey` READ rather than rebuilt from a realm and a name, so two addons keeping
 * per-character records cannot disagree about whose a row is. The channel is prefixed because
 * the loader adds it only to its own namespaces, and without it a PBE copy of a character
 * shares one record with the live character it was copied from.
 */
function characterKey() {
  const who = text(woc.world.characterKey);
  if (who === '') {
    return '';
  }
  return `${woc.game.channel}/${who}`;
}

/**
 * An amount a sentence is ABOUT, in the loader's own split so two addons cannot spell a price
 * differently. A figure the eye lands on is `{ copper }` on a readout, drawn in the game's coins.
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
 * Null for an id with no file, for art out of a generated batch, until the manifest lands, and
 * for every weapon, whose art is filed under a MODEL name through a table nothing serves.
 */
function artName(itemId) {
  if (itemId === '') {
    return null;
  }
  return woc.ui.icon.itemArtName(itemId);
}

/**
 * Never blank. A publisher outranks the loader here, which inverts the usual order: what the
 * loader has is an art file's name and says so in its own documentation. `titleCase` is the last
 * resort and a guess, taken because a list where one row in ten is a lowercase identifier reads
 * as a bug in the rows around it. The tooltip says which was used.
 */
function nameOf(itemId) {
  return known(itemId)?.name ?? artName(itemId) ?? woc.fmt.titleCase(itemId);
}

/**
 * Null while nobody has published a price, and there is no other source for one. Zero stands for
 * absent inside the record, which is safe in one direction only: a publisher leaves a field it
 * cannot state OUT, so reading a zero as absent keeps an unpriced item out of a total.
 */
function sellOf(itemId) {
  const said = known(itemId)?.sellValue ?? 0;
  if (said <= 0) {
    return null;
  }
  return said;
}

/**
 * The COUNT is as load-bearing as the figure: a total drawn from two kinds out of nine is a real
 * answer that looks exactly like a complete one, so everywhere that draws one draws both.
 */
function worthOf(counts) {
  const sums = { copper: 0, priced: 0, kinds: 0 };
  for (const [itemId, held] of counts) {
    sums.kinds += 1;
    const each = sellOf(itemId);
    if (each !== null) {
      sums.priced += 1;
      sums.copper += each * held;
    }
  }
  return sums;
}

/** One store's stacks as the `[id, count]` pairs `worthOf` adds up. */
function storeCounts(stacks) {
  return [...stacksIn(stacks)].map(([itemId, counts]) => [itemId, counts.held]);
}

/** Off the index the Items pane built this frame, which `draw` paints first. */
function accountCounts() {
  return [...found.index].map(([itemId, row]) => [itemId, row.total]);
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
 * The batch an ask is answered with. The `Array.isArray` guard is load-bearing rather than
 * defensive: a publisher answers every ask, and one with nothing to say sends a null.
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
 * The wire's shape and the stored shape are the same on purpose, so the live and stored paths
 * share every reader below. The placement hint rides along, which is what draws an alt's bags
 * the way that alt arranged them.
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
 * The id is a STRING because it is a row key: a number round-tripped through JSON and then used
 * as a DOM attribute is one implicit conversion away from a row nothing can find again.
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

/** The bank's budget rides with it, since what an expansion costs depends on the character. */
function emptyBank() {
  return { ...baseSnapshot(), bought: 0, granted: 0, next: null };
}

/** The mailbox's terms ride with it for the same reason the bank's do. */
function emptyMail() {
  return { ...baseSnapshot(), letters: [], unread: 0, postage: 0, attachments: 0, flight: 0 };
}

// Entry pairs because these keys are the names the DISPLAY uses, and pairing them
// keeps the empty shape and the parser for one source impossible to get out of step.
const SOURCE_EMPTY = new Map([
  ['bags', emptyBags],
  ['bank', emptyBank],
  ['mail', emptyMail],
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
  return snap;
}

/**
 * Checked on the TYPE rather than coerced: `Number(null)` is 0 and 0 is finite, so a null read
 * that way becomes an expansion that is free rather than one that does not exist.
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
    copper: 0,
    at: 0,
    equipped: [],
    sources: { bags: emptyBags(), bank: emptyBank(), mail: emptyMail() },
  };
}

/**
 * Checked, since a previous version wrote it and a player can edit it. A record with no name is
 * dropped: every character has one, so a row without it is not a character.
 */
function parseRecord(key, value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = emptyRecord(key);
  record.name = text(value.name);
  if (record.name === '') {
    return null;
  }
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
 * `{ cells, held }` per item, recording the largest stack seen on the way past: a reading of a
 * store is the only chance to observe a stack size, and every store goes through here.
 */
function stacksIn(entries) {
  const held = new Map();
  for (const entry of entries) {
    const itemId = entryId(entry);
    if (itemId !== '') {
      const count = entryCount(entry);
      const seen = held.get(itemId) ?? { cells: 0, held: 0 };
      held.set(itemId, { cells: seen.cells + 1, held: seen.held + count });
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
 * AT LEAST, measured against the largest stack seen, since no field says how big a stack may be.
 * An item never seen above one answers zero without being told it does not stack.
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
 * Taken once per paint and handed down. Every mark comes from IDS alone, which is what lets the
 * panel highlight anything with nobody having named it. `alsoIn` is one-directional: the bank
 * marks what is also carried and not the reverse, since a bank reading comes and goes with the
 * counter and a mark that vanished with it would read as a fault.
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
  return snap;
}

/**
 * Attachments are FLATTENED into `stacks`: a parcel waiting in a letter is an item the character
 * owns and cannot see, and the index asks one question of every source. The letters are kept
 * too, since the Mail pane draws them.
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
 * The bags stream, so they fold in unconditionally. The bank and the mailbox fold in only on
 * `near`: the server sends nothing for a counter nobody is at, and recording that as an empty
 * store would erase what the player has.
 */
function syncLive() {
  const key = characterKey();
  if (!loaded.on || key === '') {
    return;
  }
  const now = woc.wallClock();
  const record = records.get(key) ?? emptyRecord(key);
  record.key = key;
  // Kept rather than overwritten for a frame with no name: a blank is what `parseRecord` drops a
  // stored row on, so writing one deletes a character on the next page load.
  const name = text(woc.world.player?.name);
  if (name !== '') {
    record.name = name;
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
  records.set(key, record);
  keep(key, record);
}

/** One store's content, as a string that changes exactly when the content does. */
function snapshotSignature(snap) {
  const stacks = snap.stacks.map((s) => `${s.itemId}x${String(s.count)}@${String(s.slot ?? -1)}`);
  const letters = snap.letters?.map((l) => `${l.id}:${String(l.read)}`) ?? [];
  return `${String(snap.used)}/${String(snap.total)}|${stacks.join(',')}|${letters.join(',')}`;
}

function recordSignature(record) {
  const stores = SOURCES.map((source) => snapshotSignature(record.sources[source]));
  return [record.name, String(record.copper), record.equipped.join('|'), ...stores].join(';');
}

/**
 * On a change, or on a stamp going stale, which is what makes an age honest: a player standing
 * at their bank moving nothing must not be told the reading is an hour old. A rejection is the
 * log and nothing else, since a toast about storage mid-fight is worse than the missing row.
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
  // A copy, never the live record. The live one is mutated in place on every paint, so
  // handing it to an asynchronous write means what eventually lands is whatever the object
  // holds by then rather than what it held when the write was decided.
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
 * Turning the record off throws away what is stored rather than leaving it behind. The
 * character in play stays in memory, because the three detail panes are drawn from a record
 * and the pane you are looking at should not go blank to tell you nothing is being written.
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
 * `loaded` is set even on a failed read, so a panel is drawn either way. `ready` is separate and
 * gates only the WRITE: there is nobody to file a record under before world entry, and one
 * written earlier is attributed to whoever logs in next.
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

/** `min-height: 0` is the half easy to leave out: forty rows would push the frame open. */
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
 * `muted` carries the smaller size these want as well as the colour: a sentence beside a row of
 * chips is part of the same footer, and at the frame's own size it towers over them until the
 * figures read as its caption. The tone rather than a style, so a density can still reach it.
 */
function line(parent, role) {
  const el = woc.ui.line({ parent, className: 'woc-satchel-line', tone: 'muted' });
  el.dataset.role = role;
  return el;
}

/**
 * A sentence INSIDE a strip has to give way, which is the opposite of every other line: a flex
 * item is as wide as its longest line, so it would push the strip wider than the panel.
 */
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
 * A kit field on one line rather than stacked, with its label shrunk to a caption. LAYOUT only:
 * the CONTROL is never hand-sized, since an inline style outranks every selector and would opt
 * it out of the coarse-pointer tap-target floor.
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

/**
 * Baseline rather than centre: a label at 11px beside a figure at the frame's own size is two
 * heights, and centring them leaves neither on the line the sentence under them sits on.
 */
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

/** Hidden until it has something to say, so the eye lands on figures rather than sentences. */
function stat(parent, role, label) {
  const el = woc.ui.row({
    parent,
    className: 'woc-satchel-stat',
    align: 'baseline',
    gap: STAT_GAP,
  });
  el.dataset.role = role;
  // A chip wraps as a WHOLE onto the strip's next row rather than breaking between its two words.
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
  return { el, figure };
}

/** Hidden to begin with: a row that flashes a figure and then goes reads as something lost. */
function worthRow(role) {
  const bar = woc.ui.bar({ label: 'Worth', className: 'woc-satchel-worth' });
  bar.el.dataset.role = role;
  woc.ui.show(bar.el, false);
  return bar;
}

/** A figure, or nothing at all, which takes the whole chip off the strip. */
function setStat(chip, value) {
  woc.ui.show(chip.el, value !== '');
  chip.figure.textContent = value;
}

function addRow(tip, entry) {
  const bar = woc.ui.bar({ icon: entry.icon, className: 'woc-satchel-row' });
  bar.el.dataset.row = entry.key;
  // A flex column squashes its children before it scrolls, clipping every row's text with no
  // scrollbar to say so. The kit's sheet carries this for `.woc-bar`; it is stated here too
  // because a stylesheet is unreadable from a suite.
  fixed(bar.el);
  woc.ui.tooltip(bar.el, () => tip(entry.key));
  return bar;
}

/** Keyed on what the row is ABOUT, so a reused row keeps the hover a re-inserted one loses. */
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
 * Two of these, since a deposit box is cells too. `plan` and `view` are HELD rather than
 * recomputed: a tooltip is asked for its content when it is shown, and it has to describe the
 * square the pointer is over rather than whatever the store holds by then.
 */
function createGrid(name) {
  const el = document.createElement('div');
  el.className = 'woc-satchel-grid';
  el.dataset.grid = name;
  el.style.display = 'grid';
  // A FIXED track rather than `minmax(32px, 1fr)`: a stretched track stretches the square in it,
  // and a bag cell that changes shape with the window is worse than a centred grid.
  el.style.gridTemplateColumns = `repeat(auto-fill, ${String(CELL_SIZE)}px)`;
  el.style.gap = `${String(CELL_GAP)}px`;
  el.style.justifyContent = 'center';
  el.style.alignContent = 'start';
  scrolls(el);
  const grid = { el, plan: [], view: emptyView() };
  // Keyed on the SLOT, which is the one place a position is the identity rather than an
  // accident of order: cell 5 is cell 5 for as long as the store has one, and what changes is
  // what is in it. So a store that grows builds the squares it gained and one that shrinks
  // destroys the squares it lost, and nothing in between is rebuilt.
  grid.cells = woc.ui.list({
    parent: el,
    key: (slot) => String(slot.at),
    create: (slot) => createCell(grid, slot.at),
    update: (tile, slot) => {
      paintCell(tile, slot.entry, grid.view);
    },
  });
  return grid;
}

/**
 * The cell the player dragged this stack into, or null. Refused when it points outside the
 * grid: a hint from a larger bag that has since come off would place a stack nowhere.
 */
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

/**
 * One planner for both grids: the bags carry a placement hint per stack and the bank carries
 * none, and honouring an absent hint is the same code as honouring none.
 */
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
 * Resizable, since the useful width is however many squares the player wants across. Both bounds
 * are stated, because a frame that states neither takes its opening size as its floor, and they
 * are settled for good here: a bound cannot be restated, so the floor must hold for every tab.
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

// The body is a column so the pane inside it can take what is left of the frame and
// hand it to the one list that scrolls. See the header for why none of this is
// computed from the frame's box.
frame.body.style.display = 'flex';
frame.body.style.flexDirection = 'column';
frame.body.style.gap = '6px';
frame.body.style.minHeight = '0';
// The body of a frame does not grow: the loader's own sheet fills a window's body and gives
// a frame's `flex: 0 1 auto`, because a frame is normally sized by what it draws. A frame
// the player can resize is the exception, and without this the panes keep their content at
// the top and leave the height they dragged out as dead space under it.
frame.body.style.flex = '1 1 auto';

const panes = new Map([
  ['items', fills(column('woc-satchel-pane'))],
  ['bags', fills(column('woc-satchel-pane'))],
  ['bank', fills(column('woc-satchel-pane'))],
  ['mail', fills(column('woc-satchel-pane'))],
  ['roster', fills(column('woc-satchel-pane'))],
]);
for (const [name, pane] of panes) {
  pane.dataset.pane = name;
}

/** The three panes the character selector applies to. The other two span characters. */
const DETAIL_PANES = new Set(['bags', 'bank', 'mail']);

/**
 * The character selector, above the panes it applies to. Rebuilt only when the list of
 * characters changes, never on every paint: a control replaced while the player is using it
 * loses focus mid-interaction, and this one would otherwise be replaced at snapshot rate.
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
 * Unique by construction: a select's options are plain strings that are also their values, so
 * two characters of one name on two realms would collapse into one row.
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
 * Follows the character in PLAY by default and through a switch, since a panel pointed at the
 * character you just logged out of answers a question nobody asked. A deliberate pick stops it
 * following until the one in play is picked again.
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

function paintPicker() {
  const options = characterOptions();
  woc.ui.show(pickerRow, DETAIL_PANES.has(tabs.active()) && options.length > 0);
  if (!sameLabels(options.map((option) => option.label))) {
    buildPicker(options);
    return;
  }
  picker.field?.set(currentLabel());
}

const capacityBar = woc.ui.bar({ label: 'Slots', className: 'woc-satchel-capacity' });

/**
 * The fill is what is LEFT, so it drains leftward as the bags fill and the band is drawn from
 * that edge: the fill shrinking into the band is the moment the warning is about.
 */
const warnBand = document.createElement('div');
warnBand.className = 'woc-satchel-band';
warnBand.style.position = 'absolute';
warnBand.style.inset = '0 auto 0 0';
warnBand.style.width = '0';
warnBand.style.zIndex = '-1';
warnBand.style.backgroundColor = BAND_COLOR;
capacityBar.el.appendChild(warnBand);

const itemsPane = panes.get('items');
const bagsPane = panes.get('bags');
const bankPane = panes.get('bank');
const mailPane = panes.get('mail');
const rosterPane = panes.get('roster');

const bagGrid = createGrid('bags');
const bankGrid = createGrid('bank');

const search = woc.ui.field.text({
  label: 'Search',
  value: '',
  placeholder: 'every character, every store',
  onChange: () => {
    schedulePaint();
  },
});
search.el.dataset.role = 'search';
inline(search, SEARCH_WIDTH);
itemsPane.appendChild(search.el);
const itemsRows = group('items', (key) => itemTipFor(key));
scrolls(itemsRows.el);
itemsPane.appendChild(itemsRows.el);
const itemsStrip = strip(itemsPane, 'items-strip');
const shownStat = stat(itemsStrip, 'items-shown', 'Kinds');
const heldStat = stat(itemsStrip, 'items-held', 'Copies');
// A chip here rather than a row, unlike the three panes that draw one: this figure follows
// the SEARCH, so it is a fact about the list above it in the way the two counts beside it
// are, and it belongs in the same line as them.
const worthStat = stat(itemsStrip, 'items-worth', 'Worth');
const itemsNote = line(itemsPane, 'items-note');

// A grid pane puts its readout above the grid, which every list pane does the opposite of,
// and the difference is what the growing element is. A list fills its pane, so a strip after
// it is a footer against the bottom edge. A grid is only as tall as the stacks in it, so a
// strip after one floats in the middle of a panel.
fixed(capacityBar.el);
bagsPane.appendChild(capacityBar.el);
// The age sits IN the strip rather than above it, so a pane at a comfortable width
// reads as one line: what the reading is, then what is in it.
const bagsStrip = strip(bagsPane, 'bags-strip');
const bagsAgeLine = wrapping(line(bagsStrip, 'bags-age'));
const marksStat = stat(bagsStrip, 'marks', 'Marked');
const socketsStat = stat(bagsStrip, 'sockets', 'Sockets');
// The purse is a kit ROW rather than a chip on the strip, because money is the one
// figure here the kit draws rather than spells: a `{ copper }` value comes back as the
// game's own coins, and a chip takes text. It is also the figure a player scans for.
const purse = woc.ui.bar({ label: 'Carrying', className: 'woc-satchel-purse' });
purse.el.dataset.role = 'purse';
fixed(purse.el);
bagsPane.appendChild(purse.el);
// Under the purse and in the same shape, because the two are the same question about the
// same character: what they are carrying, and what the rest of it would fetch. It is a row
// rather than a chip for the reason the purse is, and it is the row that goes away entirely
// when nobody has published a price.
const bagsWorth = worthRow('bags-worth');
bagsPane.appendChild(bagsWorth.el);
bagsPane.appendChild(bagGrid.el);
const recentLine = line(bagsPane, 'recent');
const bagsNote = line(bagsPane, 'bags-note');

const bankBody = fills(column('woc-satchel-bank'));
const bankBar = woc.ui.bar({ label: 'Bank', className: 'woc-satchel-bank-capacity' });
fixed(bankBar.el);
bankBody.appendChild(bankBar.el);
// Inside the body rather than beside it, so the strip is hidden with the grid it
// describes: an age and a slot budget for a bank nobody has ever stood at are figures
// about nothing. Above the grid, for the reason the bags strip is.
const bankStrip = strip(bankBody, 'bank-strip');
const bankAgeLine = wrapping(line(bankStrip, 'bank-age'));
const bankMarksStat = stat(bankStrip, 'bank-marks', 'Marked');
const bankTermsStat = stat(bankStrip, 'bank-terms', 'Slots');
const bankWorth = worthRow('bank-worth');
bankBody.appendChild(bankWorth.el);
bankBody.appendChild(bankGrid.el);
bankPane.appendChild(bankBody);
const bankNote = line(bankPane, 'bank-note');

const mailStateLine = line(mailPane, 'mail-state');
const mailRows = group('mail', (key) => mailTip(key));
scrolls(mailRows.el);
mailPane.appendChild(mailRows.el);
const mailStrip = strip(mailPane, 'mail-strip');
const mailAgeLine = wrapping(line(mailStrip, 'mail-age'));
const postageStat = stat(mailStrip, 'mail-postage', 'Postage');
const attachmentsStat = stat(mailStrip, 'mail-attachments', 'Per letter');
const flightStat = stat(mailStrip, 'mail-flight', 'In flight');

// The account total is a kit ROW rather than a chip, for the reason the purse is: the
// figure it exists to carry is money, and money is drawn as coins rather than spelled.
// It also puts the account's total in the same shape as the per-character rows under
// it, so the eye reads one column of amounts rather than a chip and then a list.
const accountBar = woc.ui.bar({ label: 'Every character', className: 'woc-satchel-account' });
accountBar.el.dataset.role = 'account';
fixed(accountBar.el);
rosterPane.appendChild(accountBar.el);
const accountWorth = worthRow('account-worth');
rosterPane.appendChild(accountWorth.el);
const rosterStrip = strip(rosterPane, 'roster-strip');
const rosterCountStat = stat(rosterStrip, 'roster-characters', 'Characters');
const rosterSlotsStat = stat(rosterStrip, 'roster-slots', 'Slots');
const rosterFreeStat = stat(rosterStrip, 'roster-free', 'Free');
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
forget.addEventListener('click', () => {
  forgetOthers();
});
rosterPane.appendChild(forget);

fixed(tabs.el);
fixed(pickerRow);
frame.body.append(tabs.el, pickerRow, itemsPane, bagsPane, bankPane, mailPane, rosterPane);
showPane(tabs.active());

/**
 * The question the addon exists to answer. Counts are SUMMED here rather than counted as cells,
 * which is the opposite of the capacity bar and the opposite question.
 */
function buildIndex() {
  const index = new Map();
  // `characterOrder` rather than the insertion order of the map, so the places under a row
  // start with the character in play. Insertion order is whichever character storage
  // happened to be read in, which is stable and means nothing to a player.
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
    const row = index.get(itemId) ?? { total: 0, places: [] };
    row.total += counts.held;
    row.places.push({
      key: record.key,
      name: displayName(record),
      source,
      count: counts.held,
      cells: counts.cells,
      at: snap.at,
    });
    index.set(itemId, row);
  }
}

function matches(itemId, needle) {
  if (needle === '') {
    return true;
  }
  return `${nameOf(itemId)} ${itemId}`.toLowerCase().includes(needle);
}

/** Alphabetical, because the question is "where is my X" and not "what do I own most of". */
function itemOrder(index, needle) {
  return [...index.keys()]
    .filter((itemId) => matches(itemId, needle))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
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

/** Who holds a row's copies, named to a limit and counted after it. */
function placesText(places) {
  const who = byCharacter(places);
  const named = who.slice(0, MAX_PLACE_HINTS).map((one) => `${one.name} ${String(one.count)}`);
  const rest = who.length - named.length;
  if (rest > 0) {
    named.push(`+${String(rest)} more`);
  }
  return named.join(', ');
}

/**
 * One aggregated row: an item, every copy of it on the account, and where they are. `most`
 * is the largest total on screen, so the fill reads as a share of the biggest pile rather
 * than as a timer, which is what turns a list of figures into something a player can scan.
 */
function itemEntry(itemId, most) {
  const row = found.index.get(itemId) ?? { total: 0, places: [] };
  const icon = woc.ui.icon.item(itemId);
  return {
    key: itemId,
    icon,
    update: {
      label: nameOf(itemId),
      icon,
      value: String(row.total),
      detail: placesText(row.places),
      fraction: fractionOf(row.total, most),
      tone: 'default',
    },
  };
}

/**
 * One line per place: whose it is, which store, how many, in how many cells, how old. The
 * hint the whole pane exists to give, and the reason a row can afford to be one line.
 */
function placeLines(places) {
  return places.map((spot) => ({
    text: `${spot.name}, ${spot.source}: ${String(spot.count)} in ${woc.fmt.count(spot.cells, 'cell')}, read ${agoText(spot.at)}`,
  }));
}

/**
 * What one item is worth, each and for every copy of it. Empty when nobody has priced it,
 * which is the ordinary case for most of a bag and reads better as a line that is not there
 * than as one saying the price is unknown on every row.
 */
function worthLine(itemId, total) {
  const each = sellOf(itemId);
  if (each === null) {
    return '';
  }
  return `A vendor pays ${money(each)} each, ${money(each * total)} for all ${String(total)}.`;
}

/** `47 across 2 characters`, or the bare total when only one holds any. */
function spreadText(row) {
  const who = byCharacter(row.places).length;
  if (who === 1) {
    return `${String(row.total)} in all, on one character`;
  }
  return `${String(row.total)} in all, across ${String(who)} characters`;
}

function itemTipFor(itemId) {
  const row = found.index.get(itemId);
  if (row === undefined) {
    return itemId;
  }
  const lines = [`Item id: ${itemId}`, spreadText(row)];
  lines.push(...placeLines(row.places));
  const worth = worthLine(itemId, row.total);
  if (worth !== '') {
    lines.push(worth);
  }
  lines.push(...nameLines(itemId));
  lines.push({ text: 'Nothing here can move, mail or sell an item.', tone: 'muted' });
  return { title: nameOf(itemId), icon: woc.ui.icon.item(itemId), lines };
}

/**
 * Only what a figure cannot say, since the counts are on the strip: the states with no count to
 * draw, and the cap, or the fortieth row reads as the last item on the account.
 */
function itemsNoteText(shown, total) {
  if (records.size === 0) {
    return 'Nothing recorded yet. Log in on a character and their bags appear here.';
  }
  if (total === 0) {
    return 'No item on any character matches that.';
  }
  if (shown < total) {
    return 'Narrow the search to see the rest.';
  }
  return '';
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
    total += found.index.get(itemId)?.total ?? 0;
  }
  if (total === 0) {
    return '';
  }
  return String(total);
}

/**
 * What the matching rows are worth, spelled rather than drawn as coins: this one is a chip on
 * a strip beside two counts, and a chip takes text. Empty while nothing is priced, which takes
 * the chip off the strip rather than putting a `0c` on it.
 */
function worthText(sums) {
  if (sums.priced === 0) {
    return '';
  }
  return money(sums.copper);
}

/** The largest pile on screen, which every fill is drawn as a share of. */
function largestOf(order) {
  let most = 0;
  for (const itemId of order) {
    most = Math.max(most, found.index.get(itemId)?.total ?? 0);
  }
  return most;
}

function paintItems() {
  found.index = buildIndex();
  const needle = search.value().trim().toLowerCase();
  const order = itemOrder(found.index, needle);
  const shown = order.slice(0, MAX_ITEM_ROWS);
  const most = largestOf(shown);
  itemsRows.rows.sync(shown.map((itemId) => itemEntry(itemId, most)));
  setStat(shownStat, shownText(shown.length, order.length));
  setStat(heldStat, heldText(order));
  // Over everything the search matched rather than over the rows drawn, which is what the
  // count beside it does: a capped list says it is capped, and a total that quietly stopped at
  // the fortieth row would not.
  found.worth = worthOf(order.map((itemId) => [itemId, found.index.get(itemId)?.total ?? 0]));
  setStat(worthStat, worthText(found.worth));
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

function capacityTip() {
  return {
    title: 'Slots',
    lines: [
      `Pooled: ${String(BACKPACK_SLOTS)} in the backpack plus whatever your ${String(BAG_SOCKETS)} bag sockets add, up to ${String(MAX_SLOTS)}.`,
      { text: 'One cell is one stack, however much is in it.', tone: 'muted' },
      {
        text: 'Nothing here can sort, move or sell: the loader never sends a command.',
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(capacityBar.el, capacityTip);

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

/** Where the figure came from, since a stored one is as old as the reading it rode in on. */
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

/** `1 of 2 kinds priced`, which is what says the figure beside it is a partial answer. */
function pricedText(sums) {
  return `${String(sums.priced)} of ${String(sums.kinds)} kinds priced`;
}

/**
 * Drawn or taken off the panel, never `0c`: with nobody publishing prices that is a claim that
 * everything here is worth nothing, where the honest answer is no answer.
 */
function paintWorth(bar, sums) {
  woc.ui.show(bar.el, sums.priced > 0);
  bar.update({ value: { copper: sums.copper }, detail: pricedText(sums) });
}

/** What every worth figure has to say about itself, wherever it is drawn. */
function worthTipFor(said, sums) {
  return {
    title: 'Worth',
    lines: [
      said,
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
  return storeCounts(viewedSource(source).stacks);
}

woc.ui.tooltip(bagsWorth.el, () =>
  worthTipFor(
    'These bags at what a vendor pays for each thing in them.',
    worthOf(viewedCounts('bags')),
  ),
);

woc.ui.tooltip(bankWorth.el, () =>
  worthTipFor(
    'This bank at what a vendor pays for each thing in it.',
    worthOf(viewedCounts('bank')),
  ),
);

// Every store rather than the bags alone, which is the opposite of the slot total above it,
// and the line says so: slots are bags only because a bank is recorded only for a visit to
// one, while a thing owned is owned wherever it was last seen.
woc.ui.tooltip(accountWorth.el, () =>
  worthTipFor(
    'Every store of every character recorded, bank and mailbox included, at what a vendor pays.',
    worthOf(accountCounts()),
  ),
);

woc.ui.tooltip(worthStat.el, () =>
  worthTipFor('What the rows matching the search are worth to a vendor.', found.worth),
);

/**
 * What to say about names, without saying anything is wrong. Both silences are ordinary:
 * the game ships no art name for a weapon and for plenty else besides, and the addon that
 * would publish one may not be installed, may be disabled, or may not have this id.
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

function itemTip(view, entry) {
  const itemId = entryId(entry);
  const lines = [`Item id: ${itemId}`, `${String(entryCount(entry))} in this cell`];
  lines.push(...nameLines(itemId));
  lines.push(...markLines(view, itemId));
  lines.push({ text: 'Nothing here can move, merge or sell an item.', tone: 'muted' });
  return { title: nameOf(itemId), icon: woc.ui.icon.item(itemId), lines };
}

/**
 * From the last paint's plan rather than the store, so it describes the square the pointer is
 * over rather than whatever the store holds by the time the lines are composed.
 */
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

/** A tile rather than a bar: this panel has no names to put in one, and a cell is art. */
function createCell(grid, at) {
  const tile = woc.ui.tile({ className: 'woc-satchel-cell', size: CELL_SIZE });
  tile.el.dataset.cell = String(at);
  woc.ui.tooltip(tile.el, () => cellTip(grid, at));
  return tile;
}

/** A count worth drawing. A grid where every single item reads "1" is noise. */
function countFor(entry) {
  const count = entryCount(entry);
  if (count > 1) {
    return count;
  }
  return null;
}

/** Warm for a cell holding something there is more than one of. See `readStore`. */
function markTone(itemId, view) {
  if (view.split.has(itemId) || view.spare.has(itemId) || view.carried.has(itemId)) {
    return 'warn';
  }
  return 'default';
}

/**
 * The label is UNSET rather than left alone, or a cell reused from an occupied one announces the
 * item it last held. `null` is unnamed; an empty string is a name that is blank.
 */
function clearCell(tile) {
  tile.update({ label: null, icon: null, count: null, tone: 'default' });
  tile.el.style.backgroundColor = EMPTY_FILL;
  tile.el.style.borderStyle = EMPTY_EDGE;
  tile.el.style.opacity = EMPTY_OPACITY;
  tile.el.dataset.item = '';
}

function fillCell(tile, entry, view) {
  const itemId = entryId(entry);
  tile.update({
    label: nameOf(itemId),
    icon: woc.ui.icon.item(itemId),
    count: countFor(entry),
    tone: markTone(itemId, view),
  });
  tile.el.style.backgroundColor = OCCUPIED_FILL;
  tile.el.style.borderStyle = OCCUPIED_EDGE;
  tile.el.style.opacity = OCCUPIED_OPACITY;
  tile.el.dataset.item = itemId;
}

function paintCell(tile, entry, view) {
  if (tile === undefined) {
    return;
  }
  if (entry === null) {
    clearCell(tile);
    return;
  }
  fillCell(tile, entry, view);
}

function paintGrid(grid, plan, view) {
  // Both are held before the sync rather than passed into it: `update` paints from `grid.view`
  // and a tooltip is asked for its content when the pointer lands, which is long after.
  grid.plan = plan;
  grid.view = view;
  grid.cells.sync(plan.map((entry, at) => ({ at, entry })));
}

/**
 * What the marked cells add up to, as figures, or nothing at all when none is marked. Four
 * short readings, each still spelled out in full in `marksTip` on the chip and on the square
 * itself, which is where a player asks what a mark means.
 */
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

/** The marks spelled out, which is what the chip on the strip is a count of. */
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

/** A share, without the divide-by-zero that would put a NaN into a style property. */
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
 * How old a reading is, said in the player's own terms. The live case says live rather than
 * "moments ago", because those are different claims: one is a reading that is being
 * refreshed and the other is one that was refreshed recently and may already be wrong.
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

function paintBagsFigures(snap) {
  const free = Math.max(0, snap.total - snap.used);
  capacityBar.update({
    value: `${String(snap.used)} / ${String(snap.total)}`,
    detail: `${String(free)} free`,
    fraction: fractionOf(free, snap.total),
    tone: toneFor(free),
  });
  warnBand.hidden = snap.total <= 0;
  const band = Math.min(fractionOf(threshold(), snap.total), 1);
  warnBand.style.width = `${(band * PERCENT).toFixed(WIDTH_DECIMALS)}%`;
}

/** `1 / 4`, with what is in each of them one hover away. See `socketTip`. */
function socketsText(snap) {
  const filled = snap.sockets.filter((itemId) => itemId !== '').length;
  const total = Math.max(snap.sockets.length, BAG_SOCKETS);
  return `${String(filled)} / ${String(total)}`;
}

/** Nobody is playing, or nobody has been here: no figures and one sentence. */
function clearBags() {
  paintGrid(bagGrid, [], emptyView());
  warnBand.hidden = true;
  say(bagsNote, noRecordText());
  say(bagsAgeLine, '');
  say(recentLine, '');
  for (const chip of [marksStat, socketsStat]) {
    setStat(chip, '');
  }
  woc.ui.show(purse.el, false);
  woc.ui.show(bagsWorth.el, false);
}

function paintBags() {
  const record = viewedRecord();
  const live = viewingSelf();
  woc.ui.show(capacityBar.el, record !== null);
  woc.ui.show(bagGrid.el, record !== null);
  if (record === null) {
    clearBags();
    return;
  }
  const snap = record.sources.bags;
  paintBagsFigures(snap);
  const view = readStore(snap.stacks, new Set(record.equipped), new Set());
  paintGrid(bagGrid, cellPlan(snap), view);
  say(bagsNote, '');
  say(bagsAgeLine, `${whoseText(record)}${ageText(snap, live)}`);
  setStat(marksStat, marksText(view));
  setStat(socketsStat, socketsText(snap));
  woc.ui.show(purse.el, true);
  purse.update({ value: { copper: record.copper } });
  paintWorth(bagsWorth, worthOf(storeCounts(snap.stacks)));
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
  lines.push(`The next expansion costs ${money(snap.next)}.`);
  return lines;
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
woc.ui.tooltip(bankBar.el, bankTip);

/** The expansion budget, in full, under the chip that carries its figures. */
function bankTermsTip() {
  const snap = viewedSource('bank');
  return {
    title: 'Slots',
    lines: [
      ...expansionLines(snap),
      ...bonusLines(),
      { text: 'Nothing here can buy one.', tone: 'muted' },
    ],
  };
}
woc.ui.tooltip(bankTermsStat.el, bankTermsTip);

/**
 * Never "it is empty", which is why the loader publishes a status rather than a nullable
 * reading: the server sends nothing for a counter nobody is at. A note about FRESHNESS, since
 * what is drawn meanwhile is the last reading taken.
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
 * Drawn from the last `near` reading whatever the status is, which is the feature. The reverse,
 * an `away` recorded as an empty bank, is refused in `syncLive`.
 */
function paintBank() {
  const record = viewedRecord();
  const snap = viewedSource('bank');
  const live = viewingSelf();
  const drawn = record !== null && snap.at > 0;
  woc.ui.show(bankBody, drawn);
  say(bankNote, bankNoteText(record, snap, live));
  if (!drawn) {
    paintGrid(bankGrid, [], emptyView());
    say(bankAgeLine, '');
    setStat(bankMarksStat, '');
    setStat(bankTermsStat, '');
    return;
  }
  const free = Math.max(0, snap.total - snap.used);
  bankBar.update({
    value: `${String(snap.used)} / ${String(snap.total)}`,
    detail: `${String(free)} free`,
    fraction: fractionOf(free, snap.total),
    tone: toneFor(free),
  });
  const carried = new Set(stacksIn(record.sources.bags.stacks).keys());
  const view = readStore(snap.stacks, new Set(record.equipped), carried);
  paintGrid(bankGrid, cellPlan(snap), view);
  say(bankAgeLine, `${whoseText(record)}${ageText(snap, live && isNear(woc.world.bank))}`);
  setStat(bankMarksStat, marksText(view));
  setStat(bankTermsStat, expansionText(snap));
  paintWorth(bankWorth, worthOf(storeCounts(snap.stacks)));
}

function isNear(state) {
  return state.status === 'near';
}

/** Sentences joined with one space, skipping any that has nothing to say. */
function sentences(parts) {
  return parts.filter((part) => part !== '').join(' ');
}

/**
 * The one mail fact with no proximity gate. About the PLAYER rather than the selected character,
 * which is why it is not read off a record: a badge exists for when you are not at the mailbox.
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
 * In the TITLE because a badge has to be readable with the Mail tab closed and a tab strip
 * cannot be relabelled. Written only on a change, or `setTitle` runs at snapshot rate.
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
 * One letter. The fill is the unread mark rather than a measurement: a letter has nothing to
 * be a fraction of, and a filled warm row is what makes the unread ones findable in a box
 * that holds up to a hundred.
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
 * What sending one costs, read off the payload rather than written down here. Three figures
 * on the strip rather than one sentence under the list; the tooltip says the sentence,
 * because the figures alone do not say that they are the terms for sending.
 */
function paintMailTerms(snap, drawn) {
  setStat(postageStat, drawnText(drawn, money(snap.postage)));
  setStat(attachmentsStat, drawnText(drawn, woc.fmt.count(snap.attachments, 'item')));
  setStat(flightStat, drawnText(drawn, `${String(snap.flight)}s`));
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

/**
 * The title's count is `world.mailUnread`, which streams everywhere; the letters are
 * `world.mail`, which exists only at a pillar. Neither is derived from the other, or the badge
 * would light only while the player is already looking at the box.
 */
function paintMail() {
  const record = viewedRecord();
  const snap = viewedSource('mail');
  const live = viewingSelf();
  const drawn = record !== null && snap.at > 0;
  mailRows.rows.sync(snap.letters.map((letter) => mailEntry(letter)));
  paintMailTerms(snap, drawn);
  say(mailAgeLine, mailAgeText(record, snap, live));
  say(
    mailStateLine,
    sentences([unreadLine(record, snap, live), boxText(drawn, snap), gateNote(live, drawn)]),
  );
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

function rosterEntry(record, here) {
  const snap = record.sources.bags;
  const free = Math.max(0, snap.total - snap.used);
  return {
    key: record.key,
    icon: null,
    update: {
      label: labelFor(record, here),
      value: { copper: record.copper },
      detail: `${String(snap.used)} / ${String(snap.total)} cells, ${String(free)} free`,
      fraction: fractionOf(free, snap.total),
      tone: toneFor(free),
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
    return `${source}: ${String(snap.stacks.length)} stacks, read ${agoText(snap.at)}`;
  });
}

function rosterTip(key) {
  const record = records.get(key);
  if (record === undefined) {
    return key;
  }
  return {
    title: displayName(record),
    lines: [
      `Carrying ${money(record.copper)}`,
      ...storeLines(record),
      { text: `Last seen ${agoText(record.at)}`, tone: 'muted' },
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
 * The BAGS only, and the tooltip says so: bags are recorded every time a character is played and
 * a bank only if they walked up to one, so a total including banks jumps the first time somebody
 * visits a banker. The ages behind these differ by days, which nothing in a total can say, so
 * the rows keep their own stamps and the tooltip names the oldest.
 */
function rosterTotals() {
  const sums = { characters: 0, used: 0, total: 0, copper: 0, oldest: 0 };
  for (const record of records.values()) {
    const snap = record.sources.bags;
    sums.characters += 1;
    sums.used += snap.used;
    sums.total += Math.max(snap.total, snap.used);
    sums.copper += record.copper;
    if (snap.at > 0 && (sums.oldest === 0 || snap.at < sums.oldest)) {
      sums.oldest = snap.at;
    }
  }
  return sums;
}

/** How old the worst of the readings behind a total is, which a total cannot say. */
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
      `${money(sums.copper)} across the account.`,
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

function paintRosterTotals() {
  const sums = rosterTotals();
  woc.ui.show(rosterStrip, sums.characters > 0);
  woc.ui.show(accountBar.el, sums.characters > 0);
  accountBar.update({ value: { copper: sums.copper } });
  paintWorth(accountWorth, worthOf(accountCounts()));
  setStat(rosterCountStat, String(sums.characters));
  setStat(rosterSlotsStat, `${String(sums.used)} / ${String(sums.total)}`);
  setStat(rosterFreeStat, String(Math.max(0, sums.total - sums.used)));
}

function paintRoster() {
  const here = characterKey();
  rosterRows.rows.sync(characterOrder().map((record) => rosterEntry(record, here)));
  paintRosterTotals();
  say(rosterNote, rosterNoteText());
}

function draw() {
  syncLive();
  paintPicker();
  paintItems();
  paintBags();
  paintBank();
  paintMail();
  paintRoster();
  paintTitle();
}

/**
 * One repaint per frame however many ask, since a publisher's catch-up is a message per id. NO
 * `{ frame }`: `draw` opens with `syncLive`, which is what writes this character's stores down,
 * so a repaint held until somebody opens the panel is a session that recorded nothing.
 */
const schedulePaint = woc.paint(draw);

/**
 * On the CROSSING rather than the state, or every loot while full would chime. Off the live bags
 * whichever character the panes are showing, since a warning is about the player.
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
 * Somebody else is playing now. A character switch inside one page load is real: the game
 * clones and removes its HUD rather than reloading, so an addon holding a per-character view
 * has to be told. The picker follows unless the player has deliberately pointed it elsewhere.
 */
function onCharacterChange() {
  schedulePaint();
}

// `bagCapacity` is read straight through and has no watch key: `world.on` throws on
// one it does not know, and the capacity moves when a bag is socketed. Equipment is
// watched because a spare of something worn is one of the marks on the grid.
woc.world.on('inventory', onWorldChange);
woc.world.on('bags', onWorldChange);
woc.world.on('copper', onWorldChange);
woc.world.on('equipment', onWorldChange);
woc.world.on('characterKey', onCharacterChange);

// The two counters and the badge. `bank` and `mail` move when the player walks up to
// one and away again, which is the moment a reading is worth recording; `mailUnread`
// moves anywhere in the world, which is what makes the title badge work with the Mail
// tab closed.
woc.world.on('bank', schedulePaint);
woc.world.on('mail', schedulePaint);
woc.world.on('mailUnread', schedulePaint);

// The two moments the game itself narrates. `world.on('inventory')` already reports
// the change; what these add is the game's OWN line, which names the item that an
// inventory entry cannot.
woc.net.onEvent('loot', (event) => {
  const said = text(event?.text);
  if (said !== '') {
    recent.text = said;
    schedulePaint();
  }
});

/** The bulk junk sweep carries no item id, and is a plain refresh signal. */
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

// The batch, subscribed to and asked for in one call. The order inside it is what matters and
// is `follow`'s: delivery is SYNCHRONOUS, so a publisher that answers inside the ask reaches a
// handler that already exists, where one registered afterwards would miss its own answer.
woc.bus.follow(ITEMS_TOPIC, onItems);
// The incremental form is a push with no ask half: one newly learned id whenever a publisher
// learns one, so there is nothing to catch up on and a plain subscription is all of it.
woc.bus.on(woc.bus.anySender, ITEM_TOPIC, onItem);
// The older ask topic, sent beside the one `follow` derives. Drop next release.
woc.bus.emit(LEGACY_ASK_TOPIC);

woc.onSettingsChange(() => {
  if (!remembering()) {
    dropStored();
  }
  // A new threshold is a new question, so the warning gets to fire again.
  warned.on = false;
  draw();
});

/**
 * Both art answers are provisional until the manifest lands, so the first grid of a session is
 * optimistic pictures and no names. One request covers every item, and it never rejects.
 */
async function learnArt() {
  await woc.ui.icon.preloadItems();
  if (running.on) {
    schedulePaint();
  }
}

// The one thing registered by hand. Everything else lives inside a kit widget or the frame
// body and is drained on disable, but `startRecords` and `learnArt` are both awaiting
// something and either continuation could otherwise resume against a torn-down frame.
woc.onDispose(() => {
  running.on = false;
});

draw();
startRecords().catch((err) => {
  woc.warn('satchel: the character records could not be started', err);
});
learnArt().catch((err) => {
  woc.warn('satchel: the item art manifest could not be read', err);
});
