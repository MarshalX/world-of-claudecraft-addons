/// <reference types="@woc-addons/types" />

// Trailmark: where the thing your quest wants actually is.
//
// The quest log says what is outstanding and never where, and nothing on the wire ever
// will: the answer is a pure function of content tables inside the client bundle. So this
// addon carries them (`quests.json`) and runs the game's own derivation over them.
//
// `areasFor` is `questObjectiveAreas` from `src/sim/quest_targets.ts` with the tables
// handed in rather than imported, padding figures included. That leaf moves, and following
// it is the maintenance. Its node CLUSTERING is deliberately not copied: this draws a pin
// per area with a budget, and the list says how many it left out.
//
// The required count cannot simply be read. The game resolves it as
// `resolvedCounts?.[i] ?? objectives[i].count`, a per-player override that rides the wire
// and is not on the published `QuestProgress`, so this learns it from the `questProgress`
// event and falls back to the definition count. That fallback is a LOWER BOUND and is
// drawn `3/5+`, floored at what is already banked so a restored row cannot read as over.
//
// An authored pin has no height: every point is an x and a z, terrain height is a module
// function the renderer imports, and no heightmap is served. A pin hangs at the player's
// own height, which over sloping ground is approximate by construction, and sampling a
// nearby entity is not available here because the point is that nobody is standing there.
//
// An NPC's authored position and its live one can differ, since the sim nudges static NPCs
// out of buildings at world init. No display here quotes NPC coordinates as a fact.
//
// `questProgress`, `questReady` and `questDone` are not in the published catalogue, so all
// three arrive as `unknown` and every field is checked. A `required` that is not a
// positive finite number is DROPPED rather than learned: a bad denominator outlives the
// session on disk.

const DATA_FILE = 'quests.json';
/** The one per-character key: the learned denominators and the focused quest. */
const STORE_KEY = 'trail';

const FRAME_WIDTH = 300;
const FRAME_HEIGHT = 232;
/** The game's own padding figures, from `src/sim/quest_targets.ts`. Copied, not chosen. */
const CAMP_AREA_PAD = 4;
const POINT_AREA_RADIUS = 6;

/**
 * How tall one row is and how much of the frame is not rows, calibrated against a drawn
 * panel. FIXED rather than measured: measuring forces a layout, and the row budget is
 * recomputed on every drag frame. The chrome figure reserves the note line too.
 */
const ROW_PX = 33;
const CHROME_PX = 78;
/** The floor is ONE row, never the current count: bounds cannot be restated later. */
const MIN_HEIGHT = CHROME_PX + ROW_PX;
const MIN_WIDTH = 200;

/** A pin's side, and how far it floats above its point, in screen pixels. */
const PIN_SIZE = 36;
const PIN_LIFT = 22;
/** A gather objective can resolve to thirty-odd points, so the nearest few are drawn. */
const PIN_BUDGET = 12;
/** Beyond this many yards a pin is faded, so a near one reads as the near one. */
const FADE_YARDS = 120;
const FAR_OPACITY = 0.45;
const NEAR_OPACITY = 1;

const MS_PER_SECOND = 1000;

/** The world strip's default east-west extent, for a zone that declares none. */
const STRIP_MIN_X = -180;
const STRIP_MAX_X = 180;

/** A bar's fill, at the two ends. */
const FULL = 1;
const EMPTY = 0;

/** Sort ranks: the focused quest's objectives come first, everything else after. */
const RANK_FOCUS = 0;
const RANK_REST = 1;

/** One place along a list, and the smallest a list or a budget may be. */
const STEP = 1;
const ONE_ROW = 1;
const FIRST = 0;
/** A `[x, z]` pair, which is how many numbers a spawn position carries. */
const PAIR = 2;

/** The tables, empty until the data file lands. Nothing needs a special case. */
const quests = new Map();
const campsByMob = new Map();
const clusterByItem = new Map();
const npcs = new Map();
const nodesByType = new Map();
const nodesByItem = new Map();
const escorts = new Map();
/** `<questId> <itemId>` to the mob templates whose tagged loot feeds it. */
const dropMobs = new Map();
let zones = [];

/** Learned denominators, keyed `<questId>#<objectiveIndex>`. Per CHARACTER: the game's
 * override is per player, so an alt needs a different figure for the same quest.
 */
const learned = new Map();

/** The quest whose objectives lead the list, or null for "whatever is first". */
let focus = null;

/** Quest ids already seen in the log, so auto-track fires on arrival and not again. */
const seenQuests = new Set();

/** Whether the log has been walked once. See `noticeArrivals`. */
let firstWalk = true;

/** The frame's own box, which the row budget is laid out against. */
const box = { w: FRAME_WIDTH, h: FRAME_HEIGHT };

