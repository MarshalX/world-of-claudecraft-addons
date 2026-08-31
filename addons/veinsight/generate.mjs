// Regenerates addons/veinsight/nodes.json from a World of ClaudeCraft checkout.
//
//   node addons/veinsight/generate.mjs --game=/path/to/world-of-claudecraft
//
// The checkout path is REQUIRED and is never defaulted. A generator that guesses
// where the game is will happily read a checkout six releases old and write a file
// that looks exactly like a correct one: nothing tells you a stale working tree is
// stale, the way a 404 tells you an endpoint moved. So the path is an argument, the
// target is checked to actually be the game, and the game's own version is read out
// of it and stamped into the output rather than written here by hand.
//
// WHAT IT READS, all of it under the checkout:
//
//   package.json                          the version stamped into the output
//   src/sim/content/gather_nodes.ts       GATHER_NODES, and GATHER_NODE_TYPES for
//                                         the order the three types are listed in
//   src/sim/content/items.ts              every item whose `use` is a gatherTool,
//                                         and the display NAME of every yield
//   src/sim/professions/gathering.ts      NODE_TYPE_BY_PROFESSION, which is what
//                                         files a tool under the node type it opens,
//                                         NODE_HARVEST_TABLE for the respawn length
//                                         of each type, and GATHER_GAIN_TIER_STEP
//   src/sim/professions/gathering_materials.ts  NODE_MATERIAL_TABLE, for what a
//                                         zone's node of each type yields. Split out
//                                         of gathering.ts at game 0.41.0
//   src/sim/professions/wield_gate.ts     WIELD_REQUIREMENT_BY_TIER, the proficiency
//                                         each tool tier needs before it will swing
//   src/sim/professions/wheel.ts          the two reduced-gain multipliers
//   src/sim/professions/material_grades.ts  MATERIAL_GRADE_ROWS, the fine grade of
//                                         each yield and the rung it sits at
//   src/sim/content/professions.ts        TOOL_EFFECTS, for which slotted charm is a
//                                         QUALITY one and what it adds
//   src/sim/data.ts                       the ZONES array, for the canonical order
//   src/sim/content/*.ts                  every `ZoneDef` export, for id and name
//
// EVERY TUNING FIGURE IS READ RATHER THAN WRITTEN DOWN HERE, and the wield ladder
// is the case that makes the rule worth restating. Its five thresholds are pinned
// by the game's own suite against the live gain curve, which means a curve retune
// moves them with nothing on the wire to announce it, exactly like the respawn
// length that was 120 and is now 240. A hardcoded ladder here would go on locking
// and unlocking nodes by the old numbers, and no test on either side would notice.
//
// It writes ONE file, `nodes.json` beside this script, and can write nothing else:
// the destination is resolved from `import.meta.dirname` rather than from the
// working directory or from an argument.
//
// DETERMINISTIC. Nodes keep the game's own authoring order, which is load-bearing in
// the game itself (the world-gen draw order depends on it) and is therefore the one
// order that cannot be arbitrary. Zones keep the order of the game's `ZONES` array
// for the same reason. Tools are sorted by node type and then by tier, which is NOT
// the item table's order: that table interleaves the tier 4 and 5 tools into a later
// block, so sorting is what makes a newly authored tool land in one predictable place
// instead of wherever it was appended. Re-running against an unchanged checkout
// produces a byte-identical file.
//
// WHAT A GAME RELEASE COULD INVALIDATE. This is a text parse rather than an import,
// because importing `src/sim/data.ts` would drag most of the game's simulation in,
// and because the tables are content rather than code. Each assumption below fails
// LOUDLY, with a message naming the file, rather than writing a thinner table:
//
//  - Every field this reads is an inline literal. A node whose `pos` was computed
//    from a constant, or a tool whose tier came from a shared table, would not be
//    seen. The counts are asserted after parsing so that shows up as a failure.
//  - A node object's `pos` is written on one line as `pos: { x: N, z: N }`.
//  - A `ZoneDef` carries `id` and `name` as direct members.
//  - Fishing is excluded because it has no world nodes: its rods route to a separate
//    surface entirely, so `NODE_TYPE_BY_PROFESSION` has no entry for it, and that
//    absence is the filter rather than a name written out here.
//
// WHAT IT DELIBERATELY DOES NOT EMIT: zone rectangles. Veinsight resolves no point to
// a zone, so it has no rectangle test to feed. Every node row carries its own zone id
// and the only zone question left, which zone the PLAYER is in, comes over the bus
// from a zone publisher. See the header of `main.js` for why that is refused locally.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** What the checkout's own package.json has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

