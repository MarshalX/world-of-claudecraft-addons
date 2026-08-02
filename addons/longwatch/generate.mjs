// Regenerates addons/longwatch/rares.json from a World of ClaudeCraft checkout.
//
//   node addons/longwatch/generate.mjs --game=/path/to/world-of-claudecraft
//
// The checkout path is REQUIRED and is never defaulted, for the reason every other
// generator here says so: nothing tells you a stale working tree is stale the way a
// 404 tells you an endpoint moved, so a remembered path is a silent way to rebuild
// the table against a game nobody is running. The target is proved to be the game by
// its package NAME before a line of content is read, and the game's own version is
// stamped into the output rather than typed here.
//
// WHAT IT READS, all of it under the checkout and none of it written to:
//
//   package.json                          the version stamped into the output
//   src/sim/data.ts                       MOBS for the rare flag and the name, CAMPS
//                                         for where each one stands, ZONES and
//                                         `zoneContaining` for which zone that is
//   src/sim/respawn_policy.ts             `resolveRespawnSeconds`, which is the whole
//                                         of the countdown this addon draws
//   src/ui/i18n.resolved.generated/en.ts  the resolved English catalogue, for the
//                                         name cross-check below
//
// IT EVALUATES RATHER THAN PARSES, through vite's SSR module loader, the same way
// `trailmark` and `lorebind` do: `MOBS` and `CAMPS` are merges of two dozen content
// modules and the respawn resolution is a function with a precedence order, not a
// literal. Running that function is the only way to be right about it.
//
// WHICH RARES SHIP, and it is a MECHANICAL test rather than a curated list. A rare
// with no camp has nowhere to be waited for, so a countdown for it would be a number
// with nothing behind it. Today that is exactly four of the game's twenty-three:
// three summoned by the Nythraxis crypt encounter and one miniboss inside a dungeon
// instance. Nothing here names them, because `CAMPS` already says which those are and
// a hand-kept exclusion list would go stale the day one gains a camp.
//
// THE NAME IS CROSS-CHECKED RATHER THAN CHOSEN. `MOBS[id].name` and the catalogue's
// `entities.mobs[id].name` both exist, and today all 221 agree. That is not a given:
// an ABILITY's id and display name have already diverged in this game (`arcane_shot`
// is shown everywhere as "Fell Shot"), and the same drift reaching mobs would put a
// name in this file that no player sees. So both are read and a disagreement is a
// hard failure rather than a silent pick, which is what turns that drift into
// something somebody has to look at on the day it happens.
//
// WHAT A GAME RELEASE COULD INVALIDATE, each of which fails loudly:
//
//  - A rare gains a SECOND camp. The shipped shape is one point and one countdown per
//    rare, and two camps means two spawns the addon would time as one. It refuses
//    rather than taking the first, which would pin the wrong clearing.
//  - A rare appears in a zone this addon cannot express. `main.js` resolves a zone
//    from a POSITION against four rectangles it carries, and `addon.json` lists the
//    same four as the `zones` setting's options; a fifth needs both of those edited,
//    so it stops here rather than shipping a row that could never pass the filter.
//  - The two name sources diverge, as above.
//  - The counts move. A warning, since content growing is the ordinary case, except
//    an empty table, which is a read that stopped working.
//
// DETERMINISTIC. Rows are sorted by id in code point order, keys in a fixed order,
// trailing newline, so re-running against an unchanged checkout produces a byte
// identical file and a real diff means real content moved. Sorted rather than kept in
// the game's own `MOBS` order, which is what `trailmark` does and is right there for a
// reason that does not hold here: that file's order fixes entity ids inside the game,
// while nothing about this one is load-bearing, so the stable choice is the one a
// content reshuffle cannot churn.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

/** What the checkout's own package.json has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

const DATA_MODULE = '/src/sim/data.ts';
const RESPAWN_MODULE = '/src/sim/respawn_policy.ts';
const CATALOGUE_MODULE = '/src/ui/i18n.resolved.generated/en.ts';
const OUT_FILE = 'rares.json';

/** What the shipped file records about where it came from. */
const SOURCE_NOTE =
  'src/sim/data.ts, src/sim/respawn_policy.ts, src/ui/i18n.resolved.generated/en.ts';

