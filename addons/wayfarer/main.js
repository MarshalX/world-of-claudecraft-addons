/// <reference types="@woc-addons/types" />

// Wayfarer: an atlas. Where everything is, how far, which way, and which zone you are in.
//
// The zone is resolved from this addon's own rectangles rather than from the loader, and
// the refusal is the feature: the game's `zoneAt(x, z)` clamps to a nearest band, so it
// names a real overworld zone for a player standing in a dungeon. `zoneContaining` below
// is its strict sibling, copied from `src/sim/data.ts`.
//
// An arrow is the CHARACTER's heading, not the camera's. The camera's yaw is on the
// renderer and nothing publishes it, and the heading itself is the last one the server
// confirmed, so an arrow lags a fast spin by a round trip.
//
// `world.zone` is a LOCALIZED label. Draw it, never compare it.
//
// A pin's height is always an inference: the atlas carries x and z and no y, and no
// server sends ground height. Each pillar says which answer it stands on.
//
// The atlas file is `atlas.json`; see `generate.mjs` for what is in it and why.

const DATA_FILE = 'atlas.json';
const MS_PER_SECOND = 1000;
const FRAME_WIDTH = 320;
/** How narrow the panel may be dragged, which is about where a place name starts to cut. */
const MIN_FRAME_WIDTH = 220;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How far an arrow must have turned before it is worth writing a transform again. */
const BEARING_STEP_DEG = 1;
const ARROW_PX = 13;
/** The arrow, ours, on the 512 box the game draws its own icons on. */
const ARROW_PATH = 'M256 40 448 452 256 356 64 452Z';

/** Yards the game marks a point of interest visited from, `POI_VISIT_RADIUS`. */
const VISIT_RADIUS = 20;
/** How close an entity has to be to a point to stand in for its ground height. */
const SAMPLE_YARDS = 6;
/** A level range is a floor and a ceiling, and a row carrying anything else is broken. */
const LEVEL_PAIR = 2;

/** How many pins may be in the world at once. */
const MAX_PINS = 12;
/** How close two pins may land on screen before the farther one is dropped. */
const PIN_SPACING_PX = 56;
/** The pillar under a pin, thin enough to point at one spot rather than cover it. */
const PILLAR_PX = 22;
const PILLAR_WIDTH_PX = 2;
const CHIP_FONT_PX = 11;
/** What a chip is drawn on, so the world behind it cannot take the label away. */
const CHIP_BACKDROP = 'rgb(6 6 10 / 55%)';

/** An empty count, and a whole one: a full bar, a one-item floor, a first character. */
const NONE = 0;
const FULL = 1;

const CATEGORY_SETTING = {
  town: 'show-towns',
  poi: 'show-points',
  graveyard: 'show-graveyards',
  portal: 'show-portals',
  mailbox: 'show-mailboxes',
  station: 'show-stations',
};

/**
 * The views the strip offers. `icon` must be one the HUD markup SHIPS, since `gameGlyph`
 * clones a drawn node: a name the game only builds on demand leaves the slot empty forever.
 */
const VIEWS = [
  { id: 'all', label: 'All', icon: 'map', categories: null },
  { id: 'explore', label: 'Explore', icon: 'target', categories: ['poi', 'town'] },
  { id: 'travel', label: 'Travel', icon: 'swap', categories: ['portal', 'graveyard'] },
  { id: 'service', label: 'Service', icon: 'crafting', categories: ['mailbox', 'station'] },
];

/** Which view is open. Deliberately not persisted: it is navigation, not a setting. */
let view = VIEWS[0].id;

const CATEGORY_LABEL = {
  town: 'Town',
  poi: 'Point of interest',
  graveyard: 'Graveyard',
  portal: 'Portal',
  mailbox: 'Mailbox',
  station: 'Crafting station',
};

const PILLAR_STYLE = { sampled: 'dashed', guessed: 'dotted' };

const HEIGHT_WORDS = {
  sampled: 'sits at the height of something that was standing there',
  guessed: 'sits at your own height, because nothing was near enough to measure',
};

const UNKNOWN_PLACE = Object.freeze({ kind: 'unknown', zone: null });
const INSTANCE_PLACE = Object.freeze({ kind: 'instance', zone: null });
const NOWHERE_PLACE = Object.freeze({ kind: 'nowhere', zone: null });

/**
 * Empty until the data file lands, which every session begins without. Nothing is
 * special-cased: no rectangle contains anything in an empty list.
 */
