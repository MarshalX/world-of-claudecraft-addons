/// <reference types="@woc-addons/types" />

// Trailmark: where the thing your quest wants actually is.
//
// The quest log tells you WHAT is outstanding and never WHERE. `world.quests.log`
// is a quest id, a count per objective and a state; nothing on it names a mob, an
// item, a place or a zone, and nothing on the wire ever will, because the answer
// is a pure function of content tables that ship inside the client bundle. So this
// addon carries those tables (`quests.json`, declared as `data` in the manifest)
// and runs the game's OWN derivation over them.
//
// THE DERIVATION IS COPIED, NOT INVENTED. `src/sim/quest_targets.ts` at game
// 0.33.1 is a pure leaf with no DOM, no rng and no Sim state, and
// `questObjectiveAreas` is the whole of it: a KILL objective resolves to every
// camp with that mob id, a COLLECT objective to the camps of mobs whose loot is
// tagged with that quest id plus any ground-object cluster for the item, an
// INTERACT objective to the object cluster or the NPC's point, a GATHER objective
// to the matching nodes, and an ESCORT objective to where the escortee stands
// idle. The padding figures are the game's too: 4 yards around a camp's spawn
// radius and a 6 yard circle around a lone point. `areasFor` below is that
// function with the tables handed to it instead of imported.
//
// So an objective in a zone the player has NEVER ENTERED still points the right
// way. Nothing here reads `world.entities`, which is interest-radius limited: a
// camp on the far side of the world resolves exactly as well as the one underfoot.
//
// THE REQUIRED COUNT IS THE ONE FIGURE THIS ADDON CANNOT SIMPLY READ, and the
// mitigation is the most important thing in the file. The game resolves an
// objective's requirement as `progress.resolvedCounts?.[i] ?? quest.objectives[i].count`
// (`src/sim/types.ts:2983`, the field at `:2975`). It is a per-player override stamped at
// accept, it rides the wire whole, and `world.quests.log` is a passthrough of the
// game's own Map, so it is READABLE at run time and is simply not on the published
// `QuestProgress`, which stops at `questId`, `counts`, `state` and `selection`.
// Reading a field the type does not declare is reading past the contract, so this
// addon does not: it learns the true denominator from the `questProgress` EVENT,
// which carries `required` directly, holds it PER CHARACTER because the override
// is per player, and falls back to the shipped definition count for an objective
// it has not seen tick yet.
//
// THAT FALLBACK IS A LOWER BOUND AND IT SAYS SO ON SCREEN. The only override the
// game ships is `archetypeAmends`, which resolves to `5 + 3 * switchCount`
// (`src/sim/professions/archetype.ts:266`) against a definition count of 5, so the
// definition can only ever be too SMALL, never too large. A learned figure is drawn
// as `3/8`; an unlearned one as `3/5+`, with the plus meaning "at least". It is
// also floored at the count already banked, so a row restored at 6 of a definition
// 5 reads `6/6+` rather than claiming to be over. Every reading improves the first
// time that objective ticks, and never gets worse.
//
// THE ARROW ON A ROW IS MEASURED AGAINST YOUR CHARACTER, never the camera. `facing`
// is radians with 0 at +z and grows as you turn LEFT, so the arrow says which way to
// turn rather than where to look, and it is empty rather than guessed for a player
// whose facing cannot be read. It moves with the rest of the list, once a second: it
// is a direction to set off in, not a needle to steer by.
//
// AN AUTHORED PIN HAS NO HEIGHT, and there is no way to ask for one. Every point
// in the table is an x and a z: camps, ground objects, NPCs, gathering nodes and
// escort starts are all authored in two dimensions because terrain height is a
// module function the renderer imports and no heightmap is served. So a pin is
// hung at the PLAYER's own height, which is the one height known to be standing on
// the floor. Over sloping ground that is approximate by construction. The usual
// better mitigation, sampling a nearby entity, is not available here: the whole
// point of these pins is that they are pointing at somewhere nobody is standing.
//
// AN NPC'S POSITION IS THE AUTHORED ONE AND THE LIVE ONE CAN DIFFER. The sim runs
// `findSafePos` over every static NPC at world init and nudges it out of buildings
// and deep water (`src/sim/sim.ts:1948-1952`), so the entity can end up a yard or
// two from the table. That is fine for a map marker and wrong for anything needing
// exactness, so the row's tooltip says the position is authored rather than
// measured, and no display here ever quotes an NPC's coordinates as a fact.
//
// THREE EVENT KINDS ARE UNDESCRIBED. `questProgress`, `questReady` and `questDone`
// are not in the published event catalogue, so `net.onEvent` hands this addon
// `unknown` for all three and every field is checked here rather than trusted.
// `readProgress` is the one that matters: a `required` that is not a positive
// finite number is dropped rather than learned, because a bad denominator would
// be written to disk and outlive the session that produced it.
//
// WHAT IT REFUSES TO GUESS. An objective the derivation resolves to nowhere gets a
// row saying so rather than a pin somewhere plausible: a collect objective whose
// item is a gathering material or a fishing catch has no tagged drop and no ground
// object, and a kill objective on a dungeon boss has no camp, and in both cases the
// game's own map draws nothing either. A quest whose turn-in NPC is spawned on
// demand rather than placed has no point in the table at all, and the ready line
// says the turn-in is not on the map instead of pointing somewhere plausible. At
// 0.33.1 no shipped quest actually reaches that branch: the one quest naming a
// spawned-on-demand turn-in, Scourge's End, names a placed Brother Aldric beside
// the raid one, so the placed answer wins. The branch is kept because the table is
// game content and the next release owes this addon nothing.

