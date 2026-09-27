// Regenerates addons/trailmark/quests.json from a World of ClaudeCraft checkout.
//
//   node addons/trailmark/generate.mjs --game=/path/to/world-of-claudecraft
//
// The checkout path is REQUIRED and never defaulted: a guessed path can be a stale checkout that
// writes a plausible table. The target is proved to be the game first, and its package.json
// version is stamped into the output.
//
// Reads package.json, src/sim/data.ts (QUESTS, CAMPS, GROUND_OBJECTS, NPCS, GATHER_NODES,
// ESCORTS, MOBS, ZONES and the strip's default x extent) and nodeMaterialFor from
// src/sim/professions/gathering.ts.
//
// It EVALUATES rather than parses, through vite's SSR module loader, because Eastbrook's NPC
// positions are computed by `EASTBROOK_LAYOUT` and cannot be read off the page. A release that
// breaks the sim's module graph therefore breaks this loudly.
//
// Everything emitted feeds a copy of the game's `questObjectiveAreas`
// (src/sim/quest_targets.ts), mirrored by `areasFor` in main.js: when that function grows or
// changes an arm, both have to follow. The quest-tagged loot join is precomputed into `drops`
// so the addon ships no loot table.
//
// Every array keeps the game's own order (camp and NPC order fix entity ids; zones are tested
// in order), keys are in a fixed order, and the file ends in a newline, so an unchanged
// checkout regenerates byte-identical.
//
// It fails rather than writing a thinner table when an objective gains an unknown `type`, or a
// section comes back EMPTY. Moved counts only warn, since content growing is ordinary.
// `dynamic` NPCs carry no authored position and are left out, so the addon says a turn-in is
// not on the map rather than pointing somewhere plausible.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

/** What the checkout's own package.json has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

const DATA_MODULE = '/src/sim/data.ts';
const GATHERING_MODULE = '/src/sim/professions/gathering.ts';
const FARM_PATCHES_MODULE = '/src/sim/content/farm_patches.ts';
const OUT_FILE = 'quests.json';

/** What the shipped file records about where it came from. */
const SOURCE_NOTE =
  'src/sim/data.ts, src/sim/quest_targets.ts, src/sim/types.ts, ' +
  'src/sim/content/farm_patches.ts, src/sim/content/*.ts';

/** The objective types `questObjectiveAreas` knows how to place, plus `craft`. */
const KNOWN_OBJECTIVE_TYPES = new Set([
  'kill',
  'collect',
  'interact',
  'craft',
  'gather',
  'escort',
  'farm',
]);

/** Rough floors for each table, so a thin parse cannot pass quietly. */
const EXPECTED = Object.freeze({
  zones: 14,
  quests: 204,
  camps: 207,
  objects: 43,
  npcs: 86,
  nodes: 156,
  escorts: 4,
  drops: 50,
  // One patch per farming hub. Here for the EMPTY case: a farm objective whose patches all failed
  // to read would circle every bed in the world, which looks like an answer.
  farmPatches: 4,
});

const GAME_ARG = '--game=';
const INDENT = '  ';
/** What `biome.json` sets, which is what the rendered file has to fit inside. */
const LINE_WIDTH = 100;
const NONE = 0;
const ONE = 1;

function fail(message) {
  console.error(`generate: ${message}`);
  process.exit(ONE);
}

/** The checkout to read, which is an argument and is never guessed. */
function gamePathFrom(args) {
  const flag = args.find((arg) => arg.startsWith(GAME_ARG));
  if (flag === undefined) {
    fail(`no ${GAME_ARG}<path>. Pass the world-of-claudecraft checkout to read from.`);
  }
  const path = flag.slice(GAME_ARG.length);
  if (path.length === NONE) {
    fail(`${GAME_ARG} is empty. Pass the world-of-claudecraft checkout to read from.`);
  }
  return path;
}

/**
 * Prove the path is the game before loading a module out of it, by package NAME: a wrong path with
 * a `src` fails later as a resolution error that reads as the game having moved something.
 */
function checkoutVersion(root) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch (err) {
    return fail(`could not read ${root}/package.json (is this the game checkout?): ${String(err)}`);
  }
  if (parsed.name !== GAME_PACKAGE_NAME) {
    return fail(`${root} is "${String(parsed.name)}", not ${GAME_PACKAGE_NAME}`);
  }
  if (typeof parsed.version !== 'string' || parsed.version.length === NONE) {
    return fail(`${root}/package.json carries no version to stamp`);
  }
  return parsed.version;
}

/**
 * The game's content tables, loaded through its own module graph. `configFile: false`, because the
 * game's vite config is about building the game and its plugin chain is irrelevant here.
 */
async function loadTables(root) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const data = await server.ssrLoadModule(DATA_MODULE);
    const gathering = await server.ssrLoadModule(GATHERING_MODULE);
    const farmPatches = await server.ssrLoadModule(FARM_PATCHES_MODULE);
    return { data, gathering, farmPatches };
  } catch (err) {
    return fail(`could not load the game's content modules from ${root}: ${String(err)}`);
  } finally {
    await server.close();
  }
}

