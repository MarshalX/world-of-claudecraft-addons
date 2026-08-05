/// <reference types="@woc-addons/types" />

// Wayfarer: an atlas. Where everything is, how far, WHICH WAY, and which zone you are in.
//
// The direction is the reading this panel is built around, and it is the one an atlas made
// of distances alone cannot give: `Forge, 53 yd` is a fact you cannot walk on. Every row
// carries an arrow pointing at its place, turned on the frame loop from the player's own
// `facing`, so the list is read by turning until one of them points up. See `bearingTo`,
// which is the whole of the arithmetic, and `BEARING_SIGN`, which is the only part of it
// that is a claim about the game rather than a subtraction.
//
// The arrow is the CHARACTER's heading and not the camera's, which are different questions
// and only the first is answerable: the camera's yaw lives on the renderer and nothing
// publishes it. So an arrow points up when the character would walk there, which is what
// an atlas is for. The heading it reads is also the last one the SERVER confirmed, since
// the client predicts a held turn locally and applies that to the model rather than to the
// entity, so an arrow lags a fast spin by a round trip and settles the moment it stops.
//
// The zone is resolved from position, and the refusal is the feature.
//
// The loader publishes no zone id, because the game's own `zoneAt(x, z)` is not a pure
// rectangle test: it carries a clamping fallback to the southmost band containing `z` and
// then to the northmost zone, so `zoneAt(9999, 9999)` answers `drakelands` rather than
// nothing. Shipping that would name a real overworld zone for every player standing in a
// dungeon, an arena or a delve.
//
// So this addon carries the rectangles itself and copies the game's other resolver,
// `zoneContaining` (`src/sim/data.ts`), which is the one written for callers that must
// tell the open world from the instanced plane.
//
// `world.zone` is never compared against anything. It is the game's own localized minimap
// label, so a comparison against a string in this file would work on an English client and
// match nothing on any other. It is drawn under the resolved heading, and it is the more
// truthful of the two underground, where it names the delve and the rectangles have
// nothing to say.
//
// The atlas is a file: `atlas.json`, declared as `data` in the manifest, fetched by the
// loader at install and read back through `woc.data`, which hands back `unknown`. What is
// in it, what was deliberately left out, and which game release it was read from all live
// in `generate.mjs` and in the file's own `source` block rather than being restated here.
// The one part of its shape that `zoneContaining` below cannot be read without: Farshore
// Isle shares Eastbrook Vale's z band at x 180 to 540, so a test on z alone would put a
// player standing on Farshore in Eastbrook.
//
// A pin's height is always an inference, because the atlas carries x and z and no y:
// ground height is a function of a world seed no addon can call and no server sends. Each
// pin's pillar says which answer it stands on, `sampled` or `guessed`.
//
// It publishes `zone` on the bus, in ONE SHAPE whether or not there is a zone to name:
// `{ place, id, name, levelRange }`, where `place` is 'zone', 'instance', 'nowhere' or
// 'unknown' and the other three are null on any of the last three. A subscriber can
// therefore clear its own header rather than keep showing a zone the player has left, AND
// say which of the three reasons it is doing so, which is the distinction this whole addon
// is built to draw and which a bare null threw away. Nobody is obliged to listen and
// silence is ordinary; see `zonePayload`.

const DATA_FILE = 'atlas.json';
const MS_PER_SECOND = 1000;
const FRAME_WIDTH = 320;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Half a turn in degrees, which is what converts a radian bearing into a rotation. */
const HALF_TURN_DEG = 180;
/**
 * Which way the screen turns against the world.
 *
 * `facing` is radians with 0 at +z and `atan2(dx, dz)` reads the same way, so subtracting
 * one from the other is the bearing relative to where the player is looking. The sign
 * flips because a player's RIGHT hand is `forward x up`, which for forward +z and up +y
 * is -x: a point at a positive relative bearing stands to the player's left and its arrow
 * therefore turns anticlockwise. Checked against the stage, whose camera is the loader's
 * own projector rather than a stub, and worth one look at a live client.
 */
const BEARING_SIGN = -1;
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