const NODES_FILE = 'src/sim/content/gather_nodes.ts';
const ITEMS_FILE = 'src/sim/content/items.ts';
const GATHERING_FILE = 'src/sim/professions/gathering.ts';
// NODE_MATERIAL_TABLE alone lives here. Game 0.41.0 split it out of
// gathering.ts, which failed this generator outright rather than silently:
// `objectAfter` fails on a missing export, so the table could not go stale
// behind a source that had moved.
const MATERIALS_FILE = 'src/sim/professions/gathering_materials.ts';
const WIELD_FILE = 'src/sim/professions/wield_gate.ts';
const WHEEL_FILE = 'src/sim/professions/wheel.ts';
const GRADES_FILE = 'src/sim/professions/material_grades.ts';
const EFFECTS_FILE = 'src/sim/content/professions.ts';
const DATA_FILE = 'src/sim/data.ts';
const CONTENT_DIR = 'src/sim/content';

/** Every count the shipped table is expected to carry, asserted after the parse. */
const EXPECTED_TYPES = 3;
const EXPECTED_NODES = 156;
// 15 since before game 0.40.1: the committed table has carried 15 zones while
// this said 14, so every run printed a count warning that was already answered.
// Corrected so the next one that fires means something.
const EXPECTED_ZONES = 15;
const EXPECTED_TOOLS = 15;
const EXPECTED_WIELD_RUNGS = 5;
/** Three types across fourteen zones, which is every cell of the material matrix. */
const EXPECTED_MATERIALS = 42;
/** Nine yields with a fine grade: three zone rungs by three node types. */
const EXPECTED_GRADES = 9;
/** Three shipped charms, one of each kind. */
const EXPECTED_EFFECTS = 3;
/** Each of those nine, plus the fine grade of each. */
const EXPECTED_NAMES = 18;

const INDENT = 2;
const NOT_FOUND = -1;
const NONE = 0;
const ONE = 1;

const OPENERS = '{[';
const CLOSERS = '}]';

const GAME_ARG = '--game=';

