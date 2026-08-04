/// <reference types="@woc-addons/types" />

// Satchel: where your things are, across every character on the account.
//
// The game's own bag window already aggregates your bags, so a panel that redraws them
// earns nothing. Three questions the client cannot answer at all:
//
//   What is on another character. Only the character you are logged in as exists on the
//   client, so an alt's bags are unreachable the moment you log out of them.
//
//   What is in your bank or mail when you are not at one. Both reads are proximity gated:
//   the server sends the payload on proximity alone and sends nothing otherwise.
//
//   How many of something you own, and where. Answering that needs a record that outlives
//   both the session and the character.
//
// So this is a cross-character item index that happens to also draw the current bags.
// Items is the addon; the three detail panes are how you read one character's stores,
// including a character you are not logged in as.
//
// Every pane is drawn from a record, and the record for the character in play is refreshed
// from the live world before every paint. That is what makes walking away from a banker
// show your bank as of ten minutes ago rather than a blank pane, and it is what makes
// another character's bank readable at all, because the two cases are the same case. What
// the panes owe in exchange is age: every stored reading says when it was taken, because a
// bank from three days ago is still useful and must never be presented as current.
//
// Only `near` is ever recorded, and this is the single worst bug this feature can have.
// `world.bank` and `world.mail` are three-state: `near` carries the payload, `away` means
// the player is not at the counter, and `unknown` means nothing has decoded. Writing a
// snapshot on `away` would erase a character's bank the moment they walked away from it.
//
// The key is the loader's, plus the channel. `world.characterKey` is the same derivation
// `woc.storage.character` files its keys under, so this addon and any other keeping a
// per-character record cannot disagree about whose a row is. It is opaque and nothing here
// parses it. What it does not carry is the deployment, because the loader adds that itself
// in `perCharacterKey` for the two namespaces it owns; a record filed in the account-wide
// namespace gets no such help, so the channel is prefixed here. A character and its PBE
// copy have the same realm and the same name and are not the same character.
//
// Storage is account-wide, one key per character. A per-character store answers only about
// the character in play, and reading a character you are not logged in as is the entire
// feature. One key per character rather than one blob, because a blob makes every write a
// rewrite of every other character's row, and two tabs on two characters would take turns
// clobbering each other.
//
// The stamp is `woc.wallClock()`, never `woc.now()`. A row is stored in one session and
// read in the next, and a monotonic reading restored into a fresh page reads as a moment
// in 1970 or one in the future depending on which way the two drifted.
//
// A cell is an entry and an item is a total, and the two questions must never share an
// answer. One inventory entry is one cell holding 1 or 20 of something, so used slots is
// `inventory.length` and never the sum of the counts: summing them tells a player carrying
// 300 ore that their 52 cell bags are 248 slots overdrawn. The Items pane asks the opposite
// question and therefore sums, so a stack split over four cells is one row reading 47.
//
// The art is reachable and the name is not. An item id resolves to no name, no quality, no
// kind and no price anywhere on this API, because the item table is bundled inside the
// game's own chunk. `ui.icon.item(itemId)` builds a URL into the game's own item art
// directory from that same id, so a panel that cannot say what an item is can still show
// it. It returns null for an id that ships no file, so a blank face means "no art exists"
// rather than "this addon built the wrong id". `ui.icon.itemArtName` serves the name the
// art file was filed under, which is provenance for the picture rather than the item's
// name, so it is a labelled fallback and the tooltip says where the name came from. A
// publisher on the bus outranks it; the art name outranks the raw id. Loader last, because
// this particular loader answer is not the item's name.
//
// Capacity is pooled rather than per container. The backpack is 16 cells and each of the
// four bag sockets adds its own on top, to a ceiling of 72, and the game hands the pooled
// total over as one number. `bagCapacity` is read rather than derived, and it has no watch
// key of its own, so this subscribes to `bags`.
//
// `InvSlot.slot` is a placement hint and is honoured where there is one: it is the cell the
// player dragged that stack into, absent for anything never moved by hand, so hinted stacks
// are placed first and everything else flows into what is left. It is recorded too, so an
// alt's bags are drawn the way that alt arranged them.
//
// The observed stack maximum is a lower bound and says so. No published field carries a
// stack maximum, so what a merge would free is measured against the largest stack this
// addon has actually seen, learned from every store it reads. That is the safe direction:
// the failure it avoids is telling a player about room that is not there.
//
// There is no sort and there cannot be one. Sorting, merging, selling, mailing and
// withdrawing are all commands and the loader never sends one, so every tooltip that
// describes something the player might want to act on says that nothing here can act on it.
//
// The market is deliberately not here. `world.market` is readable and this addon does not
// read it: a market pane is a price history, which is its own addon, and two panels
// recording the same pages would disagree about what the player saw.
//
// The bus contract, which this addon is the first consumer of. Another addon can do better
// than an id and publish what it learns, and the topic registry gives it `item` for one
// record and `items` for a batch. Three rules follow, and they are the contract for every
// consumer after this one:
//
//   Subscribe with `woc.bus.anySender`, never with a hardcoded fqid. A subscriber names its
//   publisher, and `official/lorebind` is right only on the official marketplace: the same
//   addon installed from a fork publishes as `someone/lorebind`. `message.from` says who
//   actually answered, which is what a tooltip credits.
//
//   Ask once, then draw without waiting. A publisher emits on change, so a consumer that
//   only subscribes hears nothing when the publisher emitted everything before this addon
//   started. `item:ask` goes out after the subscriptions are up, because delivery is
//   synchronous and an answer arrives inside the emit call itself.
//
//   Silence is an ordinary state rather than an error. The publisher may not be installed,
//   may be disabled, or may simply not answer. Nothing here waits for one or tells the
//   player something is broken: the index is complete without a single name.
//
// The layout, which is three rules that only bite together:
//
//   An element comes back as the display it was built with. `setShown` clears the inline
//   display rather than writing one, so a grid comes back a grid and a sentence comes back
//   a block. A helper that wrote `flex` on the way in puts 72 bag squares in one row.
//
//   The frame is sized, its body is told to fill it, and its panes scroll. A frame is
//   content-sized unless it says otherwise, so a list of twenty rows makes a window twenty
//   rows tall. Stating a height fixes the window and moves the problem inward twice: the
//   loader fills only a window's body, so a resizable frame has to ask, and then the one
//   list or grid in each pane takes what is left and scrolls inside it.
//
//   A row in a scrolling list must not shrink. A flex column shrinks its children to fit
//   before it will scroll, so forty rows in a list half that tall are forty squashed rows
//   with their text clipped, and the scrollbar never appears to say so.
//
// The figures in a pane are short labelled chips on one wrapping line, with the sentence
// behind each one a hover away. What is not a chip is the panel's honesty rather than
// its arithmetic: how old a reading is, and that a drawn reading is the last one rather
// than a live one, stay on screen as sentences. Money is the exception, because it is the
// one figure here the kit draws: `{ copper }` passed as a readout's value comes back as the
// game's own coins and a chip takes text, so the two amounts a player scans for are kit
// rows instead. `woc.ui.money` is the text form.