function numberAt(source, field) {
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  const value = source[field];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function stringAt(source, field) {
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  const value = source[field];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function arrayAt(source, field) {
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  const value = source[field];
  if (Array.isArray(value)) {
    return value;
  }
  return null;
}

/** A point row: x and z, and never a y. See the note at the top about height. */
function readPoint(value) {
  const x = numberAt(value, 'x');
  const z = numberAt(value, 'z');
  if (x === null || z === null) {
    return null;
  }
  return { x, z };
}

/** `woc.data` hands back `unknown`, so the shape is checked here. A count of zero is
 * dropped: it divides the fill by nothing and reads as complete.
 */
function readObjective(value) {
  const type = stringAt(value, 'type');
  const count = numberAt(value, 'count');
  const label = stringAt(value, 'label');
  if (type === null || label === null || count === null || count <= 0) {
    return null;
  }
  return {
    type,
    count,
    label,
    mob: stringAt(value, 'mob'),
    item: stringAt(value, 'item'),
    object: stringAt(value, 'object'),
    npc: stringAt(value, 'npc'),
    nodeType: stringAt(value, 'nodeType'),
    escort: stringAt(value, 'escort'),
  };
}

/** One quest definition. A quest with no readable objective can point nowhere. */
function readQuest(value) {
  const id = stringAt(value, 'id');
  const name = stringAt(value, 'name');
  const listed = arrayAt(value, 'objectives');
  if (id === null || name === null || listed === null) {
    return null;
  }
  const objectives = listed.map(readObjective);
  if (objectives.length === 0 || objectives.includes(null)) {
    return null;
  }
  const turnIn = (arrayAt(value, 'turnIn') ?? []).filter((npc) => typeof npc === 'string');
  return { id, name, giver: stringAt(value, 'giver'), turnIn, objectives };
}

function adoptQuests(listed) {
  for (const [at, row] of listed.entries()) {
    const quest = readQuest(row);
    if (quest === null) {
      woc.warn(`${DATA_FILE}: quest ${String(at)} is not readable, leaving it out`, row);
    } else {
      quests.set(quest.id, quest);
    }
  }
}

function index(map, key, entry) {
  const held = map.get(key);
  if (held === undefined) {
    map.set(key, [entry]);
    return;
  }
  held.push(entry);
}

function adoptCamps(listed) {
  for (const row of listed) {
    const point = readPoint(row);
    const mob = stringAt(row, 'mob');
    const radius = numberAt(row, 'radius');
    if (point !== null && mob !== null && radius !== null && radius >= 0) {
      index(campsByMob, mob, { x: point.x, z: point.z, radius });
    }
  }
}

/**
 * One enclosing circle per ground-object definition, computed once: the game's own bound,
 * being the centroid of the spawn positions plus the distance to the farthest of them,
 * floored at the lone-point radius. Neither the positions nor the answer can change.
 */
function clusterOf(positions) {
  let cx = 0;
  let cz = 0;
  for (const at of positions) {
    cx += at[0];
    cz += at[1];
  }
  cx /= positions.length;
  cz /= positions.length;
  let spread = 0;
  for (const at of positions) {
    spread = Math.max(spread, Math.hypot(at[0] - cx, at[1] - cz));
  }
  return { x: cx, z: cz, radius: Math.max(POINT_AREA_RADIUS, spread + CAMP_AREA_PAD) };
}

/** A `[x, z]` pair, as the file stores a spawn position. */
function readPair(value) {
  if (!Array.isArray(value) || value.length < PAIR) {
    return null;
  }
  const [x, z] = value;
  if (typeof x !== 'number' || typeof z !== 'number') {
    return null;
  }
  if (!(Number.isFinite(x) && Number.isFinite(z))) {
    return null;
  }
  return [x, z];
}

function adoptObjects(listed) {
  for (const row of listed) {
    const item = stringAt(row, 'item');
    const positions = (arrayAt(row, 'positions') ?? []).map(readPair).filter((at) => at !== null);
    if (item !== null && positions.length > 0) {
      index(clusterByItem, item, clusterOf(positions));
    }
  }
}

function adoptNpcs(listed) {
  for (const row of listed) {
    const point = readPoint(row);
    const id = stringAt(row, 'id');
    const name = stringAt(row, 'name');
    if (point !== null && id !== null && name !== null) {
      npcs.set(id, { id, name, x: point.x, z: point.z });
    }
  }
}

function adoptNodes(listed) {
  for (const row of listed) {
    const point = readPoint(row);
    const type = stringAt(row, 'type');
    const item = stringAt(row, 'item');
    if (point === null || type === null) {
      woc.warn(`${DATA_FILE}: a gathering node is not readable, leaving it out`, row);
    } else {
      index(nodesByType, type, point);
      if (item !== null) {
        index(nodesByItem, item, point);
      }
    }
  }
}

function adoptEscorts(listed) {
  for (const row of listed) {
    const point = readPoint(row);
    const id = stringAt(row, 'id');
    if (point !== null && id !== null) {
      escorts.set(id, point);
    }
  }
}

/** The quest-tagged loot join, precomputed, so nothing here ships a loot table. */
function adoptDrops(listed) {
  for (const row of listed) {
    const quest = stringAt(row, 'quest');
    const item = stringAt(row, 'item');
    const mobs = (arrayAt(row, 'mobs') ?? []).filter((mob) => typeof mob === 'string');
    if (quest !== null && item !== null && mobs.length > 0) {
      dropMobs.set(`${quest} ${item}`, mobs);
    }
  }
}

/** One zone rectangle. Half-open on both axes, which is the game's own test. */
function readZone(value) {
  const id = stringAt(value, 'id');
  const name = stringAt(value, 'name');
  const zMin = numberAt(value, 'zMin');
  const zMax = numberAt(value, 'zMax');
  if (id === null || name === null || zMin === null || zMax === null) {
    return null;
  }
  return {
    id,
    name,
    zMin,
    zMax,
    xMin: numberAt(value, 'xMin') ?? STRIP_MIN_X,
    xMax: numberAt(value, 'xMax') ?? STRIP_MAX_X,
  };
}

function adoptZones(listed) {
  zones = listed.map(readZone).filter((zone) => zone !== null);
}

/** A missing section is skipped with a warning: the rest of the table still answers. */
function adopt(file) {
  const sections = [
    ['zones', adoptZones],
    ['quests', adoptQuests],
    ['camps', adoptCamps],
    ['objects', adoptObjects],
    ['npcs', adoptNpcs],
    ['nodes', adoptNodes],
    ['escorts', adoptEscorts],
    ['drops', adoptDrops],
  ];
  for (const [name, take] of sections) {
    const listed = arrayAt(file, name);
    if (listed === null) {
      woc.warn(`${DATA_FILE} carries no "${name}" array, so that half cannot resolve`);
    } else {
      take(listed);
    }
  }
}

/**
 * The game's STRICT containment test rather than its clamping one: the clamping version
 * always answers, which names an overworld zone for a point on the instance plane.
 */
function zoneAt(x, z) {
  for (const zone of zones) {
    if (z >= zone.zMin && z < zone.zMax && x >= zone.xMin && x < zone.xMax) {
      return zone;
    }
  }
  return null;
}

function zoneName(x, z) {
  return zoneAt(x, z)?.name ?? null;
}

/** Where the player is standing, or null before world entry. */
function playerPos() {
  return woc.world.player?.pos ?? null;
}

function pushArea(found, seen, area) {
  const key = `${String(area.x)},${String(area.z)},${String(area.radius)}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  found.push(area);
}

function pushCamps(found, seen, mob) {
  for (const camp of campsByMob.get(mob) ?? []) {
    pushArea(found, seen, {
      x: camp.x,
      z: camp.z,
      radius: camp.radius + CAMP_AREA_PAD,
      kind: 'camp',
    });
  }
}

function pushCluster(found, seen, item) {
  for (const cluster of clusterByItem.get(item) ?? []) {
    pushArea(found, seen, { ...cluster, kind: 'object' });
  }
}

function pushNodes(found, seen, listed) {
  for (const node of listed) {
    pushArea(found, seen, { x: node.x, z: node.z, radius: POINT_AREA_RADIUS, kind: 'node' });
  }
}

/**
 * A collect objective: the mobs that drop it, any crate of it, and the nodes that yield it.
 *
 * BASE YIELD ONLY. The game also matches a material's `fine_` grade, which would need the
 * grade ladder in the table; a quest asking for one reads as nowhere rather than wrongly.
 */
function pushCollect(found, seen, questId, objective) {
  for (const mob of dropMobs.get(`${questId} ${String(objective.item)}`) ?? []) {
    pushCamps(found, seen, mob);
  }
  pushCluster(found, seen, objective.item);
  pushNodes(found, seen, nodesByItem.get(objective.item) ?? []);
}

/** An interact objective: the object cluster, the NPC's point, or both. */
function pushInteract(found, seen, objective) {
  if (objective.object !== null) {
    pushCluster(found, seen, objective.object);
  }
  const npc = npcs.get(objective.npc);
  if (npc !== undefined) {
    pushArea(found, seen, { x: npc.x, z: npc.z, radius: POINT_AREA_RADIUS, kind: 'npc' });
  }
}

/**
 * The nodes of the named type, or the nodes yielding the item. Credit for a gather flows
 * only through a harvest, so an item-only objective pins nodes and never a camp or crate.
 */
function pushGather(found, seen, objective) {
  if (objective.nodeType !== null) {
    pushNodes(found, seen, nodesByType.get(objective.nodeType) ?? []);
    return;
  }
  pushNodes(found, seen, nodesByItem.get(objective.item) ?? []);
}

/** Deduped. A `craft` objective resolves to nothing, as it does in the game. */
function areasFor(questId, objective) {
  const found = [];
  const seen = new Set();
  if (objective.type === 'kill' && objective.mob !== null) {
    pushCamps(found, seen, objective.mob);
  } else if (objective.type === 'collect' && objective.item !== null) {
    pushCollect(found, seen, questId, objective);
  } else if (objective.type === 'interact') {
    pushInteract(found, seen, objective);
  } else if (objective.type === 'gather') {
    pushGather(found, seen, objective);
  } else if (objective.type === 'escort') {
    const start = escorts.get(objective.escort);
    if (start !== undefined) {
      pushArea(found, seen, { ...start, radius: POINT_AREA_RADIUS, kind: 'escort' });
    }
  }
  return found;
}

/** The first turn-in NPC the table has a position for. An NPC the sim walks in has none,
 * which is a real answer rather than a reason to guess.
 */
function turnInArea(quest) {
  for (const id of quest.turnIn) {
    const npc = npcs.get(id);
    if (npc !== undefined) {
      return { x: npc.x, z: npc.z, radius: POINT_AREA_RADIUS, kind: 'npc', who: npc.name };
    }
  }
  return null;
}

/** The art for one objective, or null where the game paints none. */
function iconFor(objective) {
  if (objective.type === 'kill' && objective.mob !== null) {
    return woc.ui.icon.mob(objective.mob);
  }
  if (objective.type === 'interact' && objective.npc !== null) {
    return woc.ui.icon.mob(objective.npc);
  }
  const item = objective.item ?? objective.object;
  if (item === null) {
    return null;
  }
  return woc.ui.icon.item(item);
}

/** The column, and the line that stands in for it when there is nothing to draw. */
const list = document.createElement('div');
list.className = 'woc-tm-list';
list.style.display = 'flex';
list.style.flexDirection = 'column';
list.style.gap = '3px';

const note = document.createElement('div');
note.className = 'woc-tm-note';
note.style.opacity = '0.75';

/**
 * The panel. Resizable with a floor, and the two come together: the row count is computed
 * from the box `onMove` hands over, and anything past it is counted rather than clipped.
 */
const frame = woc.ui.frame({
  id: 'objectives',
  title: 'Trailmark',
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  minWidth: MIN_WIDTH,
  minHeight: MIN_HEIGHT,
  density: 'compact',
  resizable: true,
  closable: true,
  save: true,
  onMove: (moved) => {
    box.w = moved.w;
    box.h = moved.h;
    redraw();
  },
});
frame.body.appendChild(list);
// Under the rows rather than over them: it is a footnote about what the list is holding
// back, and a truncation count above the list reads as a heading.
frame.body.appendChild(note);

/** How many rows fit in the box the player has dragged. At least one, always. */
function rowBudget() {
  return Math.max(ONE_ROW, Math.floor((box.h - CHROME_PX) / ROW_PX));
}

/** The live quest log, or null before world entry. */
function questLog() {
  const log = woc.world.quests?.log ?? null;
  if (log instanceof Map) {
    return log;
  }
  return null;
}

function objectiveKey(questId, at) {
  return `${questId}#${String(at)}`;
}

/**
 * How many are needed, and whether that figure is exact. The learned denominator wins: it
 * is the server's own resolved figure. Without one the definition count is used, floored
 * at what is already banked: the override the game ships can only push a requirement up.
 */
function requirementOf(questId, at, objective, current) {
  const exact = learned.get(objectiveKey(questId, at));
  if (exact !== undefined) {
    return { required: exact, exact: true };
  }
  return { required: Math.max(objective.count, current), exact: false };
}

/** Empty with no bearing to be had, and the row's `.trimEnd()` takes the space with it. */
function arrowTo(area) {
  return woc.fmt.compass(woc.world.bearingTo(area));
}

/** The areas of one objective, nearest first. Untouched before world entry. */
function ordered(areas) {
  const at = playerPos();
  if (at === null) {
    return areas;
  }
  return [...areas].sort((a, b) => (woc.world.distanceTo(a) ?? 0) - (woc.world.distanceTo(b) ?? 0));
}

/**
 * One objective as this addon draws it. `areas` is already nearest-first, so the nearest
 * is the one the row measures to and the ones the pins are spent on.
 */
function viewOf(questId, quest, at, counts) {
  const objective = quest.objectives[at];
  const current = counts[at] ?? 0;
  const { required, exact } = requirementOf(questId, at, objective, current);
  const areas = ordered(areasFor(questId, objective));
  return {
    key: objectiveKey(questId, at),
    questId,
    questName: quest.name,
    label: objective.label,
    icon: iconFor(objective),
    current,
    required,
    exact,
    areas,
    nearest: areas[FIRST] ?? null,
  };
}

/**
 * One quest waiting to be handed in. A row of its own rather than an objective, because
 * there is nothing left to count: what the player needs is the name of whoever takes it
 * and where they stand. It carries no denominator, so the lower-bound marking every
 * objective row wears would be a claim about nothing.
 */
function readyView(questId, quest) {
  const area = turnInArea(quest);
  const areas = [];
  if (area !== null) {
    areas.push(area);
  }
  return {
    key: `${questId}!`,
    questId,
    questName: quest.name,
    label: handInLabel(area),
    icon: turnInIcon(quest),
    current: 0,
    required: 0,
    exact: true,
    ready: true,
    areas,
    nearest: areas[FIRST] ?? null,
  };
}

function handInLabel(area) {
  if (area === null) {
    return 'Ready, and its turn-in is not on the map';
  }
  return `Hand in to ${area.who}`;
}

function turnInIcon(quest) {
  for (const id of quest.turnIn) {
    if (npcs.has(id)) {
      return woc.ui.icon.mob(id);
    }
  }
  return null;
}

/** Whether an objective still wants work. An exact figure is what closes a row. */
function outstanding(view) {
  if (view.exact) {
    return view.current < view.required;
  }
  return true;
}

/** The quests the log calls active, in the log's own order, that the table knows. */
function activeIds(log) {
  return idsInState(log, 'active');
}

/** The quests waiting to be handed in, which is what the turn-in rows are for. */
function readyIds(log) {
  return idsInState(log, 'ready');
}

function idsInState(log, state) {
  const ids = [];
  for (const [questId, progress] of log) {
    if (progress?.state === state && quests.has(questId)) {
      ids.push(questId);
    }
  }
  return ids;
}

function focusRank(questId) {
  if (questId === focus) {
    return RANK_FOCUS;
  }
  return RANK_REST;
}

/** The same, focused first. A stable sort keeps the log's order behind it. */
function activeQuests(log) {
  return activeIds(log).sort((a, b) => focusRank(a) - focusRank(b));
}

/** Whether an objective's nearest area is in the zone the player is standing in. */
function inCurrentZone(view) {
  const at = playerPos();
  if (at === null || view.nearest === null) {
    return false;
  }
  return zoneAt(view.nearest.x, view.nearest.z)?.id === zoneAt(at.x, at.z)?.id;
}

function passesZone(view) {
  if (woc.settings['other-zones']) {
    return true;
  }
  return inCurrentZone(view);
}

/** One quest's banked counts, or an empty list for a row that carries none. */
function countsOf(progress) {
  const counts = progress?.counts;
  if (Array.isArray(counts)) {
    return counts;
  }
  return [];
}

/** Every row one tracked quest earns: its turn-in, or its outstanding objectives. */
function viewsFor(questId, progress) {
  const quest = quests.get(questId);
  if (progress?.state === 'ready') {
    return [readyView(questId, quest)];
  }
  const counts = countsOf(progress);
  const found = [];
  for (const at of quest.objectives.keys()) {
    const view = viewOf(questId, quest, at, counts);
    if (outstanding(view)) {
      found.push(view);
    }
  }
  return found;
}

/**
 * Rebuilt per draw, which is what lets the zone filter and the distances follow the player
 * with nothing watching a border. Ready quests come FIRST, ahead of the focus: a turn-in
 * buried under a quest still in progress is a turn-in that gets forgotten.
 */
function wanted() {
  const log = questLog();
  if (log === null) {
    return [];
  }
  const found = [];
  const cap = woc.settings['max-quests'];
  const tracked = [...readyIds(log), ...activeQuests(log)].slice(FIRST, cap);
  for (const questId of tracked) {
    for (const view of viewsFor(questId, log.get(questId))) {
      if (passesZone(view)) {
        found.push(view);
      }
    }
  }
  return found;
}

/** `Ready` for a turn-in, `3/8` for a counted objective, `3/5+` for a bound. */
function figureOf(view) {
  if (view.ready === true) {
    return 'Ready';
  }
  if (view.exact) {
    return `${String(view.current)}/${String(view.required)}`;
  }
  return `${String(view.current)}/${String(view.required)}+`;
}

function fillOf(view) {
  if (view.ready === true) {
    return FULL;
  }
  if (view.required <= 0) {
    return EMPTY;
  }
  return Math.min(view.current / view.required, FULL);
}

/** The arrow is TRIMMED rather than left as a trailing space: it is empty exactly when
 * there is no player to measure a bearing from.
 */
function detailOf(view) {
  if (view.nearest === null) {
    return 'Nowhere on the map';
  }
  const where = zoneName(view.nearest.x, view.nearest.z) ?? 'Not in the open world';
  const away = woc.world.distanceTo(view.nearest);
  if (away === null) {
    return where;
  }
  return `${where}, ${String(Math.round(away))} yd ${arrowTo(view.nearest)}`.trimEnd();
}

/** Why the denominator reads the way it does. The most useful line on the row. */
function countLine(view) {
  if (view.ready === true) {
    return { text: 'Nothing left to count: the log says it is ready', tone: 'good' };
  }
  if (view.exact) {
    return { text: 'Counted by the server, off the progress event', tone: 'muted' };
  }
  return {
    text: 'At least this many: the shipped definition, until it ticks once',
    tone: 'warn',
  };
}

/** A camp and a lone NPC are both one circle here and are not the same thing to ride to,
 * so the width says which. The distance beside it is measured to the centre.
 */
function areaLine(view) {
  if (view.nearest === null) {
    return null;
  }
  return {
    text: `The area reaches ${String(Math.round(view.nearest.radius))} yd from that point`,
    tone: 'muted',
  };
}

/** The caveat an authored NPC point earns, and nothing else does. */
function placementLine(view) {
  if (view.nearest?.kind !== 'npc') {
    return null;
  }
  return { text: 'Authored position; the live NPC can stand a yard or two off', tone: 'muted' };
}

/** How many places this objective could be carried out, or that there are none. */
function spreadLine(view) {
  if (view.areas.length === 0) {
    return { text: 'Nothing in the tables says where this happens', tone: 'warn' };
  }
  return { text: `${String(view.areas.length)} area(s), nearest first`, tone: 'muted' };
}

function rowTooltip(view) {
  const lines = [view.label, countLine(view), spreadLine(view)];
  for (const line of [areaLine(view), placementLine(view)]) {
    if (line !== null) {
      lines.push(line);
    }
  }
  return { title: view.questName, icon: view.icon, lines };
}

/**
 * One row, holding the view it was last drawn from.
 *
 * The tooltip reads the HELD view: a row outlives every view of it, so one closed over the
 * view it was built with reports the progress this objective had when it arrived.
 */
function createRow(view) {
  const bar = woc.ui.bar({ className: 'woc-tm-row' });
  bar.el.dataset.objective = view.key;
  const held = {
    bar,
    view,
    destroy: () => {
      bar.destroy();
    },
  };
  woc.ui.tooltip(bar.el, () => rowTooltip(held.view));
  return held;
}

/** Warm while the denominator is only a lower bound, so the plus is not decoration. */
function toneOf(view) {
  if (view.exact) {
    return 'default';
  }
  return 'warn';
}

function paintRow(bar, view) {
  bar.update({
    label: `${view.questName}: ${view.label}`,
    icon: view.icon,
    fraction: fillOf(view),
    value: figureOf(view),
    detail: detailOf(view),
    tone: toneOf(view),
  });
}

/** Keyed on the objective, so the focused quest jumping to the top moves rows. */
const rows = woc.ui.list({
  parent: list,
  key: (view) => view.key,
  create: createRow,
  update: (held, view) => {
    held.view = view;
    paintRow(held.bar, view);
  },
  element: (held) => held.bar.el,
});

/** A function rather than a point: the height moves with the player. Null hides the anchor. */
function pinPoint(area) {
  return () => {
    const at = playerPos();
    if (at === null) {
      return null;
    }
    return { x: area.x, y: at.y, z: area.z };
  };
}

function createPin(entry) {
  const tile = woc.ui.tile({
    label: `${entry.questName}: ${entry.label}`,
    icon: entry.icon,
    className: 'woc-tm-pin',
    size: PIN_SIZE,
  });
  tile.el.dataset.objective = entry.key;
  const anchor = woc.ui.anchor3d(pinPoint(entry.area), {
    className: 'woc-tm-anchor',
    offset: { y: -PIN_LIFT },
  });
  anchor.el.appendChild(tile.el);
  return {
    tile,
    anchor,
    area: entry.area,
    destroy: () => {
      tile.destroy();
      anchor.destroy();
    },
  };
}

/** No `parent`: each pin carries its own `ui.anchor3d`, which already places it. */
const pins = woc.ui.list({
  key: (entry) => entry.key,
  create: createPin,
});

/** Nearest of EACH objective first, so one with thirty nodes cannot spend the whole
 * budget and leave another objective unpinned.
 */
function pinnable(shown) {
  const reach = woc.settings['pin-distance'];
  const first = [];
  const rest = [];
  for (const view of shown) {
    for (const [at, area] of view.areas.entries()) {
      const away = woc.world.distanceTo(area);
      if (away !== null && away <= reach) {
        const entry = { key: `${view.key}@${String(at)}`, area, ...pinLabel(view) };
        if (at === FIRST) {
          first.push(entry);
        } else {
          rest.push(entry);
        }
      }
    }
  }
  const all = [...first, ...rest];
  return { entries: all.slice(FIRST, PIN_BUDGET), reachable: all.length };
}

function pinLabel(view) {
  return { questName: view.questName, label: view.label, icon: view.icon };
}

function syncPins(shown) {
  const { entries, reachable } = pinnable(shown);
  pins.sync(entries);
  return { drawn: entries.length, reachable };
}

/**
 * `ui.project` answering null means do not draw, which covers more than being off screen:
 * behind the camera and inside the near plane both report finite coordinates. Without the
 * null branch a hidden pin keeps whatever opacity it last had.
 */
function paintPin(pin) {
  const at = woc.ui.project({ x: pin.area.x, y: playerPos()?.y ?? 0, z: pin.area.z });
  if (at === null) {
    pin.tile.el.style.visibility = 'hidden';
    return;
  }
  pin.tile.el.style.visibility = 'visible';
  if (at.depth > FADE_YARDS) {
    pin.tile.el.style.opacity = String(FAR_OPACITY);
    return;
  }
  pin.tile.el.style.opacity = String(NEAR_OPACITY);
}

/** Why the list is empty, in words. An empty grid reads as a measurement of zero. */
function emptyReason() {
  if (quests.size === 0) {
    return 'Reading the quest tables.';
  }
  if (questLog() === null) {
    return 'No quest log yet: not in the world.';
  }
  if (activeIds(questLog()).length + readyIds(questLog()).length === 0) {
    return 'No quests in your log.';
  }
  if (!woc.settings['other-zones']) {
    return 'Nothing outstanding in this zone. Other zones are switched off in settings.';
  }
  return 'Every objective in your log is done. Go and hand them in.';
}

/**
 * The truncations, or why the panel is bare. Both limits go on SCREEN: a list stopping at
 * the box and a world stopping at twelve pins are the two ways this could look complete
 * while leaving something out. The pin figure counts what is in range, not every area.
 */
function paintNote(shown, drawn, pinned) {
  if (shown.length === 0) {
    note.textContent = emptyReason();
    return;
  }
  const parts = [];
  if (drawn < shown.length) {
    parts.push(`${String(shown.length - drawn)} more below the panel`);
  }
  if (pinned.drawn < pinned.reachable) {
    parts.push(`${String(pinned.drawn)} of ${String(pinned.reachable)} areas in range pinned`);
  }
  note.textContent = parts.join(', ');
}

function clearDrawn() {
  rows.clear();
  pins.clear();
}

/** The pins are anchors over the world rather than children of the frame, so hiding the
 * frame does not take them down and nothing else would.
 */
function redraw() {
  if (!frame.visible) {
    clearDrawn();
    note.textContent = '';
    return;
  }
  const shown = wanted();
  const drawn = shown.slice(FIRST, rowBudget());
  rows.sync(drawn);
  paintNote(shown, drawn.length, syncPins(drawn));
}

/** Arrives as `unknown`. A `required` that is not positive and finite is DROPPED: a
 * learned figure is written to disk and outlives the session.
 */
function readProgress(event) {
  const questId = stringAt(event, 'questId');
  const at = numberAt(event, 'objectiveIndex');
  const required = numberAt(event, 'required');
  if (questId === null || at === null || required === null) {
    return null;
  }
  if (!Number.isInteger(at) || at < FIRST || required <= 0) {
    return null;
  }
  return { questId, at, required };
}

woc.net.onEvent('questProgress', (event) => {
  const record = readProgress(event);
  if (record === null) {
    return;
  }
  const key = objectiveKey(record.questId, record.at);
  if (learned.get(key) === record.required) {
    return;
  }
  learned.set(key, record.required);
  persist();
  redraw();
});

/** Say where to hand it in, once, at the moment it becomes possible. */
function announceReady(questId) {
  const quest = quests.get(questId);
  if (quest === undefined) {
    return;
  }
  const where = turnInLine(quest);
  woc.ui.toast(`${quest.name} is ready. ${where}`);
}

/** The first PLACED turn-in NPC. One the sim spawns on demand has no point at all, and
 * the line says so rather than papering over it.
 */
function turnInLine(quest) {
  for (const id of quest.turnIn) {
    const npc = npcs.get(id);
    if (npc !== undefined) {
      return `Turn in to ${npc.name}, ${zoneName(npc.x, npc.z) ?? 'not in the open world'}.`;
    }
  }
  return 'Its turn-in is not on the map.';
}

woc.net.onEvent('questReady', (event) => {
  const questId = stringAt(event, 'questId');
  if (questId !== null) {
    announceReady(questId);
  }
});

woc.net.onEvent('questDone', (event) => {
  const questId = stringAt(event, 'questId');
  if (questId !== null && focus === questId) {
    focus = null;
    persist();
  }
});

/** Rotates over the LOG's order rather than the drawn list, so a quest filtered out by
 * the zone setting is still reachable.
 */
function cycleFocus() {
  const log = questLog();
  if (log === null) {
    return;
  }
  const ids = activeIds(log);
  if (ids.length === 0) {
    return;
  }
  const at = ids.indexOf(focus);
  focus = ids[(at + STEP) % ids.length];
  persist();
  redraw();
}

/**
 * Keyed on the id being new to this SESSION rather than on an accept event, which also
 * stops a quest sitting in the log from stealing the focus back on every redraw. The first
 * walk records without focusing, since it is world entry.
 */
function noticeArrivals(log) {
  const auto = woc.settings['auto-track'] && !firstWalk;
  for (const [questId, progress] of log) {
    if (!seenQuests.has(questId)) {
      seenQuests.add(questId);
      if (auto && progress?.state === 'active' && quests.has(questId)) {
        focus = questId;
      }
    }
  }
  firstWalk = false;
}

woc.world.on('quests', () => {
  const log = questLog();
  if (log !== null) {
    noticeArrivals(log);
  }
  redraw();
});

/**
 * A per-character write REJECTS before world entry, so the await is a guard rather than a
 * delay. The stamp is `woc.wallClock()`: `woc.now()` restarts on every page load.
 */
async function save() {
  await woc.world.ready;
  await woc.storage.character.set(STORE_KEY, {
    at: woc.wallClock(),
    focus,
    required: Object.fromEntries(learned),
  });
}

function persist() {
  save().catch((err) => {
    woc.warn('could not write the learned objective counts down', err);
  });
}

/** Fills gaps only: a progress event can land before the read settles, and what this
 * session heard from the server is newer than anything on disk.
 */
function reclaim(stored) {
  const { required } = stored;
  if (typeof required !== 'object' || required === null) {
    return;
  }
  for (const [key, value] of Object.entries(required)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && !learned.has(key)) {
      learned.set(key, value);
    }
  }
}

async function restore() {
  const stored = await woc.storage.character.get(STORE_KEY, null);
  if (typeof stored !== 'object' || stored === null) {
    return;
  }
  reclaim(stored);
  const { focus: held } = stored;
  if (typeof held === 'string' && focus === null) {
    focus = held;
  }
  redraw();
}

function load() {
  restore().catch((err) => {
    woc.warn('could not read the learned objective counts back', err);
  });
}

/** The game clones its HUD on a switch rather than reloading. The override behind a
 * learned denominator is per player, so keeping one shows it under another's name.
 */
woc.world.on('characterKey', () => {
  learned.clear();
  seenQuests.clear();
  firstWalk = true;
  focus = null;
  load();
  redraw();
});

// Once a second. Every figure on this panel moves at most that often, and the pins
// position themselves, since `ui.anchor3d` rides the loader's own frame loop.
woc.setInterval(redraw, MS_PER_SECOND);

// A pin's fade comes off the camera, which turns between the ticks above. `values()` is
// creation order, which is fine here: each pin is painted from its own point.
woc.onFrame(() => {
  for (const pin of pins.values()) {
    paintPin(pin);
  }
});

// Bound by hand rather than with the frame's own `toggleKey`, DECLINED because this key
// does two things: `toggleKey` only toggles, and the pins are anchors over the world that
// nothing else takes down. No visibility callback on `FrameOpts` to hang the redraw on.
woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now, rather than up to a second from now: somebody who just hid the panel should not
  // watch its pins hang over the world waiting for the next tick.
  redraw();
});

woc.keys.bind('cycle', cycleFocus);

woc.onSettingsChange(redraw);

/**
 * Every handler above is wired BEFORE this await: subscribing after one would miss whatever
 * landed during it. `load()` rather than `await restore()`, since a per-character read
 * waits for the character and would hold the first draw on the landing page.
 */
async function boot() {
  const file = await woc.data(DATA_FILE);
  adopt(file);
  if (quests.size === 0) {
    throw new Error(`${DATA_FILE} carries no readable quests`);
  }
  load();
  const log = questLog();
  if (log !== null) {
    noticeArrivals(log);
  }
  redraw();
}

boot().catch((err) => {
  woc.error('could not read the quest tables, so nothing can be pointed at', err);
});
