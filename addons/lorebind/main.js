/// <reference types="@woc-addons/types" />

// Lorebind: the item browser, and the name service the rest of the catalogue reads.
//
// An item id resolves to no name anywhere on the addon API: the game's item table is bundled
// into its own chunk, and equipment, inventory and recipes all hand over bare ids. Solving that
// once, for every addon, is what this is for.
//
// `resolve` is the only place the ranking is decided, and the order is load-bearing:
//   1. `items.json`, the game's own table, right by construction for every id it covers.
//   2. A loot roll's `itemName`, the same server table spelled out on the wire.
//   3. `ui.icon.itemArtName`, provenance for a picture and never a name, so it is labelled on
//      screen and never published.
// `ui.icon.item` is not a fourth source and names nothing. A null from it is not evidence an id
// is fake, since an item can ship before its art.
//
// SOURCE 3 ANSWERS FOR ALMOST NOTHING NOW, and it is worth knowing why it is still ranked
// rather than dropped. The manifest keeps a name only for a CURATED entry, and game 0.36.0
// moved almost the whole catalogue into unnamed generated batches: 307 named entries became
// 39. Where it does answer it currently agrees with the game, all 38 of the 39 that are items
// at all, so the last measured divergence (21 of 303, game 0.33.0) is gone. It stays third
// anyway, because what made it untrustworthy was never the count: nothing in the game compares
// the two, a content rename rewrites the item table and leaves the art provenance alone, and a
// source that happens to agree today is not one to put ahead of the table itself.
//
// NO COUNT OF THE TABLE IS WRITTEN DOWN HERE. Content moves it in one commit, so every count on
// screen is `table.size` as it is drawn.
//
// Quality, kind, slot and every number exist for a table id and for nothing else. An id from a
// roll has a name and a quality; one from an art file has neither, and says so rather than
// picking a plausible default.
//
// The bus is the product rather than the panel. `item` is one newly learned record, `items` is
// the batch an ask is answered with, and both carry `{ id, name, source }` plus `quality`,
// `kind`, `slot`, `armorType`, `set`, `heroicOf`, `requiredClass`, `sellValue`, `itemLevel` and
// `requiredLevel` where the table states them, with anything unknown left OUT rather than sent
// empty or as a zero. A subscriber on `item` alone hears its own ask answered and takes nothing
// from it: both topics or neither.

/** The frame, and the floor a resize may take it to: chrome plus exactly ONE row of art. */
const FRAME_TITLE = 'Lorebind';
const FRAME_WIDTH = 460;
const FRAME_HEIGHT = 660;
const FRAME_MIN_WIDTH = 340;
/**
 * Everything that is not the grid. Stated rather than measured: a size floor is settled when the
 * frame is built, before there is a layout to measure.
 */
const CHROME_HEIGHT = 400;

/**
 * One square of item art, and the gap between two of them. The square is the loader's, which
 * is the game's own bag cell: a grid of items should be the size the game draws one at, and
 * the figure this panel had picked for itself was two pixels off that by coincidence.
 */
const CELL_SIZE = woc.ui.itemCell;
const CELL_GAP = 4;
/** The record under the grid draws the same art larger, since it is one item rather than many. */
const DETAIL_SIZE = 56;
/** The art and the words beside it, and then the words against each other. */
const RECORD_GAP = 8;
const RECORD_LINE_GAP = 2;
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
 * The loader's class for a tier's TEXT, worn by the two things here that are neither a bar nor a
 * tile. A tier the game does not rank gets no class, leaving the panel's own colour; never a hex
 * of this addon's own, or two addons drawing an item would disagree about the palette.
 */
function qualityClass(quality) {
  if (QUALITIES.includes(quality)) {
    return `woc-quality-${quality}`;
  }
  return '';
}