let zones = [];
let bounds = null;
let fixed = [];

/** Entry id to a SAMPLED height, kept once found. A guess is never stored: see `heightFor`. */
const heights = new Map();

/** The place and zone id last published, so a repeat of the same answer is not re-emitted. */
let publishedKey = '';

/**
 * Per-sync context, which is the one thing a list's `update` cannot be handed: it takes the
 * item and its index and this is neither. Named apart from the `visited` passed around below.
 */
let syncVisited = null;

/** A number from the file, or the fallback for a field the file left out. */
function orElse(value, fallback) {
  if (Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/** `id` is FROZEN content: a deed visit keys on it, and the game re-words labels freely. */
function readPoi(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, label, x, z, town, hidden } = value;
  const named = typeof id === 'string' && id.length > NONE && typeof label === 'string';
  if (named && label.length > NONE && Number.isFinite(x) && Number.isFinite(z)) {
    return { id, label, x, z, town: town === true, hidden: hidden === true };
  }
  return null;
}

/**
 * One zone rectangle, or null for a row that could never answer a containment test. A zone
 * with no x bounds is the full-width strip, NOT a zone of zero width.
 */
function readZone(value, strip) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, name, zMin, zMax, xMin, xMax, levelRange, pois } = value;
  const named = typeof id === 'string' && id.length > NONE && typeof name === 'string';
  const banded = Number.isFinite(zMin) && Number.isFinite(zMax) && zMax > zMin;
  const ranked =
    Array.isArray(levelRange) &&
    levelRange.length === LEVEL_PAIR &&
    levelRange.every(Number.isFinite);
  if (!(named && banded && ranked && Array.isArray(pois))) {
    return null;
  }
  return {
    id,
    name,
    zMin,
    zMax,
    xMin: orElse(xMin, strip.stripMinX),
    xMax: orElse(xMax, strip.stripMaxX),
    levelRange,
    pois: keep(pois, readPoi, `point of interest in ${id}`),
  };
}

function readPlace(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, label, x, z } = value;
  const named = typeof id === 'string' && id.length > NONE && typeof label === 'string';
  if (named && label.length > NONE && Number.isFinite(x) && Number.isFinite(z)) {
    return { id, label, x, z };
  }
  return null;
}

function readSide(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { x, z } = value;
  if (Number.isFinite(x) && Number.isFinite(z)) {
    return { x, z };
  }
  return null;
}

/** One portal pair. Both sides, or neither: half a pair leads nowhere. */
function readPortal(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, label, radius, a, b } = value;
  const named = typeof id === 'string' && id.length > NONE && typeof label === 'string';
  const here = readSide(a);
  const there = readSide(b);
  if (named && here !== null && there !== null && Number.isFinite(radius) && radius > NONE) {
    return { id, label, radius, a: here, b: there };
  }
  return null;
}

function readBounds(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { stripMinX, stripMaxX, instanceXBase } = value;
  const wide = Number.isFinite(stripMinX) && Number.isFinite(stripMaxX) && stripMaxX > stripMinX;
  if (wide && Number.isFinite(instanceXBase)) {
    return { stripMinX, stripMaxX, instanceXBase };
  }
  return null;
}

function readAtlas(file) {
  if (typeof file !== 'object' || file === null) {
    return null;
  }
  const { world, zones: listed, graveyards, mailboxes, portals } = file;
  const strip = readBounds(world);
  const lists = [listed, graveyards, mailboxes, portals].every(Array.isArray);
  if (strip === null || !lists) {
    return null;
  }
  return { strip, listed, graveyards, mailboxes, portals };
}

/** Keep what checked out and name what did not, rather than throwing the file away. */
function keep(listed, read, what) {
  const kept = [];
  for (const [at, value] of listed.entries()) {
    const row = read(value);
    if (row === null) {
      woc.warn(`${DATA_FILE}: ${what} ${String(at)} did not check out, leaving it out`, value);
    } else {
      kept.push(row);
    }
  }
  return kept;
}

/**
 * The zone containing a point, or null. Half-open on BOTH axes and no fallback, unlike the
 * game's `zoneAt`. The x test is not optional: Farshore Isle shares Eastbrook Vale's z band.
 */
function zoneContaining(x, z) {
  for (const zone of zones) {
    if (z >= zone.zMin && z < zone.zMax && x >= zone.xMin && x < zone.xMax) {
      return zone;
    }
  }
  return null;
}

function zoneIdAt(x, z) {
  return zoneContaining(x, z)?.id ?? null;
}