/** The backpack, the socket count and the ceiling, for the sentence that explains pooling. */
const BACKPACK_SLOTS = 16;
const BAG_SOCKETS = 4;
const MAX_SLOTS = 72;

/**
 * The square, and how few of them the frame may be dragged down to. There is no column
 * count: the grid is a wrapping track list, so the browser fits as many squares as the
 * frame is wide. The floor has to be stated, because a frame's size bounds are settled
 * when it is built and a grid two squares across is a list drawn the hard way.
 */
const CELL_SIZE = 32;
const CELL_GAP = 3;
const MIN_COLUMNS = 6;
const MIN_ROWS = 3;

/** Wide enough for five tabs at the compact density without them wrapping. */
const FRAME_WIDTH = 340;
/** Tall enough for a backpack of 16 squares, its bar, its strip and the tabs above. */
const FRAME_HEIGHT = 420;
/** The compact density's own padding, which the frame's width has to carry twice. */
const FRAME_PADDING = 8;
/**
 * What the shortest useful frame spends on everything that is not the scrolling pane: the
 * title bar, the tab strip, the character selector, a capacity bar and the status strip.
 * Stated rather than measured, because a size floor is settled once when the frame is built
 * and cannot be derived from a layout that does not exist yet.
 */
const CHROME_HEIGHT = 200;

const DEFAULT_WARN_FREE = 4;
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
 * How stale a stamp may get before it is rewritten with nothing else changing. A stamp
 * answers "when was this last read" rather than "when did it last change", so a player who
 * stood at their bank a minute ago must not be told the reading is an hour old. Writing
 * every paint would be a storage write at snapshot rate.
 */
const STAMP_REFRESH_MS = MINUTE_MS;

/**
 * The account-wide key prefix, one key per character per deployment. The rest of the key is
 * `characterKey()`, which is the channel and the loader's own opaque character string.
 */
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

// The registry's topics. `item` is one record, `items` is a batch of them, and the
// ask is what a consumer that started late sends to be caught up.
const ITEM_TOPIC = 'item';
const ITEMS_TOPIC = 'items';
const ASK_TOPIC = 'item:ask';

/** The warning band, in the kit's own danger colour: it marks a limit, not a target. */
const BAND_COLOR = 'rgb(255 143 133 / 30%)';

