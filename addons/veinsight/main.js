/// <reference types="@woc-addons/types" />

// Veinsight: every gathering node in the world, pinned where it actually is.
//
// A gathering node is never an entity: the server spawns nothing for one and the snapshot
// carries nothing about one, so the renderer draws them from an authored table and the
// only thing on the wire is your own respawn timers. This file is the join, and the table
// is `nodes.json`, which `generate.mjs` writes from a game checkout. Never hand-edit it.
//
// The cooldowns are facts. `world.nodeCooldowns` is per PLAYER: a node with no entry is
// ready for you whatever anybody else did to it, and it rides the snapshot, so it
// survives a reload with nothing stored.
//
// The tool gate is a fact, and it is a TOOL gate rather than a skill one: a tool covers
// its own tier and every tier below it, bare hands cover nothing, and gathering
// proficiency moves the rarity of a yield and gates nothing.
//
// The height is always an INFERENCE and each pin's pillar says which of three kinds, since
// the table carries no y and ground height is a function of a world seed no addon can
// call:
//
//   harvested  read off your own feet when a harvest landed. Exact.
//   sampled    an entity stood within a few yards. Captured once, since tracking slides
//              a marker up a ramp.
//   guessed    nothing better, so the pin sits at your own height.
//
// A pin is a tile on a pillar rather than a flat disc for that reason: a disc at the wrong
// height reads as a bug, and a pillar that starts high still points at one spot.
//
// The zone filter cannot be answered alone. The loader publishes no zone id, because the
// game's own resolver clamps rather than answering null and would name an overworld zone
// for a player in a dungeon. Every node row carries its own `zoneId`, so what is missing
// is one bus topic, and without a publisher the filter degrades to every zone and says so.

/** Yards the game lets you harvest from, `INTERACT_RANGE` in `src/sim/types.ts`. */
const REACH_YARDS = 5;
/** How close an entity has to be to a node's point to stand in for its height. */
const SAMPLE_YARDS = 6;
const MS_PER_SECOND = 1000;
/** Warm under this many seconds. ABSOLUTE rather than a share of the respawn: it is how
 * much warning the player gets to start walking, so it must not track `respawnByType`.
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
/** Where a row's text starts, so the note lines up: the kit's padding plus this addon's
 * edge. Written out because the note is a plain div with no bar to inherit from.
 */
const TEXT_INSET_PX = 7;
/** How opaque a pin is while its node is still cooling down for you. */
const COOLING_OPACITY = 0.45;
const READY_OPACITY = 1;
/** A cap rather than a promise, drawn as a number in the note when it bites, so a subset
 * is never shown as if it were everything.
 */
const MAX_PINS = 24;

/** How many stops a route line may join, counting your own position as the first. */
const MAX_ROUTE_STOPS = 5;
const ROUTE_WIDTH_PX = 2;
/**
 * NOT a bearing constant: this converts a SCREEN-space `atan2(dy, dx)` into the CSS angle a
 * route leg is drawn at, which no loader member answers.
 */
const HALF_TURN_DEGREES = 180;
const ANGLE_DECIMALS = 1;

const DATA_FILE = 'nodes.json';
/** The one per-character key. Only heights read off a real harvest are in it. */
const STORE_KEY = 'heights';
const FULL = 1;
const EMPTY = 0;
const NONE = 0;
/** `NO_TOOL_OWNED` in `tools.ts`: no matching tool at all, which opens nothing. */
const NO_TOOL = 0;

/** The three node types, in the order the game lists them. */
const TYPES = ['ore', 'wood', 'herb'];

/** What each type is called on screen, from the game's own name for the fixture. */
const TYPE_LABEL = { ore: 'Ore vein', wood: 'Wood stand', herb: 'Herb patch' };

/** `NODE_COLOR` from the game, so a pillar matches the mesh it points at. Nothing else
 * here is coloured: a bar's fill is the kit's to tint by tone.
 */
const TYPE_TINT = { ore: '#8a8f98', wood: '#5b3a21', herb: '#4caf50' };

/** Which setting turns each type on. Written out because a key here is a manifest id. */
const TYPE_SETTING = { ore: 'show-ore', wood: 'show-wood', herb: 'show-herb' };

/** How a pin's pillar is drawn for each way its height was worked out. */
const PILLAR_STYLE = { harvested: 'solid', sampled: 'dashed', guessed: 'dotted' };

/** What each of those three is called when a row says it in words. */
const HEIGHT_WORDS = {
  harvested: 'sits at the height your own harvest measured',
  sampled: 'sits at the height of something standing there',
  guessed: 'sits at your own height, nothing better was in range',
};

