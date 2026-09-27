// Regenerates addons/longwatch/rares.json and addons/longwatch/mobs.json from a
// World of ClaudeCraft checkout.
//
//   node addons/longwatch/generate.mjs --game=/path/to/world-of-claudecraft
//
// Two tables from one read of `MOBS`: `rares.json` is this addon's roster, and `mobs.json` is
// the rank table it PUBLISHES on the bus (elite, boss, rare, quest-gated), none of which is on
// the wire. One generator, so there is one thing to regenerate on a release.
//
// The checkout path is REQUIRED and never defaulted, since a stale checkout writes a plausible
// table. The target is proved to be the game by package NAME first, and its version is stamped
// into the output.
//
// Reads package.json; src/sim/data.ts (MOBS, CAMPS, ZONES, `zoneContaining`);
// src/sim/respawn_policy.ts (`resolveRespawnSeconds`, the whole countdown); and
// src/ui/i18n.resolved.generated/en.ts (the name cross-check). It EVALUATES rather than parses,
// through vite's SSR module loader, because MOBS and CAMPS are merges and the respawn is a
// function with a precedence order.
//
// Which rares ship is MECHANICAL, never a list of names. A rare with NO CAMP (summoned by an
// encounter, or inside an instance) has nothing to wait for. A rare in NO COVERED ZONE could
// never pass `main.js`'s zone filter, and is skipped and named on stdout rather than failing.
// Scope is judged BEFORE roster shape, so the shape guards below speak only about rares that
// would otherwise ship.
//
// The name is read from both `MOBS[id].name` and the catalogue, and a disagreement is a hard
// failure: ids and display names already diverge for abilities, and a name no player sees
// must not land in the table.
//
// It fails loudly when a carried rare gains a SECOND camp (two spawns cannot be one countdown,
// and taking the first pins the wrong clearing), when a rare straddles a covered and an
// uncovered zone, when the name sources diverge, or when a table comes back empty. Moved counts
// only warn.
//
// Rows are sorted by id in code point order with fixed key order and a trailing newline, so an
// unchanged checkout regenerates byte-identical. Sorted rather than in `MOBS` order because
// nothing here depends on the game's order and a content reshuffle must not churn the diff.

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
const RANKS_FILE = 'mobs.json';

/** What the shipped file records about where it came from. */
const SOURCE_NOTE =
  'src/sim/data.ts, src/sim/respawn_policy.ts, src/ui/i18n.resolved.generated/en.ts';
/** The rank table reads less: no camp, no respawn policy. */
const RANKS_SOURCE_NOTE = 'src/sim/data.ts, src/ui/i18n.resolved.generated/en.ts';

/**
 * The zones this addon can express, matching `ZONES` in `main.js` and the `zones` setting in
 * `addon.json`; the three lists move together. A rare outside them is left out HERE rather than
 * dropped at run time in front of a player.
 *
 * The game's other zones either hold no rare, or hold one this row shape cannot describe
 * (`drakemaw_broodlord` has several camps on a short respawn, up most of the time), so admitting
 * them would add dead options and list nothing.
 */
const KNOWN_ZONES = new Set([
  'eastbrook_vale',
  'mirefen_marsh',
  'thornpeak_heights',
  'veiled_hollow',
]);

/** Rough floors for each table, so a thin read cannot pass. */
const EXPECTED_RARES = 24;
const EXPECTED_CAMPED = 19;
/**
 * The ranked-template floor (elites, rare elites, bosses, plain rares and quest gates together).
 */
const EXPECTED_RANKED = 114;

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
 * The game's modules, loaded through its own module graph. `configFile: false`, because the game's
 * vite config is about building the game and its plugin chain is irrelevant here.
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
 * The mob half of the resolved English catalogue, reached by its documented path so a reshaped
 * bundle fails here rather than yielding an empty object that makes every cross-check pass.
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