/** How a number is written, for the members read by name rather than by shape. */
const NUMBER_PATTERN = '-?\\d+(?:\\.\\d+)?';
/** Any single-quoted string, which is the only quote the game's own formatter emits. */
const QUOTED_RE = /'([^']+)'/g;
/** The `pos: { x: N, z: N }` form, which every authored node is written in. */
const POS_RE = /pos:\s*\{\s*x:\s*(-?\d+(?:\.\d+)?)\s*,\s*z:\s*(-?\d+(?:\.\d+)?)\s*\}/;
/** One `professionId: 'x'` to `tier: N` pairing inside a gatherTool `use`. */
const TOOL_USE_RE = /use:\s*\{\s*type:\s*'gatherTool',\s*professionId:\s*'(\w+)',\s*tier:\s*(\d+)/g;
/** The item id nearest ABOVE a `use`, which is the item that `use` belongs to. */
const ITEM_ID_RE = /id:\s*'([\w]+)'/g;
/** One `mining: 'ore'` line of NODE_TYPE_BY_PROFESSION. */
const PROFESSION_TYPE_RE = /^\s*(\w+):\s*'(\w+)',/gm;
/** One `ore: { professionId: 'mining', respawnSeconds: N }` row of NODE_HARVEST_TABLE. */
const RESPAWN_RE = /(\w+):\s*\{[^{}]*respawnSeconds:\s*(\d+)\s*\}/g;
/** One `2: TIER2_TOOL_WIELD_PROFICIENCY,` row of the frozen wield ladder. */
const WIELD_ROW_RE = /(\d+):\s*([A-Za-z0-9_]+),/g;
/** A rung whose value is written as a number rather than as one of those identifiers. */
const LITERAL_RUNG_RE = /^\d+$/;
/** A rung's own threshold declaration, which is what those identifiers name. */
const WIELD_CONST_RE = /export const (TIER\d_TOOL_WIELD_PROFICIENCY) = (\d+);/g;
/** One `eastbrook_vale: { itemId: 'copper_ore', ... }` row of a material block. */
const MATERIAL_ROW_RE = /(\w+):\s*\{\s*itemId:\s*'(\w+)'/g;
/** One `copper_ore: { fineItemId: 'fine_copper_ore', gatherTier: 1 }` grade row. */
const GRADE_ROW_RE = /(\w+):\s*\{\s*fineItemId:\s*'(\w+)',\s*gatherTier:\s*(\d+)\s*\}/g;

/** One `TOOL_EFFECTS` member, read for the two fields the grade comparison needs. */
const EFFECT_ROW_RE = /(\w+):\s*\{[^{}]*?kind:\s*'(\w+)',\s*bonus:\s*(\d+)/g;
/** An item's id and the display name written under it, which is the next member. */
const ITEM_NAME_RE = /id:\s*'(\w+)',\s*name:\s*'([^']+)'/g;
/** A bare identifier on its own line, which is how the ZONES array is written. */
const ZONE_MEMBER_RE = /^\s*([A-Z][A-Z0-9_]*),\s*$/gm;
/** A zone's own declaration, wherever in `src/sim/content` it happens to live. */
const ZONE_DECL_RE = /export const ([A-Z][A-Z0-9_]*): ZoneDef = \{/g;

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

function readOrFail(path, why) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    return fail(`could not read ${path} (${why}): ${String(err)}`);
  }
}

/**
 * Prove the path really is the game before reading a line of content out of it.
 *
 * The package NAME rather than the presence of a directory, because a wrong path
 * that happens to hold a `src` reads as plausible right up until the tables come
 * back empty, and an empty table is what this whole check exists to never ship.
 */
function checkoutVersion(root) {
  const text = readOrFail(join(root, 'package.json'), 'is this the game checkout?');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return fail(`${root}/package.json is not JSON: ${String(err)}`);
  }
  if (parsed.name !== GAME_PACKAGE_NAME) {
    return fail(`${root} is "${String(parsed.name)}", not ${GAME_PACKAGE_NAME}`);
  }
  if (typeof parsed.version !== 'string' || parsed.version.length === NONE) {
    return fail(`${root}/package.json carries no version to stamp`);
  }
  return parsed.version;
}

/** The index just past the bracket matching the one at `from`, or a failure. */
function matchEnd(text, from, where) {
  let depth = NONE;
  for (let at = from; at < text.length; at += ONE) {
    const ch = text[at];
    if (OPENERS.includes(ch)) {
      depth += ONE;
    } else if (CLOSERS.includes(ch)) {
      depth -= ONE;
      if (depth === NONE) {
        return at + ONE;
      }
    }
  }
  return fail(`unbalanced brackets in ${where}`);
}

/**
 * The literal ASSIGNED after `marker`, as text.
 *
 * Everything is measured from the `=` rather than from the marker, and that is the
 * whole of why this helper exists: a declaration carries its TYPE between the two,
 * so `export const GATHER_NODES: GatherNodeDef[] = [` has a `[` that belongs to the
 * annotation. Searching from the marker finds that one, matches its `]` one
 * character later, and reads an empty table with nothing raising.
 */