/**
 * The zone rectangles, in the game's `ZONES` order. A zone with no x range gets the strip default
 * here, so the addon's test is a plain comparison.
 */
function zoneRows(data) {
  return data.ZONES.map((zone) => ({
    id: zone.id,
    name: zone.name,
    xMin: zone.xMin ?? data.STRIP_MIN_X,
    xMax: zone.xMax ?? data.STRIP_MAX_X,
    zMin: zone.zMin,
    zMax: zone.zMax,
  }));
}

/** One objective, trimmed to the fields the placement derivation actually reads. */
function objectiveRow(objective) {
  const row = { type: objective.type, count: objective.count, label: objective.label };
  if (objective.type === 'kill') {
    row.mob = objective.targetMobId;
  }
  if (objective.type === 'collect') {
    row.item = objective.itemId;
  }
  if (objective.type === 'craft') {
    row.recipe = objective.recipeId;
  }
  if (objective.type === 'escort') {
    row.escort = objective.escortId;
  }
  return withOptionalTargets(row, objective);
}

/** The two arms whose target fields are optional in the game's own union. */
function withOptionalTargets(row, objective) {
  if (objective.type === 'interact') {
    if (objective.targetObjectItemId) {
      row.object = objective.targetObjectItemId;
    }
    if (objective.targetNpcId) {
      row.npc = objective.targetNpcId;
    }
  }
  if (objective.type === 'gather') {
    if (objective.nodeType) {
      row.nodeType = objective.nodeType;
    }
    if (objective.itemId) {
      row.item = objective.itemId;
    }
  }
  if (objective.type === 'farm') {
    // `action` is what the row SAYS (plant or harvest), though placement ignores it. `patch` is
    // optional and its absence is meaningful: the credit arm never reads it, so every bed
    // qualifies.
    row.action = objective.action;
    if (objective.cropId) {
      row.crop = objective.cropId;
    }
    if (objective.patchId) {
      row.patch = objective.patchId;
    }
  }
  return row;
}

/**
 * Every quest, without `text` and `completionText`, which are most of the bytes and never drawn.
 * `resolved` is carried because it marks a per-player override the addon must learn from an event.
 */
function questRows(data) {
  return Object.values(data.QUESTS).map((quest) => {
    const row = {
      id: quest.id,
      name: quest.name,
      giver: quest.giverNpcId,
      turnIn: turnInIds(quest),
      objectives: quest.objectives.map(objectiveRow),
    };
    if (quest.resolvedObjectiveCounts) {
      row.resolved = quest.resolvedObjectiveCounts;
    }
    return row;
  });
}

/** The game's own `questTurnInNpcIds`: the list when there is one, else the single. */
function turnInIds(quest) {
  if (Array.isArray(quest.turnInNpcIds) && quest.turnInNpcIds.length > NONE) {
    return [...quest.turnInNpcIds];
  }
  return [quest.turnInNpcId];
}

/** Camps in spawn order, which is the game's own world-gen draw order. */
function campRows(data) {
  return data.CAMPS.map((camp) => ({
    mob: camp.mobId,
    x: camp.center.x,
    z: camp.center.z,
    radius: camp.radius,
  }));
}

/**
 * Ground objects, as an item and its spawn positions. The definition's `name` is not carried: an
 * objective carries its own label.
 */
function objectRows(data) {
  return data.GROUND_OBJECTS.map((def) => ({
    item: def.itemId,
    positions: def.positions.map((at) => [at.x, at.z]),
  }));
}

/**
 * Static NPCs, in insertion order. A `dynamic` NPC is spawned on demand with no authored placement,
 * so it is left out rather than given an invented position.
 */
function npcRows(data) {
  return Object.values(data.NPCS)
    .filter((npc) => !npc.dynamic)
    .map((npc) => ({ id: npc.id, name: npc.name, x: npc.pos.x, z: npc.pos.z }));
}

/**
 * Gathering nodes, each resolved to the item a harvest grants. That is a function of the node's
 * TYPE and ZONE, resolved through the game's own `nodeMaterialFor` rather than reproduced.
 */
function nodeRows(data, gathering) {
  return data.GATHER_NODES.map((node) => ({
    type: node.type,
    item: gathering.nodeMaterialFor(node.type, node.zoneId).itemId,
    x: node.pos.x,
    z: node.pos.z,
  }));
}

/**
 * One row per farming patch with every bed, because the game's placement (`pushFarmPatches`)
 * encloses the beds and the anchor is their centroid. A section of its own, because a patchless
 * farm objective is earned at ANY bed and needs the whole table.
 */
function farmPatchRows(farmPatches) {
  return farmPatches.FARM_PATCHES.map((patch) => ({
    id: patch.id,
    beds: patch.beds.map((bed) => ({ x: bed.x, z: bed.z })),
  }));
}

function escortRows(data) {
  return Object.values(data.ESCORTS).map((escort) => ({
    id: escort.id,
    x: escort.start.x,
    z: escort.start.z,
  }));
}

/**
 * The quest-tagged loot join. `mobsDroppingQuestItem` matches item AND quest id, since one item can
 * be tagged for one quest and untagged for another, so it is keyed on the pair. Order is the game's
 * `MOBS` merge order.
 */