/** How many pins may be in the world at once, drawn as a number when it bites. */
const MAX_PINS = 12;
/** How close two pins may land on screen before the farther one is dropped. */
const PIN_SPACING_PX = 56;
/** The pillar under a pin, thin enough to point at one spot rather than cover it. */
const PILLAR_PX = 22;
const PILLAR_WIDTH_PX = 2;
const CHIP_FONT_PX = 11;
/** What a chip is drawn on, so the world behind it cannot take the label away. */
const CHIP_BACKDROP = 'rgb(6 6 10 / 55%)';

const DEFAULT_DISTANCE = 300;
const DEFAULT_LENGTH = 8;

/** An empty count, and a whole one: a full bar, a one-item floor, a first character. */
const NONE = 0;
const FULL = 1;

/** The topic this addon publishes on, and the question anybody may ask it with. */
const ZONE_TOPIC = 'zone';
const ASK_TOPIC = 'zone:ask';

/** Category name to the id of the manifest setting that turns it on. */
const CATEGORY_SETTING = {
  town: 'show-towns',
  poi: 'show-points',
  graveyard: 'show-graveyards',
  portal: 'show-portals',
  mailbox: 'show-mailboxes',
  station: 'show-stations',
};

/**
 * The views the strip offers, each over the categories a player groups together.
 *
 * `icon` is a name in the GAME's own icon set rather than anything kept here: see
 * `gameGlyph`. All four are in the HUD markup the game ships, so all four are drawn
 * somewhere in the document once it has mounted; a name the game only builds on demand
 * would leave a slot empty for the rest of the session.
 */
const VIEWS = [
  { id: 'all', label: 'All', icon: 'map', categories: null },
  { id: 'explore', label: 'Explore', icon: 'target', categories: ['poi', 'town'] },
  { id: 'travel', label: 'Travel', icon: 'swap', categories: ['portal', 'graveyard'] },
  { id: 'service', label: 'Service', icon: 'crafting', categories: ['mailbox', 'station'] },
];

/** Which view is open. Deliberately not persisted: it is navigation, not a setting. */
let view = VIEWS[0].id;

/** What each category is called on a row. */
const CATEGORY_LABEL = {
  town: 'Town',
  poi: 'Point of interest',
  graveyard: 'Graveyard',
  portal: 'Portal',
  mailbox: 'Mailbox',
  station: 'Crafting station',
};

/** How a pin's pillar is drawn for each way its height was arrived at. */
const PILLAR_STYLE = { sampled: 'dashed', guessed: 'dotted' };

/** What each of those two is called when a tooltip says it in words. */
const HEIGHT_WORDS = {
  sampled: 'sits at the height of something that was standing there',
  guessed: 'sits at your own height, because nothing was near enough to measure',
};

/** The three answers to "where is the player" that are not a zone. */
const UNKNOWN_PLACE = Object.freeze({ kind: 'unknown', zone: null });
const INSTANCE_PLACE = Object.freeze({ kind: 'instance', zone: null });
const NOWHERE_PLACE = Object.freeze({ kind: 'nowhere', zone: null });

/**
 * The atlas, empty until the data file lands. An addon's first line runs at document-start
 * and `woc.data` is a promise, so every session begins without one. Nothing is
 * special-cased: no rectangle contains anything in an empty list, so the place resolves to
 * unknown and the panel says it is still reading.
 */
let zones = [];
/** The world's own strip width and the base of the instanced plane, from the file. */
let bounds = null;
/** Every place in the file, flattened into rows with its zone resolved once. */
let fixed = [];

/** Entry id to its row, and to its pin, for the ones currently drawn. */
const rows = new Map();
const pins = new Map();

/** Entry id to a SAMPLED height, kept once found. A guess is never stored: see `heightFor`. */
const heights = new Map();

/** The place and zone id last published, so a repeat of the same answer is not re-emitted. */
let publishedKey = '';