/**
 * The zones this addon can express, which is `ZONES` in `main.js` and the `zones`
 * setting's options in `addon.json`.
 *
 * Stated here so a rare in a fifth zone stops the generator rather than shipping a
 * row that `readRare` would drop at run time, in front of a player, with a warning
 * only they would see. All three lists move together or none of them do.
 */
const KNOWN_ZONES = new Set([
  'eastbrook_vale',
  'mirefen_marsh',
  'thornpeak_heights',
  'veiled_hollow',
]);

/** Roughly what the tables carried at game 0.33.1, so a thin read cannot pass. */
const EXPECTED_RARES = 23;
const EXPECTED_CAMPED = 19;

const GAME_ARG = '--game=';
/** Two spaces, which is what biome.json formats every JSON file in this tree to. */
const INDENT = 2;
const NONE = 0;
const ONE = 1;

function fail(message) {
  console.error(`generate: ${message}`);
  process.exit(ONE);
}

/** The same comparator lorebind sorts by, so two data files order ids alike. */
function byCodePoint(a, b) {
  if (a < b) {
    return -ONE;
  }
  if (a > b) {
    return ONE;
  }
  return NONE;
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
 * The package NAME rather than the presence of a directory, because a wrong path that
 * happens to hold a `src` reads as plausible right up until the module graph fails to
 * resolve, and a resolution failure reads as the game having moved something.
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
 * The game's own modules, loaded through its own module graph.
 *
 * `configFile: false` on purpose: the game's vite config is about building the game,
 * and running its plugin chain to read three modules would make this script depend on
 * a build pipeline it has no business knowing about.
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
    const data = await server.ssrLoadModule(DATA_MODULE);
    const respawn = await server.ssrLoadModule(RESPAWN_MODULE);
    const catalogue = await server.ssrLoadModule(CATALOGUE_MODULE);
    return { data, respawn, catalogue };
  } catch (err) {
    return fail(`could not load the game's modules from ${root}: ${String(err)}`);
  } finally {
    await server.close();
  }
}

/**
 * The mob half of the resolved English catalogue.
 *
 * Reached by its documented path rather than searched for, so a bundle that reshapes
 * itself fails here instead of quietly yielding an empty object that would make every
 * name look absent and every cross-check pass.
 */
function mobCatalogue(catalogue) {
  const mobs = catalogue.en?.entities?.mobs;
  if (typeof mobs !== 'object' || mobs === null) {
    return fail(`${CATALOGUE_MODULE} has no en.entities.mobs to check names against`);
  }
  return mobs;
}

/** Every camp, by the mob it holds, in the game's own `CAMPS` order. */
function campsByMob(data) {
  const byMob = new Map();
  for (const camp of data.CAMPS) {
    const held = byMob.get(camp.mobId);
    if (held === undefined) {
      byMob.set(camp.mobId, [camp]);
    } else {
      held.push(camp);
    }
  }
  return byMob;
}

/** The display name both sources agree on, or a hard stop saying they do not. */
function agreedName(id, template, mobs) {
  const shown = mobs[id]?.name;
  if (typeof shown !== 'string' || shown.length === NONE) {
    return fail(`${id} has no name in the English catalogue to check against`);
  }
  if (shown !== template.name) {
    return fail(
      `${id} is "${String(template.name)}" in MOBS and "${shown}" in the catalogue: ` +
        'a mob id and its display name have diverged, which this file cannot paper over',
    );
  }
  return shown;
}