/** This addon's own label for a zone id, and never `world.zone`. */
function zoneName(id) {
  return zones.find((zone) => zone.id === id)?.name ?? id;
}

/** The key the game files an exploration visit under, from `src/sim/deeds.ts`. */
function visitKey(zoneId, poiId) {
  return `poi:${zoneId}:${poiId}`;
}

/** A town is the point of interest standing on its zone's own hub, not a second row. */
function poiCategory(poi) {
  if (poi.town) {
    return 'town';
  }
  return 'poi';
}

function poiEntry(zone, poi) {
  const category = poiCategory(poi);
  return {
    id: `${category}:${zone.id}:${poi.id}`,
    label: poi.label,
    category,
    zone: zone.id,
    x: poi.x,
    z: poi.z,
    visit: visitKey(zone.id, poi.id),
    leadsTo: null,
  };
}

function placeEntry(place, category) {
  return {
    id: `${category}:${place.id}`,
    label: place.label,
    category,
    zone: zoneIdAt(place.x, place.z),
    x: place.x,
    z: place.z,
    visit: null,
    leadsTo: null,
  };
}

/** One row per SIDE, because each side is somewhere the player can actually stand. */
function portalEntries(portal) {
  const sides = [
    { side: 'a', here: portal.a, there: portal.b },
    { side: 'b', here: portal.b, there: portal.a },
  ];
  return sides.map((pair) => {
    const place = { id: `${portal.id}:${pair.side}`, label: portal.label, ...pair.here };
    const entry = placeEntry(place, 'portal');
    entry.leadsTo = zoneIdAt(pair.there.x, pair.there.z);
    return entry;
  });
}

function buildFixed(atlas) {
  const built = [];
  for (const zone of zones) {
    for (const poi of zone.pois) {
      // A hidden poi is one the game stopped drawing on its own map because the
      // place no longer reads as a landmark (game 0.40.1 put the harbor-town
      // plat over the Sowfield). Walking somebody to one is this addon's worst
      // failure, so it is left out of the list. It stays in the exploration
      // tally below, where the game still counts it.
      if (!poi.hidden) {
        built.push(poiEntry(zone, poi));
      }
    }
  }
  for (const place of keep(atlas.graveyards, readPlace, 'graveyard')) {
    built.push(placeEntry(place, 'graveyard'));
  }
  for (const place of keep(atlas.mailboxes, readPlace, 'mailbox')) {
    built.push(placeEntry(place, 'mailbox'));
  }
  for (const portal of keep(atlas.portals, readPortal, 'portal')) {
    built.push(...portalEntries(portal));
  }
  return built;
}

function adopt(atlas) {
  bounds = atlas.strip;
  zones = keep(atlas.listed, (value) => readZone(value, atlas.strip), 'zone');
  fixed = buildFixed(atlas);
}

function drawDistance() {
  return woc.settings['draw-distance'];
}

function listLength() {
  return Math.max(FULL, Math.round(woc.settings['list-length']));
}

const head = document.createElement('div');
head.className = 'woc-wf-head';
head.style.fontWeight = '600';

const minimap = document.createElement('div');
minimap.className = 'woc-wf-minimap';
minimap.style.opacity = '0.6';
minimap.style.padding = '0 0 4px';

const tabStrip = document.createElement('nav');
tabStrip.className = 'woc-tabs woc-wf-tabs';

const list = document.createElement('div');
list.className = 'woc-wf-list';
list.style.display = 'flex';
list.style.flexDirection = 'column';
list.style.gap = '2px';
list.style.padding = '4px 0';

const note = document.createElement('div');
note.className = 'woc-wf-note';
note.style.opacity = '0.6';

/**
 * The WIDTH is the player's and the height is the content's. The row count is a setting
 * rather than a function of the box, so a height this frame owned could only do nothing or
 * clip; the width is a list of place names, which are as long as the game made them.
 */
const frame = woc.ui.frame({
  id: 'atlas',
  title: 'Wayfarer',
  width: FRAME_WIDTH,
  resizable: 'width',
  // Stated, or the width it opens at is also the narrowest it can ever be.
  minWidth: MIN_FRAME_WIDTH,
  density: 'comfortable',
  closable: true,
  save: true,
});
frame.body.appendChild(head);
frame.body.appendChild(minimap);
frame.body.appendChild(tabStrip);
frame.body.appendChild(list);
frame.body.appendChild(note);

