/// <reference types="@woc-addons/types" />

// Lorebind: the item browser, and the name service the rest of the catalogue reads.
//
// WHO OPENS THIS AND WHY. It is two things and they are not equally visible. The name service
// on the bus is what the rest of the catalogue needs and no player ever sees; the window is
// what a PLAYER opens, and the question they open it with is not "what is id X" but one of
// "what does this thing I am holding do for me", "what else is there at my level for this
// slot", and "how much of the game have I actually seen". So the window is a BROWSER of the
// game's 815 items rather than a lookup box: art in a grid, filtered by kind, by quality, by
// slot and by whether this character has ever laid eyes on it, with one item's full record
// under it: its armour or its damage, its stats, what it takes to equip it and what a vendor
// pays for it, in the game's own words and in the game's own order.
//
// Quality is drawn in the game's own six colours (`QUALITY_COLOR` in its `src/ui/icons.ts`,
// with the dimmer border table beside it), because that is the one thing a player reads an
// item list by, and a codex that spells "epic" in the same grey as "poor" is asking them to
// read where the game asks them to glance.
//
// An item id resolves to no name anywhere on this API and never will. The game's item
// table is 815 definitions bundled into the play entry chunk, referenced by no object the
// loader can reach. `world.equipment` hands over ids, `world.inventory` hands over ids,
// and a recipe's reagents are ids, so every panel in the catalogue that wants to say what
// an item is has the same problem. This is where it is solved once.
//
// The source ranking is the addon; everything else is a search box drawn around it.
// `resolve` is the only place that decides it, and it has three sources in this order:
//
//   1. The embedded table, `items.json`. It is the game's own item table reduced to what its
//      own tooltip draws, derived from the `ITEMS` merge at version 0.34.0, so for every id
//      it covers it is right by construction. A NAME is the part of it the bus publishes and
//      the part every other addon needs; everything else in the row is for the window.
//   2. A name off a loot roll. `LootRoll.itemName` and `LootRollGroupStatus.itemName` are
//      the same server-side table spelled out on the wire, so they are equal in authority
//      to the file, and rank second only because coverage arrives one drop at a time.
//   3. `ui.icon.itemArtName(id)`, a labelled fallback and never a name. The loader
//      documents it as provenance for the picture: it is the name the art file was filed
//      under, gated by the game only on being non-empty, and measured at game 0.33.0, 21
//      of its 303 named entries disagreed with what the game displays, because a content
//      rename rewrites the item table and touches the art manifest zero times.
//
// `ui.icon.item(id)` is read too, and it is not a fourth source: it names nothing. It
// answers whether the art manifest lists an id, which feeds the art count and decides whether
// a square draws a picture or two letters, and it is read one-directionally in both places. A null is not evidence an id
// is fake, since items ship before their art does.
//
// AN ITEM LEVEL IS DERIVED RATHER THAN DECLARED, and the file carries it anyway. Nothing on
// the wire has one and no ItemDef has one either: the game works it out from where the item
// DROPS, which is a second index over the whole of content. So `generate.mjs` calls the
// game's own `itemLevel` and `requiredLevelFor` rather than copying a rule that would be
// right on the day it was written, and 436 of the 815 rows come back with a level: the rest
// have no derivable source, which is a fact about vendor and starter stock rather than a gap.
// `Recipe.itemLevelBudget` is still not one, and the published type says so: it is the budget
// the output was balanced against.
//
// The numbers are only ever as fresh as the file. Nothing re-reads them at run time, so an
// item the game rebalanced after 0.34.0 reads here at its old stats until somebody regenerates
// and the diff shows it, which is the same bargain the name itself is under.
//
// Quality is trustworthy for two sources and no others. An id the table covers carries the
// game's own quality and a roll sends one beside the name; an id named from its art file
// carries no quality, kind or slot, because the art manifest holds none of the three, and
// such an item says "quality unknown" rather than picking a plausible default. The same goes
// for every other number in a row: they exist for a table id and for nothing else, so the
// record under the grid is a name and a source alone for an id learned from a roll.
//
// The bus is the product rather than the panel. `item` carries one record on every newly
// learned id and `items` carries a batch, both carrying
// `{ id, name, source }` plus `quality`, `kind`, `slot`, `sellValue`, `itemLevel` and
// `requiredLevel` where the table states them, with anything unknown left out rather than
// sent empty or as a zero. `item:ask` is answered with everything known, which is what
// lets an addon that started later catch up. `satchel` and `ledgerline` are the readers
// today. An art-sourced name is never put on the bus: publishing it would launder a guess
// into an answer a subscriber would rank above its own identical fallback.
//
// A subscriber taking only `item` hears its own ask answered and takes nothing from it,
// because the answer is always the batch. Both topics or neither.
//
// What a vendor pays is the field a consumer needs most and the one the addon API answers
// least: there is no price surface at all, so a bag panel totalling what a character is
// carrying and a ledger judging a listing against the vendor floor are both reading this or
// guessing. It is copper, which is the unit every price on the wire is in.
//
// Nothing here stamps `from`. The hub stamps it from the fqid the surface was built with,
// a sender cannot set it, and a subscriber reads it to credit an answer. Any addon
// watching loot rolls can publish a name on the same `item` topic, so this addon never
// assumes it is the only publisher.

/** The frame, and the floor a resize may take it to: chrome plus exactly ONE row of art. */
const FRAME_TITLE = 'Lorebind';
const FRAME_WIDTH = 460;
const FRAME_HEIGHT = 660;
const FRAME_MIN_WIDTH = 340;
/**
 * What the shortest useful window spends on everything that is not the grid: the title bar,
 * the tab strip, the quality chips, the search row, the record under the grid and the two
 * counting lines. Stated rather than measured, because a size floor is settled when the frame
 * is built and cannot be derived from a layout that does not exist yet. Floored at one row of
 * squares, never at however many happen to be showing.
 */
const CHROME_HEIGHT = 400;

/** One square of item art, and the gap between two of them. */
const CELL_SIZE = 44;
const CELL_GAP = 4;
/** The record under the grid draws the same art larger, since it is one item rather than many. */
const DETAIL_SIZE = 56;
/** How a chip that is not lit is dimmed, and what marks the square being described. */
const FADED_CHIP = '0.5';
const CHOSEN_RING_PX = 2;
const CHOSEN_OUTLINE = `${String(CHOSEN_RING_PX)}px solid var(--gold, rgb(255 209 0))`;

/** The fewest rows of art the grid keeps, however tall the record under it grows. */
const GRID_FLOOR_ROWS = 1;
/** The most of the panel the record may take before it scrolls inside itself. */
const DETAIL_SHARE_PCT = 40;

/** How many letters stand in for art the game does not ship. See `initials`. */
const INITIALS = 2;
/** One character, for a first letter and for a capital. */
const FIRST = 1;

/**
 * The class the loader colours a tier's TEXT with, for the two things here that are neither a
 * bar nor a tile: a filter chip and the name in the record.
 *
 * The palette itself is the loader's, from the game's own two tables, and reaching it by class
 * rather than by hex is the whole point: this addon held six literals of its own until the kit
 * grew the axis, and so would every other addon that draws an item. A tier the game does not
 * rank gets no class at all, which leaves the panel's own text colour.
 */
function qualityClass(quality) {
  if (QUALITIES.includes(quality)) {
    return `woc-quality-${quality}`;
  }
  return '';
}

/**
 * The tab strip, and the one place the game's twelve kinds are grouped.
 *
 * Twelve tabs is a wall and twelve is what the game declares, so they are bucketed by what a
 * player is actually looking for. `other` is a bucket and is named as one rather than given a
 * word that would be wrong for three of the four kinds in it: a mount is not a material. No
 * tab hides anything, since All is a tab, and every item's own kind is spelled out in the
 * record under the grid in the game's own word for it.
 */
const KIND_TABS = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'armor', label: 'Armor', kinds: ['armor', 'held_offhand'] },
  { id: 'weapon', label: 'Weapon', kinds: ['weapon'] },
  { id: 'consumable', label: 'Food', kinds: ['food', 'drink', 'potion', 'elixir'] },
  { id: 'quest', label: 'Quest', kinds: ['quest'] },
  { id: 'other', label: 'Other', kinds: ['junk', 'tool', 'bag', 'mount'] },
];