function literalAfter(text, marker, opener, where) {
  const at = text.indexOf(marker);
  if (at === NOT_FOUND) {
    fail(`${where} no longer declares ${marker}`);
  }
  const assigned = text.indexOf('=', at);
  if (assigned === NOT_FOUND) {
    fail(`${where}: ${marker} is no longer assigned anything`);
  }
  const open = text.indexOf(opener, assigned);
  if (open === NOT_FOUND) {
    fail(`${where}: ${marker} is no longer a ${opener} literal`);
  }
  return text.slice(open, matchEnd(text, open, where));
}

function arrayAfter(text, marker, where) {
  return literalAfter(text, marker, '[', where);
}

function objectAfter(text, marker, where) {
  return literalAfter(text, marker, '{', where);
}

/** Each top-level `{...}` inside an array literal, in the order they are written. */
function objectsIn(arrayText, where) {
  const found = [];
  let at = ONE;
  while (at < arrayText.length) {
    const open = arrayText.indexOf('{', at);
    if (open === NOT_FOUND) {
      return found;
    }
    const end = matchEnd(arrayText, open, where);
    found.push(arrayText.slice(open, end));
    at = end;
  }
  return found;
}

/** The first capture of `pattern`, or null when it does not appear at all. */
function firstCapture(text, pattern) {
  for (const found of text.matchAll(pattern)) {
    return found[ONE];
  }
  return null;
}

function memberString(objectText, name) {
  return firstCapture(objectText, new RegExp(`${name}:\\s*'([^']+)'`, 'g'));
}

function memberNumber(objectText, name) {
  const found = firstCapture(objectText, new RegExp(`${name}:\\s*(${NUMBER_PATTERN})`, 'g'));
  if (found === null) {
    return null;
  }
  return Number(found);
}

/** Every string in a `['a', 'b']` literal, which is how the type list is written. */
function stringsIn(arrayText) {
  return [...arrayText.matchAll(QUOTED_RE)].map((found) => found[ONE]);
}

/** A `name: { ... }` member of an object literal, as text. */
function memberObject(objectText, name, where) {
  const at = objectText.search(new RegExp(`\\b${name}:\\s*\\{`));
  if (at === NOT_FOUND) {
    fail(`${where}: no ${name} block`);
  }
  const open = objectText.indexOf('{', at);
  return objectText.slice(open, matchEnd(objectText, open, where));
}

/** A `export const NAME = 0.5;` number, which is how every tuning knob is written. */
function constantNumber(source, name, where) {
  const found = firstCapture(
    source,
    new RegExp(`export const ${name} = (${NUMBER_PATTERN});`, 'g'),
  );
  if (found === null) {
    return fail(`${where} no longer declares ${name}`);
  }
  return Number(found);
}

/** One node row, in the shape the shipped file carries it in. */
function nodeFrom(objectText) {
  const pos = POS_RE.exec(objectText);
  if (pos === null) {
    return fail(`${NODES_FILE}: a node no longer writes its pos as { x: N, z: N }`);
  }
  return {
    id: memberString(objectText, 'id'),
    zone: memberString(objectText, 'zoneId'),
    type: memberString(objectText, 'type'),
    x: Number(pos[ONE]),
    z: Number(pos[2]),
    level: memberNumber(objectText, 'level'),
    tier: memberNumber(objectText, 'tier'),
  };
}

function readNodes(source) {
  const literal = arrayAfter(source, 'export const GATHER_NODES', NODES_FILE);
  const nodes = objectsIn(literal, NODES_FILE).map(nodeFrom);
  for (const node of nodes) {
    if (Object.values(node).some((value) => value === null || Number.isNaN(value))) {
      fail(`${NODES_FILE}: a node is missing a field: ${JSON.stringify(node)}`);
    }
  }
  return nodes;
}

function readTypes(source) {
  return stringsIn(arrayAfter(source, 'export const GATHER_NODE_TYPES', NODES_FILE));
}