/**
 * One of the game's own icons, cloned out of the running HUD, or null before there is one.
 *
 * The icon set is markup in a module that is not on `__game` and no file is served for any
 * of it, so a clone of the hydrated node is the only route. Null until the HUD mounts.
 */
function gameGlyph(name) {
  const drawn = document.querySelector(`[data-icon="${name}"] > svg`);
  if (drawn === null) {
    return null;
  }
  const copy = drawn.cloneNode(true);
  copy.classList.add('woc-wf-glyph');
  // Deliberately not `data-icon`: the game's hydration keys on that and would redraw into
  // this clone on the next HUD mount.
  copy.setAttribute('data-from', name);
  // The game's own `.ui-icon` sizing, restated so a tighter scope there cannot blank the strip.
  copy.style.width = '1em';
  copy.style.height = '1em';
  return copy;
}

/** Held by view id so a glyph can be dropped in once the HUD has one. */
const tabButtons = new Map();

/** Light the open one, and say which it is rather than only colouring it. */
function paintTabs() {
  for (const [id, button] of tabButtons) {
    const on = id === view;
    button.classList.toggle('woc-tab-active', on);
    button.setAttribute('aria-current', String(on));
  }
}

/**
 * Hand-rolled rather than `ui.tabs`, whose tabs take a label and nothing else: the glyph has
 * to be a LIVE node, both to inherit `currentColor` and to be dropped in once the HUD mounts.
 */
function createTab(spec) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'woc-tab woc-wf-tab';
  button.dataset.view = spec.id;
  button.style.display = 'inline-flex';
  button.style.alignItems = 'center';
  button.style.gap = '5px';
  const text = document.createElement('span');
  text.textContent = spec.label;
  button.appendChild(text);
  button.addEventListener('click', () => {
    if (view === spec.id) {
      return;
    }
    view = spec.id;
    paintTabs();
    redraw();
  });
  tabStrip.appendChild(button);
  return button;
}

for (const spec of VIEWS) {
  tabButtons.set(spec.id, createTab(spec));
}
paintTabs();

/**
 * From the redraw rather than once at build, because the HUD mounts long after an addon's
 * first line. Each tab stops asking once it has one.
 */
function fillGlyph(spec) {
  const button = tabButtons.get(spec.id);
  if (button === undefined || button.querySelector('.woc-wf-glyph') !== null) {
    return;
  }
  const glyph = gameGlyph(spec.icon);
  if (glyph !== null) {
    button.insertBefore(glyph, button.firstChild);
  }
}

function fillGlyphs() {
  for (const spec of VIEWS) {
    fillGlyph(spec);
  }
}

function viewCategories() {
  return VIEWS.find((spec) => spec.id === view)?.categories ?? null;
}

/** The player, or null before world entry. Read live: it is replaced on a switch. */
function player() {
  const { player: me } = woc.world;
  if (me === null || me === undefined) {
    return null;
  }
  return me;
}

/**
 * Where the player is: a zone, an instance, nowhere, or not knowable yet. The instance test
 * is deliberately wider than the game's `DUNGEON_X_THRESHOLD`; there is no land out there.
 */
function currentPlace() {
  const me = player();
  if (me === null || bounds === null) {
    return UNKNOWN_PLACE;
  }
  if (me.pos.x >= bounds.instanceXBase) {
    return INSTANCE_PLACE;
  }
  const zone = zoneContaining(me.pos.x, me.pos.z);
  if (zone === null) {
    return NOWHERE_PLACE;
  }
  return { kind: 'zone', zone };
}

/** The arrow, which is ours: nothing in the game points anywhere. */
function createArrow() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 512 512');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('woc-wf-arrow');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ARROW_PATH);
  svg.appendChild(path);
  svg.style.width = `${String(ARROW_PX)}px`;
  svg.style.height = `${String(ARROW_PX)}px`;
  svg.style.flex = '0 0 auto';
  svg.style.opacity = '0.8';
  return svg;
}

function sampleHeight(entry) {
  let best = null;
  let nearest = SAMPLE_YARDS;
  for (const other of woc.world.entities.values()) {
    const away = Math.hypot(other.pos.x - entry.x, other.pos.z - entry.z);
    if (away <= nearest) {
      nearest = away;
      best = other.pos.y;
    }
  }
  return best;
}

/**
 * The height under a point and where it came from, or null with no world. A sample is kept;
 * a guess is recomputed, because it is the player's own height and the player moves.
 */