const DATA_FILE = 'quests.json';
/** The one per-character key: the learned denominators and the focused quest. */
const STORE_KEY = 'trail';

const FRAME_WIDTH = 300;
const FRAME_HEIGHT = 232;
/**
 * The game's own two padding figures, from `src/sim/quest_targets.ts`.
 *
 * `CAMP_AREA_PAD` widens a camp's spawn radius so the circle covers mobs that
 * wandered off their ring; `POINT_AREA_RADIUS` is what a lone point is drawn as.
 * Copied rather than chosen, so a pin sits where the game's own map area sits.
 */
const CAMP_AREA_PAD = 4;
const POINT_AREA_RADIUS = 6;

/**
 * How tall one row is and how much of the frame is not rows, in pixels.
 *
 * Fixed figures rather than measurements: measuring a drawn row means reading a
 * layout property, which forces the browser to lay out on the spot, and the row
 * budget is recomputed on every drag frame while the player resizes the panel.
 *
 * They are CALIBRATED against a drawn panel rather than guessed, which the first
 * pair were not: a bar at this density measures 30px with a 3px gap under it, and
 * the chrome is the title bar and the body's own padding. Guessing 46 cost a third
 * of a tall panel, since the budget under-reported by a row for every 100px of
 * height. The chrome figure also reserves the note line, because the note is drawn
 * exactly when the budget bites and a row pushed under the fold by it would be the
 * one thing this whole reflow exists to avoid.
 */
const ROW_PX = 33;
const CHROME_PX = 78;
/** The floor is ONE row, never the current count: bounds cannot be restated later. */
const MIN_HEIGHT = CHROME_PX + ROW_PX;
const MIN_WIDTH = 200;

/** A pin's side, and how far it floats above its point, in screen pixels. */
const PIN_SIZE = 36;
const PIN_LIFT = 22;
/**
 * How many pins may be in the world at once.
 *
 * A gather objective on ore resolves to every ore node in the game, which is the
 * game's own answer and is thirty-odd points. Pinning all of them would put a
 * wall of tiles over the screen, so the nearest few are drawn and the list says
 * how many were left out.
 */
const PIN_BUDGET = 12;
/** Beyond this many yards a pin is faded, so a near one reads as the near one. */
const FADE_YARDS = 120;
const FAR_OPACITY = 0.45;
const NEAR_OPACITY = 1;

const MS_PER_SECOND = 1000;

/**
 * Eight sectors around the character, starting straight ahead and turning LEFT.
 *
 * Left because that is the direction `facing` increases in. Getting it backwards is a
 * display nobody can catch until they have followed it for a while, which is why the
 * direction is stated here rather than left to be read off the arithmetic.
 */
const ARROWS = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
const SECTOR_RADIANS = (Math.PI * 2) / ARROWS.length;

/** The world strip's default east-west extent, for a zone that declares none. */
const STRIP_MIN_X = -180;
const STRIP_MAX_X = 180;

/** A bar's fill, at the two ends. Named because a bare literal is a magic number. */
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

const DEFAULT_MAX_QUESTS = 5;
const DEFAULT_PIN_DISTANCE = 400;

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

