// Regenerates addons/trailmark/quests.json from a World of ClaudeCraft checkout.
//
//   node addons/trailmark/generate.mjs --game=/path/to/world-of-claudecraft
//
// The checkout path is REQUIRED and is never defaulted. A generator that guesses
// where the game is will happily read a checkout six releases old and write a file
// that looks exactly like a correct one: nothing tells you a stale working tree is
// stale, the way a 404 tells you an endpoint moved. So the path is an argument, the
// target is proved to be the game before a line of content is read, and the game's
// own version is read out of its package.json and stamped into the output rather
// than written here by hand.
//
// WHAT IT READS, all of it under the checkout:
//
//   package.json                          the version stamped into the output
//   src/sim/data.ts                       QUESTS, CAMPS, GROUND_OBJECTS, NPCS,
//                                         GATHER_NODES, ESCORTS, MOBS, ZONES and
//                                         the world strip's default x extent
//   src/sim/professions/gathering.ts      nodeMaterialFor, which is what turns a
//                                         node's type and zone into the item a
//                                         harvest of it grants
//
// IT EVALUATES RATHER THAN PARSES, and that is the one decision here worth arguing
// about. Most of these tables are literals a text parse could read, but the fifteen
// Eastbrook town NPCs are not: their positions come out of `EASTBROOK_LAYOUT`, which
// computes stall rotations, building front standing points and facings, so
// `trader_wilkes` sits at x -7.125851435200138 and no amount of regex reads that off
// the page. Vite's SSR module loader is what resolves the game's extensionless
// imports; vite is already a dependency of this repository and nothing new is added
// for this. The cost is that a game release which breaks the sim's own module graph
// breaks this too, which is a loud failure rather than a thin table.
//
// WHAT IT EXTRACTS. Trailmark reproduces `questObjectiveAreas` from the game's own
// `src/sim/quest_targets.ts`: a kill objective resolves to every camp with that mob
// id, a collect objective to the camps of mobs whose loot is TAGGED with that quest
// id plus any ground-object cluster for the item plus the nodes whose harvest yields
// it, an interact objective to the object cluster or the NPC's point, a gather
// objective to the matching nodes, and an escort objective to the escortee's start.
// That leaf function is the thing most likely to move underneath this table: if it
// grows an arm, or changes what an arm resolves to, this file and `areasFor` in
// main.js both have to follow it. It HAS moved once already, which is why that
// sentence is here rather than hypothetical: 0.34.0 added the node-yield arm to
// collect, and nothing about the emitted table had to change to feed it, because the
// node rows already carried the item each one yields. Everything emitted here exists
// to feed that function, plus the zone rectangles the addon resolves a point against.
//
// The quest-tagged loot join is precomputed into `drops` rather than shipping a loot
// table, because the addon only ever asks the one question `mobsDroppingQuestItem`
// asks: which mobs drop this item FOR THIS QUEST.
//
// DETERMINISTIC. Every array keeps the game's OWN order, which is the one order that
// is not this script's to choose and is load-bearing inside the game itself: camps
// spawn in array order and NPCs in insertion order, so both fix entity ids, and the
// zone list is walked in order by the game's own rectangle test. Keys are written in
// a fixed order and the file ends in a newline, so re-running against an unchanged
// checkout produces a byte-identical file and a real diff means real content moved.
//
// WHAT A GAME RELEASE COULD INVALIDATE, each of which fails loudly rather than
// writing a thinner table:
//
//  - A quest objective gains a new `type`. The unknown arm would emit its count and
//    label with no target field, and the addon would resolve it to nowhere. The
//    objective-type census below fails on a type this script does not know.
//  - `nodeMaterialFor` stops being a pure function of type and zone. It is called
//    once per node here, which is exactly how `questObjectiveAreas` calls it.
//  - A quest names a turn-in NPC that is `dynamic`. Those carry no authored position
//    and are deliberately left out of `npcs`; the addon says the turn-in is not on
//    the map rather than pointing somewhere plausible.
//  - The counts at the bottom move. They are warnings rather than failures, because
//    content growing is the ordinary case, but an EMPTY table is a failure.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

/** What the checkout's own package.json has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

const DATA_MODULE = '/src/sim/data.ts';
const GATHERING_MODULE = '/src/sim/professions/gathering.ts';
const OUT_FILE = 'quests.json';

/** What the shipped file records about where it came from. */
const SOURCE_NOTE =
  'src/sim/data.ts, src/sim/quest_targets.ts, src/sim/types.ts, src/sim/content/*.ts';

/** The objective types `questObjectiveAreas` knows how to place, plus `craft`. */
const KNOWN_OBJECTIVE_TYPES = new Set(['kill', 'collect', 'interact', 'craft', 'gather', 'escort']);

/** Roughly what the tables carried at game 0.34.0, so a thin parse cannot pass quietly. */
const EXPECTED = Object.freeze({
  zones: 14,
  quests: 202,
  camps: 203,
  objects: 43,
  npcs: 86,
  nodes: 156,
  escorts: 4,
  drops: 50,
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
 * Prove the path really is the game before loading a module out of it.
 *
 * The package NAME rather than the presence of a directory, because a wrong path
 * that happens to hold a `src` reads as plausible right up until the module graph
 * fails to resolve, and a resolution failure reads as the game having moved
 * something rather than as the path being wrong.
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
 * The game's own content tables, loaded through its own module graph.
 *
 * `configFile: false` on purpose: the game's vite config is about building the
 * game, and running its plugin chain to read two data modules would make this
 * script depend on a build pipeline it has no business knowing about.
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
    return { data, gathering };
  } catch (err) {
    return fail(`could not load the game's content modules from ${root}: ${String(err)}`);
  } finally {
    await server.close();
  }
}