/** A number from the file, or the fallback for a field the file left out. */
function orElse(value, fallback) {
  if (Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/** One point of interest, or null. `id` is the FROZEN id a deed visit keys on. */
function readPoi(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, label, x, z, town } = value;
  const named = typeof id === 'string' && id.length > NONE && typeof label === 'string';
  if (named && label.length > NONE && Number.isFinite(x) && Number.isFinite(z)) {
    return { id, label, x, z, town: town === true };
  }
  return null;
}

/**
 * One zone rectangle, or null for a row that could never answer a containment test. The x
 * bounds are resolved here rather than at every test, because a zone without them is the
 * original full-width strip rather than a zone with no width: reading a missing bound as
 * zero would squeeze every strip zone into the world's centre line.
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

/** One graveyard or mailbox, which is an id, a label and a point and nothing else. */
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

/** One end of a portal, which is a bare point. */
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

/** The world constants, or null: without them no rectangle can be resolved at all. */
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

/** The file's five parts, or null when it is not the shape it claims to be. */
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
 * The zone whose rectangle literally contains a point, or null for a point in none. The
 * game's `zoneContaining`, copied: half-open on both axes, first match wins, and no
 * fallback. Its sibling `zoneAt` clamps to a nearest band and is the one this addon must
 * not be. Everything that reads this has to handle null.
 */
function zoneContaining(x, z) {
  for (const zone of zones) {
    if (z >= zone.zMin && z < zone.zMax && x >= zone.xMin && x < zone.xMax) {
      return zone;
    }
  }
  return null;
}

/** The zone a fixed point sits in, as an id, or null for a point in none of them. */
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

/** Everything in the file, flattened into rows, with each one's zone resolved once. */
function buildFixed(atlas) {
  const built = [];
  for (const zone of zones) {
    for (const poi of zone.pois) {
      built.push(poiEntry(zone, poi));
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

function drawDistance() {
  return settingNumber('draw-distance', DEFAULT_DISTANCE);
}

function listLength() {
  return Math.max(FULL, Math.round(settingNumber('list-length', DEFAULT_LENGTH)));
}

/** The heading, the game's own label under it, the strip, the rows, and the footer. */
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
 * A frame rather than a window, because the player toggles it, and comfortable because
 * that is the scale the game draws its own panels at: a panel that gave the tap-target
 * floor up would be a third smaller than the game's windows beside it, and nothing here
 * is read mid-fight tightly enough to be worth that.
 *
 * Left at the frame default of not resizable, and it should stay there: the rows do not
 * reflow with the box, since how many of them there are is a number the player sets, and a
 * handle over content that ignores the box either does nothing or clips it. The honest
 * control is the `list-length` setting.
 */
const frame = woc.ui.frame({
  id: 'atlas',
  title: 'Wayfarer',
  width: FRAME_WIDTH,
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
 * The game keeps its icon set as markup inside a module that is not on `__game`, serves no
 * file for any of them and publishes no sprite, so there is nothing here to point a URL at
 * and nothing to import. What it does do is hydrate every `[data-icon]` in the document
 * into an `<svg class="ui-icon">` as the HUD mounts, which makes the DRAWN node reachable:
 * a clone of that is the game's glyph itself rather than a copy of one kept in this file,
 * and it follows the game rather than going stale the first time one is redrawn.
 *
 * Null for the whole of every session's first seconds, since an addon's first line runs at
 * document-start and the hydration is a world-entry thing. `fillGlyphs` is what keeps
 * asking rather than this answering a placeholder.
 */
function gameGlyph(name) {
  const drawn = document.querySelector(`[data-icon="${name}"] > svg`);
  if (drawn === null) {
    return null;
  }
  const copy = drawn.cloneNode(true);
  copy.classList.add('woc-wf-glyph');
  // Which of the game's icons this is, so the strip can be read back without recognising a
  // path. The game's own hydration keys on `data-icon`, so this deliberately is not that:
  // a second element claiming to be one would be hydrated again on the next HUD mount.
  copy.setAttribute('data-from', name);
  // The game's own `.ui-icon` rule says exactly this. Written again so a strip of blank
  // squares is not what a player gets if that rule is ever scoped tighter than it is now.
  copy.style.width = '1em';
  copy.style.height = '1em';
  return copy;
}

/** The strip's buttons, by view id, so a glyph can be filled in once one exists. */
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
 * One tab, wearing the kit's own classes so it answers to the frame's density.
 *
 * Hand-rolled rather than `ui.tabs`, which is the kit's strip and would ordinarily be the
 * right call: its tabs carry a label and nothing else, and the glyph here has to be a LIVE
 * node rather than a URL, both so `fill="currentColor"` inherits the strip's own colour on
 * either side of the active state and so it can be dropped in whenever the HUD turns up.
 * `.woc-tabs`, `.woc-tab` and `.woc-tab-active` are published for an addon to wear, so
 * what is rebuilt here is the click handling and nothing about how it looks.
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
 * Put the game's own glyph in front of any tab still without one.
 *
 * Called from the redraw rather than once at build, because the HUD mounts long after an
 * addon's first line and the icons do not exist until it does. It stops asking per tab as
 * soon as that tab has one, so the steady state is four `has` checks a second.
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

/** The categories the open view shows, or null for the one that shows every category. */
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
 * Where the player is: a zone, an instance, nowhere, or not knowable yet. The instance
 * check comes first and is deliberately wider than the game's own `DUNGEON_X_THRESHOLD`:
 * everything instanced is past `INSTANCE_X_BASE`, and refusing a little early costs
 * nothing, because there is no authored land out there.
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

/**
 * How far the player would have to turn to face a point, in degrees clockwise, or null
 * with nobody to be facing anything.
 *
 * This is the one reading on the panel that is not a distance, and it is what makes the
 * list a direction rather than a table: a row says how far AND which way. `facing` rides
 * the snapshot for every entity and reads in the same convention `atan2(dx, dz)` does, so
 * the whole of it is one subtraction. `BEARING_SIGN` carries why the screen turns the
 * other way.
 */
function bearingTo(entry) {
  const me = player();
  if (me === null || !Number.isFinite(me.facing)) {
    return null;
  }
  const relative = Math.atan2(entry.x - me.pos.x, entry.z - me.pos.z) - me.facing;
  return (BEARING_SIGN * relative * HALF_TURN_DEG) / Math.PI;
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

/** Yards from the player to a point, flat, which is the distance the game measures. */
function distanceTo(entry) {
  const me = player();
  if (me === null) {
    return null;
  }
  return Math.hypot(me.pos.x - entry.x, me.pos.z - entry.z);
}

/** The y of the nearest entity standing over a point, or null for nothing near it. */
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
 * The height under a point and where that number came from, or null with no world. A
 * sampled height is captured once and kept; a guess is recomputed every time, because it
 * is the player's own height and the player moves.
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

/** `forge` reads as `Forge`. The game publishes a station's TYPE id and no name. */
function titleCase(id) {
  return id
    .split('_')
    .map((word) => word.slice(NONE, FULL).toUpperCase() + word.slice(FULL))
    .join(' ');
}

/**
 * The crafting stations, from the loader rather than from the file. `world.stations` is
 * the game's own table, copied and frozen, and every row carries the zone id this addon
 * filters on. It is empty rather than null before world entry.
 */
function stationEntries() {
  const built = [];
  for (const station of woc.world.stations) {
    built.push({
      id: `station:${station.id}`,
      label: titleCase(station.type),
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
 * Whether a row is shown, which is two filters rather than one.
 *
 * The setting is the player saying they never want to see mailboxes; the open tab is them
 * looking at one group for a moment. Both narrow the same list and the footer's counts are
 * taken after both, so everything on the panel is answering about the tab in front of you
 * rather than about a list you would have to switch tabs to see.
 */
function categoryAllows(entry) {
  if (!settingFlag(CATEGORY_SETTING[entry.category], true)) {
    return false;
  }
  const only = viewCategories();
  return only === null || only.includes(entry.category);
}

/**
 * Everything worth a row right now, nearest first. Filtered to the zone the player is
 * standing in, which is why the whole list empties inside an instance rather than offering
 * the nearest overworld anything. A point across a border is genuinely left out, and that
 * is the cost of a list whose heading is a zone.
 */
function inRange() {
  const place = currentPlace();
  if (place.kind !== 'zone') {
    return [];
  }
  const reach = drawDistance();
  const shown = [];
  for (const entry of [...fixed, ...stationEntries()]) {
    const away = distanceTo(entry);
    const here = entry.zone === place.zone.id && categoryAllows(entry);
    if (here && away !== null && away <= reach) {
      shown.push({ entry, away });
    }
  }
  return shown.sort((a, b) => a.away - b.away);
}

/**
 * The visited set, or null when the deed sheet cannot be read yet.
 *
 * The counters are what says whether it can, and the visited set cannot say it for itself:
 * an empty one is what an explorer with no marks looks like and also what the loader hands
 * back for a world carrying no `deedStats` at all. The game's own `freshDeedStats()`
 * writes every counter key at 0 client-side, so a counters record with no keys is a sheet
 * that has not arrived rather than a character who has done nothing.
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

/** How many of a zone's points this character has stood in, or null for unreadable. */
function exploredIn(zone, visited) {
  if (visited === null) {
    return null;
  }
  return zone.pois.filter((poi) => visited.has(visitKey(zone.id, poi.id))).length;
}

/** The heading: the resolved zone and its level range, or the refusal in words. */
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

/** What the panel says about its own explored count, in a state or in a number. */
function exploredPart(zone, visited) {
  const explored = exploredIn(zone, visited);
  if (explored === null) {
    return 'deeds unread';
  }
  return `${String(explored)}/${String(zone.pois.length)} explored`;
}

/**
 * The limits worth saying out loud, in a number where there is one.
 *
 * One line of clauses rather than the four sentences this used to be. All of it is still
 * here, including the two that are constants: a limit the player cannot see is a limit
 * they read the panel as not having, and "heights estimated" is the difference between a
 * pin somebody trusts and one they should not. What changed is that a note ABOUT the
 * readout stopped being drawn at the same weight and length as the readout.
 */
function limits(counts, zone, visited) {
  const parts = [];
  if (settingFlag('show-visited', true)) {
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

/** What one row says about a deed visit, which only a point of interest has. */
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

/** The extra line a category earns, or null where it earns none. */
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
 * A row: an arrow pointing at the place, and the kit's bar saying what and how far.
 *
 * The arrow sits BESIDE the bar rather than in its icon slot, because that slot takes a
 * URL and this has to be an element: it is rewritten sixty times a second as the player
 * turns, and a data URI would be an image decode per row per frame to say the same
 * triangle is now pointing somewhere else. `bar.el` goes wherever an addon puts it, so a
 * wrapper holding the two is the ordinary use of it rather than a way around anything.
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
  return { entry, el: row, bar, arrow, turned: null };
}

/**
 * Point one row's arrow, and write nothing where it has not really moved.
 *
 * A degree is under the width of the arrow's own tip at this size, so anything finer is a
 * style write nobody can see. Null hides it rather than leaving it pointing at whatever it
 * last knew, which before world entry is nowhere at all.
 */
function turnArrow(row) {
  const degrees = bearingTo(row.entry);
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
 * A pin: the name on a chip, standing on a pillar whose line style is its height's
 * provenance. Written rather than drawn as a tile, because there is no timer here and a
 * tile is a timer shape. Nothing is hoverable either way, since the loader makes every
 * anchor pointer-transparent, so the words explaining a pin live on its row in the list.
 */
function createChip(entry) {
  const chip = document.createElement('div');
  chip.className = 'woc-wf-chip';
  chip.textContent = entry.label;
  chip.style.whiteSpace = 'nowrap';
  chip.style.fontSize = `${String(CHIP_FONT_PX)}px`;
  chip.style.padding = '1px 5px';
  chip.style.borderRadius = '3px';
  // A backdrop and a shadow, which is what makes a label READABLE over the world rather than
  // over a screenshot of a dark stage. Nothing in the loader's sheet reaches an addon's own
  // element, so a chip with padding and a radius and no fill is a word floating on whatever the
  // player is standing in front of. The same two values facemark gives its plates, for the same
  // reason.
  chip.style.background = CHIP_BACKDROP;
  chip.style.textShadow = '0 1px 2px rgb(0 0 0 / 90%)';
  return chip;
}

/**
 * The yardage under the name, which is what turns a label into a marker.
 *
 * Its own node so the pin's distance can be rewritten without touching the name, and
 * quieter than the name because the name is what you are looking for and the number is
 * what you check once you have found it.
 */
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
  return { entry, anchor, stack, pillar, range, style: '', shown: '', said: '' };
}

function dropPin(id, pin) {
  pin.anchor.destroy();
  pins.delete(id);
}

function clearPins() {
  for (const [id, pin] of pins) {
    dropPin(id, pin);
  }
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

function syncPins(entries) {
  const shown = new Map(entries.map((one) => [one.entry.id, one]));
  for (const [id, pin] of pins) {
    if (!shown.has(id)) {
      dropPin(id, pin);
    }
  }
  for (const [id, one] of shown) {
    let pin = pins.get(id);
    if (pin === undefined) {
      pin = createPin(one.entry);
      pins.set(id, pin);
    }
    paintPin(pin, one.away);
  }
}

/** Put a row at its position, and only when it is not already there. */
function putAt(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}

/**
 * How full a row is: how much of the way there you already are, so a place at your feet is
 * a full bar and one at the edge of your reach is nearly empty.
 *
 * This used to be the other way round, on the reasoning that the kit's `fraction` is how
 * much is LEFT and what is left of a walk is the distance still to cover. That is true and
 * it read as a fault. The list is sorted nearest first, so a fill growing DOWN it put the
 * loudest mark on the row that mattered least and made the strongest signal on the panel
 * disagree with its own ordering; every row also broke off mid-name at a different point,
 * which is what made a column of them look like damage rather than like a measurement.
 * Filling toward arrival is the same number read the other way and agrees with the sort.
 */
function fillFor(away) {
  const reach = Math.max(FULL, drawDistance());
  return Math.max(NONE, FULL - Math.min(FULL, away / reach));
}

/**
 * Whether this row is about to earn the player something, which is the only urgency an
 * atlas has: a point of interest they have not stood in, close enough that walking the
 * last few yards marks it explored. Anything else is 'default', because a mailbox is not
 * more urgent for being near.
 */
function toneFor(entry, away, visited) {
  const unearned = entry.visit !== null && visited !== null && !visited.has(entry.visit);
  if (unearned && away <= VISIT_RADIUS) {
    return 'warn';
  }
  return 'default';
}

function paintRow(row, one, visited) {
  row.bar.update({
    fraction: fillFor(one.away),
    value: `${String(Math.round(one.away))} yd`,
    detail: detailFor(one.entry, visited),
    tone: toneFor(one.entry, one.away, visited),
  });
  turnArrow(row);
}

function dropRow(id, row) {
  row.bar.destroy();
  row.el.remove();
  rows.delete(id);
}

function syncRows(entries, visited) {
  const shown = new Set(entries.map((one) => one.entry.id));
  for (const [id, row] of rows) {
    if (!shown.has(id)) {
      dropRow(id, row);
    }
  }
  for (const [at, one] of entries.entries()) {
    let row = rows.get(one.entry.id);
    if (row === undefined) {
      row = createRow(one.entry);
      rows.set(one.entry.id, row);
    }
    paintRow(row, one, visited);
    putAt(row.el, at);
  }
}

function redraw() {
  if (!frame.visible) {
    clearPins();
    return;
  }
  fillGlyphs();
  const visited = visitedSet();
  const all = inRange();
  const listed = all.slice(NONE, listLength());
  const pinned = all.slice(NONE, MAX_PINS);
  const counts = { listed: listed.length, pinned: pinned.length, total: all.length };
  head.textContent = zoneHeading();
  minimap.textContent = minimapText();
  note.textContent = noteText(counts, visited);
  syncRows(listed, visited);
  syncPins(pinned);
}

/** Where a pin is on screen right now, or null when it has no trustworthy place. */
function screenAt(entry) {
  const point = pointOf(entry);
  if (point === null) {
    return null;
  }
  return woc.ui.project(point);
}

/** Nearest to the camera first, with anything that did not project sorted last. */
function nearestFirst(a, b) {
  const near = a.at?.depth ?? Number.POSITIVE_INFINITY;
  const far = b.at?.depth ?? Number.POSITIVE_INFINITY;
  return near - far;
}

function crowded(at, kept) {
  return kept.some((other) => Math.hypot(at.x - other.x, at.y - other.y) < PIN_SPACING_PX);
}

function displayFor(show) {
  if (show) {
    return '';
  }
  return 'none';
}

function setShown(pin, show) {
  const display = displayFor(show);
  if (pin.shown !== display) {
    pin.shown = display;
    pin.stack.style.display = display;
  }
}

/**
 * Turn every arrow, which is the second thing here that answers to the camera rather than
 * to the world: the distances on this panel move once a second and the direction to walk
 * changes the instant the player does. An arrow rewritten on the redraw would lag a turn
 * by up to a second, which on the one reading that says WHICH WAY is the whole of it.
 *
 * It is a subtraction and a guarded style write per row, over a list the player capped
 * themselves, so it costs about what reading the frame's own clock does.
 */
function turnArrows() {
  for (const row of rows.values()) {
    turnArrow(row);
  }
}

/**
 * Hide a pin that has landed on top of a nearer one.
 *
 * On the frame tick because whether two points overlap on screen is an answer about the
 * camera, so it changes while the world stands still. `ui.project` rather than measuring
 * the placed elements, because a measurement forces a synchronous layout and this runs on
 * every frame.
 *
 * A null projection hides the pin outright: it answers null behind the camera and closer
 * than the near plane, where the raw projection reports finite coordinates that are wrong.
 */
function thinPins() {
  const shots = [...pins.values()].map((pin) => ({ pin, at: screenAt(pin.entry) }));
  shots.sort(nearestFirst);
  const kept = [];
  for (const shot of shots) {
    const show = shot.at !== null && !crowded(shot.at, kept);
    if (show) {
      kept.push(shot.at);
    }
    setShown(shot.pin, show);
  }
}

/**
 * What the bus is told, which is ONE SHAPE whether or not there is a zone to name.
 *
 * `place` carries the refusal rather than deleting it, and that is the whole reason this is
 * an object rather than the bare null it used to be. This addon exists to distinguish four
 * states, and three of them collapsed into one `null` on the way out: a subscriber could
 * not tell "you are in a dungeon, so a zone filter does not apply here" from "you are off
 * the map" from "the atlas has not been read yet". The first is a fact worth acting on, the
 * third is a reason to wait, and answering both with `null` made every consumer either
 * treat a loading addon as a dungeon or keep a flag of its own to guess which it was.
 *
 * The other three fields are null outside a zone rather than absent, so a consumer reads
 * the same keys in every state. `levelRange` is `{ min, max }` rather than a pair, because
 * `levelRange[1]` is a consumer guessing which end it has hold of.
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

/**
 * Publish the zone, on a change and on being asked.
 *
 * The change test is on the PLACE as well as the id, which it has to be now that three
 * states share a null id: keyed on the id alone, a player riding out of a dungeon and off
 * the map would move between two genuinely different answers in silence. `force` is the
 * answer to `zone:ask`, which has to emit whatever the state is, since a subscriber that
 * started after the last border crossing would otherwise wait for the next.
 */
function publishZone(force) {
  const payload = zonePayload();
  const key = `${payload.place}:${payload.id ?? ''}`;
  if (!force && key === publishedKey) {
    return;
  }
  publishedKey = key;
  woc.bus.emit(ZONE_TOPIC, payload);
}

// Once a second, because every figure on this panel moves at most that often and the zone
// under a rider changes far more slowly. The publish is outside the draw: an addon's bus
// contract is not the player's business, so hiding the panel must not stop the zone being
// published.
woc.setInterval(() => {
  publishZone(false);
  redraw();
}, MS_PER_SECOND);

woc.onFrame(() => {
  turnArrows();
  thinPins();
});

// Anybody may ask, including an addon that started after the last border crossing. There
// is no request-response on this bus, so this is the whole of the protocol.
woc.bus.on(woc.bus.anySender, ASK_TOPIC, () => {
  publishZone(true);
});

woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now, rather than up to a second from now: somebody who just hid the panel should not
  // watch its pins hang over the world waiting for the next tick.
  redraw();
});

woc.onSettingsChange(redraw);

/**
 * Read the atlas in, then draw for the first time with something to draw. Every handler
 * above is wired first and is a no-op against an empty table rather than wrong, which is
 * what makes that order safe: subscribing after an await would miss whatever landed during
 * it.
 */
async function boot() {
  const atlas = readAtlas(await woc.data(DATA_FILE));
  if (atlas === null) {
    throw new Error(`${DATA_FILE} is not an atlas: it is missing the world bounds or a table`);
  }
  adopt(atlas);
  publishZone(false);
  redraw();
}

boot().catch((err) => {
  woc.error('could not read the atlas, so there is no zone to resolve', err);
});
