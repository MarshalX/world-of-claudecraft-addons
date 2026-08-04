/// <reference types="@woc-addons/types" />

// Veinsight: every gathering node in the world, pinned where it actually is.
//
// A gathering node is never an entity. The server spawns nothing for one and the
// snapshot carries nothing about one: the game's own renderer draws all 156 straight
// out of an authored table (`src/sim/content/gather_nodes.ts`), and the only thing
// that ever reaches the wire is YOUR OWN respawn timers. So the table is the addon's
// to carry and the timers are the game's to answer, and this file is the join.
//
// THE TABLE IS A FILE. `nodes.json`, declared as `data` in the manifest, fetched by
// the loader at install and read back through `woc.data`. It is generated from a game
// checkout by `generate.mjs` beside it, stamped with the version it was read from,
// and nothing in it is inferred:
//
//  - `nodes` is `GATHER_NODES` from `src/sim/content/gather_nodes.ts`, all 156 rows,
//    52 of each type, 138 at tier 1, 12 at tier 2 and 6 at tier 3. Unlike a mob camp a
//    node is NOT scattered by a world seed: the authored `pos` is where it is drawn,
//    so a copy of the table is exact rather than approximate. The count is not stable
//    across releases and nothing here assumes it is: game 0.34.0's density pass took
//    the six tuned-strip zones to six nodes of every type against a doubled 240 second
//    respawn, adding 57 rows and nudging 20 that were already there, and the eight
//    expansion zones still carry their two-per-type starter kits until their own pass.
//  - `tools` is every `use: { type: 'gatherTool' }` item in `src/sim/content/items.ts`,
//    filed under the node type its profession opens rather than under the profession,
//    because the type is what a node row carries. Fishing rods are left out: fishing
//    has no world nodes at all.
//  - `zones` is each zone's own `name` from its content file under `src/sim/content/`.
//    They are THIS ADDON'S labels for THIS ADDON'S table and are never compared
//    against `world.zone`, which is localized display text rather than an id.
//  - `respawnSeconds` is `NODE_HARVEST_TABLE`'s own figure per node type, which is the
//    denominator of every bar here. It is in the FILE rather than in this source
//    because it is a tuning number that moves on a content pass: 0.34.0 doubled it to
//    240 alongside the density pass, and a constant here would have gone on dividing
//    by 120 and drawing a bar pinned at full for the whole first half of every wait.
//
// WHAT IS A FACT HERE, AND WHAT IS AN INFERENCE. This is the important half.
//
// The cooldowns are FACTS. `world.nodeCooldowns` is node id to seconds remaining,
// keyed by the same ids the table carries, so the join is direct and needs nothing
// worked out. It is per PLAYER: the server keeps one deadline map per character
// (`meta.nodeHarvestReadyAt`) and ships only the entries still counting, so a node
// with no entry is ready FOR YOU whatever anybody else did to it. There is no camping
// race, which is why every figure here says "yours" rather than "up". It rides the
// snapshot, so it survives a reload with nothing stored and nothing to reconstruct.
//
// The tool gate is a FACT, and it is a TOOL gate rather than a skill one. Reading a
// node's tier against the best matching tool in your own bags is exactly what the
// game does at the harvest boundary (`gathering.ts harvestNode`, `tools.ts
// canGatherTier`): a tool covers its own tier and every tier below it, bare hands
// cover nothing, and a node you have no tool for cannot be opened however good you
// are at the profession. Gathering proficiency moves the RARITY of what a harvest
// yields and how fast the cast runs, and gates nothing, so it is not read here.
//
// The HEIGHT is an inference, always, and the display says which of three kinds.
// The table carries x and z and no y, because the game authors none: ground height is
// a function of a world seed that no addon can call and no server sends. Three
// answers, best first, and each pin's pillar says which one it is standing on:
//
//   harvested  You have gathered this node on this character, so its height was read
//              off your own feet at the moment the harvest landed. Exact.
//   sampled    An entity was standing within a few yards of the point, and mobs,
//              NPCs and players stand on the ground. Captured ONCE rather than
//              tracked, because tracking slides a marker up a ramp.
//   guessed    Nothing better was available, so the pin sits at your own height.
//
// That is why a pin is a tile on a pillar rather than a flat disc: a disc at the
// wrong height reads as a bug, and a pillar that starts slightly high still points
// at one spot on the ground.
//
// The BEARING is a fact about your character and not about your camera. `facing` is
// radians with 0 at +Z (`facingToward` is `atan2(dx, dz)`, `src/sim/eastbrook_layout.ts`)
// and turning LEFT increases it (`src/sim/player_motion.ts`), so a positive difference
// puts a node to your left, and that is the way the arrows run. Where the camera is
// pointed is a different question and this addon does not claim to answer it.
//
// The ZONE FILTER cannot be answered alone. The loader publishes no zone id, because
// the game's own resolver clamps rather than answering null and so names an overworld
// zone for a player standing in a dungeon. Every node row carries its own `zoneId`, so
// nothing here needs a rectangle: what is missing is only which zone YOU are in, which
// is one bus topic away. Nothing publishes it unless a zone addon is installed, so the
// filter degrades to every zone and the panel says so in words rather than quietly
// listing everything.
//
// The split between the two clocks is the usual one. The list, the pins and every
// countdown move at most once a second and live on `woc.setInterval`; the only thing
// on `woc.onFrame` is the route line, whose two ends have to be re-projected as the
// camera turns. The pins position themselves, because `ui.anchor3d` rides the
// loader's own loop already.

