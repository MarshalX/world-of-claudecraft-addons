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
// THE LOCK IS THE ONE THING IN A BAG THE PLAYER SET, and it is recorded for the same reason the
// bags are: you cannot log in as somebody else to check whether the stack you are about to
// salvage is the one they protected. Your own bags and your own bank are the only surfaces that
// can answer, because the server projects a payload down to its three public fields before it
// sends one anywhere else, so a parcel in the post is counted as unlocked and every line saying
// so says which stores it counted. Nothing here can toggle one: `net` is read-only.
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
// total says how many of its kinds it could price, and with nothing priced the chip is not drawn
// at all, since `0c` over a full bag is a claim rather than a silence. It is a VENDOR price, a
// floor rather than what the thing would fetch, and every sentence about one says so. A price is
// on the SQUARE as well as on the index row: the pane that draws the bag is the one a player has
// the pointer over when they ask what a stack is worth.
//
// A tier rides those records too, and the kit takes it as an axis: `quality` colours a bar's
// label and a tile's BORDER. So an item grid is bordered by tier, which is what makes one
// readable without reading a word, and the three marks this panel derives from ids alone moved
// off the border onto a corner pip, since the kit lets a TONE beat a tier and none of split,
// spare and carried is urgency. Tone on a square now means the one urgent thing a bag has.
//
// Three layout rules that only bite together. Hiding is `woc.ui.show`, a class rather than a
// display, so a grid comes back a grid. The frame is sized, its body told to fill it and its
// panes scroll, since a frame is content-sized unless it says otherwise and the loader fills
// only a WINDOW's body. And a row in a scrolling list must not shrink, or forty rows in a list
// half that tall are squashed with their text clipped and no scrollbar to say so.
//
// EVERY figure in a pane is a short labelled chip on one wrapping line, and the two grid panes
// used to spend a whole `ui.bar` row each on the capacity and another on the worth. Both were
// restatements: a free cell is a dashed square in the grid below and countable, and the worth of
// a bag of ore is a vendor floor nobody acts on. That was 74px of a 460px frame, a row and a half
// of the grid the pane exists to draw. The one row that stays is the purse, because money is the
// one figure the kit DRAWS rather than spells.
//
// What is NOT a chip is the panel's honesty rather than its arithmetic: how old a reading is, and
// that it is the last one rather than a live one, stay on screen as sentences.
//
// The one thing a chip cannot carry is a TONE, since a chip is two spans this file builds and
// only a kit widget can be told one. So the free-slot warning is carried twice: as a colour on
// the figure, which is always on screen, and as the kit's own tone on the empty squares, which
// are what the player is looking at when they wonder whether the next thing will fit.

/** The backpack, the socket count and the ceiling, for the sentence that explains pooling. */
const BACKPACK_SLOTS = 16;
const BAG_SOCKETS = 4;
const MAX_SLOTS = 72;

/**
 * The square, and the floor a resize may take the grid to. No column count: the grid is a
 * wrapping track list, so the browser refits it. The floor is stated because a frame's bounds
 * are settled when it is built, and a grid two squares across is a list drawn the hard way.
 *
 * The square is the loader's, which is the game's: a bag drawn beside the game's own bags
 * should be the same size as them, and the figure this panel had picked for itself was a
 * third smaller, which also put every cell under the tap target a phone needs. The gap is
 * the game's 4 to go with it.
 */
const CELL_SIZE = woc.ui.itemCell;
const CELL_GAP = 4;
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

/**
 * Eight squares across, which is what the width is FOR: a 16 slot backpack is then exactly two
 * rows and a full 72 exactly nine, so no bag ever ends on a part-filled row. The five tabs fit
 * on one line inside it with room to spare, measured at 279px of the 364 the padding leaves.
 */
const FRAME_WIDTH = 380;
/** Five rows of squares under the chrome: the whole backpack, and 40 of the 72 a player holds. */
const FRAME_HEIGHT = 460;
/** Carried twice by the width. It belongs to `.woc-addon-frame` rather than to a density. */
const FRAME_PADDING = 8;
/**
 * Everything that is not the scrolling pane, measured in a browser at 189px on the Bags tab: a
 * 31px title, 39px of tabs, a 28px selector, a 16px strip and the 24px purse, plus the body's
 * own gaps. A floor is settled when the frame is built, before there is a layout to measure,
 * and nothing under Vitest can check it.
 *
 * It was 230 while the capacity and the worth were `ui.bar` rows of their own. Both are chips
 * on the strip now, which is where every other figure in this panel already was, and the 41px
 * is two thirds of another row of the grid.
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
 * A stamp answers when this was last READ rather than when it last changed, so a player who
 * stood at their bank a minute ago is not told the reading is an hour old. Writing every paint
 * would be a storage write at snapshot rate.
 */
const STAMP_REFRESH_MS = MINUTE_MS;

/** One key per character per deployment; the rest is `characterKey()`. */
const CHARACTER_PREFIX = 'char/';

/** The three stores a character has, in the order every display lists them. */
const SOURCES = ['bags', 'bank', 'mail'];

/**
 * The orders this pane can be read in, and every one of them exists because a question does.
 *
 * Name was the only one for a long time and the pane was defended on the grounds that the
 * question is "where is my X". That is true of the DEFAULT and it was never true of the cap:
 * `MAX_ITEM_ROWS` truncates whatever order it is given, so on a large account an alphabetical
 * list showed A through G and asked the player to narrow it. A cap over a sorted list is a
 * top-40 and a real answer; a cap over an alphabetical one is an arbitrary slice.
 *
 * Nothing sorts by id, which is the one order no player thinks in.
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
 * The SECOND protocol, in the same two shapes: what a thing goes for on the Merchant's counter.
 *
 * A separate topic rather than a field on an `item` record, and the separation is the point. A
 * record here is replaced wholesale by id, so a second publisher on `item` would overwrite the
 * name and the tier the catalogue publisher owns. They are also different kinds of fact: a sell
 * value is a catalogue constant, the same on every realm forever, while this is a dated
 * observation with a realm and an evidence count behind it, and nothing drawn from one may look
 * like the other.
 */