function heightFor(entry) {
  const known = heights.get(entry.id);
  if (known !== undefined) {
    return known;
  }
  const me = player();
  if (me === null) {
    return null;
  }
  const sampled = sampleHeight(entry);
  if (sampled === null) {
    return { y: me.pos.y, from: 'guessed' };
  }
  const found = { y: sampled, from: 'sampled' };
  heights.set(entry.id, found);
  return found;
}

/** Where a pin sits, in the shape `ui.anchor3d` and `ui.project` both take. */
function pointOf(entry) {
  const height = heightFor(entry);
  if (height === null) {
    return null;
  }
  return { x: entry.x, y: height.y, z: entry.z };
}

function provenance(entry) {
  return heightFor(entry)?.from ?? 'guessed';
}

/**
 * The crafting stations, from the loader rather than the file. Empty, not null, before world
 * entry. The title-cased type id is a LAST RESORT, and each row says so on its second line:
 * the game publishes no display name for a station at all.
 */
function stationEntries() {
  const built = [];
  for (const station of woc.world.stations) {
    built.push({
      id: `station:${station.id}`,
      label: woc.fmt.titleCase(station.type),
      category: 'station',
      zone: station.zoneId,
      x: station.pos.x,
      z: station.pos.z,
      visit: null,
      leadsTo: null,
    });
  }
  return built;
}

/**
 * Two filters, not one: the setting is permanent and the open tab is momentary. The footer's
 * counts are taken after both, so the whole panel answers about the tab in front of you.
 */
function categoryAllows(entry) {
  if (!woc.settings[CATEGORY_SETTING[entry.category]]) {
    return false;
  }
  const only = viewCategories();
  return only === null || only.includes(entry.category);
}

/**
 * Everything worth a row, nearest first, and only from the zone the player stands in. A
 * point across a border is genuinely left out: that is the cost of a list headed by a zone.
 */
function inRange() {
  const place = currentPlace();
  if (place.kind !== 'zone') {
    return [];
  }
  const reach = drawDistance();
  const shown = [];
  for (const entry of [...fixed, ...stationEntries()]) {
    const away = woc.world.distanceTo(entry);
    const here = entry.zone === place.zone.id && categoryAllows(entry);
    if (here && away !== null && away <= reach) {
      shown.push({ entry, away });
    }
  }
  return shown.sort((a, b) => a.away - b.away);
}

/**
 * The visited set, or null when the deed sheet cannot be read yet. The COUNTERS decide that,
 * not the set: an empty set is both a fresh explorer and a missing sheet, while the game
 * writes every counter key at 0 client-side, so an empty counters record means not arrived.
 */
function visitedSet() {
  const stats = woc.world.character?.deedStats;
  const counters = stats?.counters;
  if (typeof counters !== 'object' || counters === null) {
    return null;
  }
  if (Object.keys(counters).length === NONE || !(stats.visited instanceof Set)) {
    return null;
  }
  return stats.visited;
}

function exploredIn(zone, visited) {
  if (visited === null) {
    return null;
  }
  return zone.pois.filter((poi) => visited.has(visitKey(zone.id, poi.id))).length;
}

function zoneHeading() {
  const place = currentPlace();
  if (place.kind === 'zone') {
    const [from, to] = place.zone.levelRange;
    return `${place.zone.name}, levels ${String(from)} to ${String(to)}`;
  }
  if (place.kind === 'unknown') {
    return 'Wayfarer';
  }
  return 'Not in the open world';
}

/** The game's own minimap label, drawn and never compared against anything here. */
function minimapText() {
  const shown = woc.world.zone;
  if (typeof shown !== 'string' || shown.length === NONE) {
    return '';
  }
  return `Minimap: ${shown}`;
}

/** Why there is nothing on screen, because an empty list is never a measurement. */
function emptyNote() {
  const place = currentPlace();
  if (place.kind === 'instance') {
    return 'Inside an instance. This atlas is the open world only, so it names no zone here.';
  }
  if (place.kind === 'nowhere') {
    return 'Outside every zone rectangle in this atlas, so there is nothing to measure.';
  }
  if (zones.length === NONE) {
    return 'Reading the atlas.';
  }
  if (place.kind === 'unknown') {
    return 'Waiting for the world.';
  }
  return `Nothing within ${String(Math.round(drawDistance()))} yd of you in ${place.zone.name}.`;
}

function exploredPart(zone, visited) {
  const explored = exploredIn(zone, visited);
  if (explored === null) {
    return 'deeds unread';
  }
  return `${String(explored)}/${String(zone.pois.length)} explored`;
}