/** Whether one camp stands in a zone this addon can place a rare in. */
function inCoveredZone(camp, data) {
  const zone = data.zoneContaining(camp.center.x, camp.center.z);
  return zone !== null && zone !== undefined && KNOWN_ZONES.has(zone.id);
}

/**
 * Which bucket a rare falls in, judged SCOPE FIRST. `covered` carries the camps back rather than a
 * flag, so the caller cannot re-admit a camp this left out.
 */
function placeRare(id, camps, deps) {
  if (camps.length === NONE) {
    return { kind: 'campless' };
  }
  const covered = camps.filter((camp) => inCoveredZone(camp, deps.data));
  if (covered.length === NONE) {
    return { kind: 'offMap' };
  }
  if (covered.length !== camps.length) {
    return fail(
      `${id} has camps both inside and outside the zones this addon carries: ` +
        'nothing here can say which of its clearings to time',
    );
  }
  return { kind: 'covered', camps: covered };
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
  return {
    id,
    name: agreedName(id, template, deps.mobs),
    zone: zone.id,
    x: camp.center.x,
    z: camp.center.z,
    ...respawnBounds(id, template, camp, deps),
  };
}

/**
 * The seconds a row records: a PAIR wherever the game authored a `respawnWindow`, whose multiplier
 * is drawn per death, since pinning one end shows a countdown wrong by the width of the window.
 * `null` as the roll resolves the FLOOR, which is what `respawn` means; the ceiling rolls its own
 * maximum. `respawnMax` is left off a fixed rare.
 *
 * The ceiling is the window's upper bound although the draw is half-open and never reaches it: for
 * "back within" that is late by under a second and never early.
 */
function respawnBounds(id, template, camp, deps) {
  const respawn = deps.respawn.resolveRespawnSeconds(template, camp.center, undefined, null);
  if (!Number.isFinite(respawn) || respawn <= NONE) {
    fail(`${id} resolves to a respawn of ${String(respawn)}, which is not a countdown`);
  }
  if (template.respawnWindow === undefined) {
    return { respawn };
  }
  const respawnMax = deps.respawn.resolveRespawnSeconds(
    template,
    camp.center,
    undefined,
    (_min, max) => max,
  );
  if (!Number.isFinite(respawnMax) || respawnMax <= respawn) {
    fail(
      `${id} carries a respawn window resolving to [${String(respawn)}, ${String(respawnMax)}], ` +
        'which is not a window',
    );
  }
  return { respawn, respawnMax };
}

/**
 * Every rare this addon can place, sorted by id, plus a count of each kind left out. `CAMPS` says a
 * mob has a home and `KNOWN_ZONES` says this addon can place it; neither exclusion is a list of
 * names.
 */
function rareRows(deps) {
  const byMob = campsByMob(deps.data);
  const rares = Object.entries(deps.data.MOBS).filter(([, template]) => template.rare === true);
  const rows = [];
  const offMap = [];
  let campless = NONE;
  for (const [id, template] of rares) {
    const placed = placeRare(id, byMob.get(id) ?? [], deps);
    if (placed.kind === 'campless') {
      campless += ONE;
    }
    if (placed.kind === 'offMap') {
      offMap.push(id);
    }
    if (placed.kind === 'covered') {
      rows.push(rareRow(id, template, placed.camps, deps));
    }
  }
  rows.sort((a, b) => byCodePoint(a.id, b.id));
  offMap.sort(byCodePoint);
  return { rows, campless, offMap };
}

/**
 * Which rank a template carries, or null. `boss` beats `elite`, the order the game's nameplate
 * resolves them in; `rare` is a SEPARATE flag, since a rare elite is ordinary.
 */
function rankOf(template) {
  if (template.boss === true) {
    return 'boss';
  }
  if (template.elite === true) {
    return 'elite';
  }
  return null;
}

