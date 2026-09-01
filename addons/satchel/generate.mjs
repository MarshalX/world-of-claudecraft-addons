// Regenerates addons/satchel/bags.json from a World of ClaudeCraft checkout.
//
//   node addons/satchel/generate.mjs --game=/path/to/world-of-claudecraft
//   node addons/satchel/generate.mjs --game /path/to/world-of-claudecraft
//
// The checkout is REQUIRED and never defaulted, and both argument forms are accepted because
// the generators in this tree disagree about which one they take.
//
// A carried inventory is TWO pools: a general one (the backpack plus every unrestricted bag) and
// a materials one (every `materialsOnly` bag) that only the game's own material taxonomy may
// occupy. The bank's split rides the wire; the carried one is derived per render
// (src/ui/bags_view.ts carriedPools) and stored nowhere, so this table carries the two facts
// behind it: which bag ids are materials-only and how many slots each adds, and which item ids
// are materials.
//
// EVERYTHING IS READ THROUGH THE GAME'S OWN EXPORTS over vite's SSR loader, never parsed out of
// source text: `MATERIAL_ITEM_IDS` is a derivation over nine content tables and the game says a
// `kind` approximation over-includes, and the bag predicates are the game's own so a restriction
// that moves to another field needs no change here.
//
// NOTHING FALLS BACK. A missing export is a hard stop naming what was lost, because a generator
// that writes what it found is a stale table under a green run.
//
// EVERY LIST IS A LIST OF OBJECTS. Biome collapses an array of primitives that fits the line and
// `JSON.stringify` expands it, so a bare `["a", "b"]` loops between generate and `pnpm fix` with
// no resting state. Check with: generate, `pnpm fix`, generate, compare.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

/** What the checkout's own package.json has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

const DATA_MODULE = '/src/sim/data.ts';
const BAGS_MODULE = '/src/sim/bags.ts';
const POOLS_MODULE = '/src/sim/bag_pools.ts';
const MATERIALS_MODULE = '/src/sim/material_ids.ts';
const OUT_FILE = 'bags.json';

const SOURCE_NOTE =
  'src/sim/data.ts (ITEMS), src/sim/bags.ts (BACKPACK_SLOTS, BAG_SOCKETS), ' +
  'src/sim/bag_pools.ts (isMaterialsOnlyBag, bagSlotsOf), ' +
  'src/sim/material_ids.ts (MATERIAL_ITEM_IDS)';

const NONE = 0;
const ONE = 1;
const INDENT = 2;

/**
 * Floors, not counts: what these catch is a read that has quietly gone empty, which is what a
 * renamed content export looks like. The materials-only floor is about the feature rather than
 * the read: at zero, the pool split has left the game.
 */
const MIN_BAGS = ONE;
const MIN_MATERIALS_ONLY_BAGS = ONE;
const MIN_MATERIALS = ONE;

function fail(message) {
  console.error(`generate: ${message}`);
  process.exit(ONE);
}

/** The checkout to read, in either argument form. Never guessed. */
function gamePathFrom(args) {
  const joined = args.find((arg) => arg.startsWith('--game='));
  if (joined !== undefined) {
    const path = joined.slice('--game='.length);
    if (path.length === NONE) {
      return fail('--game= is empty. Pass the world-of-claudecraft checkout to read from.');
    }
    return path;
  }
  const at = args.indexOf('--game');
  if (at === -ONE) {
    return fail('no --game=<path>. Pass the world-of-claudecraft checkout to read from.');
  }
  const next = args[at + ONE];
  if (next === undefined || next.length === NONE) {
    return fail('--game is empty. Pass the world-of-claudecraft checkout to read from.');
  }
  return next;
}

/**
 * Prove the path is the game before loading a module out of it, by package name rather than
 * by a directory's presence: a wrong path holding a `src` fails in the module graph and reads
 * as the game having moved something.
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
 * The game's own modules, through its own module graph. `configFile: false`: running the game's
 * plugin chain to read four modules ties this script to its build pipeline.
 */
async function loadModules(root) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    return {
      data: await server.ssrLoadModule(DATA_MODULE),
      bags: await server.ssrLoadModule(BAGS_MODULE),
      pools: await server.ssrLoadModule(POOLS_MODULE),
      materials: await server.ssrLoadModule(MATERIALS_MODULE),
    };
  } catch (err) {
    return fail(`could not load the game's modules from ${root}: ${String(err)}`);
  } finally {
    await server.close();
  }
}