function dropRows(data) {
  const byPair = new Map();
  for (const [mobId, def] of Object.entries(data.MOBS)) {
    for (const entry of def.loot ?? []) {
      collectDrop(byPair, mobId, entry);
    }
  }
  return [...byPair].map(([key, mobs]) => {
    const [quest, item] = key.split(' ');
    return { quest, item, mobs };
  });
}

function collectDrop(byPair, mobId, entry) {
  if (!(entry.questId && entry.itemId)) {
    return;
  }
  const key = `${entry.questId} ${entry.itemId}`;
  const held = byPair.get(key);
  if (held === undefined) {
    byPair.set(key, [mobId]);
    return;
  }
  if (!held.includes(mobId)) {
    held.push(mobId);
  }
}

/** Every objective type must be one the addon knows how to place. */
function checkObjectiveTypes(quests) {
  const unknown = new Set();
  for (const quest of quests) {
    for (const objective of quest.objectives) {
      if (!KNOWN_OBJECTIVE_TYPES.has(objective.type)) {
        unknown.add(objective.type);
      }
    }
  }
  if (unknown.size > NONE) {
    fail(`objective types this table cannot place: ${[...unknown].sort().join(', ')}`);
  }
}

/**
 * Counts, so a table that stopped being read cannot pass quietly. A moved count WARNS, since
 * content growing is ordinary; an EMPTY section fails, since that is a broken read.
 */
function checkCounts(table) {
  for (const [name, want] of Object.entries(EXPECTED)) {
    const got = table[name].length;
    if (got === NONE) {
      fail(`read no ${name} at all, which is a read that stopped working`);
    }
    if (got !== want) {
      console.warn(`generate: read ${String(got)} ${name}, expected ${String(want)}`);
    }
  }
}

function isScalar(value) {
  return typeof value !== 'object' || value === null;
}

/**
 * One line for a value the formatter keeps on one line, or null for one it expands. An object is
 * never inlined; an array is only if everything in it is (`[[58, -58], [73, -70]]` is one line, a
 * list of camps is not). Recursive for arrays of pairs.
 */
function inlineOf(value) {
  if (isScalar(value)) {
    return JSON.stringify(value);
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value.map(inlineOf);
  if (parts.some((part) => part === null)) {
    return null;
  }
  return `[${parts.join(', ')}]`;
}

function renderArray(values, depth, used) {
  const inline = inlineOf(values);
  if (inline !== null && used + inline.length <= LINE_WIDTH) {
    return inline;
  }
  const pad = INDENT.repeat(depth + ONE);
  const lines = values.map((one) => `${pad}${renderValue(one, depth + ONE, pad.length)}`);
  return `[\n${lines.join(',\n')}\n${INDENT.repeat(depth)}]`;
}

function renderObject(value, depth) {
  const pad = INDENT.repeat(depth + ONE);
  const lines = Object.entries(value).map(([key, held]) => {
    const head = `${pad}${JSON.stringify(key)}: `;
    return `${head}${renderValue(held, depth + ONE, head.length)}`;
  });
  return `{\n${lines.join(',\n')}\n${INDENT.repeat(depth)}}`;
}

function renderValue(value, depth, used) {
  if (Array.isArray(value)) {
    return renderArray(value, depth, used);
  }
  if (isScalar(value)) {
    return JSON.stringify(value);
  }
  return renderObject(value, depth);
}

/**
 * Serialised the way Biome formats it, not by JSON.stringify, or the regenerated file fails the
 * lint gate. The differences are both about arrays: one that fits the line width (key included) and
 * holds only scalars or arrays of them stays on one line. Objects stay expanded, so a moved camp is
 * a one-line diff. Rendering the shipped file through this and then `biome check --write` must be a
 * no-op.
 */
function render(table) {
  return `${renderValue(table, NONE, NONE)}\n`;
}

function build(gameVersion, data, gathering, farmPatches) {
  return {
    gameVersion,
    source: SOURCE_NOTE,
    zones: zoneRows(data),
    quests: questRows(data),
    camps: campRows(data),
    objects: objectRows(data),
    npcs: npcRows(data),
    nodes: nodeRows(data, gathering),
    farmPatches: farmPatchRows(farmPatches),
    escorts: escortRows(data),
    drops: dropRows(data),
  };
}

async function main() {
  const root = gamePathFrom(process.argv.slice(2));
  // The identity check FIRST, before the module graph is touched: a wrong path reported as a
  // resolution failure reads as the game having moved something.
  const gameVersion = checkoutVersion(root);
  const { data, gathering, farmPatches } = await loadTables(root);
  const table = build(gameVersion, data, gathering, farmPatches);
  checkObjectiveTypes(table.quests);
  checkCounts(table);
  // Beside this script, never a path an argument could name.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render(table));
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  console.log(
    `generate: ${String(table.quests.length)} quests, ${String(table.camps.length)} camps, ` +
      `${String(table.npcs.length)} npcs, ${String(table.nodes.length)} nodes`,
  );
}

await main();
