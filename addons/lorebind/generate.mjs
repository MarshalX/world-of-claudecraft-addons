// Regenerate `items.json` from a World of ClaudeCraft checkout.
//
//   node addons/lorebind/generate.mjs --game=/path/to/world-of-claudecraft
//
// It reads `package.json` (the version stamp), `src/sim/data.ts` (the `ITEMS` merge), and the
// three modules behind what the game DERIVES rather than declares: `item_level.ts`,
// `item_level_req.ts` and `equipment_rules.ts` (`isUniqueEquipped`). Nothing in the checkout is
// written to.
//
// Each is bundled with esbuild in memory and imported, so the table is what the game actually
// assembles: several content modules build entries programmatically and a textual scrape would
// miss them. The derivations are called rather than copied, because a copy keeps answering the
// old rule after the game changes how it is spelled, with no diff to show for it.
//
// A row carries what the game's item tooltip draws plus `sellValue` and `priceHonor`, which the
// tooltip does not; `fields` in the output says so. Dropped for having no reader: the quest
// binding, the no-sell and no-discard flags, pickup denial strings, the mount key, weapon procs
// and set bonuses. Procs and bonuses are effect lists the game renders with its own module, so
// copying the data without the renderer would put a raw shape on screen.
//
// The game path is required and never defaulted, and it is checked: a directory that is not
// this game fails loudly instead of producing an empty table.
//
// The output is byte-deterministic (ids in code point order, fixed key order), so any diff after
// a regeneration is real content.
//
// Two content assumptions a release can break silently, which the printed report is for:
//
//   KINDS. `main.js` drops a row whose kind is not in its own `KINDS`, so a new kind quietly
//   shrinks the codex. Compare the printed kinds against it and move both together.
//
//   Quality and slot are OPTIONAL and their absence is meaningful. If a release makes either
//   mandatory the printed counts go to zero and the codex's "unknown" rows disappear.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

/** What the checkout's own `package.json` has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

/** The module that assembles the table, relative to the checkout root. */
const DATA_MODULE = join('src', 'sim', 'data.ts');

/** The three pure leaves behind what the game derives rather than declares. Bundled alongside. */
const LEVEL_MODULE = join('src', 'sim', 'item_level.ts');
const LEVEL_REQ_MODULE = join('src', 'sim', 'item_level_req.ts');
const EQUIP_RULES_MODULE = join('src', 'sim', 'equipment_rules.ts');

/** Where `data.ts` sits, for resolving the relative specifiers it imports. */
const SIM_DIR = 'src/sim';

/** The one file this script writes, resolved against ITSELF rather than the cwd. */
const OUTPUT = join(import.meta.dirname, 'items.json');

/** `import { A, B } from './x'`, including the multi-line form. */
const IMPORT_RE = /import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g;

/** The `ITEMS` assignment, whose argument list is the merge order. */
const MERGE_RE = /export const ITEMS[^=]*=\s*mergeItems\(([\s\S]*?)\);/;

/** A bare identifier, for reading both of the lists above. */
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;

/** The leading `./` on a relative specifier. Hoisted for `useTopLevelRegex`. */
const LEADING_DOT_RE = /^\.\//;

function fail(message) {
  console.error(`generate: ${message}`);
  exit(1);
}

/** The checkout path, which is required and is never guessed. */
function gamePathFrom(args) {
  const flag = args.find((arg) => arg.startsWith('--game='));
  const path = flag?.slice('--game='.length) ?? '';
  if (path === '') {
    fail('pass --game=/path/to/world-of-claudecraft. It is never defaulted.');
  }
  return path;
}

/**
 * Prove the directory is the game and hand back its version. The manifest and the module are
 * checked separately so "not a checkout" and "layout moved" are reported as what they are.
 */