/** Every slot the game files an item under, in the order a character wears them. */
const SLOTS = [
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'feet',
  'gloves',
  'ring',
  'mainhand',
  'offhand',
];
/** What the slot control says when it is not filtering. */
const ANY_SLOT = 'Any slot';

/**
 * The orders the grid can be read in, and what each one is called.
 *
 * A browser needs more than one, because the questions are different: alphabetical is a
 * LOOKUP order, and the other three are comparisons. Item level answers "what is the best
 * thing here", quality answers it more coarsely and groups a set together, and price answers
 * what a bag of loot is worth. Nothing sorts by id, which is the one order no player thinks in.
 */
const SORTS = [
  { label: 'Name', by: 'name' },
  { label: 'Item level', by: 'itemLevel' },
  { label: 'Quality', by: 'quality' },
  { label: 'Sell price', by: 'sellValue' },
];
const SORT_NAMES = SORTS.map((sort) => sort.label);

/** The data file, which is the first-ranked source and the reason this addon exists. */
const TABLE_FILE = 'items.json';

// The topics. `item` is one record, `items` is a batch of them, and the ask is what a
// subscriber that started late sends to be caught up.
const ITEM_TOPIC = 'item';
const ITEMS_TOPIC = 'items';
const ASK_TOPIC = 'item:ask';

/**
 * What each source is called, in the record and on the wire. These strings are the whole of
 * what a subscriber's `source` field means, so a second publisher describing the same kind
 * of evidence in different words would make the field useless: match these exactly.
 */
const SOURCE_TABLE = 'table';
const SOURCE_ROLL = 'loot roll';
const SOURCE_ART = 'art file';

/** What another addon marks an element with to borrow the codex for it. */
const MARK_ATTR = 'data-woc-item';

const MS_PER_SECOND = 1000;
/** How often the marked elements and the live id sources are re-read. */
const SWEEP_MS = MS_PER_SECOND;

const DEFAULT_MAX_CELLS = 120;

/** Every field the search matches. */
const SEARCHABLE = ['name', 'id', 'quality', 'kind', 'slot'];

/** The kinds the game's own table declares, which is what a `kind` is checked against. */
const KINDS = [
  'weapon',
  'armor',
  'held_offhand',
  'quest',
  'junk',
  'food',
  'drink',
  'tool',
  'potion',
  'elixir',
  'bag',
  'mount',
];

/** The qualities the game colours a name by, low to high. */
const QUALITIES = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * The stat block, in the game's own order, and what each abbreviation is called.
 *
 * Armor is in the table's `stats` beside the five attributes and is drawn apart from them,
 * which is what the game's own tooltip does: `{value} Armor` on a line of its own and
 * `+{value} {stat}` for everything else. The words are the game's English, from its own
 * `itemUi.stats` catalogue; nothing here is translated, because an addon cannot reach the
 * player's locale and inventing a second vocabulary for the same six numbers would be worse
 * than being in one language.
 */
const STAT_ORDER = ['str', 'agi', 'sta', 'int', 'spi', 'armor'];
const STAT_NAME = {
  str: 'Strength',
  agi: 'Agility',
  sta: 'Stamina',
  int: 'Intellect',
  spi: 'Spirit',
  armor: 'Armor',
};

/** The four affixes that sit BESIDE the stat block, with the game's names for them. */
const RATING_NAME = {
  spellPower: 'Spell Power',
  critRating: 'Crit Rating',
  hasteRating: 'Haste Rating',
  hitRating: 'Hit Rating',
};

/** Every plain number the file may carry, checked by type and kept as it stands. */
const NUMBER_FIELDS = [
  'itemLevel',
  'spellPower',
  'critRating',
  'hasteRating',
  'hitRating',
  'blockValue',
  'foodHp',
  'drinkMana',
  'potionHp',
  'potionMana',
  'bagSlots',
  'requiredLevel',
  'sellValue',
];

/**
 * What a record carries besides the id, the name and the source. Deliberately shorter than
 * the table's own row: the panel here draws every field the game's tooltip does, and the bus
 * carries the ones a consumer cannot work out for itself and would otherwise have to embed a
 * second copy of the table to know.
 *
 * The price is the reason the numbers are here at all. Nothing on the addon API says what a
 * vendor pays, so a bag panel adding up what it holds and a price ledger judging a listing
 * against the vendor floor both have to be told. It is copper, the unit every price on the
 * wire is already in. The two levels ride along because they are the orders a consumer ranks
 * items in, and neither is derivable from anything else it holds.
 */
const PUBLISHED_TEXT = ['quality', 'kind', 'slot'];
const PUBLISHED_NUMBERS = ['sellValue', 'itemLevel', 'requiredLevel'];

/** How long the game says a sat-down consumable takes, `CONSUME_DURATION` in its own sim. */
const CONSUME_SECONDS = 18;
/** Seconds in a minute, for an elixir's duration. */
const MINUTE_SECONDS = 60;
/** How many decimals a swing speed and a damage-per-second figure are drawn to. */
const SPEED_DECIMALS = 1;
/** Two, for the halfway point between a weapon's two damage bounds. */
const HALF = 2;

/**
 * A flag that changes, in a cell, so a handler can flip one the paint path reads without
 * either of them holding a stale copy.
 */
function cell(value) {
  return { on: value };
}

/** The embedded table, id to `{ id, name, kind, quality?, slot? }`. Source 1. */
const table = new Map();
/** Names read off a loot roll this session, id to `{ name, quality }`. Source 2. */
const rolled = new Map();
/**
 * Every id this addon has proven exists, from somewhere other than its own file: worn
 * gear, carried stacks, recipe results and reagents, a Merchant page, the bank, a letter's
 * parcels, a corpse's loot, the buyback ring. None of these carries a name and all of them
 * carry an id. An id in here and not in the table is either content newer than the file or
 * one this addon has no name for, and the coverage line counts it rather than hiding it.
 */
const seen = new Set();
/** Ids already put on the bus, so a roll answered four times emits once. */
const published = new Set();
/**
 * Marked elements already carrying a codex tooltip, and how to take each back. A list
 * rather than a WeakSet, because a set says whether an element has been described and
 * cannot undescribe one: holding the unsubscribes is what makes the setting mean something
 * after the fact. Entries whose element has left the document are dropped on the next
 * sweep, which is what keeps this from growing with a list that rebuilds.
 */
const described = [];

/** Set once the data file has been read, or once reading it has failed. */
const loaded = cell(false);
/** Set once the item art manifest has been read, which makes `hasArt` exact. */
const artKnown = cell(false);
/** Cleared on disable, so an awaited continuation cannot draw into a dead frame. */
const running = cell(true);
/** One repaint per animation frame however many things changed. See `schedulePaint`. */
const scheduled = cell(false);

/**
 * Every filter at once, which is what the window IS.
 *
 * One record rather than five variables because they are read together on every paint and
 * changed one at a time by five different controls: a `filters.kind` at the call site says
 * which of them a handler is moving, where a bare `kind` would not.
 *
 * `qualities` empty means EVERY quality rather than none. That is the ordinary reading of a
 * chip row and it is also the only one that can be started from: six chips all lit is the
 * same answer and would make the first click a narrowing to five, which is not what pressing
 * Epic means.
 */
const filters = { query: '', kind: 'all', slot: '', sort: 'name', qualities: new Set() };

/** The one filter that is a flag, in a cell for the reason every other flag here is. */
const seenOnly = cell(false);

/** The id whose record is drawn under the grid, or '' for nothing selected yet. */
const chosen = { id: '' };