/**
 * The game's twelve kinds, bucketed into six shelves. `other` is named as a bucket rather than
 * given a word that would be wrong for three of the four kinds in it. No tab hides anything,
 * since All is a tab.
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
 * The orders the grid can be read in: one lookup and three comparisons. Nothing sorts by id,
 * which is the one order no player thinks in.
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

// The topics. `item` is one record and `items` is a batch of them, which is what
// `woc.bus.publish` answers an ask with.
const ITEM_TOPIC = 'item';
const ITEMS_TOPIC = 'items';
/** The older ask topic, answered beside the `items:ask` `publish` derives. Drop next release. */
const LEGACY_ASK_TOPIC = 'item:ask';

/**
 * The whole of what a subscriber's `source` field means. A second publisher wording the same
 * evidence differently makes the field useless, so match these exactly.
 */
const SOURCE_TABLE = 'table';
const SOURCE_ROLL = 'loot roll';
const SOURCE_ART = 'art file';

/** What another addon marks an element with to borrow the codex for it. */
const MARK_ATTR = 'data-woc-item';

const MS_PER_SECOND = 1000;
/** How often the marked elements and the live id sources are re-read. */
const SWEEP_MS = MS_PER_SECOND;

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
 * The stat block in the game's own order and its own English, which an addon cannot translate
 * because the player's locale is out of reach. Armor rides `stats` with the attributes and is
 * drawn apart from them, as the game's tooltip does.
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

/**
 * Two numbers the game DRAWS as one, at `Math.min`. All 47 items carrying them state them
 * equal, which makes the min look like an identity: keep both, or an item raising one alone
 * would read as having raised the other too.
 */
const WARFARE_KEYS = ['pvpOffenseRating', 'pvpDefenseRating'];
const WARFARE_NAME = 'Warfare';

/**
 * The game's own mark for a heroic variant, and the ONLY thing that tells two identically named
 * rows apart: it resolves a variant's display name to its base's unchanged, so 63 pairs in the
 * table read as one name twice.
 */
const HEROIC_TAG = '[HEROIC]';