/** Every limit, including the two constant ones: a limit nobody can see reads as no limit. */
function limits(counts, zone, visited) {
  const parts = [];
  if (woc.settings['show-visited']) {
    parts.push(exploredPart(zone, visited));
  }
  if (counts.total > counts.listed) {
    parts.push(`${String(counts.total - counts.listed)} more in range`);
  }
  if (counts.total > counts.pinned) {
    parts.push(`${String(counts.pinned)} pins max`);
  }
  parts.push('heights estimated');
  return parts;
}

function noteText(counts, visited) {
  const place = currentPlace();
  if (counts.listed === NONE || place.kind !== 'zone') {
    return emptyNote();
  }
  return limits(counts, place.zone, visited).join(' · ');
}

function visitLine(entry, visited) {
  if (entry.visit === null) {
    return { text: 'Nothing is marked for standing here', tone: 'muted' };
  }
  if (visited === null) {
    return { text: 'Your deed progress cannot be read yet' };
  }
  if (visited.has(entry.visit)) {
    return { text: 'You have stood here', tone: 'muted' };
  }
  return { text: `Stand within ${String(VISIT_RADIUS)} yd to mark it explored` };
}

function kindLine(entry) {
  if (entry.category === 'portal' && entry.leadsTo !== null) {
    return { text: `Steps you through to ${zoneName(entry.leadsTo)}`, tone: 'muted' };
  }
  if (entry.category === 'mailbox') {
    return { text: 'Authored point: the game nudges a mailbox clear of buildings', tone: 'muted' };
  }
  if (entry.category === 'station') {
    return { text: 'Named by its type id, which is all the game publishes', tone: 'muted' };
  }
  return null;
}

/** Where a point is, in this addon's own words rather than the game's label. */
function whereLine(entry) {
  const what = CATEGORY_LABEL[entry.category];
  return `${what} in ${zoneName(entry.zone)}, at ${String(entry.x)}, ${String(entry.z)}`;
}

function rowTooltip(entry, visited) {
  const lines = [whereLine(entry), visitLine(entry, visited)];
  const extra = kindLine(entry);
  if (extra !== null) {
    lines.push(extra);
  }
  lines.push({ text: `Its pin ${HEIGHT_WORDS[provenance(entry)]}`, tone: 'muted' });
  return { title: entry.label, lines };
}

function detailFor(entry, visited) {
  const what = CATEGORY_LABEL[entry.category];
  if (entry.visit === null || visited === null) {
    return what;
  }
  if (visited.has(entry.visit)) {
    return `${what}, explored`;
  }
  return `${what}, not yet explored`;
}

/**
 * The arrow sits BESIDE the bar rather than in its icon slot: that slot takes a URL, and this
 * is rewritten sixty times a second, which as a data URI is an image decode per row per frame.
 */
function createRow(entry) {
  const row = document.createElement('div');
  row.className = 'woc-wf-row';
  row.dataset.place = entry.id;
  row.dataset.category = entry.category;
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '6px';
  const arrow = createArrow();
  const bar = woc.ui.bar({ label: entry.label });
  bar.el.style.flex = '1 1 auto';
  bar.el.style.minWidth = '0';
  row.appendChild(arrow);
  row.appendChild(bar.el);
  woc.ui.tooltip(row, () => rowTooltip(entry, visitedSet()));
  // The list removes the wrapper it inserted; the bar inside it is ours to take down.
  return { entry, el: row, bar, arrow, turned: null, destroy: () => bar.destroy() };
}

/**
 * A degree is under the arrow's own tip at this size, so anything finer is a style write
 * nobody can see. Null HIDES it rather than leaving it pointing at whatever it last knew.
 */
function turnArrow(row) {
  const degrees = woc.world.bearingTo(row.entry);
  if (degrees === null) {
    row.arrow.style.visibility = 'hidden';
    return;
  }
  row.arrow.style.visibility = '';
  if (row.turned !== null && Math.abs(degrees - row.turned) < BEARING_STEP_DEG) {
    return;
  }
  row.turned = degrees;
  row.arrow.style.transform = `rotate(${degrees.toFixed(FULL)}deg)`;
}

/**
 * Written rather than drawn as a `ui.tile`, which is a timer shape and there is no timer here.
 * Nothing on a pin is hoverable: every anchor is pointer-transparent, so the words live on the row.
 */