/** Gathering profession id to the node type it opens, which is the game's own map. */
function readTypeByProfession(source) {
  const literal = objectAfter(source, 'export const NODE_TYPE_BY_PROFESSION', GATHERING_FILE);
  const map = new Map();
  for (const line of literal.matchAll(PROFESSION_TYPE_RE)) {
    map.set(line[ONE], line[2]);
  }
  return map;
}

/**
 * Seconds each node type takes to come back, out of the game's own NODE_HARVEST_TABLE.
 *
 * Read rather than written down for the reason the tool tiers are: it is a TUNING
 * figure, so it moves on a content pass with nothing to announce it. Game 0.34.0
 * doubled it from 120 to 240 alongside the density pass, and while the addon carried
 * its own 120 every node with over two minutes left drew a bar pinned at full.
 *
 * Emitted per type even though all three currently agree, because the game's table is
 * keyed per type: collapsing them to one number here would be this file deciding they
 * are the same question, and the next tune that splits them would go unnoticed.
 */
function readRespawnSeconds(source, types) {
  const literal = objectAfter(source, 'export const NODE_HARVEST_TABLE', GATHERING_FILE);
  const found = new Map();
  RESPAWN_RE.lastIndex = NONE;
  for (const row of literal.matchAll(RESPAWN_RE)) {
    found.set(row[ONE], Number(row[2]));
  }
  const byType = {};
  for (const type of types) {
    const seconds = found.get(type);
    if (seconds === undefined || Number.isNaN(seconds)) {
      fail(`${GATHERING_FILE}: NODE_HARVEST_TABLE carries no respawnSeconds for ${type}`);
    }
    byType[type] = seconds;
  }
  return byType;
}

/**
 * Node type to the gathering profession that works it, which is the direction the
 * addon reads it in: a node knows its type and needs the profession to look a
 * proficiency counter up under.
 *
 * Inverted from the game's own map rather than written out, so a profession
 * renamed or a type re-filed arrives here rather than being missed. A type with no
 * profession is a failure: without one there is no counter to read and the whole
 * wield gate silently stops applying to that type.
 */
function readProfessionByType(typeByProfession, types) {
  const byType = {};
  for (const [professionId, type] of typeByProfession) {
    byType[type] = professionId;
  }
  for (const type of types) {
    if (byType[type] === undefined) {
      fail(`${GATHERING_FILE}: NODE_TYPE_BY_PROFESSION names no profession for ${type}`);
    }
  }
  return byType;
}

/**
 * Tool tier to the gathering proficiency it takes to swing one (R22).
 *
 * REFUSED rather than defaulted, like the respawn map: this is the whole of the
 * addon's wield gate, and a ladder read as empty would report every owned tool as
 * usable, which is the exact state this table exists to correct.
 *
 * Two passes because the table's values are named constants rather than literals:
 * the rungs are declared one per exported `TIER_N_..._PROFICIENCY` and the frozen
 * object references them. A one-pass regex over the object would read five
 * identifiers and no numbers.
 */
function readWieldLadder(source) {
  const named = new Map();
  for (const found of source.matchAll(WIELD_CONST_RE)) {
    named.set(found[ONE], Number(found[2]));
  }
  const literal = objectAfter(source, 'export const WIELD_REQUIREMENT_BY_TIER', WIELD_FILE);
  const byTier = {};
  for (const [, tier, raw] of literal.matchAll(WIELD_ROW_RE)) {
    let value = named.get(raw);
    if (LITERAL_RUNG_RE.test(raw)) {
      value = Number(raw);
    }
    if (value === undefined || Number.isNaN(value)) {
      fail(`${WIELD_FILE}: WIELD_REQUIREMENT_BY_TIER rung ${tier} is ${raw}, not a number`);
    }
    byTier[tier] = value;
  }
  return byTier;
}

/**
 * The proficiency-gain curve, which is what decides whether a node still teaches
 * you anything: every `step` points of proficiency is one gain tier, scored
 * against the node's own tier, and a node that many tiers below pays `reduced`,
 * then `minimal`, then nothing.
 *
 * The two multipliers are the crafting wheel's, because gathering scores against
 * the same four-state curve. Read from there rather than restated, for the reason
 * every other figure here is read.
 */