/**
 * What tells an occupied cell from an empty one without the art.
 *
 * A blank face means the game ships no file, which is common: every weapon in the game is
 * filed under a model name nothing serves. A stack of one draws no count either, because a
 * grid where every single item reads "1" is noise. Those two together would leave a full
 * cell indistinguishable from an empty one, so the cell's own body carries the distinction:
 * a filled square with a solid edge against a faint dashed outline. Never `borderColor`,
 * which is the tone's, and an inline write would beat the class that sets it.
 */
const OCCUPIED_FILL = 'rgb(255 255 255 / 7%)';
const EMPTY_FILL = 'transparent';
const OCCUPIED_EDGE = 'solid';
const EMPTY_EDGE = 'dashed';
const OCCUPIED_OPACITY = '1';
const EMPTY_OPACITY = '0.4';

/**
 * What a name taken from the art file is worth saying about itself. The loader is explicit
 * that this is provenance for the picture rather than the item's name, so a square drawn
 * from one has to say so somewhere. The tooltip is that somewhere: a tile's accessible name
 * is one string with no room to qualify anything.
 */
const ART_NOTE = {
  text: 'Named from its art file, which is not always what the game calls it.',
  tone: 'muted',
};

/** Item id to what somebody published about it, plus who published it. */
const names = new Map();
/**
 * Item id to the largest single stack of it seen, ever, including out of storage. The only
 * stack maximum obtainable at all, since no published field carries one. That is a lower
 * bound and is the safe direction, because the failure it avoids is telling a player about
 * room that is not there. Reading stored records back in feeds it too, so the estimate does
 * not reset every page load.
 */
const largest = new Map();

/**
 * A flag that changes, in a cell. The factory keeps the value a boolean rather than the
 * literal it starts as: a property initialized to `false` reads as the type `false`, so
 * every later test of it is reported as a condition that can never be true.
 */
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
/** One repaint per frame however many messages arrive. See `schedulePaint`. */
const scheduled = cell(false);
/** Whether the free-slot warning has already fired for this trip below the line. */
const warned = cell(false);

/** The last thing the game said arrived or left, verbatim. See `recentLine`. */
const recent = { text: '' };
/** The window title as last written, so `setTitle` is called only on a change. */
const titleShown = { text: FRAME_TITLE };
/** Which character the three detail panes are showing. See `viewedKey`. */
const selection = { key: '', follow: cell(true) };
/** The index behind the rows on screen, so a tooltip describes the row it is over. */
const found = { index: new Map() };
/**
 * Letter bodies for the character in play, which the stored form deliberately drops. A body
 * is the longest field a letter has and is worth nothing to the index, and it is only
 * readable while standing at the pillar anyway, so it is held here for as long as the
 * reading lasts.
 */
const bodies = new Map();

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

/** How few free slots is worth saying something about. */
function threshold() {
  return Math.max(0, Math.round(settingNumber('warn-free', DEFAULT_WARN_FREE)));
}

/** Whether anything at all is written down. Off means this session and no further. */
function remembering() {
  return settingFlag('remember', true);
}

function text(value) {
  if (typeof value === 'string') {
    return value;
  }
  return '';
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
 * Which character is playing, on which deployment.
 *
 * `world.characterKey` is the loader's derivation and is read rather than rebuilt from a
 * realm and a name, so that two addons keeping their own per-character records cannot
 * disagree about whose a row is. Opaque: nothing here parses it.
 *
 * The channel is prefixed, and leaving it off is a bug rather than a shortening. The
 * loader's own per-character keys carry the deployment because characters are issued per
 * deployment and are not comparable across them. This addon files under the account-wide
 * namespace, which the loader adds nothing to, so without this a PBE copy of a character
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
 * An amount spoken, for a tooltip line or a sentence. The loader's split rather than this
 * addon's arithmetic, so that two addons showing a price cannot spell it differently, and
 * it drops the units an amount has none of: postage of 30 copper reads as `30c`.
 *
 * The other form is `{ copper }` passed as a readout's `value`, which the kit draws with
 * the game's own coins. That one is for a figure the eye lands on; this one is for a figure
 * a sentence is about.
 */
function money(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'unknown';
  }
  return woc.ui.money(amount);
}

function countedCells(count) {
  if (count === 1) {
    return '1 cell';
  }
  return `${String(count)} cells`;
}

function countedItems(count) {
  if (count === 1) {
    return '1 item';
  }
  return `${String(count)} items`;
}

function unitAgo(count, unit) {
  if (count === 1) {
    return `1 ${unit} ago`;
  }
  return `${String(count)} ${unit}s ago`;
}

/**
 * How old a reading is, in the coarsest unit that still says something. The wall clock on
 * both sides, which is why a stamp comes from `woc.wallClock()`: this subtraction spans
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
 * The name the item's art file was filed under, or null: for an id with no file, for one
 * whose art came out of a generated batch, and for every weapon in the game, since weapon
 * art is filed under a model name through a table nothing serves. Also null until the
 * manifest has been read, which is what `learnArt` is for.
 */