function createChip(entry) {
  const chip = document.createElement('div');
  chip.className = 'woc-wf-chip';
  chip.textContent = entry.label;
  chip.style.whiteSpace = 'nowrap';
  chip.style.fontSize = `${String(CHIP_FONT_PX)}px`;
  chip.style.padding = '1px 5px';
  chip.style.borderRadius = '3px';
  // No loader rule reaches an addon's own element, so without a fill and a shadow this is a
  // word floating on whatever the player happens to be standing in front of.
  chip.style.background = CHIP_BACKDROP;
  chip.style.textShadow = '0 1px 2px rgb(0 0 0 / 90%)';
  return chip;
}

/** Its own node, so the distance is rewritten without touching the name beside it. */
function createRange() {
  const range = document.createElement('span');
  range.className = 'woc-wf-range';
  range.style.marginLeft = '5px';
  range.style.opacity = '0.7';
  range.style.fontVariantNumeric = 'tabular-nums';
  return range;
}

function createPillar() {
  const pillar = document.createElement('div');
  pillar.className = 'woc-wf-pillar';
  pillar.style.width = `${String(PILLAR_WIDTH_PX)}px`;
  pillar.style.height = `${String(PILLAR_PX)}px`;
  pillar.style.margin = '0 auto';
  pillar.style.borderLeftWidth = `${String(PILLAR_WIDTH_PX)}px`;
  return pillar;
}

function createPin(entry) {
  const stack = document.createElement('div');
  stack.className = 'woc-wf-pin';
  stack.dataset.place = entry.id;
  const pillar = createPillar();
  const chip = createChip(entry);
  const range = createRange();
  chip.appendChild(range);
  stack.appendChild(chip);
  stack.appendChild(pillar);
  const anchor = woc.ui.anchor3d(() => pointOf(entry), { className: 'woc-wf-anchor' });
  anchor.el.appendChild(stack);
  // The stack hangs off the anchor, so the anchor is the whole teardown. The list has no
  // parent here and removes nothing.
  return {
    entry,
    anchor,
    stack,
    pillar,
    range,
    style: '',
    said: '',
    destroy: () => anchor.destroy(),
  };
}

function paintPin(pin, away) {
  const from = provenance(pin.entry);
  pin.stack.dataset.height = from;
  if (pin.style !== PILLAR_STYLE[from]) {
    pin.style = PILLAR_STYLE[from];
    pin.pillar.style.borderLeftStyle = pin.style;
  }
  const said = `${String(Math.round(away))} yd`;
  if (pin.said !== said) {
    pin.said = said;
    pin.range.textContent = said;
  }
}

/**
 * No `parent`, unlike the row list below: each pin carries its own `ui.anchor3d` and the
 * loader is already placing it, so there is nothing here to insert or to order.
 */
const pinList = woc.ui.list({
  key: (one) => one.entry.id,
  create: (one) => createPin(one.entry),
  update: (pin, one) => {
    paintPin(pin, one.away);
  },
});

/**
 * How much of the way there you already are, which is the inverse of the kit's usual
 * "how much is LEFT": the list is sorted nearest first and the fill has to agree with it.
 */
function fillFor(away) {
  const reach = Math.max(FULL, drawDistance());
  return Math.max(NONE, FULL - Math.min(FULL, away / reach));
}

/**
 * The only urgency an atlas has: a point not yet stood in, near enough to be worth the walk.
 * A mailbox is not more urgent for being close.
 */
function toneFor(entry, away, visited) {
  const unearned = entry.visit !== null && visited !== null && !visited.has(entry.visit);
  if (unearned && away <= VISIT_RADIUS) {
    return 'warn';
  }
  return 'default';
}

function paintRow(row, one) {
  row.bar.update({
    fraction: fillFor(one.away),
    value: `${String(Math.round(one.away))} yd`,
    detail: detailFor(one.entry, syncVisited),
    tone: toneFor(one.entry, one.away, syncVisited),
  });
  turnArrow(row);
}

/**
 * Keyed on the place rather than the position: the sort is by distance and the player is
 * walking, so a key on the index would rebuild both rows every time two of them swapped.
 */
const rowList = woc.ui.list({
  parent: list,
  key: (one) => one.entry.id,
  create: (one) => createRow(one.entry),
  update: (row, one) => {
    paintRow(row, one);
  },
});