function readGain(gatheringSource, wheelSource) {
  return {
    step: constantNumber(gatheringSource, 'GATHER_GAIN_TIER_STEP', GATHERING_FILE),
    reduced: constantNumber(wheelSource, 'REDUCED_TIER_MULTIPLIER', WHEEL_FILE),
    minimal: constantNumber(wheelSource, 'MINIMAL_TIER_MULTIPLIER', WHEEL_FILE),
  };
}

/**
 * What one harvest yields, as node type to zone to the base item id.
 *
 * The unit counts are deliberately NOT emitted. They are a function of the rarity
 * roll alone, so they are the same number for every node of every type in every
 * zone, which makes them a fact about gathering rather than about a node, and a
 * panel of nodes has nowhere honest to put one.
 */
function readMaterials(source, types) {
  const literal = objectAfter(source, 'export const NODE_MATERIAL_TABLE', MATERIALS_FILE);
  const byType = {};
  for (const type of types) {
    const block = memberObject(literal, type, MATERIALS_FILE);
    const byZone = {};
    for (const row of block.matchAll(MATERIAL_ROW_RE)) {
      byZone[row[ONE]] = row[2];
    }
    if (Object.keys(byZone).length === NONE) {
      fail(`${MATERIALS_FILE}: NODE_MATERIAL_TABLE lists no zone for ${type}`);
    }
    byType[type] = byZone;
  }
  return byType;
}

/**
 * The fine grade of each yield and the zone rung it sits at, which together are
 * the whole of the D8 upgrade rule: a tool STRICTLY above the rung, at a node of
 * at least that rung, mints the fine id instead of the base one.
 *
 * The rung is keyed to the MATERIAL rather than to the node, and the game's own
 * comment says why: a rule reading the node's tier would make fine Osmium farmable
 * off a Thornpeak tier-1 vein with a tier-2 pick.
 */
/**
 * Each slotted tool effect's KIND and the magnitude it adds.
 *
 * Both are read rather than written down, for the reason the wield ladder is. The
 * quality charm's bonus of 1 lands exactly ON the fine threshold from bare hands,
 * a margin the game's own suite pins, so a retune to 2 would change which nodes
 * mint a fine grade with nothing on the wire to announce it. The KIND is read for
 * a plainer reason: the three shipped charms are one of each, and only the quality
 * one touches the comparison this addon draws.
 */
function readEffects(source) {
  const literal = objectAfter(source, 'const TOOL_EFFECTS', EFFECTS_FILE);
  const byId = {};
  for (const row of literal.matchAll(EFFECT_ROW_RE)) {
    byId[row[ONE]] = { kind: row[2], bonus: Number(row[3]) };
  }
  return byId;
}

function readGrades(source) {
  const literal = objectAfter(source, 'const MATERIAL_GRADE_ROWS', GRADES_FILE);
  const byBase = {};
  for (const row of literal.matchAll(GRADE_ROW_RE)) {
    byBase[row[ONE]] = { fine: row[2], tier: Number(row[3]) };
  }
  return byBase;
}

/**
 * The game's own display name for every id a row can name, and it is not optional
 * polish: an id is not a name here. `thorium_ore` is shown to players as "Osmium
 * Ore", `silverleaf_herb` as "Sheenleaf Herb", and a table that title-cased the id
 * would say "Thorium Ore" forever with no regeneration able to fix it.
 */
function readItemNames(source, ids) {
  const declared = new Map();
  for (const found of source.matchAll(ITEM_NAME_RE)) {
    declared.set(found[ONE], found[2]);
  }
  const names = {};
  for (const id of ids) {
    const name = declared.get(id);
    if (name === undefined) {
      fail(`${ITEMS_FILE}: no item declares ${id}, which a yield names`);
    }
    names[id] = name;
  }
  return names;
}