function gameVersionAt(gamePath) {
  const manifest = join(gamePath, 'package.json');
  if (!existsSync(manifest)) {
    fail(`${gamePath} has no package.json, so it is not a game checkout.`);
  }
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (parsed.name !== GAME_PACKAGE_NAME) {
    fail(`${gamePath} is "${String(parsed.name)}", not ${GAME_PACKAGE_NAME}.`);
  }
  if (!existsSync(join(gamePath, DATA_MODULE))) {
    fail(`${gamePath} has no ${DATA_MODULE}. The game's layout has moved.`);
  }
  const { version } = parsed;
  if (typeof version !== 'string' || version === '') {
    fail(`${manifest} declares no version to stamp the table with.`);
  }
  return version;
}

/** One game module, bundled in memory and imported: `items.json` is the only file written. */
async function bundle(gamePath, entry) {
  const esbuild = await import('esbuild');
  const built = await esbuild.build({
    entryPoints: [join(gamePath, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const code = built.outputFiles[0]?.text ?? '';
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return await import(url);
}

/** The game's `ITEMS`, its set table, and the three derivations, one bundle per entry point. */
async function readGame(gamePath) {
  const data = await bundle(gamePath, DATA_MODULE);
  const level = await bundle(gamePath, LEVEL_MODULE);
  const levelReq = await bundle(gamePath, LEVEL_REQ_MODULE);
  const rules = await bundle(gamePath, EQUIP_RULES_MODULE);
  const items = data.ITEMS;
  if (typeof items !== 'object' || items === null) {
    fail(`${DATA_MODULE} exported no ITEMS record.`);
  }
  if (typeof levelReq.requiredLevelFor !== 'function' || typeof level.itemLevel !== 'function') {
    fail('the item level modules no longer export requiredLevelFor and itemLevel.');
  }
  if (typeof rules.isUniqueEquipped !== 'function') {
    fail(`${EQUIP_RULES_MODULE} no longer exports isUniqueEquipped.`);
  }
  const sets = data.ITEM_SETS;
  if (typeof sets !== 'object' || sets === null) {
    fail(`${DATA_MODULE} no longer re-exports ITEM_SETS, so a set has no name.`);
  }
  return {
    items,
    sets,
    itemLevel: level.itemLevel,
    requiredLevelFor: levelReq.requiredLevelFor,
    isUniqueEquipped: rules.isUniqueEquipped,
  };
}

/** Identifier to the module specifier it was imported from, across `data.ts`. */
function importSources(source) {
  const sources = new Map();
  for (const [, names, specifier] of source.matchAll(IMPORT_RE)) {
    for (const name of names.match(IDENTIFIER_RE) ?? []) {
      sources.set(name, specifier);
    }
  }
  return sources;
}

/** A specifier as `data.ts` writes it, as a path from the checkout root. */
function repoPath(specifier) {
  if (!specifier.startsWith('.')) {
    return specifier;
  }
  return `${SIM_DIR}/${specifier.replace(LEADING_DOT_RE, '')}.ts`;
}

/** Which files the table was merged from, in merge order, so a new content module is recorded. */
function provenanceFrom(source) {
  const merge = MERGE_RE.exec(source);
  if (merge === null) {
    fail(`${DATA_MODULE} no longer assigns ITEMS from mergeItems().`);
  }
  const sources = importSources(source);
  const seen = new Set([`${DATA_MODULE} (the ITEMS merge)`]);
  for (const name of merge[1].match(IDENTIFIER_RE) ?? []) {
    const specifier = sources.get(name);
    if (specifier !== undefined) {
      seen.add(repoPath(specifier));
    }
  }
  return [...seen];
}

/** Code point order, so the ordering cannot follow anybody's locale. */
function byCodePoint(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Copy a field only where the game declares one, so absent stays absent. */
function put(row, key, value) {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    row[key] = value;
  }
  if (typeof value === 'string' && value !== '') {
    row[key] = value;
  }
}

/**
 * The six primary stats, in the game's order, plus armor. Copied key by key: a spread would
 * carry a stat the game adds later into a file whose reader has never heard of it.
 */
const STAT_KEYS = ['str', 'agi', 'sta', 'int', 'spi', 'armor'];

function statsOf(def) {
  const stats = {};
  for (const key of STAT_KEYS) {
    const value = def.stats?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      stats[key] = value;
    }
  }
  if (Object.keys(stats).length === 0) {
    return null;
  }
  return stats;
}

/**
 * The Warfare pair, which the game keeps as two numbers and draws as their `Math.min`. Both are
 * stored because they are two declarations; they happen to be equal today, which does not make
 * the min an identity.
 */
function warfareOf(def) {
  const row = {};
  put(row, 'pvpOffenseRating', def.pvpOffenseRating);
  put(row, 'pvpDefenseRating', def.pvpDefenseRating);
  if (Object.keys(row).length === 0) {
    return null;
  }
  return row;
}

/** The three combat ratings and spell power, which sit beside `stats` rather than in it. */
function ratingsOf(def) {
  const row = {};
  put(row, 'spellPower', def.spellPower);
  put(row, 'critRating', def.critRating);
  put(row, 'hasteRating', def.hasteRating);
  put(row, 'hitRating', def.hitRating);
  if (Object.keys(row).length === 0) {
    return null;
  }
  return row;
}

/** What a consumable gives back, in the four fields the game keeps them in. */
function restoresOf(def) {
  const row = {};
  put(row, 'foodHp', def.foodHp);
  put(row, 'drinkMana', def.drinkMana);
  put(row, 'potionHp', def.potionHp);
  put(row, 'potionMana', def.potionMana);
  if (def.elixir !== undefined) {
    row.elixir = { aura: def.elixir.aura, value: def.elixir.value, duration: def.elixir.duration };
  }
  if (Object.keys(row).length === 0) {
    return null;
  }
  return row;
}

/** A weapon's swing, without the dagger flag, which gates an ability rather than reading. */
function weaponOf(def) {
  const { weapon } = def;
  if (weapon === undefined) {
    return null;
  }
  return { min: weapon.min, max: weapon.max, speed: weapon.speed };
}

/**
 * What the character has to be to use it. `requiredLevel` is the DERIVED number, since the
 * declared one is usually absent; a 1 is dropped because every character is at least level 1.
 */
function gatesOf(def, derive) {
  const row = {};
  const level = derive.requiredLevelFor(def);
  if (level > 1) {
    row.requiredLevel = level;
  }
  if (Array.isArray(def.requiredClass) && def.requiredClass.length > 0) {
    row.requiredClass = [...def.requiredClass];
  }
  if (Object.keys(row).length === 0) {
    return null;
  }
  return row;
}

/**
 * Which item this is. `heroicOf` is the only link between a heroic variant and its base, which
 * share a display name. `uniqueEquipped` is asked of the game and written only where true.
 */
function identityOf(row, def, derive) {
  put(row, 'heroicOf', def.heroicOf);
  if (derive.isUniqueEquipped(def) === true) {
    row.uniqueEquipped = true;
  }
}

/**
 * One item, in the file's one key order. A field is written only where the game declares or
 * derives one: absent differs from empty, and filling it in states a fact the game never did.
 */
function rowOf(id, def, derive) {
  const row = { id, name: def.name, kind: def.kind };
  put(row, 'quality', def.quality);
  put(row, 'slot', def.slot);
  put(row, 'armorType', def.armorType);
  identityOf(row, def, derive);
  put(row, 'itemLevel', derive.itemLevel(def));
  const stats = statsOf(def);
  if (stats !== null) {
    row.stats = stats;
  }
  const warfare = warfareOf(def);
  if (warfare !== null) {
    Object.assign(row, warfare);
  }
  const ratings = ratingsOf(def);
  if (ratings !== null) {
    Object.assign(row, ratings);
  }
  const weapon = weaponOf(def);
  if (weapon !== null) {
    row.weapon = weapon;
  }
  put(row, 'blockValue', def.blockValue);
  const restores = restoresOf(def);
  if (restores !== null) {
    Object.assign(row, restores);
  }
  put(row, 'bagSlots', def.bagSlots);
  const gates = gatesOf(def, derive);
  if (gates !== null) {
    Object.assign(row, gates);
  }
  put(row, 'set', derive.sets[def.set]?.name);
  if (def.soulbound === true) {
    row.soulbound = true;
  }
  put(row, 'sellValue', def.sellValue);
  put(row, 'priceHonor', def.priceHonor);
  return row;
}

function rowsOf(game) {
  const derive = {
    itemLevel: game.itemLevel,
    requiredLevelFor: game.requiredLevelFor,
    isUniqueEquipped: game.isUniqueEquipped,
    sets: game.sets,
  };
  return Object.keys(game.items)
    .sort(byCodePoint)
    .map((id) => rowOf(id, game.items[id], derive));
}

/**
 * Biome's own formatter over the rendered file. `JSON.stringify` expands every array while
 * Biome collapses one that fits the line, so unformatted output fails `pnpm check`; running
 * the real formatter avoids keeping a second copy of its rule.
 */
function formatted(json) {
  return execFileSync('pnpm', ['exec', 'biome', 'format', '--stdin-file-path=items.json'], {
    input: json,
    encoding: 'utf8',
  });
}

/** The file. `name` gets its own line, so a rename stays a one-line diff. */
function render(gameVersion, provenance, rows) {
  const fields =
    "what the game's own item tooltip draws, plus the two prices it does not: id, name and kind " +
    'always, then quality, slot, armorType, heroicOf, uniqueEquipped, itemLevel, stats, ' +
    'pvpOffenseRating, pvpDefenseRating, spellPower, critRating, hasteRating, hitRating, weapon, ' +
    'blockValue, foodHp, drinkMana, potionHp, potionMana, elixir, bagSlots, requiredLevel, ' +
    'requiredClass, set, soulbound, sellValue and priceHonor wherever the game declares or ' +
    'derives one';
  const file = { gameVersion, generatedFrom: provenance, fields, items: rows };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** What a release could change without breaking anything here. See the header. */
function report(rows) {
  const kinds = [...new Set(rows.map((row) => row.kind))].sort(byCodePoint);
  const noQuality = rows.filter((row) => row.quality === undefined).length;
  const noSlot = rows.filter((row) => row.slot === undefined).length;
  const withStats = rows.filter((row) => row.stats !== undefined).length;
  const withLevel = rows.filter((row) => row.itemLevel !== undefined).length;
  const heroic = rows.filter((row) => row.heroicOf !== undefined).length;
  const unique = rows.filter((row) => row.uniqueEquipped === true).length;
  const warfare = rows.filter((row) => row.pvpOffenseRating !== undefined).length;
  console.log(`generate: ${String(rows.length)} items`);
  console.log(`generate: kinds seen, check these against KINDS in main.js: ${kinds.join(', ')}`);
  console.log(`generate: ${String(noQuality)} declare no quality, ${String(noSlot)} no slot`);
  console.log(`generate: ${String(withStats)} carry stats, ${String(withLevel)} an item level`);
  const family = `${String(heroic)} upgrade a base item, ${String(unique)} are unique-equipped`;
  console.log(`generate: ${family}, ${String(warfare)} carry Warfare`);
}

/** A function so `source`, `version` and `rows` stay out of module scope, where params shadow them. */
async function main() {
  const gamePath = gamePathFrom(argv.slice(2));
  const version = gameVersionAt(gamePath);
  const source = readFileSync(join(gamePath, DATA_MODULE), 'utf8');
  const rows = rowsOf(await readGame(gamePath));
  writeFileSync(OUTPUT, formatted(render(version, provenanceFrom(source), rows)));
  report(rows);
  console.log(`generate: wrote ${OUTPUT} for game ${version}`);
}

await main();