function exportedFunction(module, name, where) {
  const value = module[name];
  if (typeof value !== 'function') {
    return fail(`${where} no longer exports a ${name} function`);
  }
  return value;
}

function exportedCount(module, name, where) {
  const value = module[name];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= NONE) {
    return fail(`${where} no longer exports ${name} as a positive whole number of slots`);
  }
  return value;
}

function itemTable(data) {
  const items = data.ITEMS;
  if (typeof items !== 'object' || items === null) {
    return fail(`${DATA_MODULE} no longer exports an ITEMS table`);
  }
  return items;
}

/**
 * Every bag the game defines, with what it adds and to which pool, through the game's own
 * predicates rather than a field read here. Never infer slots from the quality tier: the game
 * lets a rare 16-slot bag out-slot an epic 14-slot one.
 */
function bagRows(items, isMaterialsOnlyBag, bagSlotsOf) {
  const rows = [];
  for (const def of Object.values(items)) {
    if (def?.kind === 'bag') {
      const slots = bagSlotsOf(def);
      if (!Number.isInteger(slots) || slots <= NONE) {
        fail(`${String(def.id)} is a bag and bagSlotsOf answers ${String(slots)} for it`);
      }
      rows.push({
        id: String(def.id),
        name: String(def.name),
        slots,
        materialsOnly: isMaterialsOnlyBag(def) === true,
      });
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every id the sim treats as a material, from the game's own registry. Read as an iterable,
 * never reconstructed by kind: the game says a kind approximation over-includes.
 */
function materialIds(module) {
  const set = module.MATERIAL_ITEM_IDS;
  if (typeof set !== 'object' || set === null || typeof set.has !== 'function') {
    return fail(`${MATERIALS_MODULE} no longer exports MATERIAL_ITEM_IDS as a set`);
  }
  const ids = [...set].filter((id) => typeof id === 'string' && id.length > NONE);
  return ids.sort((a, b) => a.localeCompare(b));
}

/** A read that has quietly gone empty is the failure this table exists to prevent. */
function checkFloors(bags, materials) {
  if (bags.length < MIN_BAGS) {
    fail(`ITEMS holds no kind 'bag' items at all: the bag table has moved`);
  }
  const restricted = bags.filter((bag) => bag.materialsOnly).length;
  if (restricted < MIN_MATERIALS_ONLY_BAGS) {
    fail('no bag reads as materialsOnly: the pool split this table exists for has moved');
  }
  if (materials.length < MIN_MATERIALS) {
    fail('MATERIAL_ITEM_IDS derived to nothing: one of its content tables has moved');
  }
}

/** Two-space, which is what Biome formats this tree's JSON to. See the header. */
function render(table) {
  return `${JSON.stringify(table, null, INDENT)}\n`;
}

function tableFor(gameVersion, slots, bags, materials) {
  return {
    gameVersion,
    source: SOURCE_NOTE,
    note:
      'The carried pool split. A general pool is backpackSlots plus every non-materialsOnly ' +
      'equipped bag; a materials pool is every materialsOnly one. A non-material item can only ' +
      'take general headroom; a material takes materials headroom first and spills into general. ' +
      'materials lists every id the game counts as one, derived rather than approximated by kind.',
    backpackSlots: slots.backpack,
    bagSockets: slots.sockets,
    bags,
    materials: materials.map((id) => ({ id })),
  };
}

async function main() {
  const root = process.argv.slice(INDENT);
  const gameRoot = gamePathFrom(root);
  const gameVersion = checkoutVersion(gameRoot);
  const loaded = await loadModules(gameRoot);
  const slots = {
    backpack: exportedCount(loaded.bags, 'BACKPACK_SLOTS', BAGS_MODULE),
    sockets: exportedCount(loaded.bags, 'BAG_SOCKETS', BAGS_MODULE),
  };
  const bags = bagRows(
    itemTable(loaded.data),
    exportedFunction(loaded.pools, 'isMaterialsOnlyBag', POOLS_MODULE),
    exportedFunction(loaded.pools, 'bagSlotsOf', POOLS_MODULE),
  );
  const materials = materialIds(loaded.materials);
  checkFloors(bags, materials);
  // Beside this script rather than anywhere an argument could name.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render(tableFor(gameVersion, slots, bags, materials)));
  const restricted = bags.filter((bag) => bag.materialsOnly).length;
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  console.log(
    `generate: backpack ${String(slots.backpack)} plus ${String(slots.sockets)} sockets, ` +
      `${String(bags.length)} bags (${String(restricted)} materials-only), ` +
      `${String(materials.length)} material ids`,
  );
}

await main();