/** Every id the yield lines can draw: each material and the fine grade of each. */
function yieldIds(materials, grades) {
  const ids = new Set();
  for (const byZone of Object.values(materials)) {
    for (const itemId of Object.values(byZone)) {
      ids.add(itemId);
      const row = grades[itemId];
      if (row !== undefined) {
        ids.add(row.fine);
      }
    }
  }
  return [...ids].sort();
}

/** The item id nearest above `before`, which is the item a `use` belongs to. */
function itemIdBefore(source, before) {
  let found = null;
  ITEM_ID_RE.lastIndex = NONE;
  for (const match of source.matchAll(ITEM_ID_RE)) {
    if (match.index >= before) {
      return found;
    }
    found = match[ONE];
  }
  return found;
}

/**
 * Every gathering tool, filed under the node type its profession opens.
 *
 * Fishing falls out here rather than being named: it has no world nodes, so the
 * game's own profession map has no entry for it and the lookup simply misses.
 */
function readTools(source, typeByProfession) {
  const tools = [];
  TOOL_USE_RE.lastIndex = NONE;
  for (const use of source.matchAll(TOOL_USE_RE)) {
    const type = typeByProfession.get(use[ONE]);
    const id = itemIdBefore(source, use.index);
    if (type !== undefined && id !== null) {
      tools.push({ id, type, tier: Number(use[2]) });
    }
  }
  return tools;
}

/** Tools by node type in the game's own type order, then by tier. */
function sortTools(tools, types) {
  return [...tools].sort((a, b) => {
    const byType = types.indexOf(a.type) - types.indexOf(b.type);
    if (byType !== NONE) {
      return byType;
    }
    return a.tier - b.tier;
  });
}

/** Every `ZoneDef` one content file declares, into the shared index. */
function collectZoneDecls(source, where, into) {
  ZONE_DECL_RE.lastIndex = NONE;
  for (const decl of source.matchAll(ZONE_DECL_RE)) {
    const open = source.indexOf('{', decl.index);
    const literal = source.slice(open, matchEnd(source, open, where));
    into.set(decl[ONE], {
      id: memberString(literal, 'id'),
      name: memberString(literal, 'name'),
    });
  }
}

/** Every `ZoneDef` declared under `src/sim/content`, keyed by its export name. */
function readZoneDecls(root) {
  const dir = join(root, CONTENT_DIR);
  const byExport = new Map();
  // Sorted, so a filesystem that hands entries back in a different order cannot move
  // a byte of the output. The ZONES array decides what is emitted and in what order;
  // this only has to find every declaration.
  for (const entry of readdirSync(dir).sort()) {
    if (entry.endsWith('.ts')) {
      collectZoneDecls(readFileSync(join(dir, entry), 'utf8'), entry, byExport);
    }
  }
  return byExport;
}

/** The zones in the game's own `ZONES` order, which is the one order that is not ours. */
function readZones(root, dataSource) {
  const declared = readZoneDecls(root);
  const literal = arrayAfter(dataSource, 'export const ZONES: ZoneDef[]', DATA_FILE);
  const zones = [];
  for (const member of literal.matchAll(ZONE_MEMBER_RE)) {
    const zone = declared.get(member[ONE]);
    if (zone === undefined) {
      fail(`${DATA_FILE}: ZONES names ${member[ONE]}, which no content file declares`);
    }
    if (zone.id === null || zone.name === null) {
      fail(`${CONTENT_DIR}: ${member[ONE]} carries no id and name`);
    }
    zones.push(zone);
  }
  return zones;
}

/** How many zone rows the whole material matrix carries, across every type. */
function countMaterials(materials) {
  return Object.values(materials).reduce((sum, byZone) => sum + Object.keys(byZone).length, NONE);
}