/** Yards the game lets you harvest from, `INTERACT_RANGE` in `src/sim/types.ts`. */
const REACH_YARDS = 5;
/** How close an entity has to be to a node's point to stand in for its height. */
const SAMPLE_YARDS = 6;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
/**
 * Under this many SECONDS left, a row goes warm: the node is nearly yours again.
 *
 * ABSOLUTE, and deliberately NOT a share of the respawn. It is how much warning the
 * player gets to start walking, and how far away they are has nothing to do with how
 * long the node sleeps, so it does not track `respawnByType` and must not be rewritten
 * to. Spelled out because the ratio moved on its own: it was an eighth of the old 120
 * second respawn and is a sixteenth of 0.34.0's 240, which is exactly the shape of
 * number a later reader assumes was proportional and "corrects".
 */
const NEARLY_READY = 15;

const FRAME_WIDTH = 300;
/** A pin's square, the tap-target floor the game holds its own controls to. */
const PIN_SIZE = 40;
/** How tall the pillar under a pin is, in screen pixels. */
const PILLAR_PX = 26;
/** The pillar's width, thin enough to point at one spot rather than cover it. */
const PILLAR_WIDTH_PX = 3;
/** The type edge down the left of a row. */
const ROW_EDGE_PX = 3;
/**
 * Where a row's text starts, and therefore where the note above the rows lines up.
 *
 * The kit's own 4px of padding inside a bar, plus the edge this addon draws OUTSIDE
 * that padding. Written out because the note is a plain div and has no bar to
 * inherit either number from; a few pixels out would only ever look like a few
 * pixels out, which is why it is safe to state rather than derive.
 */
const TEXT_INSET_PX = 7;
/** How opaque a pin is while its node is still cooling down for you. */
const COOLING_OPACITY = 0.45;
const READY_OPACITY = 1;
/**
 * How many pins may be in the world at once.
 *
 * A cap rather than a promise, because the draw distance goes to 400 yards and a
 * node cluster is six deep. It is drawn as a NUMBER in the note when it bites, so
 * the display never quietly shows a subset as if it were everything.
 */
const MAX_PINS = 24;

/** How many stops a route line may join, counting your own position as the first. */
const MAX_ROUTE_STOPS = 5;
const ROUTE_WIDTH_PX = 2;
const HALF_TURN_DEGREES = 180;
const ANGLE_DECIMALS = 1;

const DATA_FILE = 'nodes.json';
/** The one per-character key. Only heights read off a real harvest are in it. */
const STORE_KEY = 'heights';
/** The topic a zone addon publishes the player's current zone on. */
const ZONE_TOPIC = 'zone';

const FULL = 1;
const EMPTY = 0;
const NONE = 0;
/** `NO_TOOL_OWNED` in `tools.ts`: no matching tool at all, which opens nothing. */
const NO_TOOL = 0;

/** The three node types, in the order the game lists them. */
const TYPES = ['ore', 'wood', 'herb'];

/** What each type is called on screen, from the game's own name for the fixture. */
const TYPE_LABEL = { ore: 'Ore vein', wood: 'Wood stand', herb: 'Herb patch' };

/**
 * Each type's colour, and it is the GAME'S rather than one this addon picked.
 *
 * `NODE_COLOR` in `src/render/gather_nodes_lookup.ts` is what the world mesh is
 * tinted with, so a pillar in the same colour matches the thing it points at.
 * Nothing else here is coloured: a bar's fill is the kit's to tint by tone, and an
 * addon passing its own colour is how two addons stop looking alike.
 */
const TYPE_TINT = { ore: '#8a8f98', wood: '#5b3a21', herb: '#4caf50' };

/** Which setting turns each type on. Written out because a key here is a manifest id. */
const TYPE_SETTING = { ore: 'show-ore', wood: 'show-wood', herb: 'show-herb' };

/**
 * Eight sectors around the player, starting straight ahead and turning LEFT.
 *
 * Left rather than right because that is the direction `facing` increases in, and
 * getting it backwards would be a display that is wrong in a way nobody can see
 * until they have followed it.
 */
const ARROWS = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
const SECTOR_RADIANS = (Math.PI * 2) / ARROWS.length;

/** How a pin's pillar is drawn for each way its height was worked out. */
const PILLAR_STYLE = { harvested: 'solid', sampled: 'dashed', guessed: 'dotted' };

/** What each of those three is called when a row says it in words. */
const HEIGHT_WORDS = {
  harvested: 'sits at the height your own harvest measured',
  sampled: 'sits at the height of something standing there',
  guessed: 'sits at your own height, nothing better was in range',
};

const DEFAULT_DISTANCE = 150;
const DEFAULT_LENGTH = 6;

/**
 * The longest a gather cast can run, `GATHER_CAST_BASE_SEC` in `gathering.ts`.
 *
 * The formula only ever shortens it, so this is a ceiling rather than a guess. It
 * is here because an interrupted cast emits no result, and a note saying a harvest
 * is under way with nothing behind it is exactly the kind of thing that reads as
 * live and is not.
 */
const GATHER_CAST_MS = 2500;

/** The table, empty until the data file lands. No row matches an empty table. */
let nodes = [];
let byId = new Map();
/** Zone id to this addon's own label for it. */
let zoneNames = new Map();
/** Node type to the tools that open it, each with the tier it covers. */
let toolsByType = new Map();
/**
 * Node type to the seconds a harvested node of it takes to come back, off the game's
 * own `NODE_HARVEST_TABLE`.
 *
 * It comes out of the data file rather than being written down here, because it is a
 * TUNING number: it moves on a content pass with nothing on the wire to announce it,
 * and game 0.34.0 doubled it from 120 to 240. A constant here is wrong the moment
 * that happens and wrong SILENTLY, because the fill is clamped: dividing by 120 while
 * the server counts down from 240 draws a bar pinned at full for the whole first two
 * minutes, which reads as a node that has not started coming back rather than as a
 * display that is lying.
 *
 * Per type because the game's table is keyed per type; all three agree today. Empty
 * until the data file lands, and nothing draws against it before then: `readTable`
 * refuses a file that does not carry a positive figure for every type, so by the time
 * there is a node to draw, its own type has one.
 */