/**
 * One rank row, carrying only what an id cannot give. `name` rides every row because ids and
 * display names diverge, and title-casing the id prints a name no player sees. `requiresQuestId`
 * rides here too, so a display can treat a quest-gated mob as inert scenery for anybody not on the
 * quest.
 */
function rankRow(id, template, mobs) {
  const row = { id, name: agreedName(id, template, mobs) };
  const rank = rankOf(template);
  if (rank !== null) {
    row.rank = rank;
  }
  if (template.rare === true) {
    row.rare = true;
  }
  if (typeof template.requiresQuestId === 'string' && template.requiresQuestId.length > NONE) {
    row.requiresQuestId = template.requiresQuestId;
  }
  return row;
}

/**
 * Every template carrying something the wire cannot say, sorted by id. Only flagged templates ship,
 * so an absent id is an ordinary mob; that is safe because this reads the whole of `MOBS` and is
 * complete by construction.
 */
function rankRows(deps) {
  const rows = [];
  for (const [id, template] of Object.entries(deps.data.MOBS)) {
    if (rankOf(template) !== null || template.rare === true || template.requiresQuestId) {
      rows.push(rankRow(id, template, deps.mobs));
    }
  }
  rows.sort((a, b) => byCodePoint(a.id, b.id));
  return rows;
}

/** The same shape of guard the rares get, for the same reason. */
function checkRanks(rows) {
  if (rows.length === NONE) {
    fail('read no elite, boss or rare template at all, which is a read that stopped working');
  }
  if (rows.length !== EXPECTED_RANKED) {
    console.warn(
      `generate: ranked ${String(rows.length)} templates, expected ${String(EXPECTED_RANKED)}`,
    );
  }
}

/**
 * Counts, so a table that stopped being read cannot pass quietly. A moved count WARNS, since
 * content growing is ordinary; an EMPTY table fails, since that is a broken read.
 */
function checkCounts(rows, campless, offMap) {
  if (rows.length === NONE) {
    fail('read no rare with a camp at all, which is a read that stopped working');
  }
  const rares = rows.length + campless + offMap.length;
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
 * Ordinary two-space JSON, as Biome formats it. Rows are sorted by id and never move, so the
 * compact per-row rendering `trailmark` uses buys nothing.
 */
function render(table) {
  return `${JSON.stringify(table, null, INDENT)}\n`;
}

async function main() {
  const root = gamePathFrom(process.argv.slice(2));
  // The identity check FIRST, before the module graph is touched: a wrong path reported as a
  // resolution failure reads as the game having moved something.
  const gameVersion = checkoutVersion(root);
  const { data, respawn, catalogue } = await loadModules(root);
  const deps = { data, respawn, mobs: mobCatalogue(catalogue) };
  const { rows, campless, offMap } = rareRows(deps);
  checkCounts(rows, campless, offMap);
  const ranked = rankRows(deps);
  checkRanks(ranked);
  // Beside this script, never a path an argument could name.
  const out = join(import.meta.dirname, OUT_FILE);
  writeFileSync(out, render({ gameVersion, source: SOURCE_NOTE, rares: rows }));
  const ranksOut = join(import.meta.dirname, RANKS_FILE);
  writeFileSync(ranksOut, render({ gameVersion, source: RANKS_SOURCE_NOTE, mobs: ranked }));
  console.log(`generate: wrote ${out} and ${ranksOut} from ${GAME_PACKAGE_NAME} ${gameVersion}`);
  console.log(`generate: ${String(ranked.length)} templates carry a rank, a rare flag or a gate`);
  console.log(
    `generate: ${String(rows.length)} rares placed, ` +
      `${String(campless)} left out for having no camp, ` +
      `${String(offMap.length)} for standing outside the zones this addon carries`,
  );
  // NAMED rather than counted: a rare left out for its zone is one a new zone would let in, so
  // which ones is on screen for whoever decides that.
  if (offMap.length > NONE) {
    console.log(`generate: outside them: ${offMap.join(', ')}`);
  }
}

await main();