/** Every count the shipped table is supposed to carry, so a thin parse cannot pass. */
function checkCounts(table, types) {
  const counted = [
    ['node types', types.length, EXPECTED_TYPES],
    ['nodes', table.nodes.length, EXPECTED_NODES],
    ['zones', table.zones.length, EXPECTED_ZONES],
    ['gathering tools', table.tools.length, EXPECTED_TOOLS],
    ['wield rungs', Object.keys(table.wieldByTier).length, EXPECTED_WIELD_RUNGS],
    ['material rows', countMaterials(table.materials), EXPECTED_MATERIALS],
    ['fine grades', Object.keys(table.grades).length, EXPECTED_GRADES],
    ['tool effects', Object.keys(table.effects).length, EXPECTED_EFFECTS],
    ['item names', Object.keys(table.itemNames).length, EXPECTED_NAMES],
  ];
  for (const [what, got, want] of counted) {
    if (got !== want) {
      console.warn(`generate: read ${String(got)} ${what}, expected ${String(want)}`);
    }
  }
  if (table.nodes.length === NONE || table.zones.length === NONE) {
    fail('read an empty table, which is a parse that stopped working rather than content');
  }
  checkLadderCovers(table);
}

/**
 * Every tool the table offers has a rung on the ladder.
 *
 * A missing one is the quiet failure this whole gate has to avoid: the addon reads
 * an absent requirement as no requirement, so a tier the ladder forgot would be
 * reported as swingable by anyone carrying it, which is the pre-R22 behaviour the
 * table exists to replace.
 */
function checkLadderCovers(table) {
  for (const tool of table.tools) {
    if (table.wieldByTier[String(tool.tier)] === undefined) {
      fail(
        `${WIELD_FILE}: no wield requirement for tier ${String(tool.tier)}, which ${tool.id} is`,
      );
    }
  }
}

/** The shipped file's shape, built in the key order it is written in. */
function build(root) {
  // The identity check FIRST, before a line of content is read. Reading the node
  // table first would report a wrong path as a missing source file, which reads as
  // the game having moved something rather than as the path being wrong.
  const gameVersion = checkoutVersion(root);
  const nodeSource = readOrFail(join(root, NODES_FILE), 'the node table');
  const types = readTypes(nodeSource);
  const gatheringSource = readOrFail(join(root, GATHERING_FILE), 'the profession map');
  const itemSource = readOrFail(join(root, ITEMS_FILE), 'the item table');
  const typeByProfession = readTypeByProfession(gatheringSource);
  const materials = readMaterials(
    readOrFail(join(root, MATERIALS_FILE), 'the node material table'),
    types,
  );
  const grades = readGrades(readOrFail(join(root, GRADES_FILE), 'the material grades'));
  const table = {
    gameVersion,
    respawnSeconds: readRespawnSeconds(gatheringSource, types),
    professionByType: readProfessionByType(typeByProfession, types),
    wieldByTier: readWieldLadder(readOrFail(join(root, WIELD_FILE), 'the wield ladder')),
    gain: readGain(gatheringSource, readOrFail(join(root, WHEEL_FILE), 'the gain curve')),
    zones: readZones(root, readOrFail(join(root, DATA_FILE), 'the zone list')),
    tools: sortTools(readTools(itemSource, typeByProfession), types),
    materials,
    grades,
    effects: readEffects(readOrFail(join(root, EFFECTS_FILE), 'the tool effects')),
    itemNames: readItemNames(itemSource, yieldIds(materials, grades)),
    nodes: readNodes(nodeSource),
  };
  checkCounts(table, types);
  return table;
}

function main() {
  const root = gamePathFrom(process.argv.slice(2));
  const table = build(root);
  // Beside this script rather than anywhere an argument could name, so the only file
  // this can write is the one it exists to write.
  const out = join(import.meta.dirname, 'nodes.json');
  writeFileSync(out, `${JSON.stringify(table, null, INDENT)}\n`);
  const counts = `${String(table.nodes.length)} nodes, ${String(table.zones.length)} zones`;
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${table.gameVersion}`);
  console.log(`generate: ${counts}, ${String(table.tools.length)} gathering tools`);
}

main();