let respawnByType = new Map();
/** Node type to the best tier you own, recomputed once per draw rather than per node. */
let tierByType = new Map();

/**
 * Node id to the height under it, and which of the three ways that was arrived at.
 *
 * A `harvested` entry is the only kind written down, because it is the only kind
 * that is a measurement. A `sampled` one is an estimate a different session would
 * make differently, and storing it would turn one passer-by into a permanent claim.
 */
const heights = new Map();

/** Node id to its row, and to its world pin, for the ones currently drawn. */
const rows = new Map();
const pins = new Map();
/** The route's legs, in order, each an anchor holding one rotated line. */
let legs = [];

/** The zone a publisher last named, or null when nobody has published one. */
let publishedZone = null;
/** Whether any zone publisher has ever answered, which the note distinguishes. */
let zoneHeard = false;

/** Which node type the player is harvesting right now, from the cast, or null. */
let harvesting = null;
/** When that cast can no longer be running, on the monotonic clock. */
let harvestingUntil = NONE;

/** One table row, or null for anything that is not one. */
function readNode(value, zoneIds) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, zone, type, x, z, level, tier } = value;
  const named = typeof id === 'string' && id.length > 0 && zoneIds.has(zone);
  const placed = TYPES.includes(type) && Number.isFinite(x) && Number.isFinite(z);
  const ranked = Number.isFinite(tier) && tier > NONE && Number.isFinite(level);
  if (named && placed && ranked) {
    return { id, zone, type, x, z, level, tier };
  }
  return null;
}

/** One zone label, or null. The id is what every node row is checked against. */
function readZone(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, name } = value;
  if (typeof id === 'string' && id.length > 0 && typeof name === 'string' && name.length > 0) {
    return { id, name };
  }
  return null;
}

/** One tool, or null. A tool with no tier could never be compared against a node. */
function readTool(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, type, tier } = value;
  const named = typeof id === 'string' && id.length > 0 && TYPES.includes(type);
  if (named && Number.isFinite(tier) && tier > NONE) {
    return { id, type, tier };
  }
  return null;
}

/**
 * The respawn map, or null unless every type carries a positive number of seconds.
 *
 * Refused outright rather than defaulted, which is the opposite of how a bad NODE row
 * is treated, and deliberately: a node that does not check out is one row left out of
 * a list, while a missing respawn length is the denominator of every bar in the panel.
 * There is no honest number to fall back to, and the last one this addon happened to
 * know is exactly the stale constant reading it from the file is here to remove.
 */
function readRespawn(value) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const byType = new Map();
  for (const type of TYPES) {
    const seconds = value[type];
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= NONE) {
      return null;
    }
    byType.set(type, seconds);
  }
  return byType;
}