/** `GATHER_CAST_BASE_SEC`, which the formula only ever shortens, so it is a CEILING. An
 * interrupted cast emits no result, so without it the note reads as live when it is not.
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
 * Node type to the seconds a harvested node of it takes to come back, off the game's own
 * `NODE_HARVEST_TABLE`.
 *
 * It comes out of the data file rather than being written down here, because it is a
 * tuning number that moves on a content pass with nothing on the wire to announce it. A
 * constant here is wrong silently, since the fill is clamped: dividing by 120 while the
 * server counts down from 240 draws a bar pinned at full for the whole first half.
 *
 * Per type because the game's table is keyed per type; all three agree today. Empty until
 * the data file lands, and nothing draws against it before then: `readTable` refuses a
 * file that does not carry a positive figure for every type.
 */
let respawnByType = new Map();
/** Node type to the best tier you own, recomputed once per draw rather than per node. */
let tierByType = new Map();

/**
 * Node id to the height under it, and which of the three ways that was arrived at. A
 * `harvested` entry is the only kind written down, because it is the only kind that is a
 * measurement: a `sampled` one is an estimate a different session would make differently,
 * and storing it would turn one passer-by into a permanent claim.
 */
const heights = new Map();

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

/** REFUSED rather than defaulted, unlike a bad node row: this is the denominator of every
 * bar in the panel and there is no honest number to fall back to.
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

function drawDistance() {
  return woc.settings['draw-distance'];
}

function listLength() {
  return Math.max(FULL, Math.round(woc.settings['list-length']));
}

/** The line above the rows saying why the panel is showing what it is showing. */
const note = document.createElement('div');
note.className = 'woc-vs-note';
note.style.opacity = '0.75';
// Indented to the rows rather than to the body: with no padding of its own the sentence
// starts 7px left of every label below it and ends hard against the panel's border, and a
// line of text touching a border reads as one that has been cut off.
note.style.padding = `2px ${String(TEXT_INSET_PX)}px 4px`;

const list = document.createElement('div');
list.className = 'woc-vs-list';
list.style.display = 'flex';
list.style.flexDirection = 'column';
list.style.gap = '3px';

/** NOT resizable: the row count is a setting, so a drag handle would either clip the rows
 * or leave a gap under them.
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
 * The column the content lays out in, which must NOT restate the frame's width: the
 * loader already holds a content-sized frame to it, and the frame's padding is inside that
 * number, so a column stating it again is 20px too wide and clips its own rows.
 */
const column = document.createElement('div');
column.className = 'woc-vs-column';
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
 * The best tier you own, `NO_TOOL` for none, or null for bags that cannot be read. The
 * BAGS rather than the equipment: a gathering tool has no slot and the game's own gate
 * scans the inventory. Null and `NO_TOOL` are different answers and collapsing them would
 * say every node in the world is shut to you.
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