function text(value) {
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function settingFlag(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function settingNumber(id, fallback) {
  const value = woc.settings[id];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/**
 * How many squares are drawn before the grid says it stopped. Read straight from the setting
 * with no clamping: the manifest declares `min` and `max` and the loader coerces against
 * them, so a second clamp here would be dead code that reads like a guard.
 */
function maxCells() {
  return Math.round(settingNumber('max-results', DEFAULT_MAX_CELLS));
}

function learningFromRolls() {
  return settingFlag('learn-rolls', true);
}

function describingMarked() {
  return settingFlag('tooltips', true);
}

/**
 * One row of the data file, checked. `woc.data` hands back `unknown`: nothing validates
 * the shape, and a table nothing checked is right only until somebody edits it. An id, a
 * name and a known kind are required; quality and slot are optional in the game's own
 * table, so a row without one is ordinary rather than broken and the field is left absent.
 */
function readRow(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const id = text(value.id);
  const name = text(value.name);
  const kind = text(value.kind);
  if (id === '' || name === '' || !KINDS.includes(kind)) {
    return null;
  }
  const row = { id, name, kind };
  const quality = text(value.quality);
  if (QUALITIES.includes(quality)) {
    row.quality = quality;
  }
  copyText(row, value, ['slot', 'armorType', 'set']);
  copyNumbers(row, value, NUMBER_FIELDS);
  readDetail(row, value);
  return row;
}

/** Copy the string fields that are free text to this reader: a slot, a class, a set name. */
function copyText(row, value, keys) {
  for (const key of keys) {
    const said = text(value[key]);
    if (said !== '') {
      row[key] = said;
    }
  }
}

/** A number the file states, or nothing. A zero is dropped: the generator never writes one. */
function copyNumbers(row, value, keys) {
  for (const key of keys) {
    const said = value[key];
    if (typeof said === 'number' && Number.isFinite(said) && said !== 0) {
      row[key] = said;
    }
  }
}

/** The three fields with a shape of their own, each checked before it is kept. */
function readDetail(row, value) {
  const stats = readStats(value.stats);
  if (stats !== null) {
    row.stats = stats;
  }
  const weapon = readWeapon(value.weapon);
  if (weapon !== null) {
    row.weapon = weapon;
  }
  const elixir = readElixir(value.elixir);
  if (elixir !== null) {
    row.elixir = elixir;
  }
  if (Array.isArray(value.requiredClass)) {
    row.requiredClass = value.requiredClass.filter((one) => text(one) !== '');
  }
  if (value.soulbound === true) {
    row.soulbound = true;
  }
}

/** The stat block, keyed by the game's own five abbreviations plus armor. */
function readStats(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const stats = {};
  for (const key of STAT_ORDER) {
    const said = value[key];
    if (typeof said === 'number' && Number.isFinite(said) && said !== 0) {
      stats[key] = said;
    }
  }
  if (Object.keys(stats).length === 0) {
    return null;
  }
  return stats;
}

/** A swing: two damage bounds and a speed, all three or none of them. */
function readWeapon(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { min, max, speed } = value;
  const numbers = [min, max, speed].every((one) => typeof one === 'number' && Number.isFinite(one));
  if (!numbers || speed <= 0) {
    return null;
  }
  return { min, max, speed };
}

/** The buff an elixir grants, which is a name, an amount and a length. */
function readElixir(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const aura = text(value.aura);
  const { value: amount, duration } = value;
  if (aura === '' || typeof amount !== 'number' || typeof duration !== 'number') {
    return null;
  }
  return { aura, value: amount, duration };
}

/** The file's `items` array, or null when the file is not what it claims to be. */
function readTable(value) {
  if (typeof value !== 'object' || value === null || !Array.isArray(value.items)) {
    return null;
  }
  const rows = [];
  for (const entry of value.items) {
    const row = readRow(entry);
    if (row !== null) {
      rows.push(row);
    }
  }
  return rows;
}

/** The version of the game the file was derived from, for the coverage line. */
function readVersion(value) {
  if (typeof value !== 'object' || value === null) {
    return '';
  }
  return text(value.gameVersion);
}

/**
 * The name the item's art file was filed under, or null. Source 3, and a guess. Called
 * defensively like anything reached through a game object: a future update can leave
 * something callable in place that throws, and that has to cost a name rather than a panel.
 */
function artName(itemId) {
  if (itemId === '') {
    return null;
  }
  try {
    return woc.ui.icon.itemArtName(itemId);
  } catch (err) {
    woc.warn('lorebind: the art manifest could not be asked for a name', err);
    return null;
  }
}

/**
 * Whether the game ships a painted file for this id. Source 4, and one-directional. A URL
 * means the manifest lists the id, so the id is almost certainly real. A null is true of
 * items that certainly exist, so it proves nothing and is never read as evidence against
 * an id.
 */
function hasArt(itemId) {
  if (itemId === '') {
    return false;
  }
  try {
    return woc.ui.icon.item(itemId) !== null;
  } catch (err) {
    woc.warn('lorebind: the art manifest could not be asked for an icon', err);
    return false;
  }
}

function artUrl(itemId) {
  try {
    return woc.ui.icon.item(itemId);
  } catch {
    // Swallowed rather than logged: `hasArt` asks the same question a line earlier on
    // every path that reaches here, so a throw has already been reported once.
    return null;
  }
}

/**
 * The best name there is for an id, and where it came from. The ranking, in one function,
 * and the only place that decides it. `source` is null when nothing can name the id at
 * all, which is a real answer: an id with no name is not the same thing as an id that does
 * not exist.
 */
function resolve(itemId) {
  const known = table.get(itemId);
  if (known !== undefined) {
    return { ...known, source: SOURCE_TABLE };
  }
  const roll = rolled.get(itemId);
  if (roll !== undefined) {
    return { id: itemId, name: roll.name, quality: roll.quality, source: SOURCE_ROLL };
  }
  const art = artName(itemId);
  if (art !== null && art !== '') {
    return { id: itemId, name: art, source: SOURCE_ART };
  }
  return { id: itemId, name: '', source: null };
}

/**
 * The other spelling, when a roll and the file disagree about the same id. The file wins
 * the display because it is the ranked source, but the disagreement is the only evidence
 * available that the file has fallen behind the running game. Empty when the two agree or
 * when only one has an answer.
 */
function disagreement(itemId) {
  const known = table.get(itemId);
  const roll = rolled.get(itemId);
  if (known === undefined || roll === undefined || known.name === roll.name) {
    return '';
  }
  return roll.name;
}

/**
 * One record for the bus, with anything unknown left out rather than sent empty. Absent
 * and empty are different answers, and a subscriber checking `payload.quality` cannot tell
 * an item whose quality nobody knows from one whose quality is the empty string. The same
 * rule decides the numbers and matters more there, because a `sellValue` of 0 is a
 * perfectly good reading of an item a vendor will not pay for.
 *
 * Returns null for every name that came off an art file: those are provenance for a
 * picture, a subscriber can read `ui.icon.itemArtName` for itself, and publishing one
 * would rank a guess above the fallback the subscriber already has.
 *
 * Both copiers are the ones the table reader uses, so a field is dropped here on exactly
 * the terms it was kept on: only the table states any of these, and a roll-sourced record
 * therefore carries a name, a quality and nothing else without needing to say so.
 */
function record(itemId) {
  const answer = resolve(itemId);
  if (answer.source === null || answer.source === SOURCE_ART) {
    return null;
  }
  const payload = { id: answer.id, name: answer.name, source: answer.source };
  copyText(payload, answer, PUBLISHED_TEXT);
  copyNumbers(payload, answer, PUBLISHED_NUMBERS);
  return payload;
}

/** Put one newly learned id on the bus, once per session. */
function publishItem(itemId) {
  if (published.has(itemId)) {
    return;
  }
  const payload = record(itemId);
  if (payload === null) {
    return;
  }
  published.add(itemId);
  woc.bus.emit(ITEM_TOPIC, payload);
}

/**
 * Put everything known on the bus as one message. The table is 815 rows, delivery is
 * synchronous inside this call, and 815 separate emits would be 815 allocations and 815
 * repaints in every subscriber to say what one array says.
 *
 * It walks every id the codex has heard of and lets `record` refuse, rather than walking
 * only the ids it expects to be publishable: with the ids filtered here, `record`'s
 * refusal to publish an art-sourced name is unreachable and its guard test passes with the
 * guard deleted. One decision point, and it is the one under test.
 */
function publishAll() {
  const rows = [];
  for (const itemId of allIds()) {
    const payload = record(itemId);
    if (payload !== null) {
      published.add(itemId);
      rows.push(payload);
    }
  }
  if (rows.length > 0) {
    woc.bus.emit(ITEMS_TOPIC, rows);
  }
}

/**
 * Learn a name off a roll the group is answering. The wire spells an item out in very few
 * places and this is one of them. A name already held for the id is dropped here, and
 * `publishItem` keeps it to one emit per id, so the same drop rolled on four times in a
 * night is one message.
 */
function learnFromRoll(itemId, itemName, quality) {
  if (itemId === '' || itemName === '' || !learningFromRolls()) {
    return false;
  }
  const held = rolled.get(itemId);
  if (held !== undefined && held.name === itemName) {
    return false;
  }
  rolled.set(itemId, { name: itemName, quality });
  seen.add(itemId);
  publishItem(itemId);
  return true;
}

function rollQuality(value) {
  const quality = text(value);
  if (QUALITIES.includes(quality)) {
    return quality;
  }
  return '';
}

/**
 * Every roll the group has open, from both of the two places it carries one.
 *
 * `rolls` is what you were asked to answer and `rollStatus` is every open roll in the
 * party including ones you were never a candidate for. The two overlap rather than nest,
 * so reading both gets the ids you could not have won; `rolls` also drops a prompt the
 * moment you answer it while `rollStatus` holds it until the roll resolves.
 *
 * What this cannot see is master loot, and the gap is in the game rather than the reading.
 * A master-loot item in its curate phase is excluded from both by the same server-side
 * guard, because nobody is voting on it yet. Its name rides the `masterLoot` event, which
 * the published event catalogue does not describe, so reading it would mean guessing at a
 * payload shape nothing pins. A group using master loot teaches this addon fewer names,
 * and the coverage line shows that rather than hiding it.
 */
function learnFromGroup(group) {
  if (group === null || typeof group !== 'object') {
    return;
  }
  const open = [...(group.rolls ?? []), ...(group.rollStatus ?? [])];
  let learned = false;
  for (const roll of open) {
    const taught = learnFromRoll(
      text(roll?.itemId),
      text(roll?.itemName),
      rollQuality(roll?.quality),
    );
    learned = learned || taught;
  }
  if (learned) {
    schedulePaint();
  }
}

function noteId(value) {
  const itemId = text(value);
  if (itemId !== '') {
    seen.add(itemId);
  }
}

function noteStacks(stacks) {
  if (!Array.isArray(stacks)) {
    return;
  }
  for (const stack of stacks) {
    noteId(stack?.itemId);
  }
}

/**
 * The static half of the id sources: every recipe's result and every reagent.
 * `world.recipes` is content rather than state, which is why it has no watch key and why
 * reading it once is enough.
 */
function noteRecipes() {
  const { recipes } = woc.world;
  if (!Array.isArray(recipes)) {
    return;
  }
  for (const recipe of recipes) {
    noteId(recipe?.resultItemId);
    noteStacks(recipe?.reagents);
  }
}

/** The three proximity-gated stores. Only a `near` status carries a payload to read. */
function noteGated() {
  const { market, bank, mail } = woc.world;
  if (market?.status === 'near' && market.info !== null) {
    for (const listing of market.info.listings ?? []) {
      noteId(listing?.itemId);
    }
  }
  if (bank?.status === 'near' && bank.info !== null) {
    noteStacks(bank.info.slots);
  }
  if (mail?.status === 'near' && mail.info !== null) {
    for (const letter of mail.info.messages ?? []) {
      noteStacks(letter?.items);
    }
  }
}

/** Every corpse in scope, filtered to what you could actually take off it. */
function noteCorpses() {
  for (const corpse of woc.world.corpses.values()) {
    noteStacks(corpse?.all);
  }
}

/**
 * Re-read every live id source, on an interval rather than on a watch key. Most of these
 * have no watch key, and the ones that do report membership of a set rather than a field
 * changing inside it.
 */
function collectSeen() {
  const before = seen.size;
  noteRecipes();
  noteStacks(woc.world.inventory);
  noteStacks(woc.world.buyback);
  noteGated();
  noteCorpses();
  for (const itemId of Object.values(woc.world.equipment ?? {})) {
    noteId(itemId);
  }
  return seen.size > before;
}

/** Every id the codex has heard of at all, named or not. */
function allIds() {
  return new Set([...table.keys(), ...rolled.keys(), ...seen]);
}

/**
 * How many ids each source can name, plus how many nothing can. Counted rather than
 * stored, because the answer moves as rolls land and as the player walks past a Merchant.
 * The four figures are kept apart: a single total would fold a name that is right by
 * construction together with one taken off an art file.
 */
function coverage() {
  const counts = { table: 0, roll: 0, art: 0, unnamed: 0, artless: 0, total: 0 };
  for (const itemId of allIds()) {
    counts.total += 1;
    const { source } = resolve(itemId);
    if (source === SOURCE_TABLE) {
      counts.table += 1;
    } else if (source === SOURCE_ROLL) {
      counts.roll += 1;
    } else if (source === SOURCE_ART) {
      counts.art += 1;
    } else {
      counts.unnamed += 1;
    }
    if (!hasArt(itemId)) {
      counts.artless += 1;
    }
  }
  return counts;
}

function matchesQuery(row, needle) {
  for (const field of SEARCHABLE) {
    if (text(row[field]).toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

/** Named ids first and alphabetically; bare ones after, in the order they were learned. */
function compareRows(a, b) {
  if (a.name === '' || b.name === '') {
    return Number(a.name === '') - Number(b.name === '');
  }
  return a.name.localeCompare(b.name);
}

/**
 * How much of the sorted-by fact a row has, for the three orders that are numbers.
 *
 * Quality is a number here because it is a RANK: the game's six tiers are ordered, so sorting
 * by the word would put epic under poor and rare over uncommon, which is the alphabet
 * answering a question nobody asked.
 */
function sortValue(row, key) {
  if (key === 'quality') {
    return QUALITIES.indexOf(text(row.quality));
  }
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return -1;
}

/**
 * The chosen order, highest first, with the alphabet breaking every tie.
 *
 * Highest first because every one of the three numeric orders is a "best" question, and a row
 * the table has no answer for sorts to the BOTTOM rather than to the top: an item with no
 * item level is one the game derives none for, and leading a list of the best gear with the
 * things that have no level at all would answer the opposite question.
 */
function compareBy(key) {
  return (a, b) => {
    const difference = sortValue(b, key) - sortValue(a, key);
    if (difference !== 0) {
      return difference;
    }
    return compareRows(a, b);
  };
}

/** The kinds the open tab admits, or null for the tab that admits everything. */
function tabKinds() {
  return KIND_TABS.find((tab) => tab.id === filters.kind)?.kinds ?? null;
}

/**
 * Whether one item survives the controls. Every arm is a fact the table already carries,
 * which is what makes these filters rather than a second search: an item with no kind is out
 * of every tab but All, because the codex does not know its kind rather than knowing it is
 * none of them.
 */
function passes(row, needle) {
  const kinds = tabKinds();
  if (kinds !== null && !kinds.includes(text(row.kind))) {
    return false;
  }
  if (filters.qualities.size > 0 && !filters.qualities.has(text(row.quality))) {
    return false;
  }
  if (filters.slot !== '' && text(row.slot) !== filters.slot) {
    return false;
  }
  if (seenOnly.on && !seen.has(row.id)) {
    return false;
  }
  return needle === '' || matchesQuery(row, needle);
}

/**
 * What the controls are pointed at, resolved and sorted. Every id the codex knows of rather
 * than only the ones in the file, so an id learned off a roll or seen in the bags is findable
 * the moment it is known. Untouched controls list everything, which is what makes the window
 * a browser of the game rather than a box you have to know an answer to use.
 */
function results() {
  const needle = filters.query.trim().toLowerCase();
  const rows = [];
  for (const itemId of allIds()) {
    const row = resolve(itemId);
    if (passes(row, needle)) {
      rows.push(row);
    }
  }
  if (filters.sort === 'name') {
    rows.sort(compareRows);
  } else {
    rows.sort(compareBy(filters.sort));
  }
  return rows;
}

function readableSlot(slot) {
  return text(slot).replaceAll('_', ' ');
}

/** Whether a string has anything in it, for filtering the parts of a composed line. */
function filled(part) {
  return part !== '';
}

/** The first letter up, for a word the game stores lower case and a reader reads as a label. */
function capitalized(word) {
  return word.slice(0, FIRST).toUpperCase() + word.slice(FIRST);
}

/**
 * `Uncommon armor, waist`, from whichever of the three the source could answer.
 *
 * The quality is in the words as well as in the colour. A colour alone would leave the one
 * fact a player sorts items by unreadable to anyone who cannot tell #0070dd from #a335ee, and
 * this line is also what a screen reader gets, since the grid's squares are art.
 */
function kindLine(row) {
  const parts = [qualityAndKind(row)];
  if (text(row.slot) !== '') {
    parts.push(readableSlot(row.slot));
  }
  return parts.join(', ');
}

/**
 * The head of that line, which always speaks to the quality even when nobody knows it.
 *
 * Absent is not poor: the game declares no quality for 96 of its items, and a line that simply
 * left the word out where every other one carries a tier would read as the lowest tier rather
 * than as a fact nobody has. The same goes the other way for an id learned off a roll, which
 * carries a quality and no kind at all.
 */
function qualityAndKind(row) {
  const quality = text(row.quality);
  const kind = [readableSlot(row.armorType), readableSlot(row.kind)].filter(filled).join(' ');
  if (quality !== '' && kind !== '') {
    return `${capitalized(quality)} ${kind}`;
  }
  if (quality !== '') {
    return `${capitalized(quality)}, kind unknown`;
  }
  if (kind !== '') {
    return `${capitalized(kind)}, quality unknown`;
  }
  return 'Kind and quality both unknown';
}

/**
 * Where the name came from, spelled out in the record under the grid. This is the attribution
 * and it is why the panel is worth having. An art-sourced name is marked in words rather than
 * by a colour or a symbol: the colours here mean quality, and a caveat drawn in the same
 * language as a tier would read as one.
 */
function sourceLine(row) {
  if (row.source === SOURCE_TABLE) {
    return 'from the table';
  }
  if (row.source === SOURCE_ROLL) {
    return 'from a loot roll';
  }
  if (row.source === SOURCE_ART) {
    return 'from its art file, which may not be what the game calls it';
  }
  return 'no name from any source';
}

/** The name to draw, falling back to the raw id so nothing is ever nameless. */
function rowLabel(row) {
  if (row.name === '') {
    return row.id;
  }
  return row.name;
}

/** One row's tier as the kit takes it, or null for an item the game ranks at no tier. */
function qualityOf(row) {
  const quality = text(row.quality);
  if (QUALITIES.includes(quality)) {
    return quality;
  }
  return null;
}

/**
 * What stands in a square for art the game does not ship.
 *
 * 134 items have none, every one of them a weapon, and a grid of blank squares says nothing
 * about which blank is which. Two letters off the name is not a picture and is not pretending
 * to be one: it is enough to tell one square from its neighbour while the quality border and
 * the record under the grid carry the rest. An empty string for an item that HAS art, since
 * the figure would then be a monogram over a picture.
 */
function initials(row) {
  if (hasArt(row.id)) {
    return '';
  }
  const words = rowLabel(row).replaceAll('_', ' ').split(' ');
  return words
    .slice(0, INITIALS)
    .map((word) => word.slice(0, FIRST).toUpperCase())
    .join('');
}

/** `42 - 68 Damage, speed 3.2 (17.2 damage per second)`, in the game's own wording. */
function damageLine(row) {
  const { weapon } = row;
  if (weapon === undefined) {
    return '';
  }
  const dps = (weapon.min + weapon.max) / HALF / weapon.speed;
  const swing = `${String(weapon.min)} - ${String(weapon.max)} Damage`;
  const speed = `speed ${weapon.speed.toFixed(SPEED_DECIMALS)}`;
  return `${swing}, ${speed} (${dps.toFixed(SPEED_DECIMALS)} damage per second)`;
}

/** The armour value, which the game gives a line of its own rather than a plus sign. */
function armorLine(row) {
  const armor = row.stats?.armor;
  if (armor === undefined) {
    return '';
  }
  const block = row.blockValue;
  if (block === undefined) {
    return `${String(armor)} Armor`;
  }
  return `${String(armor)} Armor, ${String(block)} Block`;
}

/** Every stat the item carries, one per entry: the attributes first, then the four affixes. */
function statLines(row) {
  const parts = [];
  for (const key of STAT_ORDER) {
    const value = row.stats?.[key];
    if (value !== undefined && key !== 'armor') {
      parts.push(`+${String(value)} ${STAT_NAME[key]}`);
    }
  }
  for (const [key, name] of Object.entries(RATING_NAME)) {
    if (row[key] !== undefined) {
      parts.push(`+${String(row[key])} ${name}`);
    }
  }
  return parts;
}

/**
 * What using it does, in the four shapes the game keeps a consumable's effect in.
 *
 * Not `useLine`, which is what it was called for ten minutes: Biome reads a `use` prefix as a
 * React hook and refuses to see one called after an early return.
 */
function effectLine(row) {
  const over = `over ${String(CONSUME_SECONDS)} sec`;
  if (row.foodHp !== undefined) {
    return `Use: Restores ${String(row.foodHp)} health ${over}, seated`;
  }
  if (row.drinkMana !== undefined) {
    return `Use: Restores ${String(row.drinkMana)} mana ${over}, seated`;
  }
  if (row.potionHp !== undefined) {
    return `Use: Restores ${String(row.potionHp)} health`;
  }
  if (row.potionMana !== undefined) {
    return `Use: Restores ${String(row.potionMana)} mana`;
  }
  return elixirLine(row);
}

/** An elixir's buff, and a bag's sockets, which are the two remaining use effects. */
function elixirLine(row) {
  if (row.elixir !== undefined) {
    const minutes = Math.round(row.elixir.duration / MINUTE_SECONDS);
    const gives = `+${String(row.elixir.value)} ${row.elixir.aura}`;
    return `Use: ${gives} for ${String(minutes)} min`;
  }
  if (row.bagSlots !== undefined) {
    return `${String(row.bagSlots)} slots when carried in a bag socket`;
  }
  return '';
}

/**
 * What it takes to use it and what it is worth, on one line.
 *
 * The classes are the game's own ids rather than its display names, because this addon has no
 * class table and title-casing `warlock` is a guess that happens to be right. Soulbound is
 * here rather than beside the name for the same reason the game puts it early: it is the
 * fact that decides whether the rest of the line is worth reading.
 */
function gateLines(row) {
  const parts = [];
  if (row.itemLevel !== undefined) {
    parts.push(`Item level ${String(row.itemLevel)}`);
  }
  if (row.requiredLevel !== undefined) {
    parts.push(`Requires level ${String(row.requiredLevel)}`);
  }
  if (row.requiredClass !== undefined && row.requiredClass.length > 0) {
    parts.push(`Classes: ${row.requiredClass.map(capitalized).join(', ')}`);
  }
  if (row.set !== undefined) {
    parts.push(row.set);
  }
  if (row.soulbound === true) {
    parts.push('Soulbound');
  }
  if (row.sellValue !== undefined) {
    parts.push(`Sell price: ${woc.ui.money(row.sellValue)}`);
  }
  return parts;
}

/**
 * The numbers, for the tooltip, in the record's own order and with its own words.
 *
 * The stats line is `good` and the gates line is `muted`, which is the same distinction the
 * record draws in colour: what the item GIVES you, and what it asks of you first.
 */
function numberLines(row) {
  const lines = [];
  for (const said of [damageLine(row), armorLine(row), effectLine(row)]) {
    if (said !== '') {
      lines.push(said);
    }
  }
  for (const stat of statLines(row)) {
    lines.push({ text: stat, tone: 'good' });
  }
  for (const gate of gateLines(row)) {
    lines.push({ text: gate, tone: 'muted' });
  }
  return lines;
}

/**
 * What a square's tooltip says, built when the pointer lands on it. The function form because
 * the answer moves: a roll landing while the window is open changes an item's source.
 *
 * It says everything the record says and is not redundant with it: a tooltip follows the
 * pointer across a grid at reading speed, and the record holds one item still while the player
 * looks at another.
 */
function describeItem(itemId) {
  const row = resolve(itemId);
  const lines = [kindLine(row), ...numberLines(row), { text: `Id: ${row.id}`, tone: 'muted' }];
  lines.push(sourceLine(row));
  const other = disagreement(itemId);
  if (other !== '') {
    lines.push({
      text: `A loot roll spelled this "${other}". The table shipped with this addon was`,
      tone: 'warn',
    });
    lines.push({
      text: 'derived from an older game version, so it may have been renamed.',
      tone: 'warn',
    });
  }
  if (!hasArt(itemId)) {
    lines.push({
      text: 'The game ships no art for this id, so its square draws two letters.',
      tone: 'muted',
    });
  }
  return { title: rowLabel(row), icon: artUrl(itemId), lines };
}

const frame = woc.ui.frame({
  id: 'codex',
  title: FRAME_TITLE,
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'comfortable',
  closable: true,
  save: true,
  // Closed until asked for. A browser of the whole game is a thing the player opens, so
  // leaving it on screen would put a 580px panel over the game for a question nobody is
  // asking. `save` means a player who leaves it open gets it back.
  visible: false,
  resizable: true,
  minWidth: FRAME_MIN_WIDTH,
  minHeight: CHROME_HEIGHT + CELL_SIZE,
});

// A column, so the grid takes what is left of the window and scrolls inside it while the
// controls above it and the record below it stay put.
frame.body.style.display = 'flex';
frame.body.style.flexDirection = 'column';
frame.body.style.gap = '8px';
frame.body.style.minHeight = '0';

/** A row of controls that keeps its height whatever the grid does. */
function strip(role) {
  const el = document.createElement('div');
  el.className = 'woc-lorebind-strip';
  el.dataset.role = role;
  el.style.display = 'flex';
  el.style.flexWrap = 'wrap';
  el.style.alignItems = 'flex-end';
  el.style.gap = '6px';
  el.style.flexShrink = '0';
  frame.body.appendChild(el);
  return el;
}

/**
 * One of the two counting lines under the record.
 *
 * Drawn as a caption rather than as body text: they are footnotes about the grid, and at the
 * panel's own size they would take three of the rows of art the window exists to show. The
 * grid is the content here and these say how much of it there is.
 */
function line(role) {
  const el = document.createElement('div');
  el.className = 'woc-lorebind-line';
  el.dataset.role = role;
  el.style.flexShrink = '0';
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.35';
  el.style.opacity = '0.75';
  frame.body.appendChild(el);
  return el;
}

/**
 * The kind strip, which is the coarsest cut and therefore the first control.
 *
 * `ui.tabs` rather than a sixth dropdown: these are the six shelves the window is divided
 * into and a player moves between them constantly, so they are navigation, which is what the
 * kit's tab strip is for. Every other control narrows what is on the open shelf.
 */
const kindTabs = woc.ui.tabs({
  tabs: KIND_TABS.map((tab) => ({ id: tab.id, label: tab.label })),
  onSelect: (id) => {
    filters.kind = id;
    schedulePaint();
  },
});
kindTabs.el.style.flexShrink = '0';
frame.body.appendChild(kindTabs.el);

const chipStrip = strip('qualities');

/**
 * One quality chip: the word, in the game's own colour for it, pressed or not.
 *
 * The colour is the point. Quality is what a player sorts every item by and the game paints
 * it everywhere, so a filter that named the six tiers in the panel's own text colour would be
 * a legend for a thing the player already reads by hue. `aria-pressed` rather than a class
 * alone, because a toggle that only LOOKS pressed is a control a screen reader cannot report.
 */
function createChip(quality) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `woc-btn woc-lorebind-chip ${qualityClass(quality)}`;
  chip.dataset.quality = quality;
  chip.textContent = capitalized(quality);
  chip.style.padding = '4px 8px';
  chip.addEventListener('click', () => {
    toggleQuality(quality);
  });
  chipStrip.appendChild(chip);
  return chip;
}

const chips = QUALITIES.map((quality) => [quality, createChip(quality)]);

/** Turn one tier on or off. Nothing lit is every tier, which is what an empty set means. */
function toggleQuality(quality) {
  if (filters.qualities.has(quality)) {
    filters.qualities.delete(quality);
  } else {
    filters.qualities.add(quality);
  }
  schedulePaint();
}

/** Draw the chips from the filter rather than from the click, so one state paints them all. */
function paintChips() {
  for (const [quality, chip] of chips) {
    const lit = filters.qualities.has(quality);
    const counts = filters.qualities.size === 0 || lit;
    chip.setAttribute('aria-pressed', String(lit));
    // `currentColor`, so the edge of a lit chip is the tier's own colour without this file
    // holding one: the class the loader gave it has already set the text to that colour.
    chip.style.borderColor = '';
    chip.style.opacity = FADED_CHIP;
    if (lit) {
      chip.style.borderColor = 'currentColor';
    }
    if (counts) {
      chip.style.opacity = '1';
    }
  }
}

const findStrip = strip('find');

const search = woc.ui.field.text({
  label: 'Search',
  value: '',
  placeholder: 'name, id, kind or slot',
  onChange: (next) => {
    filters.query = next;
    schedulePaint();
  },
});
search.el.style.flex = '1 1 90px';
search.el.dataset.role = 'search';
findStrip.appendChild(search.el);

const slotField = woc.ui.field.select({
  label: 'Slot',
  value: ANY_SLOT,
  options: [ANY_SLOT, ...SLOTS.map(readableSlot)],
  onChange: (next) => {
    filters.slot = '';
    if (next !== ANY_SLOT) {
      filters.slot = next.replaceAll(' ', '_');
    }
    schedulePaint();
  },
});
slotField.el.style.flex = '0 1 100px';
slotField.el.dataset.role = 'slot';
findStrip.appendChild(slotField.el);

const sortField = woc.ui.field.select({
  label: 'Sort',
  value: SORT_NAMES[0],
  options: SORT_NAMES,
  onChange: (next) => {
    filters.sort = SORTS.find((sort) => sort.label === next)?.by ?? 'name';
    schedulePaint();
  },
});
sortField.el.style.flex = '0 1 110px';
sortField.el.dataset.role = 'sort';
findStrip.appendChild(sortField.el);

/**
 * The one filter that is about the PLAYER rather than about the game.
 *
 * Everything else here narrows a table every player installs identically. This one asks what
 * this character has actually laid eyes on: worn, carried, banked, posted, looted or read off
 * a recipe. It is the closest thing the codex has to a collection, and it is the reason the
 * counting line says how many of the 815 have been seen at all.
 */
const seenField = woc.ui.field.checkbox({
  label: 'Only what I have seen',
  value: false,
  onChange: (next) => {
    seenOnly.on = next;
    schedulePaint();
  },
});
seenField.el.style.flex = '0 0 auto';
seenField.el.dataset.role = 'seen';
findStrip.appendChild(seenField.el);

/**
 * The grid, which is the window.
 *
 * A wrapping track list rather than a column of rows: item art IS the label in this game, a
 * player picks a thing out of their bags by its picture, and eight squares across a 460px
 * panel puts a whole shelf on screen where eight rows would be half a screenful. There is no
 * column count, so the browser fits as many as the frame is wide on every resize.
 */
const grid = document.createElement('div');
grid.className = 'woc-lorebind-grid';
grid.style.display = 'grid';
grid.style.gridTemplateColumns = `repeat(auto-fill, ${String(CELL_SIZE)}px)`;
grid.style.gap = `${String(CELL_GAP)}px`;
// Room for the ring on the chosen square, which is drawn OUTSIDE the cell's box: without it
// the scroll box clips the ring on the top row and on both edges, so the one square the panel
// is describing looks like the one square somebody cut a corner off.
grid.style.padding = `${String(CHOSEN_RING_PX + 1)}px`;
grid.style.justifyContent = 'center';
grid.style.alignContent = 'start';
// Sized by its content and shrunk when there is not room, rather than grown to fill: an
// underfull grid would otherwise hold a band of empty squares' worth of nothing between the
// last row of art and the record, and the record is what the player is reading.
grid.style.flex = '0 1 auto';
// A flex item's floor is its content, so without this a grid of 120 squares refuses to
// shrink and pushes the window open from the inside.
grid.style.minHeight = `${String(CELL_SIZE * GRID_FLOOR_ROWS + CELL_GAP)}px`;
grid.style.overflowY = 'auto';
grid.style.overscrollBehavior = 'contain';
frame.body.appendChild(grid);

/**
 * The record under the grid: one item, spelled out.
 *
 * The grid answers "what is there" and this answers "what is this one", which is the pair of
 * questions a browser is. It is not a substitute for the tooltip: the tooltip follows the
 * pointer and is gone the moment it leaves, and a player comparing two helmets needs one of
 * them to stay on screen while they look at the other.
 */
const detail = document.createElement('div');
detail.className = 'woc-lorebind-record';
detail.dataset.role = 'record';
detail.style.display = 'flex';
detail.style.gap = '8px';
// Top, not centre: the record is one line for a junk item and six for a weapon, and art
// centred against six lines floats away from the name it belongs to.
detail.style.alignItems = 'flex-start';
// It may be two lines for a lump of ore and eleven for a legendary, so it takes what it needs
// and the GRID gives way, down to a floor of two rows of art. Never the other way round: the
// record is the answer to the click the player just made, and a record cut off at three of its
// nine lines is the panel refusing to answer. Past its own share it scrolls rather than
// pushing the grid below that floor.
detail.style.flex = '0 0 auto';
detail.style.minHeight = `${String(DETAIL_SIZE)}px`;
detail.style.maxHeight = `${String(DETAIL_SHARE_PCT)}%`;
detail.style.overflowY = 'auto';
detail.style.overscrollBehavior = 'contain';
detail.style.borderTop = '1px solid var(--color-border-default, rgb(78 61 29))';
detail.style.paddingTop = '6px';
frame.body.appendChild(detail);

const recordArt = woc.ui.tile({ className: 'woc-lorebind-record-art', size: DETAIL_SIZE });
detail.appendChild(recordArt.el);

const recordText = document.createElement('div');
recordText.style.display = 'flex';
recordText.style.flexDirection = 'column';
recordText.style.gap = '2px';
recordText.style.minWidth = '0';
detail.appendChild(recordText);

function recordLine(role, size) {
  const el = document.createElement('div');
  el.dataset.role = role;
  el.style.fontSize = size;
  el.style.lineHeight = '1.3';
  recordText.appendChild(el);
  return el;
}

const recordName = recordLine('name', '15px');
recordName.style.fontWeight = '600';
const recordKind = recordLine('kind', '12px');
/**
 * The numbers, ONE FACT PER LINE, which is how the game's own item tooltip reads.
 *
 * It was three lines with commas in them, and that was wrong twice over: a legendary's five
 * stats and six classes ran off the right edge of the panel and were cut, and a comma-joined
 * list is a paragraph where the game gives a column. A player comparing two helmets scans a
 * column; they do not read a sentence. Vertical space is what this panel has: the window is
 * resizable, the grid takes what is left, and a run of short lines costs nothing an item
 * browser needs more.
 */
const recordBlock = document.createElement('div');
recordBlock.dataset.role = 'block';
recordBlock.style.display = 'flex';
recordBlock.style.flexDirection = 'column';
recordText.appendChild(recordBlock);

const recordSource = recordLine('source', '12px');
recordSource.style.opacity = '0.75';

/** One line of the block, in the tone that says what kind of fact it is. */
function blockLine(said, role) {
  const el = document.createElement('div');
  el.dataset.role = role;
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.35';
  el.textContent = said;
  if (role === 'stat') {
    el.style.color = 'var(--color-text-success, rgb(127 220 79))';
  }
  if (role === 'gate') {
    el.style.opacity = '0.85';
  }
  recordBlock.appendChild(el);
}

/** Draw the whole block for one item, or empty it. Rebuilt rather than diffed: it is six
 *  elements at most and it changes only when the player picks another square. */
function paintBlock(row) {
  recordBlock.replaceChildren();
  if (row === null) {
    blockLine('Its damage or armour, its stats, and what it takes to equip it.', 'number');
    return;
  }
  for (const said of [damageLine(row), armorLine(row), effectLine(row)]) {
    if (said !== '') {
      blockLine(said, 'number');
    }
  }
  for (const stat of statLines(row)) {
    blockLine(stat, 'stat');
  }
  for (const gate of gateLines(row)) {
    blockLine(gate, 'gate');
  }
}

const statusLine = line('status');
const coverageLine = line('coverage');

/** Squares on screen, id to the kit tile drawing it. See `syncCells`. */
const cells = new Map();

/** Select an item, which is what a click on a square means. */
function choose(itemId) {
  chosen.id = itemId;
  schedulePaint();
}

/**
 * One square: art, a quality border, and a way in from the keyboard.
 *
 * A tile rather than a bar for the reason a bag is a grid: a bar is a name with a fill behind
 * it and this panel's names are in the record below, while a tile is art with room for a
 * figure, which is what an item square is. The role and the tabindex are the kit's gap and
 * not its fault: `ui.tile` draws a square and says nothing about whether it does anything,
 * and one that answers a click has to answer Enter too.
 */
function addCell(itemId) {
  const tile = woc.ui.tile({ className: 'woc-lorebind-cell', size: CELL_SIZE });
  tile.el.dataset.item = itemId;
  tile.el.setAttribute('role', 'button');
  tile.el.tabIndex = 0;
  tile.el.style.cursor = 'pointer';
  tile.el.addEventListener('click', () => {
    choose(itemId);
  });
  tile.el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(itemId);
    }
  });
  woc.ui.tooltip(tile.el, () => describeItem(itemId));
  cells.set(itemId, tile);
  grid.appendChild(tile.el);
  return tile;
}

/** Put a square where it belongs, and only when it is not there already. */
function place(el, at) {
  if (grid.children[at] !== el) {
    grid.insertBefore(el, grid.children[at] ?? null);
  }
}

/**
 * Mark the square whose record is showing.
 *
 * An outline rather than the border, which is the item's quality and must not be overwritten
 * by a passing state: a selected epic would otherwise stop being purple for as long as it was
 * selected, which is the one moment a player is reading it hardest.
 */
function markChosen(tile, itemId, open) {
  tile.el.style.outline = '';
  tile.el.style.outlineOffset = '';
  if (itemId === open) {
    tile.el.style.outline = CHOSEN_OUTLINE;
    tile.el.style.outlineOffset = '1px';
  }
}

/**
 * Sync the grid to a reading: drop what has gone, build what is new, place the rest. A square
 * is reused rather than replaced, because an element removed and re-inserted loses whatever
 * the browser was tracking on it, hover and focus included, and fires no leave event to say so.
 */
function syncCells(shown, open) {
  const wanted = new Set(shown.map((row) => row.id));
  for (const [itemId, tile] of cells) {
    if (!wanted.has(itemId)) {
      tile.destroy();
      cells.delete(itemId);
    }
  }
  for (const [at, row] of shown.entries()) {
    const tile = cells.get(row.id) ?? addCell(row.id);
    // The label is the accessible name of a square whose whole face is art, so it carries
    // what a sighted reader gets from the picture and the border together.
    tile.update({
      label: `${rowLabel(row)}, ${kindLine(row)}`,
      icon: artUrl(row.id),
      value: initials(row),
      quality: qualityOf(row),
    });
    markChosen(tile, row.id, open);
    place(tile.el, at);
  }
}

/** What the record shows when nothing has been picked yet, which is every first open. */
function emptyRecord() {
  recordArt.update({ icon: null, value: '', label: null, quality: null });
  recordName.className = '';
  recordName.textContent = 'Pick an item';
  recordKind.textContent = 'Its name, quality, kind and slot go here.';
  paintBlock(null);
  recordSource.textContent = 'Where that name came from goes here too.';
}

/** Draw the item the grid is pointing at, or say there is not one. */
function paintRecord(itemId) {
  if (itemId === '') {
    emptyRecord();
    return;
  }
  const row = resolve(itemId);
  // The same tier the square in the grid carries, so the record reads as that square enlarged
  // rather than as a second thing about the same item.
  recordArt.update({
    icon: artUrl(itemId),
    value: initials(row),
    label: rowLabel(row),
    quality: qualityOf(row),
  });
  recordName.className = qualityClass(text(row.quality));
  recordName.textContent = rowLabel(row);
  recordKind.textContent = kindLine(row);
  paintBlock(row);
  recordSource.textContent = `${row.id} - ${sourceLine(row)}`;
}

function countedItems(count) {
  if (count === 1) {
    return '1 item';
  }
  return `${String(count)} items`;
}

/** Why the grid is short, or why it is empty. Never an empty box with a title on it. */
function statusText(found, drawn) {
  if (!loaded.on) {
    return 'Reading the item table.';
  }
  if (found === 0 && filters.query.trim() !== '') {
    return `Nothing here matches "${filters.query.trim()}".`;
  }
  if (found === 0 && table.size > 0) {
    return 'Nothing matches these filters.';
  }
  if (found === 0) {
    return 'The item table could not be read, so the codex knows nothing.';
  }
  if (drawn < found) {
    return `Showing ${String(drawn)} of ${countedItems(found)}. Narrow it to see the rest.`;
  }
  return `Showing ${countedItems(found)}.`;
}

/**
 * The attribution and the collection, on one line.
 *
 * Four figures for the names rather than one total, because a name off the table and a name
 * off an art file are not the same kind of fact, and this addon's whole claim is that it says
 * which. The seen count rides the same line because it answers the other question a player
 * opens this with, and both are about the same 815 things.
 */
function coverageText(counts) {
  const parts = [`${String(counts.table)} named from the table`];
  if (counts.roll > 0) {
    parts.push(`${String(counts.roll)} from a roll`);
  }
  if (counts.art > 0) {
    parts.push(`${String(counts.art)} from art files, a guess`);
  }
  if (counts.unnamed > 0) {
    parts.push(`${String(counts.unnamed)} by nothing`);
  }
  return `${parts.join(', ')}. Seen: ${String(seen.size)}.`;
}

/**
 * How many known ids draw as initials, and why. Held back until the art manifest has actually
 * been read, because until then `ui.icon.item` is optimistic and every id would count as
 * having art. Saying nothing is right for that window; saying zero would be a measurement
 * nobody took.
 *
 * On the coverage line's tooltip rather than in a line of its own: it is a caveat about the
 * grid, it is the same sentence every session, and a browser that spends two of its lines
 * explaining itself is the thing this window stopped being.
 */
function artText(counts) {
  if (!artKnown.on) {
    return 'Still reading the art manifest, so nothing has been counted yet.';
  }
  if (counts.artless === 0) {
    return 'Every item the codex knows of ships art.';
  }
  const share = `${String(counts.artless)} of ${String(counts.total)}`;
  return `${share} ship no art and draw as initials. Every weapon is one of them: weapon art is filed under a model name the game does not serve.`;
}

function say(el, said) {
  el.textContent = said;
  el.hidden = said === '';
}

woc.ui.tooltip(coverageLine, () => ({
  title: 'What the codex knows',
  lines: [artText(coverage()), { text: 'Hover a square for one item.', tone: 'muted' }],
}));

/**
 * The item the record describes, which is what the player picked or, until they pick one, the
 * first square in the grid. A record that sat empty under a full grid would make the panel look
 * like it had not finished loading, and the first square is a real answer to what is on screen.
 */
function showing(shown) {
  if (chosen.id !== '') {
    return chosen.id;
  }
  return text(shown[0]?.id);
}

function draw() {
  const found = results();
  const shown = found.slice(0, maxCells());
  const open = showing(shown);
  syncCells(shown, open);
  // A grid with nothing in it keeps its share of the panel and shows it as a hole, which reads
  // as a window that failed to draw rather than as a search that found nothing. Hidden, the
  // line under it saying so is where the eye lands.
  grid.hidden = shown.length === 0;
  paintChips();
  paintRecord(open);
  const counts = coverage();
  say(statusLine, statusText(found.length, shown.length));
  say(coverageLine, coverageText(counts));
}

/**
 * One repaint per animation frame however many things asked for one. A roll landing, a
 * sweep finding four new ids and a keystroke in the search field are three reasons to
 * redraw the same list, and doing it three times would rebuild every row three times.
 */
function schedulePaint() {
  if (scheduled.on) {
    return;
  }
  scheduled.on = true;
  woc.requestAnimationFrame(() => {
    scheduled.on = false;
    if (running.on) {
      draw();
    }
  });
}

/**
 * Give every marked element a codex tooltip, once. `described` is what keeps this to one
 * attach per element rather than one per sweep, and the loader's tooltip kit owns the other
 * half of the problem, which is an anchor removed while the pointer is over it.
 */
function describeMarked(root) {
  if (!describingMarked()) {
    forgetMarked();
    return;
  }
  const held = new Set(described.map((entry) => entry.el));
  for (const entry of described.splice(0)) {
    if (entry.el.isConnected) {
      described.push(entry);
    } else {
      held.delete(entry.el);
      entry.off();
    }
  }
  for (const el of root.querySelectorAll(`[${MARK_ATTR}]`)) {
    const itemId = text(el.getAttribute(MARK_ATTR));
    if (itemId !== '' && !held.has(el)) {
      described.push({ el, off: woc.ui.tooltip(el, () => describeItem(itemId)) });
    }
  }
}

/** Take every codex tooltip back, which is what turning the setting off means. */
function forgetMarked() {
  for (const entry of described.splice(0)) {
    entry.off();
  }
}

/**
 * Where a marked element is looked for: the whole document. A frame sits in a band inside
 * the loader's root rather than directly under it, and there is no published handle on that
 * root, so a scoped sweep would be inferring loader internals. The cost is one attribute
 * selector a second over a tree that is mostly the game's, which stays correct whatever the
 * loader does with its own layout next.
 */
function tooltipRoot() {
  return document;
}

/**
 * The sweep, which is also what makes the group subscription an optimisation. A watch key
 * fires on change and the world is already live by the time an addon's body runs, so a roll
 * that was open before this addon started fires no handler at all. Reading the group here
 * costs one field read a second and closes that window; `learnFromRoll` is guarded on the
 * id, so the two routes cannot teach the same name twice.
 */
function sweep() {
  const learned = collectSeen();
  learnFromGroup(woc.world.group);
  describeMarked(tooltipRoot());
  // Only on a change. A repaint resolves and sorts every id the codex knows, and sorting
  // 815 names through `localeCompare` is not free, so a sweep that found nothing must not
  // schedule one.
  if (learned) {
    schedulePaint();
  }
}

woc.keys.bind('toggle', () => {
  frame.toggle();
});

woc.onSettingsChange(() => {
  schedulePaint();
});

woc.world.on('group', (group) => {
  learnFromGroup(group);
});

// Answered with everything known: a subscriber asks precisely because it started after
// the batch went out.
woc.bus.on(woc.bus.anySender, ASK_TOPIC, () => {
  publishAll();
});

woc.setInterval(sweep, SWEEP_MS);

woc.onDispose(() => {
  running.on = false;
});

/**
 * Read the table, then say what can be drawn from it. The art manifest is preloaded
 * separately and not awaited before the first paint: the codex is readable without it and
 * only the art count depends on it. A failed read is not a reason to show nothing either,
 * which is why `loaded` is set on both paths: the panel then says the table could not be
 * read rather than sitting empty claiming to know nothing.
 */
async function boot() {
  const file = await woc.data(TABLE_FILE);
  const listed = readTable(file);
  if (listed === null) {
    throw new Error(`${TABLE_FILE} carries no "items" array`);
  }
  for (const row of listed) {
    table.set(row.id, row);
  }
  woc.log(
    `lorebind: ${String(listed.length)} items from the game's own table at ${readVersion(file)}`,
  );
  publishAll();
}

boot()
  .catch((err) => {
    woc.error('lorebind: the item table could not be read, so there is nothing to name', err);
  })
  .finally(() => {
    loaded.on = true;
    schedulePaint();
  });

woc.ui.icon
  .preloadItems()
  .then(() => {
    artKnown.on = true;
    schedulePaint();
  })
  .catch(() => {
    // Documented never to reject. Caught anyway, because a broken promise here would be an
    // unhandled rejection in the page the game is running in.
  });