/** The file's three arrays and its respawn map, or null when it is not that shape. */
function readTable(file) {
  if (typeof file !== 'object' || file === null) {
    return null;
  }
  const { nodes: listed, zones, tools } = file;
  if (!(Array.isArray(listed) && Array.isArray(zones) && Array.isArray(tools))) {
    return null;
  }
  const respawn = readRespawn(file.respawnSeconds);
  if (respawn === null) {
    return null;
  }
  return { listed, zones, tools, respawn };
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

/** Group the tools by the node type each one opens. */
function indexTools(kept) {
  const byType = new Map(TYPES.map((type) => [type, []]));
  for (const tool of kept) {
    byType.get(tool.type).push(tool);
  }
  return byType;
}

function adopt(table) {
  respawnByType = table.respawn;
  const zones = keep(table.zones, readZone, 'zone');
  zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
  toolsByType = indexTools(keep(table.tools, readTool, 'tool'));
  const zoneIds = new Set(zoneNames.keys());
  nodes = keep(table.listed, (value) => readNode(value, zoneIds), 'node');
  byId = new Map(nodes.map((node) => [node.id, node]));
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

/** The line above the rows saying why the panel is showing what it is showing. */
const note = document.createElement('div');
note.className = 'woc-vs-note';
note.style.opacity = '0.75';
// Indented to the rows rather than to the body, which is what it looked like it
// should be until there were rows under it: with no padding of its own the sentence
// starts 7px left of every label below it and ends hard against the panel's border,
// and a line of text touching a border reads as a line that has been cut off.
note.style.padding = `2px ${String(TEXT_INSET_PX)}px 4px`;

const list = document.createElement('div');
list.className = 'woc-vs-list';
list.style.display = 'flex';
list.style.flexDirection = 'column';
list.style.gap = '3px';

/**
 * A frame rather than a window, because the player TOGGLES it rather than opening
 * it, and compact rather than comfortable because it is glanced at while riding.
 *
 * Not resizable, and that is the pair rule rather than an omission: how many rows
 * there are is a number the player sets, so a handle that changed the height either
 * clips the rows or leaves a gap under them. The honest control is a size setting,
 * which is what `list-length` is.
 */
const frame = woc.ui.frame({
  id: 'nodes',
  title: 'Veinsight',
  width: FRAME_WIDTH,
  density: 'compact',
  closable: true,
  save: true,
});

/**
 * The column the content lays out in, and the whole of what fixes the width.
 *
 * A frame that is not resizable is CONTENT SIZED: the loader writes its position and
 * leaves the box to the browser, since `frame/interactive.ts` paints a width only for
 * a frame somebody can drag. So `width` above is the opening box and the floor a
 * resize could reach, and neither of those reaches a frame nobody can resize. What
 * that leaves is a panel as wide as its longest line, which is not a constant: it
 * measured 403px holding the note above and 169px holding "No node within 20 yd", so
 * it changed width under the player every time the note changed, and again on a zone
 * whose name is longer than Eastbrook Vale.
 *
 * A column of a stated width is what `width` was meant to say. The note wraps inside
 * it, the rows lay out against it, and the panel is the same width all session.
 */
const column = document.createElement('div');
column.className = 'woc-vs-column';
column.style.width = `${String(FRAME_WIDTH)}px`;
column.style.boxSizing = 'border-box';
column.appendChild(note);
column.appendChild(list);
frame.body.appendChild(column);

/** The player, or null before world entry. Read live: it is replaced on a switch. */
function player() {
  const { player: me } = woc.world;
  if (me === null || me === undefined) {
    return null;
  }
  return me;
}

/** Seconds left on YOUR timer for a node, or 0 for one that is ready for you. */
function coolingFor(node) {
  const map = woc.world.nodeCooldowns;
  if (map === null || map === undefined) {
    return EMPTY;
  }
  const left = map.get(node.id);
  if (typeof left !== 'number' || !Number.isFinite(left) || left <= NONE) {
    return EMPTY;
  }
  return left;
}

/**
 * The best tier of tool you own for one type, `NO_TOOL` for none, or null for bags
 * that cannot be read.
 *
 * The bags rather than the equipment, because a gathering tool has no slot: the
 * game's own gate scans the whole inventory (`bestOwnedGatherToolTierOrNone`).
 *
 * Null and `NO_TOOL` are different answers and collapsing them would be the whole
 * display lying at once: an inventory the loader cannot read yet would otherwise say
 * every node in the world is shut to you, which is what "you own no tools" looks
 * like from the outside. Null means the gate is not applied and the panel says so.
 */
function bestToolTier(type) {
  const bags = woc.world.inventory;
  if (bags === null || bags === undefined) {
    return null;
  }
  const owned = toolsByType.get(type) ?? [];
  let best = NO_TOOL;
  for (const slot of bags) {
    for (const tool of owned) {
      if (tool.id === slot.itemId && tool.tier > best) {
        best = tool.tier;
      }
    }
  }
  return best;
}

/** Re-read the bags once, because otherwise every node scans them again. */
function refreshTools() {
  tierByType = new Map(TYPES.map((type) => [type, bestToolTier(type)]));
}

/** The best tier owned for a type, or null while the bags cannot be read. */
function toolTier(type) {
  return tierByType.get(type) ?? null;
}

/** Whether the bags say anything at all yet, which is a state rather than an answer. */
function bagsKnown() {
  return toolTier(TYPES[0]) !== null;
}

/** Whether anything in your bags can open this node. Unreadable bags refuse nothing. */
function openable(node) {
  const owned = toolTier(node.type);
  return owned === null || owned >= node.tier;
}

/** Flat distance to a node, which is the 2D one the game's own harvest gate uses. */
function distanceTo(node) {
  const me = player();
  if (me === null) {
    return null;
  }
  return Math.hypot(me.pos.x - node.x, me.pos.z - node.z);
}

/**
 * Which way to turn for a node, as one of eight arrows.
 *
 * Relative to your character's facing rather than to the camera, and the sign is
 * the game's: `facing` grows as you turn left, so a positive difference is a node on
 * your left and the sectors run that way.
 */
function bearingTo(node) {
  const me = player();
  if (me === null) {
    return '';
  }
  const toward = Math.atan2(node.x - me.pos.x, node.z - me.pos.z);
  const sector = Math.round((toward - me.facing) / SECTOR_RADIANS);
  return ARROWS[((sector % ARROWS.length) + ARROWS.length) % ARROWS.length];
}

/** The y of the nearest entity standing over a node's point, or null for none near. */
function sampleHeight(node) {
  let best = null;
  let nearest = SAMPLE_YARDS;
  for (const entity of woc.world.entities.values()) {
    const away = Math.hypot(entity.pos.x - node.x, entity.pos.z - node.z);
    if (away <= nearest) {
      nearest = away;
      best = entity.pos.y;
    }
  }
  return best;
}

/**
 * The height under a node and where that number came from, or null with no world.
 *
 * A harvested height is kept forever and a sampled one is captured once; a guess is
 * recomputed every time, because it is the player's own height and they move.
 */
function heightFor(node) {
  const known = heights.get(node.id);
  if (known !== undefined) {
    return known;
  }
  const me = player();
  if (me === null) {
    return null;
  }
  const sampled = sampleHeight(node);
  if (sampled === null) {
    return { y: me.pos.y, from: 'guessed' };
  }
  const found = { y: sampled, from: 'sampled' };
  heights.set(node.id, found);
  return found;
}

/** Where a pin sits, in the shape `ui.anchor3d` and `ui.project` both take, or null. */
function pointOf(node) {
  const height = heightFor(node);
  if (height === null) {
    return null;
  }
  return { x: node.x, y: height.y, z: node.z };
}

/** How the height under a node was arrived at, for the display that says so. */
function provenance(node) {
  return heightFor(node)?.from ?? 'guessed';
}

function zoneName(id) {
  return zoneNames.get(id) ?? id;
}

/** The zone filter's answer, and it is only ever a real one with a publisher up. */
function zoneAllows(node) {
  if (!settingFlag('this-zone-only', false) || publishedZone === null) {
    return true;
  }
  return node.zone === publishedZone;
}

function typeAllows(node) {
  return settingFlag(TYPE_SETTING[node.type], true);
}

function tierAllows(node) {
  return settingFlag('above-tier', true) || openable(node);
}

function allowed(node) {
  return typeAllows(node) && zoneAllows(node) && tierAllows(node);
}

/** Every node worth drawing right now, nearest first. */
function inRange() {
  const reach = drawDistance();
  const shown = [];
  for (const node of nodes) {
    const away = distanceTo(node);
    if (away !== null && away <= reach && allowed(node)) {
      shown.push({ node, away });
    }
  }
  return shown.sort((a, b) => a.away - b.away);
}

/** `1m 30s`, `45s`. Rounded up, so nothing reads 0 while it is still counting. */
function countdown(seconds) {
  const whole = Math.ceil(seconds);
  if (whole >= SECONDS_PER_MINUTE) {
    const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
    return `${String(minutes)}m ${String(whole % SECONDS_PER_MINUTE)}s`;
  }
  return `${String(whole)}s`;
}

/**
 * The same countdown in bare seconds: `83s`, `12s`.
 *
 * For the pin, which is a 40px square rather than a 300px row: `1m 23s` does not fit
 * in one, and what a browser does with text that does not fit is wrap it and paint
 * the second line past the tile.
 *
 * Seconds all the way up rather than minutes above a minute, which is what every
 * other countdown in a tile does. The range is what makes the difference: an aura
 * runs to ten minutes and needs the shorter unit, while a node comes back inside one
 * respawn, which at game 0.34.0 is 240 seconds, so the longest figure is `240s` and
 * four characters still fit. Rounding that range to whole minutes would leave four
 * distinct readings across the entire wait, which costs the one thing the figure is
 * for, namely whether it is worth standing here.
 */
function pinCountdown(seconds) {
  return `${String(Math.ceil(seconds))}s`;
}

/** The respawn length for a node's type, which every fill in the panel divides by. */
function respawnFor(type) {
  return respawnByType.get(type);
}

/** Whether a node is ready AND you carry something that opens it. */
function takeable(node) {
  return coolingFor(node) === EMPTY && openable(node);
}

/**
 * The figure a node is drawn with, in whichever length the caller has room for.
 *
 * The two states are words rather than times and are the same in both places: a
 * pin that abbreviated "Tool" would be saying something else, and there is nothing
 * shorter than "Yours" that still says whose the timer is.
 */
function figureIn(node, time) {
  if (!openable(node)) {
    return 'Tool';
  }
  const left = coolingFor(node);
  if (left === EMPTY) {
    return 'Yours';
  }
  return time(left);
}

/** The row's right-hand figure. "Tool" is a state rather than a time, and says so. */
function figureFor(node) {
  return figureIn(node, countdown);
}

/** The pin's, in the room a 40px square has. */
function pinFigure(node) {
  return figureIn(node, pinCountdown);
}

/**
 * How full a row is, in the kit's own sense: how much of the timer is LEFT.
 *
 * A node that is ready has no timer, so it draws empty and the figure carries the
 * state. Nothing here inverts the fill to make the good state loud, because a bar
 * meaning "remaining" on one row and "progress" on another means nothing at all.
 */
function fillFor(node) {
  const left = coolingFor(node);
  if (left === EMPTY) {
    return EMPTY;
  }
  return Math.min(FULL, left / respawnFor(node.type));
}

function toneFor(node) {
  const left = coolingFor(node);
  if (left > EMPTY && left <= NEARLY_READY) {
    return 'warn';
  }
  return 'default';
}

function labelFor(node) {
  const label = TYPE_LABEL[node.type];
  if (node.tier > FULL) {
    return `${label} (tier ${String(node.tier)})`;
  }
  return label;
}

function detailFor(node, away) {
  return `${zoneName(node.zone)}, ${String(Math.round(away))} yd ${bearingTo(node)}`;
}

/** What one row says about the tool gate, which is a fact rather than a guess. */
function toolLine(node) {
  const owned = toolTier(node.type);
  if (owned === null) {
    return { text: 'Your bags cannot be read yet, so nothing here is gated on a tool' };
  }
  if (owned >= node.tier) {
    return { text: `Your best tool for this is tier ${String(owned)}`, tone: 'muted' };
  }
  if (owned === NO_TOOL) {
    return { text: `You carry no tool for this, and it needs tier ${String(node.tier)}` };
  }
  return { text: `Needs a tier ${String(node.tier)} tool, yours is tier ${String(owned)}` };
}

function rowTooltip(node) {
  const lines = [
    `${zoneName(node.zone)}, level ${String(node.level)} ground, at ${String(node.x)}, ${String(node.z)}`,
    toolLine(node),
    { text: `Comes back ${String(respawnFor(node.type))}s after YOU harvest it`, tone: 'muted' },
    { text: `Its pin ${HEIGHT_WORDS[provenance(node)]}`, tone: 'muted' },
  ];
  return { title: labelFor(node), lines };
}

/** One row. The type is carried by an edge in the game's own colour for it. */
function createRow(node) {
  const bar = woc.ui.bar({ label: labelFor(node), className: 'woc-vs-row' });
  bar.el.dataset.node = node.id;
  bar.el.style.borderLeft = `${String(ROW_EDGE_PX)}px solid ${TYPE_TINT[node.type]}`;
  // The same width back on the other side, and invisible. A border sits outside the
  // kit's padding, so an edge on one side alone makes the row lopsided: the name
  // gets 7px of air and the countdown 4, which puts the figure nearer the panel's
  // border than anything else on the row and reads as a number about to be cut off.
  // Mirrored rather than measured, so it stays right if the kit's padding moves.
  bar.el.style.borderRight = `${String(ROW_EDGE_PX)}px solid transparent`;
  woc.ui.tooltip(bar.el, () => rowTooltip(node));
  return bar;
}

/**
 * The pillar under a pin, whose line style is the height's provenance.
 *
 * Drawn rather than written because a pin cannot carry a tooltip: the loader makes
 * every anchor pointer-transparent, so nothing over the world is hoverable. The
 * words are on the row in the list, which is.
 */
function createPillar(node) {
  const pillar = document.createElement('div');
  pillar.className = 'woc-vs-pillar';
  pillar.style.width = `${String(PILLAR_WIDTH_PX)}px`;
  pillar.style.height = `${String(PILLAR_PX)}px`;
  pillar.style.margin = '0 auto';
  pillar.style.borderLeftWidth = `${String(PILLAR_WIDTH_PX)}px`;
  pillar.style.borderLeftColor = TYPE_TINT[node.type];
  return pillar;
}

/**
 * One pin: a tile with the respawn sweeping over it, standing on a pillar.
 *
 * The anchor centres its content on the point, so the whole thing is lifted by half
 * its own height to put the pillar's FOOT on the node rather than its middle.
 */
function createPin(node) {
  const tile = woc.ui.tile({
    label: `${labelFor(node)}, ${zoneName(node.zone)}`,
    icon: null,
    className: 'woc-vs-pin',
    size: PIN_SIZE,
  });
  const stack = document.createElement('div');
  stack.className = 'woc-vs-stack';
  stack.dataset.node = node.id;
  const pillar = createPillar(node);
  stack.appendChild(tile.el);
  stack.appendChild(pillar);
  const anchor = woc.ui.anchor3d(() => pointOf(node), {
    className: 'woc-vs-anchor',
    offset: { y: -(PIN_SIZE + PILLAR_PX) / 2 },
  });
  anchor.el.appendChild(stack);
  return { tile, anchor, stack, pillar, style: '', opacity: '' };
}

function dropPin(id, pin) {
  pin.tile.destroy();
  pin.anchor.destroy();
  pins.delete(id);
}

function clearPins() {
  for (const [id, pin] of pins) {
    dropPin(id, pin);
  }
}

/** Whether the player could harvest a node from where they are standing right now. */
function inReach(away) {
  return away <= REACH_YARDS;
}

/** A pin is drawn quietly while its node is still cooling for you. */
function opacityFor(node) {
  if (takeable(node)) {
    return String(READY_OPACITY);
  }
  return String(COOLING_OPACITY);
}

/** Paint one pin, writing only what moved. */
function paintPin(pin, entry) {
  const { node, away } = entry;
  const from = provenance(node);
  pin.tile.update({ fraction: fillFor(node), value: pinFigure(node), tone: toneFor(node) });
  pin.stack.dataset.height = from;
  pin.stack.dataset.reach = String(inReach(away));
  if (pin.style !== PILLAR_STYLE[from]) {
    pin.style = PILLAR_STYLE[from];
    pin.pillar.style.borderLeftStyle = pin.style;
  }
  const opacity = opacityFor(node);
  if (pin.opacity !== opacity) {
    pin.opacity = opacity;
    pin.anchor.el.style.opacity = opacity;
  }
}

function syncPins(entries) {
  const shown = new Map(entries.map((entry) => [entry.node.id, entry]));
  for (const [id, pin] of pins) {
    if (!shown.has(id)) {
      dropPin(id, pin);
    }
  }
  for (const [id, entry] of shown) {
    let pin = pins.get(id);
    if (pin === undefined) {
      pin = createPin(entry.node);
      pins.set(id, pin);
    }
    paintPin(pin, entry);
  }
}

/** Put a row at its position, and only when it is not already there. */
function place(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}

function paintRow(bar, entry) {
  const { node, away } = entry;
  bar.update({
    fraction: fillFor(node),
    value: figureFor(node),
    detail: detailFor(node, away),
    tone: toneFor(node),
  });
  bar.el.dataset.reach = String(inReach(away));
}

function syncRows(entries) {
  const shown = new Set(entries.map((entry) => entry.node.id));
  for (const [id, bar] of rows) {
    if (!shown.has(id)) {
      bar.destroy();
      rows.delete(id);
    }
  }
  for (const [at, entry] of entries.entries()) {
    let bar = rows.get(entry.node.id);
    if (bar === undefined) {
      bar = createRow(entry.node);
      rows.set(entry.node.id, bar);
    }
    paintRow(bar, entry);
    place(bar.el, at);
  }
}

/** Which types the player has switched off, so the empty note can say so. */
function offTypes() {
  return TYPES.filter((type) => !settingFlag(TYPE_SETTING[type], true));
}

/** Why there is nothing in range, in words, because an empty list is not a zero. */
function emptyNote() {
  if (nodes.length === NONE) {
    return 'Reading the node table.';
  }
  if (player() === null) {
    return 'Waiting for the world.';
  }
  if (offTypes().length === TYPES.length) {
    return 'Every node type is switched off in the settings.';
  }
  return `No node within ${String(Math.round(drawDistance()))} yd.`;
}

/** Every reason the panel is showing less than everything, in words. */
function limits(listed, pinned, total) {
  const parts = [];
  if (total > listed) {
    parts.push(`${String(total - listed)} more in range`);
  }
  if (total > pinned) {
    parts.push(`${String(pinned)} pins is the most drawn at once`);
  }
  if (!bagsKnown()) {
    parts.push('your bags cannot be read, so no tool gate is applied');
  }
  if (settingFlag('this-zone-only', false) && !zoneHeard) {
    parts.push('no zone publisher is installed, so every zone is listed');
  }
  if (harvesting !== null && woc.now() < harvestingUntil) {
    parts.push(`harvesting ${TYPE_LABEL[harvesting].toLowerCase()}`);
  }
  return parts;
}

/** Each limit is written as its own sentence, so it reads as one rather than a list. */
function asSentence(part) {
  return `${part.slice(NONE, FULL).toUpperCase()}${part.slice(FULL)}.`;
}

/** What the panel says about itself, above the rows. */
function noteText(listed, pinned, total) {
  if (listed === NONE) {
    return emptyNote();
  }
  const parts = limits(listed, pinned, total);
  if (parts.length === NONE) {
    return 'Timers are yours alone. Nobody else can take a node off you.';
  }
  return parts.map(asSentence).join(' ');
}

function redraw() {
  if (!frame.visible) {
    clearPins();
    clearRoute();
    return;
  }
  refreshTools();
  const all = inRange();
  const listed = all.slice(NONE, listLength());
  const pinned = all.slice(NONE, MAX_PINS);
  note.textContent = noteText(listed.length, pinned.length, all.length);
  syncRows(listed);
  syncPins(pinned);
  syncRoute(pinned);
}

/**
 * The route's stops: the nearest nodes that are actually yours, chained one to the
 * next from where you stand.
 *
 * Nearest-neighbour rather than anything cleverer, because the honest claim is "go
 * here, then here" and not "this is the shortest tour", which is a claim this addon
 * would have no way to stand behind. Only takeable nodes are joined: a leg to
 * something still cooling, or to something your tools cannot open, is a walk to
 * nothing.
 */
function routeStops(entries) {
  const left = entries.map((entry) => entry.node).filter(takeable);
  const stops = [];
  const me = player();
  if (me === null) {
    return stops;
  }
  let at = { x: me.pos.x, z: me.pos.z };
  while (stops.length < MAX_ROUTE_STOPS - FULL && left.length > NONE) {
    let best = NONE;
    for (const [index, node] of left.entries()) {
      const chosen = left[best];
      if (Math.hypot(node.x - at.x, node.z - at.z) < Math.hypot(chosen.x - at.x, chosen.z - at.z)) {
        best = index;
      }
    }
    const [taken] = left.splice(best, FULL);
    stops.push(taken);
    at = { x: taken.x, z: taken.z };
  }
  return stops;
}

/** Where the player is, in the shape both the anchor and the projector take. */
function playerPoint() {
  return { unit: 'player', over: 'body' };
}

/** One leg of the route: an anchor at its start, holding a line drawn to its end. */
function createLeg(from, to) {
  const line = document.createElement('div');
  line.className = 'woc-vs-leg';
  line.dataset.to = to.id;
  line.style.position = 'absolute';
  line.style.left = '50%';
  line.style.top = '50%';
  line.style.height = `${String(ROUTE_WIDTH_PX)}px`;
  line.style.transformOrigin = '0 50%';
  line.style.background = TYPE_TINT[to.type];
  line.style.opacity = String(COOLING_OPACITY);
  const anchor = woc.ui.anchor3d(anchorAt(from), { className: 'woc-vs-route' });
  anchor.el.appendChild(line);
  return { anchor, line, from, to, width: '', transform: '' };
}

/** A leg's start, as a point source: a function for a node, the unit for the player. */
function anchorAt(from) {
  if (from === null) {
    return playerPoint();
  }
  return () => pointOf(from);
}

/** The same end, as the fixed point `ui.project` takes rather than a source. */
function projectAt(end) {
  if (end === null) {
    return playerPoint();
  }
  return pointOf(end);
}

function clearRoute() {
  for (const leg of legs) {
    leg.anchor.destroy();
  }
  legs = [];
}

/** Where one end of a leg is on screen, or null when it has no trustworthy place. */
function screenEnd(end) {
  const at = projectAt(end);
  if (at === null) {
    return null;
  }
  return woc.ui.project(at);
}

/**
 * Lay one leg out from where its two ends are on screen right now.
 *
 * This is the only thing in the addon on the frame tick, and it has to be: a leg's
 * length and angle are answers about the CAMERA, so they change when nothing in the
 * world has moved at all. Written only when the rounded numbers changed.
 */
function paintLeg(leg) {
  const start = screenEnd(leg.from);
  const end = screenEnd(leg.to);
  if (start === null || end === null) {
    leg.line.style.display = 'none';
    return;
  }
  leg.line.style.display = '';
  const width = `${String(Math.round(Math.hypot(end.x - start.x, end.y - start.y)))}px`;
  const degrees = (Math.atan2(end.y - start.y, end.x - start.x) * HALF_TURN_DEGREES) / Math.PI;
  const transform = `rotate(${degrees.toFixed(ANGLE_DECIMALS)}deg)`;
  if (leg.width !== width) {
    leg.width = width;
    leg.line.style.width = width;
  }
  if (leg.transform !== transform) {
    leg.transform = transform;
    leg.line.style.transform = transform;
  }
}

/** The ids the legs join, so a route that has not changed is left standing. */
function legKey(stops) {
  return stops.map((node) => node.id).join('>');
}

function syncRoute(entries) {
  if (!settingFlag('route', false)) {
    clearRoute();
    return;
  }
  const stops = routeStops(entries);
  if (legKey(stops) === legKey(legs.map((leg) => leg.to))) {
    return;
  }
  clearRoute();
  let from = null;
  for (const stop of stops) {
    legs.push(createLeg(from, stop));
    from = stop;
  }
}

/** Everything a harvested height needs to survive a reload, and nothing else. */
async function save() {
  await woc.world.ready;
  const pairs = [];
  for (const [id, height] of heights) {
    if (height.from === 'harvested') {
      pairs.push([id, height.y]);
    }
  }
  await woc.storage.character.set(STORE_KEY, Object.fromEntries(pairs));
}

function persist() {
  save().catch((err) => {
    woc.warn('could not write the node heights down', err);
  });
}

/**
 * Take a stored height back, over a node nothing better is known about.
 *
 * A per-character READ waits for the character, so this settles at world entry,
 * which is after a harvest could already have landed. What this session measured is
 * newer by definition, so a stored value never overwrites a harvested one.
 */
function reclaim(id, value) {
  const known = heights.get(id);
  if (known?.from === 'harvested' || !byId.has(id)) {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    heights.set(id, { y: value, from: 'harvested' });
  }
}

async function restore() {
  const stored = await woc.storage.character.get(STORE_KEY, null);
  if (typeof stored !== 'object' || stored === null) {
    return;
  }
  for (const [id, value] of Object.entries(stored)) {
    reclaim(id, value);
  }
  redraw();
}

function load() {
  restore().catch((err) => {
    woc.warn('could not read the node heights back', err);
  });
}

// The key set changing is the one signal a node becoming yours again produces, and
// `world.on` reports that set rather than the seconds counting down, which is
// exactly the split this addon is drawn on. The inventory watch is the tool gate:
// buying a better pick changes what half of these rows say.
woc.world.on('nodeCooldowns', redraw);
woc.world.on('inventory', redraw);

/**
 * A harvest landed, so this node's height is now a measurement rather than a guess.
 *
 * The player is standing ON the node when the cast completes, which is what makes
 * their own feet the exact answer for a point the table gives no height for. It
 * overwrites whatever was there, because every other kind of answer is an estimate.
 */
woc.net.onEvent('gatherResult', (event) => {
  harvesting = null;
  const me = player();
  const node = byId.get(event.nodeId);
  if (node === undefined || me === null) {
    return;
  }
  heights.set(node.id, { y: me.pos.y, from: 'harvested' });
  persist();
  redraw();
});

/**
 * A gather cast has started, and it says the TYPE and no node id at all.
 *
 * So the note says a harvest is under way and deliberately does not say of what:
 * attributing it to the nearest node of that type would be a guess drawn as a fact,
 * and the id arrives on the result a second or two later anyway.
 *
 * Two guards, and both of them are about the note being true rather than merely
 * present. `castStart` is a BROADCAST rather than a personal record, so somebody
 * else mining beside you emits one and would otherwise say YOU were harvesting.
 * And an interrupted cast emits no result at all, so the note is stamped with the
 * longest a cast can run rather than left standing until one arrives.
 */
woc.net.onEvent('castStart', (event) => {
  const me = player();
  const mine = me !== null && event.entityId === me.id;
  if (mine && typeof event.gatherNodeType === 'string' && TYPES.includes(event.gatherNodeType)) {
    harvesting = event.gatherNodeType;
    harvestingUntil = woc.now() + GATHER_CAST_MS;
    redraw();
  }
});

/**
 * The player has become somebody else without the page reloading.
 *
 * Heights are per character in storage, and a sampled one is per session, so both
 * sets belong to whoever was playing a moment ago. Left in place, the next harvest
 * would write the previous character's measurements out under this one's key.
 */
woc.world.on('characterKey', () => {
  heights.clear();
  load();
  redraw();
});

// A zone publisher, if one is installed. `anySender` rather than a hardcoded fqid,
// because `official/wayfarer` is right only on the official marketplace and the same
// addon installed from a fork publishes under another name. Silence is ordinary: it
// means nobody is publishing, which the note says in words.
woc.bus.on(woc.bus.anySender, ZONE_TOPIC, (message) => {
  const zone = message.payload;
  if (typeof zone === 'object' && zone !== null && typeof zone.id === 'string') {
    zoneHeard = true;
    publishedZone = zone.id;
    redraw();
  }
});

/** Ask, and draw without waiting: there is no reply on this bus and never will be. */
function askForZone() {
  woc.bus.emit(`${ZONE_TOPIC}:ask`);
}

// Once a second, because every figure on this panel moves at most that often: a
// countdown is written in whole seconds and a 240 second sweep moves a sixth of a
// degree a tick. The route is the exception and rides the frame loop below.
woc.setInterval(redraw, MS_PER_SECOND);

// The legs only, and only while there are any. Everything else here would be sixty
// rewrites a second of six strings that did not change.
woc.onFrame(() => {
  for (const leg of legs) {
    paintLeg(leg);
  }
});

woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now rather than up to a second from now: somebody who just hid the panel should
  // not watch its pins hang over the world waiting for the next tick.
  redraw();
});

woc.onSettingsChange(() => {
  askForZone();
  redraw();
});

/**
 * Read the table in, then do the two things that needed one.
 *
 * Every handler above is wired first and is a no-op against an empty table rather
 * than wrong, which is what makes that order safe: an addon's first line runs at
 * document-start, and subscribing after an await would miss whatever landed during
 * it. `load()` rather than `await restore()`, because a per-character read waits for
 * the character and awaiting it here would hold the first draw on the landing page.
 */
async function boot() {
  const table = readTable(await woc.data(DATA_FILE));
  if (table === null) {
    throw new Error(
      `${DATA_FILE} carries no "nodes", "zones" and "tools" arrays and "respawnSeconds" map`,
    );
  }
  adopt(table);
  load();
  askForZone();
  redraw();
}

boot().catch((err) => {
  woc.error('could not read the node table, so there is nothing to pin', err);
});