/**
 * The true denominators, learned from the `questProgress` event.
 *
 * Keyed `<questId>#<objectiveIndex>`. Per character, because the override the
 * game applies is per player: an alt who has switched archetype twice needs a
 * different figure for the same quest than the main who never has.
 */
const learned = new Map();

/** The quest whose objectives lead the list, or null for "whatever is first". */
let focus = null;

/** Quest ids already seen in the log, so auto-track fires on arrival and not again. */
const seenQuests = new Set();

/** Whether the log has been walked once. See `noticeArrivals`. */
let firstWalk = true;

/** One kit row per objective on screen, and one pin per area drawn. */
const rows = new Map();
const pins = new Map();

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

/**
 * One objective, as the shipped table carries it.
 *
 * `woc.data` hands back `unknown` for the reason `storage.get` does: the loader
 * checks the file parses as JSON at install and nothing else, so every shape here
 * is a claim this addon checks. An objective with no positive count is dropped:
 * a denominator of zero divides the fill by nothing and reads as complete.
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

/** Push onto a keyed list, which is the shape every lookup in `areasFor` wants. */
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
 * One enclosing circle per ground-object definition, computed once.
 *
 * The game's own bound: the centroid of the spawn positions plus the distance to
 * the farthest of them, floored at the lone-point radius. Precomputed at adopt
 * rather than per frame, since neither the positions nor the answer can change.
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

/**
 * The quest-tagged loot join, precomputed.
 *
 * `mobsDroppingQuestItem` walks every mob template looking for a loot entry whose
 * item AND quest id both match, because the same item can be tagged for one quest
 * and drop untagged for another. The file carries that join already made, keyed
 * on the same pair, so nothing here has to ship a loot table.
 */
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

/**
 * Take the whole table on.
 *
 * A section that is missing or is not an array is skipped with a warning rather
 * than treated as a reason to throw the file away: a quest list with no gathering
 * nodes still answers every kill and collect objective, and a named gap beats a
 * blank panel.
 */
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
 * The zone a point is in, or null for a point in none of them.
 *
 * The game's own strict containment test rather than its clamping one. The
 * clamping version always answers with a zone, which would name an overworld zone
 * for a point on the instance plane the dungeons, arenas and delves sit on; this
 * one reports "nowhere" honestly, and the display says so in words.
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