/** Empty with no bearing to be had, which is before world entry or a non-finite facing. */
function arrowTo(node) {
  return woc.fmt.compass(woc.world.bearingTo(node));
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

/** A harvested height is kept forever and a sampled one captured once; a guess is
 * recomputed, since it is the player's own height and they move.
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
  if (!woc.settings['this-zone-only'] || publishedZone === null) {
    return true;
  }
  return node.zone === publishedZone;
}

function typeAllows(node) {
  return woc.settings[TYPE_SETTING[node.type]];
}

function tierAllows(node) {
  return woc.settings['above-tier'] || openable(node);
}

function allowed(node) {
  return typeAllows(node) && zoneAllows(node) && tierAllows(node);
}

/** Every node worth drawing right now, nearest first. */
function inRange() {
  const reach = drawDistance();
  const shown = [];
  for (const node of nodes) {
    const away = woc.world.distanceTo(node);
    if (away !== null && away <= reach && allowed(node)) {
      shown.push({ node, away });
    }
  }
  return shown.sort((a, b) => a.away - b.away);
}

/**
 * A node's respawn in bare seconds, and neither `fmt.duration` style is it: `1m 23s` wraps
 * past a 40px tile and `'timer'` rounds the whole four-minute wait to four readings.
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

/** The two states are WORDS in both places: a pin abbreviating "Tool" would say something
 * else.
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

/**
 * The row's right-hand figure. "Tool" is a state rather than a time, and says so.
 *
 * Bounded by one respawn, 240 seconds for every type in `nodes.json`, so only the minute
 * and second tiers render. A content change past an hour would turn `60m 0s` into `1h 0m`.
 */
function figureFor(node) {
  return figureIn(node, (left) => woc.fmt.duration(left, 'coarse'));
}

/** The pin's, in the room a 40px square has. */
function pinFigure(node) {
  return figureIn(node, pinCountdown);
}

/**
 * How full a row is, in the kit's own sense: how much of the timer is left. A node that is
 * ready has no timer, so it draws empty and the figure carries the state. Nothing here
 * inverts the fill, because a bar meaning "remaining" on one row and "progress" on another
 * means nothing at all.
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
  return `${zoneName(node.zone)}, ${String(Math.round(away))} yd ${arrowTo(node)}`;
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
  // The same width back on the other side, and invisible. A border sits outside the kit's
  // padding, so an edge on one side alone makes the row lopsided and puts the figure
  // nearer the panel's border than anything else on the row. Mirrored rather than
  // measured, so it stays right if the kit's padding moves.
  bar.el.style.borderRight = `${String(ROW_EDGE_PX)}px solid transparent`;
  woc.ui.tooltip(bar.el, () => rowTooltip(node));
  return bar;
}

/** Drawn rather than written because a pin cannot carry a tooltip: every anchor is
 * pointer-transparent. The words are on the row, which is hoverable.
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

/** The anchor CENTRES its content on the point, so this is lifted by half its own height
 * to stand the pillar's foot on the node rather than its middle.
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
  return {
    tile,
    anchor,
    stack,
    pillar,
    style: '',
    opacity: '',
    destroy: () => {
      tile.destroy();
      anchor.destroy();
    },
  };
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

/** No `parent`: each pin carries its own `ui.anchor3d`, which already places it. */
const pins = woc.ui.list({
  key: (entry) => entry.node.id,
  create: (entry) => createPin(entry.node),
  update: paintPin,
});

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

/** Keyed on the node rather than its position: this list re-sorts as the player rides. */
const rows = woc.ui.list({
  parent: list,
  key: (entry) => entry.node.id,
  create: (entry) => createRow(entry.node),
  update: paintRow,
});

/** Which types the player has switched off, so the empty note can say so. */
function offTypes() {
  return TYPES.filter((type) => !woc.settings[TYPE_SETTING[type]]);
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
  if (woc.settings['this-zone-only'] && !zoneHeard) {
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
    pins.clear();
    clearRoute();
    return;
  }
  refreshTools();
  const all = inRange();
  const listed = all.slice(NONE, listLength());
  const pinned = all.slice(NONE, MAX_PINS);
  note.textContent = noteText(listed.length, pinned.length, all.length);
  rows.sync(listed);
  pins.sync(pinned);
  syncRoute(pinned);
}

/**
 * Nearest-neighbour rather than anything cleverer: the honest claim is "go here, then
 * here" and not "this is the shortest tour". Only TAKEABLE nodes are joined, since a leg
 * to something still cooling is a walk to nothing.
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

/** The only thing here on the frame tick, and it has to be: a leg's length and angle are
 * answers about the CAMERA, so they move when the world has not. Written only on a change.
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
  if (!woc.settings.route) {
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

/** Fills gaps only: the read settles at world entry, after a harvest could have landed,
 * and what this session measured is newer by definition.
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

// The key set changing is the only signal a node becoming yours again produces; the
// seconds counting down are not one. The inventory watch is the tool gate.
woc.world.on('nodeCooldowns', redraw);
woc.world.on('inventory', redraw);

/** The player is standing on the node when a cast completes, so their own feet are the
 * exact answer. It OVERWRITES: every other kind of answer is an estimate.
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
 * A gather cast carries the type and NO node id, so the note says a harvest is under way
 * and not of what: naming the nearest node of that type would be a guess drawn as a fact.
 *
 * Two guards. `castStart` is a broadcast, so somebody mining beside you emits one, and an
 * interrupted cast emits no result, so the note is stamped rather than left standing.
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

/** Heights are per character, so left in place the next harvest writes the previous
 * character's measurements out under this one's key.
 */
woc.world.on('characterKey', () => {
  heights.clear();
  load();
  redraw();
});

// A zone publisher, if one is installed. Silence is ordinary and means nobody is
// publishing, and a publisher with nothing to say answers null, so the payload is checked.
woc.bus.follow('zone', (payload) => {
  if (typeof payload === 'object' && payload !== null && typeof payload.id === 'string') {
    zoneHeard = true;
    publishedZone = payload.id;
    redraw();
  }
});

// Once a second, because every figure on this panel moves at most that often. The route
// is the exception and rides the frame loop below.
woc.setInterval(redraw, MS_PER_SECOND);

// The legs only: everything else would be sixty rewrites a second of strings that did
// not change.
woc.onFrame(() => {
  for (const leg of legs) {
    paintLeg(leg);
  }
});

// Bound by hand rather than with the frame's own `toggleKey`, DECLINED because this key
// does two things: `toggleKey` only toggles, and the pins are anchors over the world that
// nothing else takes down. No visibility callback on `FrameOpts` to hang the redraw on.
woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now rather than up to a second from now: somebody who just hid the panel should not
  // watch its pins hang over the world waiting for the next tick.
  redraw();
});

woc.onSettingsChange(redraw);

/**
 * Every handler above is wired BEFORE this await: subscribing after one would miss whatever
 * landed during it. `load()` rather than `await restore()`, since a per-character read
 * waits for the character and would hold the first draw on the landing page.
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
  redraw();
}

boot().catch((err) => {
  woc.error('could not read the node table, so there is nothing to pin', err);
});