function artName(itemId) {
  if (itemId === '') {
    return null;
  }
  return woc.ui.icon.itemArtName(itemId);
}

/**
 * `chunk_of_ore` read back as `Chunk Of Ore`. The last resort, and a guess: an item id is
 * not a name and the game capitalises plenty of things this gets wrong. It is still the
 * better of the two readable failures, because a list where one row in ten is a lowercase
 * identifier reads as a bug in the rows around it. The tooltip says where every name came
 * from.
 */
function titleCase(itemId) {
  return itemId
    .split('_')
    .filter((word) => word !== '')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The best name there is, and a reading of the id when there is none. Never blank. A
 * publisher first and the loader second, which is the opposite of the usual ordering and is
 * right here for one reason: what the loader has is not the item's name and says so in its
 * own documentation. A publisher's is.
 */
function nameOf(itemId) {
  return known(itemId)?.name ?? artName(itemId) ?? titleCase(itemId);
}

/**
 * One published record, checked. A bus payload is `unknown` and is another addon's idea of
 * the shape, so an id and a name are required and everything else reads as absent when it
 * is the wrong kind.
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
    kind: text(payload.kind),
    quality: text(payload.quality),
    source: text(payload.source),
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

/** The batch form of the same topic, which the registry gives a publisher for a bulk answer. */
function onItems(message) {
  if (!Array.isArray(message.payload)) {
    return;
  }
  let learned = 0;
  for (const entry of message.payload) {
    if (remember(entry, message.from)) {
      learned += 1;
    }
  }
  if (learned > 0) {
    schedulePaint();
  }
}

/**
 * One stack, from the wire or from storage, which are the same shape on purpose. `InvSlot`
 * is what the game hands over and what gets written down, so the live path and the stored
 * path share every reader below this line. The placement hint rides along, which is what
 * lets an alt's bags be drawn the way that alt arranged them.
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
 * One letter, without its body. The id is carried as a string because it is a row key
 * everywhere it is used, and a number that round-trips through JSON and is then used as a
 * DOM attribute is one implicit conversion away from a row that cannot be found again.
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
 * What the next bank expansion costs, or null once they are all bought. Checked on the type
 * rather than coerced, because `Number(null)` is 0 and 0 is finite: a `nextExpansionCost`
 * of null read that way becomes an expansion that is free rather than one that does not
 * exist.
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
 * One stored character, checked. A previous version of this addon wrote it and a player can
 * edit it. A record with no name is dropped outright: every character has one, so a row
 * without it is not a character.
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
 * Item id to `{ cells, held }` over one store, recording the largest stack seen. The
 * recording is a side effect of a read on purpose: every reading of a store is also the only
 * chance to observe a stack size. Every store goes through here, the stored ones included.
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
 * How many cells merging this item's stacks would free, at least. Measured against the
 * largest stack seen, because no published field says how big a stack of anything may be.
 * An item never seen above one is a thing that does not stack, and the same arithmetic
 * answers zero for it without needing to be told.
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
 * One reading of a store: what is held, what is doubled up, and what is a spare. Taken once
 * per paint and handed down. Every mark comes from ids alone, which is what makes them the
 * things this panel can highlight with nobody having named anything.
 *
 * `alsoIn` is the other store's ids and is one-directional: the bank marks what the
 * character is also carrying, and the bags do not mark what is also banked, because a bank
 * reading comes and goes as the player walks up to a counter and a mark that appeared and
 * vanished with it would read as a fault.
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
 * The mailbox, with every attachment flattened into `stacks`. The index asks one question
 * of every source, "what items are in here", and a parcel waiting in a letter is an item
 * the character owns and cannot see. Keeping the letters as well is what the Mail pane draws.
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
 * Fold the live world into the record for the character in play. The bags are folded in
 * unconditionally, because they stream. The bank and the mailbox are folded in only on
 * `near`: the server sends nothing for a counter the player is not standing at, and
 * recording that as an empty store would erase what they have.
 */
function syncLive() {
  const key = characterKey();
  if (!loaded.on || key === '') {
    return;
  }
  const now = woc.wallClock();
  const record = records.get(key) ?? emptyRecord(key);
  record.key = key;
  // Kept rather than overwritten when the entity has no name for a frame. A blank one is
  // what `parseRecord` drops a stored row on, so writing one would quietly delete a
  // character on the next page load rather than at the moment it happened.
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
 * Write a record down, when it has changed or when its stamp has gone stale. The stale half
 * is what makes an age honest: a stamp answers when a store was last read, so a player
 * standing at their bank moving nothing must not be told the reading is an hour old, and
 * writing on every paint would be a storage write at snapshot rate.
 *
 * A rejection is the addon's own log and nothing else: this is a record the player did not
 * ask for at the moment it fails, and a toast about storage during a fight would be worse
 * than the missing row.
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
 * Read what is stored, then wait for somebody to be playing. The read failing is not a
 * reason to show nothing: `loaded` is set either way. `ready` is separate and gates only the
 * write, because there is nobody to file a record under until world entry and one written
 * before it would be attributed to whoever logged in next.
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

/**
 * What an element's display is when it is shown, for the ones this addon lays out. Recorded
 * where the element is built rather than passed at every call site, because the call sites
 * are the paint functions and the thing being shown is whatever they happen to hold.
 */
const displays = new WeakMap();

/** Build-time: this element is a `grid`, or a `flex` column, or whatever it is. */
function displayAs(el, display) {
  displays.set(el, display);
  el.style.display = display;
  return el;
}

/**
 * Show or hide an element, both ways. `hidden` is a UA rule at the lowest priority there
 * is, so an inline display beats it outright and the element stays on screen; setting only
 * the display would leave it in the accessibility tree instead.
 *
 * An element this addon did not lay out comes back with no inline display at all, rather
 * than with a `flex` that only suits the ones it did: a kit bar shown as a flex line draws
 * its detail beside its figure instead of under it, and neither raises anything.
 */
function setShown(el, shown) {
  el.hidden = !shown;
  if (!shown) {
    el.style.display = 'none';
    return;
  }
  const display = displays.get(el);
  if (display === undefined) {
    el.style.removeProperty('display');
    return;
  }
  el.style.display = display;
}

/**
 * A flex child that takes what is left of its parent and may shrink to nothing.
 * `min-height: 0` is the half that is easy to leave out: a flex item's floor is its content,
 * so without it a list of forty rows refuses to shrink and pushes the frame open.
 */
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

/** A sentence the pane says on its own line. See the header on what stays one. */
function line(parent, role) {
  const el = document.createElement('div');
  el.className = 'woc-satchel-line';
  el.dataset.role = role;
  el.style.lineHeight = '1.35';
  // A size of its own, at the strip's rather than the frame's. A sentence beside a row of
  // chips is read as part of the same footer, and at the frame's own size it towers over
  // them: the strip's figures then read as a caption on the sentence.
  el.style.fontSize = '12px';
  fixed(el);
  parent.appendChild(el);
  return el;
}

/**
 * A sentence sitting in a strip rather than under one. It has to give way, which is the
 * opposite of what every other line does: a flex item is as wide as its longest line by
 * default, so an age line in a narrow frame would push the strip wider than the panel.
 * `min-width: 0` is what actually lets it wrap.
 */
function wrapping(el) {
  el.style.flexShrink = '1';
  el.style.minWidth = '0';
  return el;
}

function say(el, said) {
  setShown(el, said !== '');
  el.textContent = said;
}

/**
 * A kit field laid on one line, at the size the rest of this panel is drawn at. `ui.field`
 * stacks its label over a control with a 40px floor, which is right for a settings pane and
 * is 120 pixels of chrome over a list here. The floor is given up deliberately, the same
 * trade `density: 'compact'` makes, and only for these two: they are read at a glance and
 * operated once.
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
    control.style.minHeight = '24px';
    control.style.fontSize = '13px';
    control.style.padding = '2px 6px';
  }
  return fixed(row);
}

function column(className) {
  const el = document.createElement('div');
  el.className = className;
  el.style.flexDirection = 'column';
  el.style.gap = '3px';
  displayAs(el, 'flex');
  setShown(el, true);
  return el;
}

/**
 * The status strip: short labelled figures on one line, wrapping onto a second. Baseline
 * alignment rather than centre, because a label at 11px beside a figure at the frame's own
 * size is two different heights and centring them makes neither sit on the line the
 * sentence under it sits on.
 */
function strip(parent, role) {
  const el = document.createElement('div');
  el.className = 'woc-satchel-strip';
  el.dataset.role = role;
  el.style.flexWrap = 'wrap';
  el.style.alignItems = 'baseline';
  el.style.gap = '2px 10px';
  displayAs(el, 'flex');
  fixed(el);
  parent.appendChild(el);
  setShown(el, true);
  return el;
}

/**
 * One labelled figure, hidden until it has something to say. The label is drawn small and
 * quiet and the figure at the frame's own size, so the eye lands on four numbers rather
 * than on four sentences.
 */
function stat(parent, role, label) {
  const el = document.createElement('div');
  el.className = 'woc-satchel-stat';
  el.dataset.role = role;
  el.style.gap = '4px';
  el.style.alignItems = 'baseline';
  // A chip is a label and a figure that belong on one line, so it wraps as a WHOLE
  // onto the next row of the strip rather than breaking between the two.
  el.style.whiteSpace = 'nowrap';
  displayAs(el, 'flex');
  fixed(el);
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
  parent.appendChild(el);
  setShown(el, false);
  return { el, figure };
}

/** A figure, or nothing at all, which takes the whole chip off the strip. */
function setStat(chip, value) {
  setShown(chip.el, value !== '');
  chip.figure.textContent = value;
}

/**
 * A list of kit rows that is rebuilt from a reading rather than from events. `rows` is what
 * is already on screen, so a repaint reuses a row rather than replacing it: an element
 * removed and re-inserted loses whatever the browser was tracking on it, hover included.
 */
function group(name, tip) {
  const el = column('woc-satchel-list');
  el.dataset.list = name;
  return { el, rows: new Map(), tip };
}

/** Put a cell or a row where it belongs, and only when it is not there already. */
function place(list, el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}

function addRow(owner, key, icon) {
  const bar = woc.ui.bar({ icon, className: 'woc-satchel-row' });
  bar.el.dataset.row = key;
  // A list is a flex column, and a flex column shrinks its children to fit before it will
  // scroll: forty rows in a list half that tall are forty rows squashed to half a line each,
  // their text clipped by the bar's own `overflow: hidden`, with no scrollbar to say so.
  fixed(bar.el);
  woc.ui.tooltip(bar.el, () => owner.tip(key));
  owner.rows.set(key, bar);
  owner.el.appendChild(bar.el);
  return bar;
}

/** Sync one list to a reading: drop what has gone, build what is new, place the rest. */
function syncList(owner, entries) {
  const wanted = new Set(entries.map((entry) => entry.key));
  for (const [key, bar] of owner.rows) {
    if (!wanted.has(key)) {
      bar.destroy();
      owner.rows.delete(key);
    }
  }
  for (const [at, entry] of entries.entries()) {
    const bar = owner.rows.get(entry.key) ?? addRow(owner, entry.key, entry.icon);
    bar.update(entry.update);
    place(owner.el, bar.el, at);
  }
}

/**
 * One grid of cells: the element, the tiles in it, and the reading behind them. Two of
 * these, because a deposit box is cells too. `plan` and `view` are held rather than
 * recomputed on demand, because a tooltip is asked for its content when it is shown and it
 * has to describe the square the pointer is over rather than whatever the store holds by
 * the time the answer is composed.
 */
function createGrid(name) {
  const el = document.createElement('div');
  el.className = 'woc-satchel-grid';
  el.dataset.grid = name;
  displayAs(el, 'grid');
  // As many squares across as the frame is wide, decided by the browser on every resize. A
  // fixed track rather than `minmax(32px, 1fr)`: a stretched track would stretch the square
  // in it, and a bag cell that changes shape with the window is worse than a centred grid.
  el.style.gridTemplateColumns = `repeat(auto-fill, ${String(CELL_SIZE)}px)`;
  el.style.gap = `${String(CELL_GAP)}px`;
  el.style.justifyContent = 'center';
  el.style.alignContent = 'start';
  scrolls(el);
  return { el, cells: [], plan: [], view: emptyView() };
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
 * What each square of a store holds: one stack, or null for an empty cell. One planner for
 * both grids. The bags carry a placement hint per stack and the bank carries none, so the
 * bank flows into the front of its grid: honouring an absent hint and honouring none are
 * the same code.
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
 * The panel.
 *
 * Resizable, which a frame is not by default and which this one has to be: what it draws is
 * a grid whose useful width is however many squares the player wants across, and five lists
 * any of which can outrun a fixed height. Both size bounds are stated because a frame that
 * states neither takes the size it opened at as its floor. They are derived from the square
 * and a minimum count, and they are settled here for good: a bound cannot be restated after
 * the frame is built, so the floor has to stay true for the widest tab as well.
 */
const frame = woc.ui.frame({
  id: 'bags',
  title: FRAME_TITLE,
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'compact',
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
    setShown(pane, name === active);
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
 * A label per character, guaranteed unique. `ui.field.select` takes plain strings, which
 * are both the option and its value, so two characters of the same name on different realms
 * would collapse into one row. The key is opaque but unique, so the second of a pair
 * carries it.
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
 * Which character the detail panes are showing. Following the character in play is the
 * default and survives a switch, because a panel that stayed pointed at the character you
 * just logged out of would be answering a question nobody asked. A deliberate pick stops
 * following until the player picks the one in play again.
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
  setShown(pickerRow, DETAIL_PANES.has(tabs.active()) && options.length > 0);
  if (!sameLabels(options.map((option) => option.label))) {
    buildPicker(options);
    return;
  }
  picker.field?.set(currentLabel());
}

const capacityBar = woc.ui.bar({ label: 'Slots', className: 'woc-satchel-capacity' });

/**
 * The warning band, inside the capacity bar and behind its text. The fill is what is left,
 * the kit's sense everywhere, so it drains toward the left edge as the bags fill and the
 * band is drawn from that edge: the moment the fill has shrunk into the band is the moment
 * the warning is about.
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
 * Every item on the account, and every place a copy of it sits. The question the addon
 * exists to answer. Counts are summed here rather than counted as cells, which is the
 * opposite of what the capacity bar does and the opposite question: how many of a thing you
 * own is a total, and how much room it takes up is a cell budget.
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

/**
 * A row's places folded to one entry per character, in the order they were added. The row
 * itself is already one line for an item however many cells hold it; this is the same fold
 * one level up, so a character whose bags and bank both hold some reads as one name with
 * one figure.
 */
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
    text: `${spot.name}, ${spot.source}: ${String(spot.count)} in ${countedCells(spot.cells)}, read ${agoText(spot.at)}`,
  }));
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
  lines.push(...nameLines(itemId));
  lines.push({ text: 'Nothing here can move, mail or sell an item.', tone: 'muted' });
  return { title: nameOf(itemId), icon: woc.ui.icon.item(itemId), lines };
}