function redraw() {
  if (!frame.visible) {
    pinList.clear();
    return;
  }
  fillGlyphs();
  syncVisited = visitedSet();
  const all = inRange();
  const listed = all.slice(NONE, listLength());
  const pinned = all.slice(NONE, MAX_PINS);
  const counts = { listed: listed.length, pinned: pinned.length, total: all.length };
  head.textContent = zoneHeading();
  minimap.textContent = minimapText();
  note.textContent = noteText(counts, syncVisited);
  rowList.sync(listed);
  pinList.sync(pinned);
}

function screenAt(entry) {
  const point = pointOf(entry);
  if (point === null) {
    return null;
  }
  return woc.ui.project(point);
}

/** Nearest first, with anything that did not project sorted last. */
function nearestFirst(a, b) {
  const near = a.at?.depth ?? Number.POSITIVE_INFINITY;
  const far = b.at?.depth ?? Number.POSITIVE_INFINITY;
  return near - far;
}

function crowded(at, kept) {
  return kept.some((other) => Math.hypot(at.x - other.x, at.y - other.y) < PIN_SPACING_PX);
}

/**
 * On the frame loop, not the redraw: the direction to walk changes the instant the player
 * turns, and a second of lag on the one reading that says WHICH WAY is the whole of it.
 */
function turnArrows() {
  for (const row of rowList.values()) {
    turnArrow(row);
  }
}

/**
 * Hide a pin that has landed on top of a nearer one. On the frame tick, because overlap is a
 * question about the camera; `ui.project` rather than measuring, which would force a layout.
 *
 * A null projection hides the pin outright: behind the camera the raw numbers are finite and
 * wrong. `values()` order does not matter, since this sorts by depth first.
 */
function thinPins() {
  const shots = pinList.values().map((pin) => ({ pin, at: screenAt(pin.entry) }));
  shots.sort(nearestFirst);
  const kept = [];
  for (const shot of shots) {
    const show = shot.at !== null && !crowded(shot.at, kept);
    if (show) {
      kept.push(shot.at);
    }
    woc.ui.show(shot.pin.stack, show);
  }
}

/**
 * ONE SHAPE in all four states, with the same keys nulled outside a zone. `place` carries
 * WHICH refusal it is, because "in a dungeon", "off the map" and "not read yet" are a fact
 * to act on, a fact to act on, and a reason to wait: a bare null told a consumer none of it.
 * `levelRange` is `{ min, max }` rather than a pair, since `levelRange[1]` is a guess.
 */
function zonePayload() {
  const place = currentPlace();
  if (place.kind !== 'zone') {
    return { place: place.kind, id: null, name: null, levelRange: null };
  }
  const [min, max] = place.zone.levelRange;
  return {
    place: 'zone',
    id: place.zone.id,
    name: place.zone.name,
    levelRange: { min, max },
  };
}

function publishKey(payload) {
  return `${payload.place}:${payload.id ?? ''}`;
}

/** Both an ask and an announcement come through here, so it is where what went out is noted. */
function zoneAnswer() {
  const payload = zonePayload();
  publishedKey = publishKey(payload);
  return payload;
}

// Every ask is answered whatever the state is, which is why `zonePayload` never returns null:
// there is no request-response on this bus, so the ask is the whole of the protocol.
const zoneChannel = woc.bus.publish('zone', zoneAnswer);

/**
 * The change test is on the PLACE as well as the id, since three states share a null id:
 * riding out of a dungeon and off the map is a real change the id alone cannot see.
 */
function announceZone() {
  if (publishKey(zonePayload()) === publishedKey) {
    return;
  }
  zoneChannel.announce();
}

// The announcement is outside the draw on purpose: hiding the panel must not stop the zone
// being published, since an addon's bus contract is not the player's business.
woc.setInterval(() => {
  announceZone();
  redraw();
}, MS_PER_SECOND);

woc.onFrame(() => {
  turnArrows();
  thinPins();
});

// Not `toggleKey`: this key also clears the world pins, and a frame has no on-hide callback.
woc.keys.bind('toggle', () => {
  frame.toggle();
  redraw();
});

woc.onSettingsChange(redraw);

/**
 * Every handler above is wired BEFORE this await and is a no-op against an empty table
 * rather than wrong; subscribing afterwards would miss whatever landed during it.
 */
async function boot() {
  const atlas = readAtlas(await woc.data(DATA_FILE));
  if (atlas === null) {
    throw new Error(`${DATA_FILE} is not an atlas: it is missing the world bounds or a table`);
  }
  adopt(atlas);
  announceZone();
  redraw();
}

boot().catch((err) => {
  woc.error('could not read the atlas, so there is no zone to resolve', err);
});