/** Every plain number the file may carry, checked by type and kept as it stands. */
const NUMBER_FIELDS = [
  'itemLevel',
  'pvpOffenseRating',
  'pvpDefenseRating',
  'priceHonor',
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
 * What the bus carries beyond the id, the name and the source: shorter than the table's own row,
 * and every field on it is one a consumer cannot work out for itself. The price is copper, the
 * unit the wire uses. `heroicOf` is what separates the 63 pairs that arrive as one name twice.
 * `uniqueEquipped` stays off: nothing draws equipment, and a published field with no reader is a
 * promise kept for nobody.
 *
 * `set` IS THE DISPLAY NAME AND NOT THE SET ID. The game names set bonuses and their proc auras
 * from the id ('emberscreed' procs `set_emberscreed_4pc`) while this publishes 'Creed of Embers
 * Vestments', so a consumer correlating a proc with a set must map name back to id itself.
 */
const PUBLISHED_TEXT = ['quality', 'kind', 'slot', 'armorType', 'set', 'heroicOf'];
const PUBLISHED_NUMBERS = ['sellValue', 'itemLevel', 'requiredLevel'];
/**
 * A LIST, so it is copied rather than handed over: the bus freezes the envelope and not the
 * payload, and a subscriber writing into the array would rewrite the table row. Absent means
 * wearable by everyone, never an empty list.
 */
const PUBLISHED_LISTS = ['requiredClass'];

/** How long the game says a sat-down consumable takes, `CONSUME_DURATION` in its own sim. */
const CONSUME_SECONDS = 18;
/** Seconds in a minute, for an elixir's duration. */
const MINUTE_SECONDS = 60;
/** How many decimals a swing speed and a damage-per-second figure are drawn to. */
const SPEED_DECIMALS = 1;
/** Two, for the halfway point between a weapon's two damage bounds. */
const HALF = 2;

/** A flag in a cell, so a handler and the paint path cannot hold different copies of it. */
function cell(value) {
  return { on: value };
}

/** The embedded table, id to `{ id, name, kind, quality?, slot? }`. Source 1. */
const table = new Map();
/** Names read off a loot roll this session, id to `{ name, quality }`. Source 2. */
const rolled = new Map();
/**
 * Every id proven to exist from somewhere other than the file: worn, carried, banked, mailed,
 * looted, crafted. None of those carries a name. One in here and not in the table is content
 * newer than the file, and the coverage line counts it rather than hiding it.
 */
const seen = new Set();
/** Ids already put on the bus, so a roll answered four times emits once. */
const published = new Set();
/**
 * Marked elements carrying a codex tooltip, and how to take each back. A list rather than a
 * WeakSet: holding the unsubscribes is what lets the setting mean something after the fact.
 * Disconnected entries are dropped on the next sweep, so a rebuilding list cannot grow it.
 */
const described = [];

/** Set once the data file has been read, or once reading it has failed. */
const loaded = cell(false);
/** Set once the item art manifest has been read, which makes `hasArt` exact. */
const artKnown = cell(false);

/**
 * Every filter at once. `qualities` empty means EVERY quality rather than none: six chips lit
 * says the same thing and would make the first press a narrowing to five.
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

/** No clamp: the manifest declares `min` and `max` and the loader has already applied them. */
function maxCells() {
  return Math.round(woc.settings['max-results']);
}

function learningFromRolls() {
  return woc.settings['learn-rolls'];
}

function describingMarked() {
  return woc.settings.tooltips;
}

/**
 * One row of the data file, checked, since `woc.data` hands back `unknown`. Quality and slot
 * are optional in the game's own table, so a row without one is ordinary and the field is left
 * absent rather than filled in.
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
  copyText(row, value, ['slot', 'armorType', 'set', 'heroicOf']);
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

/** A list the file states, copied so nothing downstream can write into the table's own row. */
function copyLists(row, value, keys) {
  for (const key of keys) {
    const said = value[key];
    if (Array.isArray(said) && said.length > 0) {
      row[key] = [...said];
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
  if (value.uniqueEquipped === true) {
    row.uniqueEquipped = true;
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
 * Source 3, and a guess. Guarded like anything reached through a game object: a future update
 * can leave something callable in place that throws, and that must cost a name, not the panel.
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
 * One-directional: a URL means the manifest lists the id, and a null is true of items that
 * certainly exist, so it is never read as evidence against one.
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
 * The ranking, in one function and nowhere else. A null `source` is a real answer: an id
 * nothing can name is not the same thing as an id that does not exist.
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
 * The roll's spelling when it disagrees with the file. The file still wins the display; the
 * disagreement is the only evidence available that the file has fallen behind the game.
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
 * One record for the bus, with anything unknown left OUT rather than sent empty: a subscriber
 * cannot tell an unknown quality from an empty one, and `sellValue: 0` is a real reading of an
 * item a vendor will not buy. Null for an art-sourced name, which would rank a guess above the
 * identical fallback the subscriber already has.
 */
function record(itemId) {
  const answer = resolve(itemId);
  if (answer.source === null || answer.source === SOURCE_ART) {
    return null;
  }
  const payload = { id: answer.id, name: answer.name, source: answer.source };
  copyText(payload, answer, PUBLISHED_TEXT);
  copyNumbers(payload, answer, PUBLISHED_NUMBERS);
  copyLists(payload, answer, PUBLISHED_LISTS);
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
 * Everything known, as ONE batch: delivery is synchronous, so a message per row would be a
 * repaint per row in every subscriber to say what one array says.
 *
 * It walks every id and lets `record` refuse rather than filtering first, so the refusal to
 * publish an art-sourced name stays reachable and under test. Null when there is nothing to
 * say, and that null is emitted: a follower cannot tell silence from an absent publisher.
 */
function everythingKnown() {
  const rows = [];
  for (const itemId of allIds()) {
    const payload = record(itemId);
    if (payload !== null) {
      published.add(itemId);
      rows.push(payload);
    }
  }
  if (rows.length === 0) {
    return null;
  }
  return rows;
}

/**
 * A roll is one of the very few places the wire spells an item out. Guarded on the held name,
 * and `publishItem` on the id, so a drop rolled on four times is one message.
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
 * Both places a roll is carried. They OVERLAP rather than nest: `rolls` is what you were asked
 * and drops the moment you answer, `rollStatus` is every open roll in the party and holds until
 * it resolves, so reading both gets the ids you could not have won.
 *
 * Master loot is invisible to both by a server-side guard, and its name rides an event the
 * published catalogue does not describe. Such a group teaches this fewer names.
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

/** `world.recipes` is content rather than state: no watch key, and one read is enough. */
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
 * On an interval rather than on watch keys: most of these have none, and the ones that do
 * report membership of a set rather than a field changing inside it.
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
 * What each source can name, counted rather than stored since the answer moves as rolls land.
 * Four figures rather than one total, which would fold a name right by construction together
 * with one taken off an art file.
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

/** Quality is a RANK rather than a word here, or the alphabet would put epic under poor. */
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
 * Highest first, since all three numeric orders are "best" questions, with the alphabet
 * breaking ties. A row the table has no answer for sorts to the BOTTOM rather than the top.
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
 * Whether one item survives the controls. An item with no kind is out of every tab but All: the
 * codex does not know its kind rather than knowing it is none of them.
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
 * Every id the codex knows of rather than only the file's, so one learned off a roll or seen in
 * the bags is findable at once. Untouched controls list everything.
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

function filled(part) {
  return part !== '';
}

/** The first letter up, for a word the game stores lower case and a reader reads as a label. */
function capitalized(word) {
  return word.slice(0, FIRST).toUpperCase() + word.slice(FIRST);
}

/**
 * `Uncommon armor, waist`. The quality is in the WORDS as well as the colour: a colour alone is
 * unreadable to anyone who cannot tell the two blues apart, and this line is what a screen
 * reader is given for a square that is nothing but art.
 */
function kindLine(row) {
  const parts = [qualityAndKind(row)];
  if (text(row.slot) !== '') {
    parts.push(readableSlot(row.slot));
  }
  return [parts.join(', '), heroicTag(row)].filter(filled).join(' ');
}

/**
 * Absent is not poor. The game declares no quality for 96 of its items, and leaving the word out
 * where every other row carries a tier reads as the lowest tier rather than as a fact nobody has.
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
 * On the kind line and never on the NAME, which is where the game puts it: a variant's display
 * name is its base's, and an addon spelling a different one would be wrong in the one place this
 * addon claims to be right. The square, its tooltip and the record all read that line.
 */
function heroicTag(row) {
  if (text(row.heroicOf) === '') {
    return '';
  }
  return HEROIC_TAG;
}

/**
 * The attribution, in WORDS rather than a colour or a symbol: colour means quality here, so a
 * caveat drawn in the same language would read as a tier.
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
 * Two letters for an item the game ships no art for: a grid of blank squares says nothing
 * about which blank is which. Empty where there IS art, or the figure would be a monogram
 * over a picture.
 *
 * Draws for nothing at game 0.36.0, which commissioned the last of it, weapons included. It
 * stays because the game keeps its own ledger of art it has not made yet and refills it
 * whenever content lands ahead of the painting.
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

/**
 * `Math.min`, as the game does. A pair with only one side stated therefore reads as nothing,
 * which is the game's answer too.
 */
function warfareRating(row) {
  const [offense, defense] = WARFARE_KEYS.map((key) => row[key] ?? 0);
  return Math.min(offense, defense);
}

/** Every stat the item carries, one per entry: the attributes, then Warfare, then the affixes. */
function statLines(row) {
  const parts = [];
  for (const key of STAT_ORDER) {
    const value = row.stats?.[key];
    if (value !== undefined && key !== 'armor') {
      parts.push(`+${String(value)} ${STAT_NAME[key]}`);
    }
  }
  const warfare = warfareRating(row);
  if (warfare > 0) {
    parts.push(`+${String(warfare)} ${WARFARE_NAME}`);
  }
  for (const [key, name] of Object.entries(RATING_NAME)) {
    if (row[key] !== undefined) {
      parts.push(`+${String(row[key])} ${name}`);
    }
  }
  return parts;
}

/**
 * The four shapes the game keeps a consumable's effect in. Not named `useLine`: Biome reads a
 * `use` prefix as a React hook and refuses one called after an early return.
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
 * What it takes to use it and what it is worth. The classes are the game's ids title-cased,
 * which is a guess that happens to be right: there is no class table to read.
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
  parts.push(...wearLines(row));
  if (row.sellValue !== undefined) {
    parts.push(`Sell price: ${woc.ui.money(row.sellValue)}`);
  }
  if (row.priceHonor !== undefined) {
    parts.push(`Honor price: ${String(row.priceHonor)}`);
  }
  return parts;
}

/**
 * Unique-equipped is a rule about a FAMILY rather than an id: a variant and its base are one
 * item for it. The base ID is drawn rather than its name, which is by definition the word
 * already on screen, and the flag is the game's own derivation carried in the table.
 */
function wearLines(row) {
  const parts = [];
  if (row.uniqueEquipped === true) {
    parts.push('Unique-Equipped, so one worn copy per item');
  }
  if (text(row.heroicOf) !== '') {
    parts.push(`Heroic upgrade of ${row.heroicOf}`);
  }
  if (row.soulbound === true) {
    parts.push('Soulbound');
  }
  return parts;
}

/** Stats are `good` and gates are `muted`: what the item gives you, and what it asks first. */
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
 * Built when the pointer lands, because the answer moves: a roll landing changes an item's
 * source. Not redundant with the record, which holds one item still while the pointer moves.
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
  toggleKey: 'toggle',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  density: 'comfortable',
  closable: true,
  save: true,
  // Closed until asked for: a browser of the whole game is a thing a player opens, and `save`
  // gives it back to one who left it open.
  visible: false,
  resizable: true,
  minWidth: FRAME_MIN_WIDTH,
  minHeight: CHROME_HEIGHT + CELL_SIZE,
});

// A column, so the grid takes what is left and scrolls while the controls and record stay put.
frame.body.style.display = 'flex';
frame.body.style.flexDirection = 'column';
frame.body.style.gap = '8px';
frame.body.style.minHeight = '0';

/**
 * `align: 'end'` rather than baseline: every item is a label stacked OVER a control, so a
 * baseline would line up the labels and leave the controls at four different heights.
 */
function strip(role) {
  const el = woc.ui.row({
    parent: frame.body,
    className: 'woc-lorebind-strip',
    wrap: true,
    align: 'end',
  });
  el.dataset.role = role;
  return el;
}

/**
 * A footnote about the grid, drawn as a caption: at the panel's own size these two lines would
 * take three of the rows of art the window exists to show.
 */
function line(role) {
  const el = woc.ui.line({ parent: frame.body, className: 'woc-lorebind-line', tone: 'muted' });
  el.dataset.role = role;
  return el;
}

/** Tabs rather than a sixth dropdown: six shelves moved between constantly is navigation. */
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
 * The word in the game's own colour for its tier, which is how a player reads an item list.
 * `aria-pressed` as well as the styling: a toggle that only LOOKS pressed says nothing aloud.
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
    // `currentColor`: the loader's class has already set the text to the tier's colour, so the
    // edge follows without this file holding a hex.
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
 * The one filter about the PLAYER rather than the game: what this character has laid eyes on,
 * which is the closest thing the codex has to a collection.
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
 * A wrapping track list rather than a column of rows: art IS the label in this game, and eight
 * squares across put a shelf on screen where eight rows are half a screenful. No column count,
 * so the browser refits on every resize.
 */
const grid = document.createElement('div');
grid.className = 'woc-lorebind-grid';
grid.style.display = 'grid';
grid.style.gridTemplateColumns = `repeat(auto-fill, ${String(CELL_SIZE)}px)`;
grid.style.gap = `${String(CELL_GAP)}px`;
// Room for the chosen square's ring, which is drawn OUTSIDE the cell's box and is otherwise
// clipped by the scroll box on the top row and both edges.
grid.style.padding = `${String(CHOSEN_RING_PX + 1)}px`;
grid.style.justifyContent = 'center';
grid.style.alignContent = 'start';
// Sized by content rather than grown to fill, or an underfull grid holds a band of nothing
// between the last row of art and the record.
grid.style.flex = '0 1 auto';
// A flex item's floor is its content, so without this 120 squares push the window open.
grid.style.minHeight = `${String(CELL_SIZE * GRID_FLOOR_ROWS + CELL_GAP)}px`;
grid.style.overflowY = 'auto';
grid.style.overscrollBehavior = 'contain';
frame.body.appendChild(grid);

/**
 * One item, spelled out, and not a substitute for the tooltip: a player comparing two helmets
 * needs one of them to stay on screen while the pointer is over the other.
 *
 * Aligned to the top, since art centred against six lines floats away from its name.
 */
const detail = woc.ui.row({
  parent: frame.body,
  className: 'woc-lorebind-record',
  align: 'start',
  gap: RECORD_GAP,
});
detail.dataset.role = 'record';
// Two lines for a lump of ore and eleven for a legendary, so the GRID gives way rather than the
// record: it answers the click the player just made. Past its share it scrolls.
detail.style.flex = '0 0 auto';
detail.style.minHeight = `${String(DETAIL_SIZE)}px`;
detail.style.maxHeight = `${String(DETAIL_SHARE_PCT)}%`;
detail.style.overflowY = 'auto';
detail.style.overscrollBehavior = 'contain';
detail.style.borderTop = '1px solid var(--color-border-default, rgb(78 61 29))';
detail.style.paddingTop = '6px';

const recordArt = woc.ui.tile({ className: 'woc-lorebind-record-art', size: DETAIL_SIZE });
detail.appendChild(recordArt.el);

const recordText = woc.ui.column({ parent: detail, gap: RECORD_LINE_GAP });
// A flex item is as wide as its longest line, so without this a legendary's longest sentence
// pushes the record wider than the panel instead of wrapping.
recordText.style.minWidth = '0';

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
 * ONE FACT PER LINE, as the game's own item tooltip reads. A player comparing two helmets scans
 * a column; a comma-joined list is a paragraph, and it runs off the edge of the panel.
 */
const recordBlock = woc.ui.column({ parent: recordText, gap: 0 });
recordBlock.dataset.role = 'block';

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

/** Rebuilt rather than diffed: six elements at most, and only when another square is picked. */
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

/**
 * The id the record is describing. Held rather than passed, since `ui.list` hands `update` the
 * item and its index and this is one fact about the whole sync.
 */
const open = cell('');

/** Select an item, which is what a click on a square means. */
function choose(itemId) {
  chosen.id = itemId;
  schedulePaint();
}

/**
 * A tile rather than a bar: this panel's names are in the record below, so a square is art with
 * room for a figure. The role and the tabindex are ours to add, since a tile says nothing about
 * whether it does anything, and one that answers a click has to answer Enter too.
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
  return tile;
}

/**
 * An outline rather than the border, which is the item's QUALITY: a selected epic would
 * otherwise stop being purple exactly while the player is reading it hardest.
 */
function markChosen(tile, itemId) {
  tile.el.style.outline = '';
  tile.el.style.outlineOffset = '';
  if (itemId === open.on) {
    tile.el.style.outline = CHOSEN_OUTLINE;
    tile.el.style.outlineOffset = '1px';
  }
}

/**
 * Keyed on the id rather than a position, so a square the sort moved is the same square: a
 * re-inserted element loses hover and focus and fires no leave event to say so.
 */
const cells = woc.ui.list({
  parent: grid,
  key: (row) => row.id,
  create: (row) => addCell(row.id),
  update: (tile, row) => {
    // The accessible name of a square that is nothing but art, so it carries what the picture
    // and the border say together.
    tile.update({
      label: `${rowLabel(row)}, ${kindLine(row)}`,
      icon: artUrl(row.id),
      value: initials(row),
      quality: qualityOf(row),
    });
    markChosen(tile, row.id);
  },
});

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
  // The tier the square carries, so the record reads as that square enlarged.
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
    return `Showing ${String(drawn)} of ${woc.fmt.count(found, 'item')}. Narrow it to see the rest.`;
  }
  return `Showing ${woc.fmt.count(found, 'item')}.`;
}

/**
 * Four figures rather than one total: a name off the table and a name off an art file are not
 * the same kind of fact, and saying which is this addon's whole claim.
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
 * Held back until the art manifest has landed: `ui.icon.item` is optimistic until then, so a
 * figure now would be a measurement nobody took. On a tooltip rather than a line of its own,
 * since it is the same caveat every session.
 */
function artText(counts) {
  if (!artKnown.on) {
    return 'Still reading the art manifest, so nothing has been counted yet.';
  }
  if (counts.artless === 0) {
    return 'Every item the codex knows of ships art.';
  }
  const share = `${String(counts.artless)} of ${String(counts.total)}`;
  return `${share} ship no art and draw as initials. The game commissions art behind content, so this empties and refills as it catches up.`;
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
 * What the player picked, or the first square until they pick one: an empty record under a full
 * grid reads as a panel that has not finished loading.
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
  open.on = showing(shown);
  cells.sync(shown);
  // Hidden rather than empty, or the hole where the grid was reads as a window that failed to
  // draw rather than as a search that found nothing.
  woc.ui.show(grid, shown.length > 0);
  paintChips();
  paintRecord(open.on);
  const counts = coverage();
  say(statusLine, statusText(found.length, shown.length));
  say(coverageLine, coverageText(counts));
}

/** No `{ frame }`: the panel is closed most of the time and its figures must stay current. */
const schedulePaint = woc.paint(draw);

/** One attach per marked element rather than one per sweep, which is what `described` holds. */
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
 * The whole document, since no published handle reaches the loader's root and a scoped sweep
 * would be inferring its layout. One attribute selector a second.
 */
function tooltipRoot() {
  return document;
}

/**
 * What makes the group subscription an optimisation rather than the source: a watch key fires
 * on CHANGE, so a roll open before this addon started fires no handler at all. `learnFromRoll`
 * is guarded on the id, so the two routes cannot teach one name twice.
 */
function sweep() {
  const learned = collectSeen();
  learnFromGroup(woc.world.group);
  describeMarked(tooltipRoot());
  // Only on a change: a repaint sorts eight hundred names through `localeCompare`.
  if (learned) {
    schedulePaint();
  }
}

woc.onSettingsChange(() => {
  schedulePaint();
});

woc.world.on('group', (group) => {
  learnFromGroup(group);
});

/** Every ask answered with everything known, since a subscriber asks because it started late. */
const publication = woc.bus.publish(ITEMS_TOPIC, everythingKnown);

// The older ask topic, answered beside the derived one. Drop next release.
woc.bus.on(woc.bus.anySender, LEGACY_ASK_TOPIC, publication.announce);

woc.setInterval(sweep, SWEEP_MS);

/**
 * The art manifest is not awaited: only the art count depends on it. `loaded` is set on both
 * paths, so a failed read says so rather than sitting empty claiming to know nothing.
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
  publication.announce();
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