/** One roster row, in the shape `readRare` in main.js checks. */
function rareRow(id, template, camps, deps) {
  if (camps.length > ONE) {
    return fail(
      `${id} has ${String(camps.length)} camps: this roster holds one point and one ` +
        'countdown per rare, and two spawns timed as one would pin the wrong clearing',
    );
  }
  const [camp] = camps;
  const zone = deps.data.zoneContaining(camp.center.x, camp.center.z);
  if (zone === null || zone === undefined || !KNOWN_ZONES.has(zone.id)) {
    return fail(
      `${id} stands in ${String(zone?.id)}, which main.js and addon.json do not carry: ` +
        'both have to gain the zone before this row can ship',
    );
  }
  const respawn = deps.respawn.resolveRespawnSeconds(template, camp.center, undefined);
  if (!Number.isFinite(respawn) || respawn <= NONE) {
    return fail(`${id} resolves to a respawn of ${String(respawn)}, which is not a countdown`);
  }
  return {
    id,
    name: agreedName(id, template, deps.mobs),
    zone: zone.id,
    x: camp.center.x,
    z: camp.center.z,
    respawn,
  };
}

/**
 * Every rare with somewhere to be waited for, sorted by id.
 *
 * A rare with NO camp is left out rather than emitted without a position, which is
 * the one editorial-looking decision here and is not one: `CAMPS` is what says a mob
 * has a home, and a rare summoned by an encounter or standing in a dungeon instance
 * is on no respawn cycle at all.
 */
function rareRows(deps) {
  const byMob = campsByMob(deps.data);
  const rares = Object.entries(deps.data.MOBS).filter(([, template]) => template.rare === true);
  const rows = [];
  let campless = NONE;
  for (const [id, template] of rares) {
    const camps = byMob.get(id) ?? [];
    if (camps.length === NONE) {
      campless += ONE;
    } else {
      rows.push(rareRow(id, template, camps, deps));
    }
  }
  rows.sort((a, b) => byCodePoint(a.id, b.id));
  return { rows, campless };
}

/**
 * Counts, so a table that stopped being read cannot pass quietly.
 *
 * A moved count is a WARNING, because content growing is the ordinary case and a
 * generator that refused every release would be run once. An EMPTY table is a
 * failure: that is a read that stopped working rather than content that moved.
 */
function checkCounts(rows, campless) {
  if (rows.length === NONE) {
    fail('read no rare with a camp at all, which is a read that stopped working');
  }
  const rares = rows.length + campless;
  if (rares !== EXPECTED_RARES) {
    console.warn(
      `generate: read ${String(rares)} rare templates, expected ${String(EXPECTED_RARES)}`,
    );
  }
  if (rows.length !== EXPECTED_CAMPED) {
    console.warn(
      `generate: ${String(rows.length)} of them have a camp, expected ${String(EXPECTED_CAMPED)}`,
    );
  }
}

/**
 * Ordinary two-space JSON, which is what Biome formats this repository's JSON to.
 *
 * Deliberately NOT the one-row-per-line rendering `trailmark` uses. That shape exists
 * to keep a diff readable when rows MOVE, and rows here cannot: they are sorted by id,
 * so a retuned respawn is a one-line diff either way and a new rare is six added
 * lines in one place. Expanded also means `pnpm lint` formats this file like every
 * other JSON in the tree rather than needing an exemption to be left alone.
 */
function render(table) {
  return `${JSON.stringify(table, null, INDENT)}\n`;
}

async function main() {
  const root = gamePathFrom(process.argv.slice(2));
  // The identity check FIRST, before the module graph is touched: a wrong path
  // reported as a resolution failure reads as the game having moved something.
  const gameVersion = checkoutVersion(root);
  const { data, respawn, catalogue } = await loadModules(root);
  const { rows, campless } = rareRows({ data, respawn, mobs: mobCatalogue(catalogue) });
  checkCounts(rows, campless);
  // Beside this script rather than anywhere an argument could name, so the only file
  // this can write is the one it exists to write.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render({ gameVersion, source: SOURCE_NOTE, rares: rows }));
  console.log(`generate: wrote ${out} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  console.log(
    `generate: ${String(rows.length)} rares with a camp, ` +
      `${String(campless)} left out for having none`,
  );
}

await main();