const PRICE_TOPIC = 'price';
const PRICES_TOPIC = 'prices';

/** The older ask topic, sent beside the one `follow` derives. Drop next release. */
const LEGACY_ASK_TOPIC = 'item:ask';

/**
 * The kit's own `warn` and `danger`, transcribed because a chip is not a kit widget and only a
 * kit widget can be told a tone. A figure on the strip is two spans this file builds, so there
 * is nothing to hand a tone to and no way to reach the rule that would colour one.
 *
 * The alternative was to keep a whole `ui.bar` row for the free-slot figure purely to inherit
 * its tone, which is 37px of panel for a colour. Four other addons already carry these two
 * values for the same reason.
 */
const WARN_COLOR = 'rgb(200 168 56)';
const DANGER_COLOR = 'rgb(255 143 133)';

/**
 * The kit's own six tiers. A publisher's `quality` is another addon's string, and the kit
 * colours nothing for a value outside this set, so anything else is passed as null rather than
 * handed over to be ignored: the two are the same picture and only one of them is a decision.
 */
const QUALITY_TIERS = new Set(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary']);

/**
 * The mark that used to be the cell's border colour.
 *
 * `tone` and `quality` compete for a tile's border and the kit is explicit that tone wins,
 * because tone is urgency. Split across cells, worn as well, carried as well: none of those is
 * urgent, and spending the border on them meant an item grid could never show a tier. So the
 * mark is a corner pip, opposite the padlock and clear of the stack count, and the border is
 * the tier's. Tone on a cell now means the ONE urgent thing a bag has: running out of room.
 */
const MARK_COLOR = 'rgb(200 168 56)';
const MARK_PX = 5;

/**
 * What tells an occupied cell from an empty one WITHOUT the art, which is often missing, and
 * without a count, which a stack of one does not draw. Never `borderColor`: that is the tone's,
 * and an inline write would beat the class that sets it.
 */
/**
 * The lock mark, DRAWN rather than typed.
 *
 * A padlock as a character is either an emoji, which is not a thing to put in a grid of painted
 * art, or a symbol half the fonts in the world do not carry; the loader's own close mark is a
 * path for the same reason. Bottom-left, where the game paints its own, which keeps it clear of
 * the stack count in the opposite corner. Shape first and colour second: the amber is the game's
 * own lock tint, and a reader who cannot separate it from the border still sees a padlock.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCK_PATH =
  'M4 7V5a3 3 0 0 1 6 0v2h.4A1.6 1.6 0 0 1 12 8.6v3.8A1.6 1.6 0 0 1 10.4 14H3.6A1.6 1.6 0 0 1 2 12.4V8.6A1.6 1.6 0 0 1 3.6 7H4Zm1.6 0h2.8V5a1.4 1.4 0 0 0-2.8 0v2Z';
const LOCK_COLOR = 'rgb(224 162 74)';
const LOCK_PX = 11;

const OCCUPIED_FILL = 'rgb(255 255 255 / 7%)';
const EMPTY_FILL = 'transparent';
const OCCUPIED_EDGE = 'solid';
const EMPTY_EDGE = 'dashed';
const OCCUPIED_OPACITY = '1';
const EMPTY_OPACITY = '0.4';
/**
 * An empty cell is drawn faint so a full grid reads as full, and 0.4 takes the tone's border
 * colour down with it, which is the one case where the faintness is working against the point.
 */
const LAST_OPACITY = '0.85';

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
/** Item id to the market figure somebody published, plus who published it. See `parsePrice`. */
const prices = new Map();
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
/**
 * What the Items pane is asking for. The search was the whole of it, which meant the pane could
 * answer "where is my X" and nothing else about an inventory it had pooled.
 *
 * `who` is a character key or the empty string for everybody. It filters the PLACES under a row
 * rather than the rows, since a player asking about Sena means Sena's copies and Sena's worth
 * rather than every row Sena happens to hold one of.
 */
const filters = { sort: 'name', who: '' };

/** The index behind the rows on screen, so a tooltip describes the row it is over. */
const found = {
  index: new Map(),
  /** The index as the filter sees it, which is the same object while nothing is filtered. */
  view: new Map(),
  worth: { copper: 0, priced: 0, kinds: 0 },
};
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
 * Whether the player has locked this specific copy, which only their OWN bags and bank can say.
 *
 * A locked copy refuses salvage, a craft's reagent draw and a vendor sale until it is unlocked
 * again, and it is a gesture the player makes in the game's own bag window. This addon reports
 * it and can never perform it: `net` is read-only and there is no send surface at all.
 *
 * Read off the entry rather than the wire's payload, so a stored cell and a live one answer the
 * same way. A mail attachment cannot carry it: the server projects a letter's payload down to
 * its three public fields before it sends one, so the flag is not absent there, it is
 * unreachable, and a cell recorded from mail is honestly unlocked-as-far-as-anyone-knows.
 */
function isLocked(entry) {
  return entry?.locked === true;
}

/** How many of a cell's units are protected: all of them, or none. A cell is locked whole. */
function lockedUnits(entry, count) {
  if (isLocked(entry)) {
    return count;
  }
  return 0;
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
 * Null for an id with no file, for art out of a generated batch, and until the manifest lands.
 *
 * The batch case is almost all of them now: game 0.36.0 moved the catalogue into unnamed
 * generated batches and left 39 curated entries carrying a name, so this answers for a handful
 * of reagents and bags and nothing else. The picture is unaffected, since a batch id has a file.
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
 * What somebody published this item GOES FOR, on the market a given character plays.
 *
 * The realm test is the whole reason a price record carries one. This panel pools stock across
 * every character on the account, and the ledger publishing prices is a history of ONE market:
 * an alt's forty ore sitting on another realm are worth what that realm pays, which nothing here
 * knows. So the answer is null for them rather than the wrong figure, and every total says how
 * many kinds it had to leave out.
 */
function marketOf(itemId, realm) {
  const said = prices.get(itemId) ?? null;
  if (said === null || said.realm !== realm) {
    return null;
  }
  return said;
}

/** The realm a recorded character's things are sitting on, or '' for a record from before it. */
function realmOf(key) {
  return records.get(key)?.realm ?? '';
}

/** The realm of whoever the three per-character panes are pointed at. */
function viewedRealm() {
  return viewedRecord()?.realm ?? '';
}

/**
 * The COUNT is as load-bearing as the figure: a total drawn from two kinds out of nine is a real
 * answer that looks exactly like a complete one, so everywhere that draws one draws both.
 *
 * TWO totals rather than one, because there are two sources and they answer different questions:
 * a vendor floor is what an item is certainly worth and a market median is what it would
 * probably fetch, and the gap between them is most of the reason anybody looks. Each carries its
 * own `priced` count, since the two sources cover different sets of the same bag.
 *
 * `thin` counts the kinds whose market figure rests on a SINGLE reading, which is one stranger's
 * asking price on one day. It is in the total and it is disclosed, rather than being silently
 * dropped or silently folded in.
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
 * Off the index the Items pane built this frame, which `draw` paints first.
 *
 * One entry per item per REALM rather than per item, since a row pools copies from characters
 * who may be on different markets and only some of them are ones a published price applies to.
 * The vendor side double-counts nothing by it: `kinds` is what the count of priced kinds is
 * measured against, and an item split across two realms genuinely is two answers here.
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

/**
 * The whole ACCOUNT, from the unfiltered index. The roster's own total reads this on the same
 * paint the Items pane draws, so it must never follow the Items pane's filter: the two would
 * agree on screen and one of them would be lying.
 */
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
 * One market figure, checked. `id`, `realm`, `unit` and `at` are required and everything else
 * reads as absent, which is the same contract `parseItem` applies to the other protocol.
 *
 * The REALM is required rather than optional, and a row without one is refused rather than
 * accepted as applying everywhere. This panel pools stock across every character on the account
 * and they are not all on one market; a figure with no realm could only be spent by pretending
 * they were.
 *
 * It is refused HERE and nowhere else, which is what keeps `marketOf` a single comparison: a
 * character recorded before this addon wrote realms down has a blank one, and the two blanks
 * would otherwise match each other.
 */
function parsePrice(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const itemId = text(payload.id);
  const realm = text(payload.realm);
  const unit = positive(payload.unit);
  const at = positive(payload.at);
  // `positive` answers 0 for anything that is not a number above zero, which is what an absent
  // field and a nonsense one both read as. A price of nothing is not a price.
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
    // One visit is one stranger's asking price. Defaulted to one rather than to zero, since a
    // publisher that omits it has still seen the thing at least once.
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

/** The batch, with the same `Array.isArray` guard and for the same reason `onItems` has one. */
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
 * The wire's shape and the stored shape are the same on purpose, so the live and stored paths
 * share every reader below. The placement hint rides along, which is what draws an alt's bags
 * the way that alt arranged them.
 *
 * The lock is the ONE place the two spellings differ, and both are read here. The wire nests it
 * under the copy's payload, where the rest of that payload is signer, enchant and rolled stats
 * this addon has no use for; storing the payload to keep one boolean would put an object per
 * cell into a store that holds every character's bags, so it is written flat. Reading both is
 * what lets a record saved by any version read back the same way.
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
  // APPENDED, and written only when it is true, so a record saved before locks existed reads
  // with no migration pass and an unlocked cell costs no bytes.
  if (value?.instance?.locked === true || value?.locked === true) {
    stack.locked = true;
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
    // The class id and the level, which turn a list of three names into a roster. Both ride the
    // player entity and neither was being written down, so the pane that exists to say who you
    // have could only say what they were called. Empty and zero are what a record written by an
    // older version reads as, and both are drawn as nothing rather than as a guess.
    templateId: '',
    level: 0,
    /**
     * Which market this character's things are sitting on, which is what makes a published
     * market price applicable to them or not.
     *
     * Recorded rather than derived, because `world.characterKey` is documented OPAQUE and a
     * second addon parsing it is a second addon that breaks when the derivation changes. Read
     * off `net.state`, which is safe HERE for the reason it would not be at start-up: nothing
     * is written until `characterKey` is non-empty, so world entry has already happened and
     * the hello frame landed long before it.
     */
    realm: '',
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
 * `{ cells, held, locked }` per item, recording the largest stack seen on the way past: a reading
 * of a store is the only chance to observe a stack size, and every store goes through here.
 *
 * `locked` counts UNITS rather than cells, so it is comparable with `held` on the same row: a
 * player asking how much of something is protected means copies, and one locked cell can hold
 * twenty of them. A locked copy never merges into another stack, which is what keeps the two
 * figures from double-counting a cell.
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
  // Kept on a blank for the reason the name is: a frame that has not carried these yet must
  // not delete what the last one did. A level never goes down and a class never changes.
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
  return { el, name, figure };
}

/**
 * The chip's own word, which changes with what the figure MEANS: a worth chip drawing a vendor
 * floor and one drawing a market median are two different answers and must not share a label.
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

/**
 * Urgency on a chip, which the kit cannot be asked for. The attribute rides beside the colour
 * so a suite reads the DECISION rather than a transcribed rgb string.
 */
function setStatTone(chip, tone) {
  chip.el.dataset.tone = tone;
  chip.figure.style.color = CHIP_TONES.get(tone) ?? '';
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
  // A FIXED track rather than the game's own `minmax(42px, 1fr)`: a stretched track stretches
  // the square in it, and a bag cell that changes size with the window is worse than a
  // centred grid. The square itself is the game's, which is what `ui.itemCell` carries.
  el.style.gridTemplateColumns = `repeat(auto-fill, ${String(CELL_SIZE)}px)`;
  el.style.gap = `${String(CELL_GAP)}px`;
  el.style.justifyContent = 'center';
  el.style.alignContent = 'start';
  scrolls(el);
  const grid = { el, plan: [], view: emptyView(), last: 'default' };
  // Keyed on the SLOT, which is the one place a position is the identity rather than an
  // accident of order: cell 5 is cell 5 for as long as the store has one, and what changes is
  // what is in it. So a store that grows builds the squares it gained and one that shrinks
  // destroys the squares it lost, and nothing in between is rebuilt.
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

/**
 * ONE character is not a choice, and a select offering it is a labelled row saying what the
 * pane's own age line already says. It comes back the moment a second character is recorded.
 */
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
const mailPane = panes.get('mail');
const rosterPane = panes.get('roster');

const bagGrid = createGrid('bags');
const bankGrid = createGrid('bank');

/**
 * Three controls on ONE wrapping line, which is lorebind's `findStrip` down to the flex
 * values: a list of items with a search, a sort and a filter over it is a shape this project
 * has already settled, and a second idiom for it would be a second thing to learn.
 */
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
// THE WHOLE FIRST LINE. All three controls on one line needs about 485px of a pane that has
// 364, so the strip wraps whatever it is told; what it is told decides whether that reads as a
// layout or as an accident. Left to find its own width the search took most of line one and
// pushed one dropdown onto a line of its own beside a hand's width of nothing.
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

/**
 * Whose things to count, rebuilt only when the roster changes, for the reason the Bags
 * selector is: a control replaced while the player is using it loses focus mid-interaction.
 */
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

/**
 * ONE character is not a choice, exactly as on the Bags selector: the control offers `Everyone`
 * and the one person that means, which is a question with one answer.
 */
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
  // Reset rather than left pointing at a character who has stopped being recorded, which is
  // what `Forget other characters` does to whoever is selected here.
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

// EVERY scalar in this panel is a chip on a strip, and the two grid panes used to spend a
// whole `ui.bar` row each on capacity and another on worth. Both were figures the pane
// already carried: a free cell is a dashed square in the grid below, countable, and the
// worth of a bag full of ore is a vendor floor nobody acts on. That is 74px of a 460px
// frame, which is a row and a half of the grid the pane exists to draw, spent on a
// restatement. The Items pane had it right first.
//
// A grid pane puts its readout above the grid, which every list pane does the opposite of,
// and the difference is what the growing element is. A list fills its pane, so a strip after
// it is a footer against the bottom edge. A grid is only as tall as the stacks in it, so a
// strip after one floats in the middle of a panel.
//
// The age sits IN the strip rather than above it, so a pane at a comfortable width
// reads as one line: what the reading is, then what is in it.
const bagsStrip = strip(bagsPane, 'bags-strip');
const bagsAgeLine = wrapping(line(bagsStrip, 'bags-age'));
const slotsStat = stat(bagsStrip, 'slots', 'Slots');
// The same pair of words the Roster strip uses for the same pair of figures.
const freeStat = stat(bagsStrip, 'free', 'Free');
const marksStat = stat(bagsStrip, 'marks', 'Marked');
const socketsStat = stat(bagsStrip, 'sockets', 'Sockets');
const bagsWorthStat = stat(bagsStrip, 'bags-worth', 'Worth');
// The purse is the ONE kit ROW that stays, because money is the one figure here the kit
// draws rather than spells: a `{ copper }` value comes back as the game's own coins, and a
// chip takes text. It is also the figure a player scans for.
const purse = woc.ui.bar({ label: 'Carrying', className: 'woc-satchel-purse' });
purse.el.dataset.role = 'purse';
fixed(purse.el);
bagsPane.appendChild(purse.el);
bagsPane.appendChild(bagGrid.el);
const recentLine = line(bagsPane, 'recent');
const bagsNote = line(bagsPane, 'bags-note');

const bankBody = fills(column('woc-satchel-bank'));
// Inside the body rather than beside it, so the strip is hidden with the grid it
// describes: an age and a slot budget for a bank nobody has ever stood at are figures
// about nothing. Above the grid, for the reason the bags strip is.
const bankStrip = strip(bankBody, 'bank-strip');
const bankAgeLine = wrapping(line(bankStrip, 'bank-age'));
const bankSlotsStat = stat(bankStrip, 'bank-slots', 'Slots');
const bankFreeStat = stat(bankStrip, 'bank-free', 'Free');
const bankMarksStat = stat(bankStrip, 'bank-marks', 'Marked');
// `Slots` above is how many there are; this is what buying more of them costs, which used
// to be called Slots as well while the capacity was a bar and the two never met on a line.
const bankTermsStat = stat(bankStrip, 'bank-terms', 'Expansion');
const bankWorthStat = stat(bankStrip, 'bank-worth', 'Worth');
// A CHIP rather than the kit row the Bags pane draws, and the difference in weight is the
// point. On Bags the purse is the headline: what is this character carrying. Here it is
// context for a store that holds no money at all, and the pane that needs it most is an ALT's
// bank, where the coin figure was three tabs away in the roster.
const bankPurseStat = stat(bankStrip, 'bank-purse', 'Carrying');
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
/**
 * MONEY IN THE POST, which nothing has ever counted.
 *
 * A letter carries copper, this addon has always parsed it and drawn it per letter as part of
 * `Attached:`, and no total anywhere added it up. So an account with sale proceeds waiting at
 * a mailbox was under-reported by the panel's own headline figure, using a number it was
 * already holding. It is a store like the other two, and it is the only one that holds coin.
 */
const postStat = stat(mailStrip, 'mail-post', 'In the post');
const mailPurseStat = stat(mailStrip, 'mail-purse', 'Carrying');

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
const accountWorthStat = stat(rosterStrip, 'account-worth', 'Worth');
/**
 * BESIDE the account's coin rather than added into it, which is the whole of the decision.
 *
 * The bar above says `Every character` and draws the sum of their purses, and a letter's
 * attachment is not carried by anybody: folding it in would make that figure say something it
 * does not mean. Left out entirely it was worse, because the panel then had the number,
 * printed it per letter, and let the account headline read low. So it is its own chip, named
 * for where it is, and the bar's tooltip points at it.
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
 * ONE CLICK USED TO DO THIS, on a tab a player opens to look at their alts.
 *
 * There is no undo and there is no second copy: earning a row back means logging in as that
 * character, and earning its bank back means walking them to a banker. The message counts what
 * is about to go, because "other characters" is the one thing the player cannot see from the
 * button, and a dismissal resolves to the cancel id or to null.
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
    const row = index.get(itemId) ?? { total: 0, locked: 0, places: [] };
    row.total += counts.held;
    row.locked += counts.locked;
    row.places.push({
      key: record.key,
      name: displayName(record),
      source,
      count: counts.held,
      cells: counts.cells,
      locked: counts.locked,
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

/**
 * The rows as the FILTER sees them, which is not always what the account holds.
 *
 * A character filter cannot narrow the index in place, and the reason is one line away: the
 * roster's own account total reads `found.index` on the same paint, so an index filtered for
 * this pane would silently make the roster report one character's worth as the account's. The
 * full index stays the source of truth and this derives a view over it.
 *
 * A row with no place left under the filter is dropped, which is what makes the character
 * filter narrow the LIST as well as the figures on it.
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

/** How many cells a row is spending, which is the question the Bags tab makes a player ask. */
function cellsOf(row) {
  return row.places.reduce((sum, spot) => sum + spot.cells, 0);
}

/** When the newest reading behind a row was taken, which is how old its figures are. */
function seenAt(row) {
  return row.places.reduce((newest, spot) => Math.max(newest, spot.at), 0);
}

/**
 * What a row is worth, in the SAME source the pane's own total is drawn in.
 *
 * Never a mixture. A market median and a vendor floor differ by a factor of tens, so a list
 * ordered on whichever each row happened to have would rank a browsed piece of junk over an
 * unbrowsed valuable and read as a ranking by worth. Where the pane is showing market figures
 * an unpriced row is worth nothing HERE and sinks, and its own second line says so, which is
 * the honest version and doubles as a list of what to go and look up.
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

/** Descending on every figure, since the question each one asks is "which are the biggest". */
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
 * Alphabetical by default, because the question is "where is my X" and not "what do I own most
 * of". Every other order is one the player picked, and the note under the list says which.
 */
function itemOrder(rows, needle, marketing) {
  const ids = [...rows.keys()].filter((itemId) => matches(itemId, needle));
  // Named first whatever the order, so ties inside a sort are stable and readable rather than
  // being whichever character storage happened to be read in.
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
 * Who holds a row's copies, named to a limit and counted after it.
 *
 * ON A ONE-CHARACTER ACCOUNT it names the STORES instead. There is only one name to give, so
 * every row of the pane reads `Marshal 9` under a figure that already says 9, forty times over,
 * and the useful half of the answer, which of the three stores it is in, is the half the line
 * was spending its width not saying.
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
 * The row's second line, which FOLLOWS THE SORT.
 *
 * A list ordered by worth whose rows say `Marshal 87, Bruk 54` is a list that has been
 * reshuffled rather than sorted: the figure the order was taken on is the one thing not on
 * screen, so the player has to trust the ranking instead of reading it. Under name and copies
 * the places text is already the right answer, since the figure being ranked is the one drawn
 * at the end of the row.
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
 * One aggregated row: an item, every copy of it on the account, and where they are. `most`
 * is the largest total on screen, so the fill reads as a share of the biggest pile rather
 * than as a timer, which is what turns a list of figures into something a player can scan.
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
      // The tier colours the NAME here rather than a border, which is what the kit does with
      // it on a bar. It is also what tells this row's fill from a selection: a list where
      // every name is the panel's own text and some rows carry a wash reads as a list with
      // rows selected in it, and a list of tier-coloured names reads as items.
      quality: qualityOf(itemId),
      tone: 'default',
    },
  };
}

/**
 * One line per place: whose it is, which store, how many, in how many cells, how old. The
 * hint the whole pane exists to give, and the reason a row can afford to be one line.
 */
/** The clause a place adds when some of its copies are protected, and nothing when none are. */
function lockedClause(locked) {
  if (locked > 0) {
    return `, ${String(locked)} locked`;
  }
  return '';
}

function placeLines(places) {
  return places.map((spot) => ({
    text:
      `${spot.name}, ${spot.source}: ${String(spot.count)} in ${woc.fmt.count(spot.cells, 'cell')}` +
      `${lockedClause(spot.locked)}, read ${agoText(spot.at)}`,
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

/**
 * How old a market figure is and how much is behind it, which is the half a price cannot carry.
 *
 * Two ages are on screen at once and they answer different questions: the store's stamp says
 * when these bags were last read, and this says when the counter was. A reader who took one for
 * the other would think a week-old price was as fresh as a live bag.
 */
function evidenceText(said) {
  const trips = `${woc.fmt.count(said.visits, 'reading')}, newest ${agoText(said.at)}`;
  if (said.visits > 1) {
    return `${trips}.`;
  }
  return `${trips}. One reading is one seller's asking price on one day.`;
}

/** What was PAID, where the publisher has any, never folded into the figure above it. */
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

/**
 * What this item goes for, for a holding on ONE realm, and nothing at all where no publisher
 * has priced it there.
 *
 * The realm test is `marketOf`'s and it is not a formality: the ledger publishing these is a
 * history of one market, and an alt's stock on another realm is worth what that realm pays,
 * which nothing here knows. Silence rather than the wrong figure.
 */
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
 * How many copies the player has locked, and nothing at all when none are.
 *
 * Silent at zero on purpose: unlocked is the ordinary state of everything in a bag, so a line
 * saying so on every row of a forty-row pane is noise the interesting case has to compete with.
 * Mail is why it says which stores it counted: a letter's attachments arrive already trimmed of
 * the flag, so a copy sitting in the post is counted as unlocked whatever it was when it was
 * sent, and this line would otherwise read as a claim about every copy on the account.
 */
function lockedLine(row) {
  if (row.locked <= 0) {
    return '';
  }
  return `${String(row.locked)} of ${String(row.total)} locked against salvage, crafting and vendor sale. Mail cannot say, so a copy in the post is not counted.`;
}

/**
 * The copies of one row that sit on a market somebody has published prices for, and how many
 * are somewhere else.
 *
 * A row pools every character on the account and they are not all on one realm, so `row.total`
 * is the wrong multiplier for a market figure. Priced against the copies the figure applies to,
 * and the rest counted rather than quietly folded in.
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
  // The VIEW, so a row filtered to one character describes that character's copies rather
  // than the account's. The row on screen and the lines under the pointer are one answer.
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
 * Only what a figure cannot say, since the counts are on the strip: the states with no count to
 * draw, and the cap, or the fortieth row reads as the last item on the account.
 */
function itemsNoteText(shown, total) {
  if (records.size === 0) {
    return 'Nothing recorded yet. Log in on a character and their bags appear here.';
  }
  if (total === 0) {
    return emptyText();
  }
  if (shown < total) {
    // NAMES THE ORDER, because the cap is only an answer if it is a top of something. It used
    // to read `Narrow the search to see the rest`, which is what a list truncated
    // alphabetically can honestly say and is why the sort had to come first: the fortieth row
    // by name is an arbitrary place to stop, and the fortieth by worth is not.
    return `The first ${String(shown)} by ${sortLabel().toLowerCase()}. Search or pick a character for the rest.`;
  }
  return '';
}

/** Why the list is empty, which is a different sentence for each of the two ways it can be. */
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
 * What a row's FILL measures, which is whatever the list is ordered on.
 *
 * It measured copies whatever the order, which was fine while name was the only order and
 * became a lie the moment there were five: sorted by worth, a nearly worthless row could draw
 * the longest bar, and the eye reads a bar before it reads a figure. Now the bar, the second
 * line and the row order are one fact rather than three, so a sorted list descends and reads
 * as a distribution instead of as a scatter of highlights.
 *
 * `seen` gets NO fill. A share needs a zero point and an age has none: every stamp is a moment
 * since 1970, so every bar would draw at very nearly full width and say nothing. The second
 * line carries the age in the only form a person reads it in.
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
 * The largest of EVERYTHING THE FILTERS MATCHED, not of the forty rows drawn.
 *
 * The denominator used to be the largest drawn row, so the 40-row cap silently rescaled every
 * bar in the pane: the same item drew a different width depending on how many others happened
 * to be above it, with nothing on screen saying the scale had moved. It still moves with the
 * search and the character filter, and that is right, because the player did that and can see
 * what they did.
 */
function largestOf(order, marketing) {
  let most = 0;
  for (const itemId of order) {
    most = Math.max(most, fillValue(itemId, marketing));
  }
  return most;
}

/**
 * Whether the pane is drawing MARKET figures, which decides what a worth sort ranks on and what
 * a worth subline says. Read from the whole account rather than from the rows on screen, so a
 * search that happens to match only unpriced rows does not silently change what the order means.
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
  // Over everything the search matched rather than over the rows drawn, which is what the
  // count beside it does: a capped list says it is capped, and a total that quietly stopped at
  // the fortieth row would not.
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

function capacityTip() {
  return {
    title: 'Slots',
    lines: [
      `Pooled: ${String(BACKPACK_SLOTS)} in the backpack plus whatever your ${String(BAG_SOCKETS)} bag sockets add, up to ${String(MAX_SLOTS)}.`,
      { text: 'One cell is one stack, however much is in it.', tone: 'muted' },
      { text: 'Every free cell is a dashed square in the grid below.', tone: 'muted' },
      {
        text: 'Nothing here can sort, move or sell: the loader never sends a command.',
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(slotsStat.el, capacityTip);

/** What the colour on the free figure means, said in words for anyone who cannot see it. */
function freeTipFor(source) {
  const snap = viewedSource(source);
  const free = Math.max(0, snap.total - snap.used);
  return {
    title: 'Free',
    lines: [
      `${woc.fmt.count(free, 'cell')} with nothing in them.`,
      {
        text: `The figure turns at ${woc.fmt.count(threshold(), 'cell')} left, which is your own setting, and the last free squares in the grid turn with it.`,
        tone: 'muted',
      },
    ],
  };
}
woc.ui.tooltip(freeStat.el, () => freeTipFor('bags'));

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
 * Which of the two figures a chip is showing.
 *
 * MARKET WHERE THERE IS ONE. What a vendor pays is a floor and it is small: a whole bag of ore
 * comes to a few silver against a purse of a thousand gold, so as the only figure on the strip
 * it was a true fact nobody could act on. What the Merchant's counter goes for is the number a
 * player actually decides anything with. The vendor total does not go away, it moves to the
 * tooltip beside it, where being the CERTAIN one is worth stating.
 *
 * The chip's own LABEL changes with it, because a figure that quietly changes meaning is worse
 * than either figure alone.
 */
function marketFirst(sums) {
  return sums.marketPriced > 0;
}

/**
 * Drawn or taken off the strip entirely, never `0c`: with nobody publishing prices that is a
 * claim that everything here is worth nothing, where the honest answer is no answer.
 *
 * `pricedText` was a second line under the figure while this was a bar. It is on the tooltip
 * now, which is where every other qualification in this panel already lives, and the figure is
 * still refused outright rather than drawn unqualified when nothing has been priced.
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

/** The vendor total, kept beside the market one rather than replaced by it. See `marketFirst`. */
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

// Every store rather than the bags alone, which is the opposite of the slot total beside it,
// and the line says so: slots are bags only because a bank is recorded only for a visit to
// one, while a thing owned is owned wherever it was last seen.
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
 * What to say about names, without saying anything is wrong. Both silences are ordinary:
 * the game's art manifest names only its 39 curated entries and says nothing about the rest
 * of the catalogue, and the addon that would publish one may not be installed, may be
 * disabled, or may not have this id.
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

/**
 * What a vendor pays for this SQUARE, which is the question a player asks with the pointer over
 * one and the pane that could not answer it.
 *
 * The Items pane has carried a worth line per row since prices arrived on the bus and the grid
 * carried none, so the panel drawing the bag was the one that could not say what was in it. Two
 * figures rather than one, because the each is what compares two stacks and the total is what
 * decides whether this cell is worth the trip.
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
 * Both figures on one square, labelled, and never merged into one.
 *
 * The vendor line first because it is the CERTAIN one: a vendor pays that today whatever the
 * counter is doing. The market line under it is the one a player decides anything with, and it
 * says how old it is and how much is behind it. A number made of the two would be true of
 * neither, which is the same rule the addon publishing these prices holds itself to.
 */
function priceLines(itemId, count) {
  return [
    ...cellWorthLine(itemId, count),
    ...marketLines(itemId, viewedRealm(), count, 'this cell'),
  ];
}

function itemTip(view, entry) {
  const itemId = entryId(entry);
  const count = entryCount(entry);
  const lines = [`Item id: ${itemId}`, `${String(count)} in this cell`];
  lines.push(...nameLines(itemId));
  lines.push(...priceLines(itemId, count));
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

/** Whether this square carries one of the three marks. See `readStore`. */
function isMarked(itemId, view) {
  return view.split.has(itemId) || view.spare.has(itemId) || view.carried.has(itemId);
}

/**
 * The tier a publisher gave this id, or null for one nobody has placed.
 *
 * A square of art edged by its tier is what the game's own bag draws and what makes a grid of
 * them readable without reading a word, and the tier was arriving on the bus already and being
 * spent on one word in a tooltip. Refused for anything the kit does not know, since `quality`
 * is an enum and a publisher's string is another addon's idea of one.
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
 * The padlock on one cell, built once and then shown or hidden.
 *
 * Built lazily and kept, rather than added and removed per paint: a grid of 72 cells is
 * repainted on every world change, and a mark that is created and dropped each time is 72
 * allocations a frame to say nothing has moved. It is a child of the tile the kit handed over,
 * which is the same liberty this addon already takes with the cell's own border and fill.
 */
function lockMark(tile) {
  const held = tile.el.querySelector('[data-satchel-lock]');
  if (held !== null) {
    return held;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 14 16');
  svg.setAttribute('fill', 'currentColor');
  // Hidden from assistive technology on purpose: the cell's own accessible name carries the
  // locked fact, and a second announcement of it is one the reader has to sit through twice.
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

/** The pip, built and kept for the reason the padlock is. Top left, opposite the count. */
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
  // Silent, for the reason the padlock is: what it stands for is spelled out in the cell's
  // own tooltip, and a coloured dot has no name worth reading aloud.
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
 * The label is UNSET rather than left alone, or a cell reused from an occupied one announces the
 * item it last held. `null` is unnamed; an empty string is a name that is blank.
 *
 * `last` is whether this square is among the few the player has left, which is the only urgent
 * thing a bag can say and is therefore the only thing on a cell that gets a tone.
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
    // The lock rides the accessible name because a tile is announced as one image and there is
    // nowhere else on it for a second fact to go.
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
 * The warning lives HERE as well as on the strip, because the two say different halves of it.
 * The chip is always on screen and carries the figure; the squares are what the player is
 * actually looking at when they wonder whether the next thing they pick up will fit.
 *
 * Every free cell rather than the last few: with two left, two squares carrying the colour is
 * the whole answer, and picking out a subset of identical empty squares would say a particular
 * one of them is the last, which is not a thing a bag has.
 */
function emptyTone(free) {
  if (free <= 0) {
    return 'default';
  }
  return toneFor(free);
}

function paintGrid(grid, plan, view, free) {
  // Both are held before the sync rather than passed into it: `update` paints from `grid.view`
  // and a tooltip is asked for its content when the pointer lands, which is long after.
  grid.plan = plan;
  grid.view = view;
  grid.last = emptyTone(free);
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
  setStat(slotsStat, `${String(snap.used)} / ${String(snap.total)}`);
  setStat(freeStat, String(free));
  setStatTone(freeStat, toneFor(free));
}

/** `1 / 4`, with what is in each of them one hover away. See `socketTip`. */
function socketsText(snap) {
  const filled = snap.sockets.filter((itemId) => itemId !== '').length;
  const total = Math.max(snap.sockets.length, BAG_SOCKETS);
  return `${String(filled)} / ${String(total)}`;
}

/** Nobody is playing, or nobody has been here: no figures and one sentence. */
function clearBags() {
  paintGrid(bagGrid, [], emptyView(), MAX_SLOTS);
  say(bagsNote, noRecordText());
  say(bagsAgeLine, '');
  say(recentLine, '');
  for (const chip of [slotsStat, freeStat, marksStat, socketsStat, bagsWorthStat]) {
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
  paintGrid(bagGrid, cellPlan(snap), view, Math.max(0, snap.total - snap.used));
  say(bagsNote, '');
  say(bagsAgeLine, `${whoseText(record)}${ageText(snap, live)}`);
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
    paintGrid(bankGrid, [], emptyView(), MAX_SLOTS);
    say(bankAgeLine, '');
    for (const chip of [
      bankSlotsStat,
      bankFreeStat,
      bankMarksStat,
      bankTermsStat,
      bankPurseStat,
      bankWorthStat,
    ]) {
      setStat(chip, '');
    }
    return;
  }
  const free = Math.max(0, snap.total - snap.used);
  setStat(bankSlotsStat, `${String(snap.used)} / ${String(snap.total)}`);
  setStat(bankFreeStat, String(free));
  setStatTone(bankFreeStat, toneFor(free));
  const carried = new Set(stacksIn(record.sources.bags.stacks).keys());
  const view = readStore(snap.stacks, new Set(record.equipped), carried);
  paintGrid(bankGrid, cellPlan(snap), view, free);
  say(bankAgeLine, `${whoseText(record)}${ageText(snap, live && isNear(woc.world.bank))}`);
  setStat(bankMarksStat, marksText(view));
  setStat(bankTermsStat, expansionText(snap));
  setStat(bankPurseStat, purseText(record));
  paintWorth(bankWorthStat, worthOf(storeCounts(snap.stacks, record.realm)));
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
  // Hidden at zero rather than drawn as `0c`, which is what every other money figure here
  // does: a mailbox with no coin in it is the ordinary case and a nought is not news.
  setStat(postStat, postText(snap, drawn));
}

/** A figure only where there is one, since a mailbox holding no coin is the ordinary case. */
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

/** The same, over every character recorded, which is what the roster's own chip counts. */
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

/** `40 Warrior`, or as much of it as was recorded. Nothing at all for a record written before. */
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
    // Out of the tooltip, because it is the fact that says why a row's figures are what they
    // are: a bank total from four days ago is not a bank total anybody should act on.
    parts.push(`seen ${agoText(record.at)}`);
  }
  return parts.filter((part) => part !== '').join(', ');
}

/**
 * ONE meaning per bar: how full that character is. The fill is the share of their cells in
 * use and the tone is the same fact going amber and then red, so length and colour agree.
 *
 * It has been wrong twice and each mistake is worth keeping. First it was the share that was
 * FREE, which inverts on sight: the character with the emptier bags drew the longer bar, so a
 * roster read top to bottom said the reverse of what it meant. Then it was the share of the
 * account's COIN, which fixed the inversion by changing the QUANTITY rather than the direction,
 * and left one widget carrying two unrelated facts with a label for neither: a reader looking
 * straight at it could not say what it measured, which is the whole test a bar has to pass.
 *
 * The coin is not lost by this and was never served by it. It is DRAWN at the end of the same
 * row, exactly, in the game's own coins, which is the honest way to show a precise figure. A
 * proportional second copy of a number spelled out four inches away earns very little, and it
 * was costing the roster the one ranking it actually wants.
 */
function rosterEntry(record, here) {
  const snap = record.sources.bags;
  const free = Math.max(0, snap.total - snap.used);
  return {
    key: record.key,
    icon: null,
    update: {
      label: labelFor(record, here),
      value: { copper: record.copper },
      detail: rosterDetail(record, snap),
      fraction: fractionOf(snap.used, snap.total),
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
  const snap = record.sources.bags;
  // No "last seen" line: it moved onto the row itself, and a tooltip that repeats the line
  // under the pointer is one the reader has to check against the row to be sure it agrees.
  return {
    title: displayName(record),
    lines: [
      `Carrying ${money(record.copper)}`,
      // What the BAR is, spelled out, because a bar that has to be guessed at is one that
      // has already failed and this one has been guessed at wrongly twice.
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

/**
 * What is in the post, said in the tooltip on the figure it is NOT part of.
 *
 * The bar counts purses, a letter's attachment is carried by nobody, and a reader comparing
 * the two figures has to be told which is which rather than left to work it out.
 */
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
  const free = Math.max(0, sums.total - sums.used);
  setStat(rosterFreeStat, String(free));
  setStatTone(rosterFreeStat, toneFor(free));
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
// The second protocol, subscribed exactly like the first: `follow` for the batch, a plain
// subscription for the push, `anySender` on both. A price publisher and a name publisher are
// two different addons and either may be absent; silence from either is ordinary.
woc.bus.follow(PRICES_TOPIC, onPrices);
woc.bus.on(woc.bus.anySender, PRICE_TOPIC, onPrice);
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