/**
 * The zone rectangles, in the game's own `ZONES` order.
 *
 * A zone with no x range spans the original strip column, which is the default the
 * game's own rectangle test applies. It is resolved here rather than left absent,
 * so the addon's test is a plain comparison rather than a second place the default
 * has to be remembered.
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
  return row;
}

/**
 * Every quest, with the text stripped out.
 *
 * `text` and `completionText` are most of the table's bytes and answer nothing the
 * addon asks: the game's own quest dialog draws them and this display never does.
 * `resolved` is carried because it is the flag that says a quest's requirement is
 * overridden per player, which is the figure the addon has to learn from an event.
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
 * Ground objects, as an item and its spawn positions.
 *
 * The `name` on the game's own definition is display text the addon never shows: an
 * objective carries its own label, which is what the quest author wrote for it.
 */
function objectRows(data) {
  return data.GROUND_OBJECTS.map((def) => ({
    item: def.itemId,
    positions: def.positions.map((at) => [at.x, at.z]),
  }));
}

/**
 * Static NPCs, in insertion order.
 *
 * A `dynamic` NPC is left out and that is the point rather than an omission: the
 * owning system spawns it on demand, so it carries no authored placement, and a
 * position invented for one would be a pin on an empty chapel.
 */
function npcRows(data) {
  return Object.values(data.NPCS)
    .filter((npc) => !npc.dynamic)
    .map((npc) => ({ id: npc.id, name: npc.name, x: npc.pos.x, z: npc.pos.z }));
}

/**
 * Gathering nodes, each resolved to the item a harvest of it grants.
 *
 * The item is what an item-only gather objective is matched against, and it is a
 * function of the node's TYPE and ZONE rather than of the node, so it is resolved
 * here through the game's own `nodeMaterialFor` rather than reproduced.
 */
function nodeRows(data, gathering) {
  return data.GATHER_NODES.map((node) => ({
    type: node.type,
    item: gathering.nodeMaterialFor(node.type, node.zoneId).itemId,
    x: node.pos.x,
    z: node.pos.z,
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
 * The quest-tagged loot join, precomputed.
 *
 * `mobsDroppingQuestItem` walks every mob template for a loot entry whose item AND
 * quest id both match, because the same item can be tagged for one quest and drop
 * untagged for another. Keyed on that pair here so the addon ships no loot table.
 *
 * Mob order inside a pair, and pair order in the file, are both the game's own
 * `MOBS` merge order, which is fixed by the content modules rather than by this.
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
 * Counts, so a table that stopped being read cannot pass quietly.
 *
 * A moved count is a WARNING, because content growing is the ordinary case and a
 * generator that refused every content release would be run once. An EMPTY section
 * is a failure: that is a read that stopped working rather than content that moved.
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
 * One line for a value the formatter keeps on one line, or null for one it expands.
 *
 * An object is never inlined, and an array is only as long as everything in it is:
 * `[[58, -58], [73, -70]]` is one line and a list of camps is not. Recursive because
 * a ground object's positions are an array of pairs, which is exactly the shape the
 * first version of this got wrong.
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
 * Serialised the way the repository's own formatter wants it, not by JSON.stringify.
 *
 * Biome formats this file like every other one here, so a generator emitting anything
 * else writes a file the lint gate then rejects, which is a regeneration nobody can
 * commit without a hand edit. This addon's first version packed a row onto one line to
 * keep content diffs short and paid exactly that price. The two rules that differ from
 * `JSON.stringify(value, null, 2)` are both about arrays: one that fits the line width
 * and holds nothing but scalars or arrays of them is kept on one line, and the width is
 * measured including the key in front of it. Objects stay expanded, which is what keeps
 * a moved camp to a one-line diff even now that a camp is five lines.
 *
 * Verified against the formatter rather than reasoned about: rendering the shipped file
 * through this and then through `biome check --write` is byte for byte the same file.
 */
function render(table) {
  return `${renderValue(table, NONE, NONE)}\n`;
}

function build(gameVersion, data, gathering) {
  return {
    gameVersion,
    source: SOURCE_NOTE,
    zones: zoneRows(data),
    quests: questRows(data),
    camps: campRows(data),
    objects: objectRows(data),
    npcs: npcRows(data),
    nodes: nodeRows(data, gathering),
    escorts: escortRows(data),
    drops: dropRows(data),
  };
}

async function main() {
  const root = gamePathFrom(process.argv.slice(2));
  // The identity check FIRST, before the module graph is touched: a wrong path
  // reported as a resolution failure reads as the game having moved something.
  const gameVersion = checkoutVersion(root);
  const { data, gathering } = await loadTables(root);
  const table = build(gameVersion, data, gathering);
  checkObjectiveTypes(table.quests);
  checkCounts(table);
  // Beside this script rather than anywhere an argument could name, so the only
  // file this can write is the one it exists to write.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render(table));
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  console.log(
    `generate: ${String(table.quests.length)} quests, ${String(table.camps.length)} camps, ` +
      `${String(table.npcs.length)} npcs, ${String(table.nodes.length)} nodes`,
  );
}

await main();