/**
 * What the pane says in sentences, which is only what a figure cannot say. The counts are on
 * the strip. What is left is the states where there is no count to draw, and the one
 * instruction: a capped list has to say that it is capped, or the fortieth row reads as the
 * last item on the account.
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
  syncList(
    itemsRows,
    shown.map((itemId) => itemEntry(itemId, most)),
  );
  setStat(shownStat, shownText(shown.length, order.length));
  setStat(heldStat, heldText(order));
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
    return `Merging them by hand would free ${countedCells(frees)}.`;
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
    lines.push(`${countedCells(held.cells)}, ${String(held.held)} held`);
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
 * What a cell says under the pointer. Read from the plan and the reading of the last paint
 * rather than from the store, so the answer describes the square the pointer is actually
 * over rather than whatever the store holds by the time the tooltip composes its lines.
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

/**
 * One square. A tile rather than a bar, and it is the whole reason the grid is a grid: a bar
 * is a name with a fill behind it and this panel has no names to put in one, while a tile is
 * art with a count in the corner, which is what a bag cell is.
 */
function createCell(grid, at) {
  const tile = woc.ui.tile({ className: 'woc-satchel-cell', size: CELL_SIZE });
  tile.el.dataset.cell = String(at);
  woc.ui.tooltip(tile.el, () => cellTip(grid, at));
  return tile;
}