/** A collect objective: the camps of tagged droppers, plus any object cluster. */
function pushCollect(found, seen, questId, objective) {
  for (const mob of dropMobs.get(`${questId} ${String(objective.item)}`) ?? []) {
    pushCamps(found, seen, mob);
  }
  pushCluster(found, seen, objective.item);
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
 * A gather objective: the nodes of the named type, or the nodes yielding the item.
 *
 * The two arms are the game's own and are symmetric on purpose. Credit for a
 * gather objective flows only through a harvest, so an item-only objective pins
 * the nodes whose material resolves to that item and never a mob camp or a ground
 * object, which could never grant it.
 */
function pushGather(found, seen, objective) {
  if (objective.nodeType !== null) {
    pushNodes(found, seen, nodesByType.get(objective.nodeType) ?? []);
    return;
  }
  pushNodes(found, seen, nodesByItem.get(objective.item) ?? []);
}

/**
 * Every circle one objective is carried out in, deduped.
 *
 * `questObjectiveAreas` from `src/sim/quest_targets.ts`, with the tables passed in
 * rather than imported. A `craft` objective deliberately resolves to nothing: the
 * game gives it no area either, because a recipe is worked at a bench rather than
 * at a place the quest names.
 */
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

/**
 * Where a quest is handed in, or null when nothing placed can take it.
 *
 * The first turn-in NPC the table has a position for. A quest may name several,
 * and one the sim walks in mid-encounter rather than placing carries no position
 * at all, which is a real answer rather than a reason to guess at a chapel.
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
 * The panel.
 *
 * Compact rather than comfortable: this is a readout glanced at while riding, and
 * the tap-target floor would make the title bar the loudest thing on it. Not bare,
 * because it is a list with a heading rather than an overlay that IS its content,
 * and because an empty one has to be findable to say WHY it is empty.
 *
 * RESIZABLE, WITH A FLOOR, AND THE TWO COME TOGETHER. The content genuinely
 * reflows: the number of rows drawn is computed from the box `onMove` hands over,
 * and anything past it is reported as a count rather than clipped. The floor is
 * ONE row, never the current count, because bounds cannot be restated after the
 * frame is built and a floor set while six rows showed would trap the player who
 * later has one.
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
// Under the rows rather than over them: it is a footnote about what the list is
// holding back, and a truncation count above the list reads as a heading.
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
 * How many of this objective are needed, and whether that figure is exact.
 *
 * The learned denominator wins, because it is the server's own resolved figure for
 * THIS character. Without one the shipped definition count is used, floored at
 * whatever has already been banked: the only override the game ships can only push
 * the requirement up, so the definition is a lower bound, and a count already past
 * it is a better one.
 */
function requirementOf(questId, at, objective, current) {
  const exact = learned.get(objectiveKey(questId, at));
  if (exact !== undefined) {
    return { required: exact, exact: true };
  }
  return { required: Math.max(objective.count, current), exact: false };
}

/**
 * Which way to turn to reach an area, as one of eight arrows.
 *
 * A fact about your CHARACTER rather than about the camera: `facing` is radians with
 * 0 at +z and grows as you turn left, so a positive difference puts the area on your
 * left and the sectors run that way. Where the camera is pointed is a different
 * question and nothing here claims to answer it.
 *
 * Nothing at all before world entry, and nothing for a facing that is not a finite
 * number. A default of straight ahead would be an arrow that is confidently wrong,
 * and an arrow is the one thing on this panel somebody acts on without reading.
 */
function bearingTo(area) {
  const at = playerPos();
  const facing = woc.world.player?.facing;
  if (at === null || typeof facing !== 'number' || !Number.isFinite(facing)) {
    return '';
  }
  const toward = Math.atan2(area.x - at.x, area.z - at.z);
  const sector = Math.round((toward - facing) / SECTOR_RADIANS);
  return ARROWS[((sector % ARROWS.length) + ARROWS.length) % ARROWS.length];
}

/** Yards from the player to an area's centre, or null before world entry. */
function distanceTo(area) {
  const at = playerPos();
  if (at === null) {
    return null;
  }
  return Math.hypot(at.x - area.x, at.z - area.z);
}

/** The areas of one objective, nearest first. Untouched before world entry. */
function ordered(areas) {
  const at = playerPos();
  if (at === null) {
    return areas;
  }
  return [...areas].sort((a, b) => (distanceTo(a) ?? 0) - (distanceTo(b) ?? 0));
}

/**
 * One objective as this addon draws it.
 *
 * `areas` is already nearest-first, so the nearest is the one the row measures to
 * and the ones the pins are spent on.
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
 * One quest waiting to be handed in.
 *
 * A row of its own rather than an objective, because there is nothing left to
 * count: what the player needs is the name of whoever takes it and where they
 * stand. It carries no denominator at all, so the lower-bound marking that every
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
  if (settingFlag('other-zones', true)) {
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
 * Every row worth drawing, in the order they are drawn.
 *
 * Rebuilt on every draw rather than cached, which is affordable because the log is
 * a handful of quests and the tables are indexed: what it buys is the zone filter
 * and the distances following the player with nothing having to watch a border.
 *
 * READY QUESTS COME FIRST, ahead of the focus. A quest with nothing left to do is
 * a reward waiting to be collected, and burying it under the objectives of a quest
 * the player is still working is how a turn-in gets forgotten for an hour.
 */
function wanted() {
  const log = questLog();
  if (log === null) {
    return [];
  }
  const found = [];
  const cap = settingNumber('max-quests', DEFAULT_MAX_QUESTS);
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

/**
 * Where the nearest area is, how far off, and which way to turn for it.
 *
 * Says so when there is nowhere. The arrow is trimmed off rather than left as a
 * trailing space, since it is empty on exactly the readings that have no player to
 * measure a bearing from.
 */
function detailOf(view) {
  if (view.nearest === null) {
    return 'Nowhere on the map';
  }
  const where = zoneName(view.nearest.x, view.nearest.z) ?? 'Not in the open world';
  const away = distanceTo(view.nearest);
  if (away === null) {
    return where;
  }
  return `${where}, ${String(Math.round(away))} yd ${bearingTo(view.nearest)}`.trimEnd();
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

/**
 * How wide the nearest area is.
 *
 * A camp and a single NPC are both one circle on this display and they are not the
 * same thing to ride to: the game pads a camp's own spawn radius by four yards and
 * draws a lone point as six, so the figure says whether the objective is a wide
 * area to sweep or a spot to stand on. The distance beside it is measured to the
 * CENTRE, which is what this line makes readable rather than ambiguous.
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

function createRow(view) {
  const bar = woc.ui.bar({ className: 'woc-tm-row' });
  bar.el.dataset.objective = view.key;
  woc.ui.tooltip(bar.el, () => rowTooltip(rows.get(view.key)?.view ?? view));
  return bar;
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

/** Put a row at its position, and only when it is not already there. */
function place(el, at) {
  if (list.children[at] !== el) {
    list.insertBefore(el, list.children[at] ?? null);
  }
}

function dropRow(key, held) {
  held.bar.destroy();
  rows.delete(key);
}

function syncRows(shown) {
  const live = new Set(shown.map((view) => view.key));
  for (const [key, held] of rows) {
    if (!live.has(key)) {
      dropRow(key, held);
    }
  }
  for (const [at, view] of shown.entries()) {
    let held = rows.get(view.key);
    if (held === undefined) {
      held = { bar: createRow(view), view };
      rows.set(view.key, held);
    }
    held.view = view;
    paintRow(held.bar, view);
    place(held.bar.el, at);
  }
}

/**
 * A pin's point, which is the authored x and z at the PLAYER's own height.
 *
 * A function rather than a fixed point, because the height is the only part that
 * moves and it moves with the player. Null before world entry hides the anchor,
 * which is the honest answer while there is no world to hang it in.
 */
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
  return { tile, anchor, area: entry.area };
}

function dropPin(key, pin) {
  pin.tile.destroy();
  pin.anchor.destroy();
  pins.delete(key);
}

function clearPins() {
  for (const [key, pin] of pins) {
    dropPin(key, pin);
  }
}

/**
 * The areas worth a pin: the nearest one of each objective first, then the rest.
 *
 * Nearest-of-each first rather than nearest-overall, so an objective with thirty
 * gathering nodes cannot spend the whole budget and leave another objective with
 * no pin at all.
 */
function pinnable(shown) {
  const reach = settingNumber('pin-distance', DEFAULT_PIN_DISTANCE);
  const first = [];
  const rest = [];
  for (const view of shown) {
    for (const [at, area] of view.areas.entries()) {
      const away = distanceTo(area);
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
  const live = new Set(entries.map((entry) => entry.key));
  for (const [key, pin] of pins) {
    if (!live.has(key)) {
      dropPin(key, pin);
    }
  }
  for (const entry of entries) {
    if (!pins.has(entry.key)) {
      pins.set(entry.key, createPin(entry));
    }
  }
  return { drawn: entries.length, reachable };
}

/**
 * Fade a pin by how far away it is, and hide it where it must not be drawn.
 *
 * `ui.project` answering null means DO NOT DRAW, and that covers more than being
 * off screen: it is null behind the camera and null for a point CLOSER than the
 * near plane, where the raw projection still reports finite coordinates that are
 * off by any amount. The anchor hides itself for the same reasons, so this is the
 * fade rather than a second guard, and the null branch is what stops a pin being
 * left at whatever opacity it last had while its point cannot be trusted.
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
  if (!settingFlag('other-zones', true)) {
    return 'Nothing outstanding in this zone. Other zones are switched off in settings.';
  }
  return 'Every objective in your log is done. Go and hand them in.';
}

/**
 * What the panel says under the rows: the truncations, or why it is bare.
 *
 * Both limits go on screen rather than in a comment. A list that quietly stops at
 * the bottom of the box and a world that quietly stops at twelve pins are the two
 * ways this display could look complete while leaving something out.
 *
 * The pin figure counts what is IN RANGE rather than every area, because an area
 * the player put out of reach with the distance setting is not something the panel
 * declined to draw.
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
  for (const [key, held] of rows) {
    dropRow(key, held);
  }
  clearPins();
}

/**
 * Draw the panel, or take everything out of the world when it is not up.
 *
 * The pins are anchors the loader holds over the world rather than children of the
 * frame, so hiding the frame does not hide them and nothing else would.
 */
function redraw() {
  if (!frame.visible) {
    clearDrawn();
    note.textContent = '';
    return;
  }
  const shown = wanted();
  const drawn = shown.slice(FIRST, rowBudget());
  syncRows(drawn);
  paintNote(shown, drawn.length, syncPins(drawn));
}

/**
 * One `questProgress` record, checked field by field.
 *
 * Undescribed by the published event catalogue, so `net.onEvent` hands this over as
 * `unknown` and a narrowing written from a guess would be wrong silently. A
 * `required` that is not a positive finite number is dropped rather than learned,
 * because a learned figure is written to disk and outlives the session.
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

/**
 * Where a ready quest is handed in.
 *
 * A quest can name several turn-in NPCs and the first placed one is what is
 * offered. An NPC the sim spawns on demand rather than placing has no point in the
 * table at all, and that is said rather than papered over: pointing at the wrong
 * chapel is worse than admitting the map does not carry this one.
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

/**
 * Take the focus to the next active quest.
 *
 * A rotation over the log's own order rather than over the drawn list, so a quest
 * filtered out by the zone setting is still reachable: the filter is about what is
 * worth drawing, not about which quest the player may look at next.
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
 * Focus a quest the moment it turns up in the log, if the player asked for that.
 *
 * Keyed on the id being new to this session rather than on an accept event, so a
 * quest accepted while the addon was disabled and a quest accepted a second ago
 * are treated the same. The set is also what stops a quest sitting in the log from
 * stealing the focus back on every redraw.
 *
 * The FIRST walk records without focusing. That walk is world entry, or the moment
 * the player enabled this addon, and every quest already in the log arrives in it
 * at once: focusing there would pick whichever the log happened to hold last, which
 * is not a quest the player just accepted and is not a choice anybody made.
 */
function noticeArrivals(log) {
  const auto = settingFlag('auto-track', true) && !firstWalk;
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
 * Write down what has been learned, once the character it belongs to is known.
 *
 * `world.ready` is the gate. A per-character WRITE rejects before world entry
 * because its value was decided when it was called: held instead, it would store
 * a denominator worked out before anyone knew whose it was against whichever
 * character the player then picked. Nothing here can produce one before world
 * entry, since a progress event needs a world, so the await is a guard rather than
 * a delay.
 *
 * The stamp is `woc.wallClock()` and never `woc.now()`. `now()` is monotonic and
 * restarts near zero on every page load, so a stored monotonic stamp reads as
 * being in the future on the next session with nothing to indicate it.
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

/**
 * Take one stored denominator back, and only over an objective nothing has said
 * anything about this session.
 *
 * A per-character READ waits for the character, so it settles at world entry,
 * which is exactly when a progress event could already have landed. What this
 * session heard from the server is newer than anything on disk by definition, so
 * the restore fills gaps and never overwrites one.
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

/**
 * The player has become somebody else without the page reloading.
 *
 * Real: the game clones and removes its HUD on a character switch rather than
 * reloading, so nothing an addon can see forces it to start again. Every learned
 * denominator belongs to whoever was playing a moment ago, and the override behind
 * them is per player, so keeping them would show one character's requirement under
 * another's name and write it back out under their key.
 */
woc.world.on('characterKey', () => {
  learned.clear();
  seenQuests.clear();
  firstWalk = true;
  focus = null;
  load();
  redraw();
});

// Once a second. Every figure on this panel moves at most that often: a count
// changes on an event, and a distance over a zone-wide ride moves a yard or two.
// The pins position themselves, because `ui.anchor3d` rides the loader's own frame
// loop, so joining that loop for the list would rewrite the same strings sixty
// times a second to say nothing new.
woc.setInterval(redraw, MS_PER_SECOND);

// The frame loop is spent on the pins alone, which is where it is actually needed:
// a pin's fade comes off the camera, and the camera turns between ticks.
woc.onFrame(() => {
  for (const pin of pins.values()) {
    paintPin(pin);
  }
});

woc.keys.bind('toggle', () => {
  frame.toggle();
  // Now, rather than up to a second from now: somebody who just hid the panel
  // should not watch its pins hang over the world waiting for the next tick.
  redraw();
});

woc.keys.bind('cycle', cycleFocus);

woc.onSettingsChange(redraw);

/**
 * Read the tables in, then do the two things that needed them.
 *
 * Every handler above is wired FIRST and is a no-op until this lands: no quest id
 * matches an empty map, so a quest subscription fires and draws nothing. That
 * order is the important one, because an addon's first line runs at document-start
 * and subscribing after an await would miss whatever arrived during it.
 *
 * `load()` rather than `await restore()`, because a per-character read waits for
 * the character: awaiting it here would hold the first draw on the landing page
 * until somebody logged in, and the reclaim it does only ever fills what is blank.
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