/** Grow or shrink a grid to its store's capacity. Cells are never reordered. */
function sizeGrid(grid, total) {
  while (grid.cells.length > total) {
    const gone = grid.cells.pop();
    gone.destroy();
  }
  while (grid.cells.length < total) {
    const at = grid.cells.length;
    const tile = createCell(grid, at);
    grid.cells.push(tile);
    place(grid.el, tile.el, at);
  }
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
 * An empty cell. The label is unset rather than left alone, because a tile's accessible name
 * is otherwise only ever written and a cell reused from an occupied one would go on
 * announcing what used to be in it. `null` puts it back to unnamed, which hides the square
 * from assistive technology outright; an empty string says "this is called the empty
 * string" rather than "this has no name".
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
  grid.plan = plan;
  grid.view = view;
  sizeGrid(grid, plan.length);
  for (const [at, entry] of plan.entries()) {
    paintCell(grid.cells[at], entry, view);
  }
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

/** The sentences the figures used to be, for the hover. */
function markSentences(view) {
  const lines = [];
  if (view.split.size > 0) {
    lines.push(
      `${countedItems(view.split.size)} here ${isAre(view.split.size)} in more than one cell.`,
    );
    lines.push(freeLine(view.reclaim));
  }
  if (view.spare.size > 0) {
    lines.push(`${countedItems(view.spare.size)} here ${isAre(view.spare.size)} also equipped.`);
  }
  if (view.carried.size > 0) {
    lines.push(
      `${countedItems(view.carried.size)} here ${isAre(view.carried.size)} also in the bags.`,
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
  setShown(purse.el, false);
}

function paintBags() {
  const record = viewedRecord();
  const live = viewingSelf();
  setShown(capacityBar.el, record !== null);
  setShown(bagGrid.el, record !== null);
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
  setShown(purse.el, true);
  purse.update({ value: { copper: record.copper } });
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
  const lines = [`${countedCells(snap.bought)} bought and ${countedCells(snap.granted)} granted.`];
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
      text: `${text(source?.id)}: ${countedCells(numberOr(source?.slots, 0))}`,
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
 * Why a bank or a mailbox is not being refreshed right now. Never "it is empty", which is
 * the whole reason the loader publishes a status rather than a nullable reading: the server
 * sends nothing for a counter the player is not standing at. What is drawn in the meantime
 * is the last reading that was taken, so this is a note about freshness rather than an
 * excuse for a blank pane.
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
 * The deposit box, live or remembered. The grid is drawn from the last `near` reading
 * whatever the current status is, and that is the feature. What must never happen is the
 * reverse, an `away` status being recorded as an empty bank, and that is refused in
 * `syncLive` rather than here.
 */
function paintBank() {
  const record = viewedRecord();
  const snap = viewedSource('bank');
  const live = viewingSelf();
  const drawn = record !== null && snap.at > 0;
  setShown(bankBody, drawn);
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
}

function isNear(state) {
  return state.status === 'near';
}

/** Sentences joined with one space, skipping any that has nothing to say. */
function sentences(parts) {
  return parts.filter((part) => part !== '').join(' ');
}

/**
 * The badge: the one mail fact with no proximity gate on it at all. About the player rather
 * than about the selected character, which is why it is not taken from a record:
 * `world.mailUnread` streams everywhere, and a badge exists for the moment you are not at
 * the mailbox.
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
 * The unread count in the window title. A badge has to be readable with the Mail tab closed
 * and a tab strip is built once and cannot be relabelled, so the title is what is left, and
 * it is on screen whichever pane is open. Written only on a change, since `setTitle` on
 * every paint would rewrite the same string at snapshot rate.
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
    parts.push(countedItems(letter.items.length));
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
  setStat(attachmentsStat, drawnText(drawn, countedItems(snap.attachments)));
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
      `Postage is ${money(snap.postage)}, up to ${countedItems(snap.attachments)} a letter, ${String(snap.flight)}s in flight.`,
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
 * The mailbox, live or remembered. The count in the title comes from `world.mailUnread`,
 * which streams everywhere, and the letters from `world.mail`, which exists only at a
 * pillar. Neither is derived from the other: `mail.unread` counts the same letters and is
 * the pane's own figure, and reaching for it to draw a badge would give a badge that only
 * lights while the player is already looking at the box.
 */
function paintMail() {
  const record = viewedRecord();
  const snap = viewedSource('mail');
  const live = viewingSelf();
  const drawn = record !== null && snap.at > 0;
  syncList(
    mailRows,
    snap.letters.map((letter) => mailEntry(letter)),
  );
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
 * Every character added up, which is the one question a list of them cannot answer.
 *
 * The bags only, and the tooltip says so. Bags are recorded every time a character is
 * played; a bank is recorded only if that character walked up to one, so a slot total that
 * included them would jump the first time somebody visited a banker. Money is the
 * account's, which is the figure a player with a bank mule is after.
 *
 * The ages behind these differ by days and nothing in a total can say so, which is why the
 * per-character rows keep their own stamps and the tooltip names the oldest of them.
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
  setShown(rosterStrip, sums.characters > 0);
  setShown(accountBar.el, sums.characters > 0);
  accountBar.update({ value: { copper: sums.copper } });
  setStat(rosterCountStat, String(sums.characters));
  setStat(rosterSlotsStat, `${String(sums.used)} / ${String(sums.total)}`);
  setStat(rosterFreeStat, String(Math.max(0, sums.total - sums.used)));
}

function paintRoster() {
  const here = characterKey();
  syncList(
    rosterRows,
    characterOrder().map((record) => rosterEntry(record, here)),
  );
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
 * One repaint per frame, however many things asked for one. A publisher catching this addon
 * up answers the ask with a message per id, and a repaint per message would be a hundred
 * rebuilds of the same index inside one frame.
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

/**
 * Say something once when the bags get tight, and re-arm when they do not. On the crossing
 * rather than on the state, or every loot while full would chime. Read from the live bags
 * whichever character the panes happen to be showing: a warning is about the player.
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
    if (settingFlag('warn-cue', true)) {
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

// Subscriptions first, then the ask, because delivery is SYNCHRONOUS: a publisher
// that answers inside this emit call reaches a handler that already exists, and one
// registered afterwards would miss its own answer.
woc.bus.on(woc.bus.anySender, ITEM_TOPIC, onItem);
woc.bus.on(woc.bus.anySender, ITEMS_TOPIC, onItems);
woc.bus.emit(ASK_TOPIC);

woc.keys.bind('toggle', () => {
  frame.toggle();
});

woc.onSettingsChange(() => {
  if (!remembering()) {
    dropStored();
  }
  // A new threshold is a new question, so the warning gets to fire again.
  warned.on = false;
  draw();
});

/**
 * Read the item art manifest once, then repaint. Both art answers are provisional until it
 * lands: `ui.icon.item` hands back a hopeful URL and `ui.icon.itemArtName` hands back null,
 * so the first grid of a session is drawn with optimistic pictures and no names. One request
 * covers every item in the game. It never rejects, and nothing waits for it.
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
