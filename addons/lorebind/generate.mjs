// Regenerate `items.json` from a World of ClaudeCraft checkout.
//
//   node addons/lorebind/generate.mjs --game=/path/to/world-of-claudecraft
//
// WHAT IT READS DIRECTLY, all of it inside the checkout and none of it written to
// (the bundle below then pulls in whatever `data.ts` imports):
//
//   package.json          the game version, stamped into the output
//   src/sim/data.ts       the `ITEMS` merge, which is the table itself, and the
//                         list of content modules merged into it
//   src/sim/item_level.ts and src/sim/item_level_req.ts, for the two numbers the
//                         game DERIVES rather than declares: an item's level and
//                         the character level needed to equip it
//   src/sim/equipment_rules.ts, for the one FLAG it derives the same way:
//                         `isUniqueEquipped`, which no ItemDef carries
//
// It bundles those with esbuild IN MEMORY and imports the result, so what it
// reads is the table the game actually assembles rather than a regex over
// source. That matters because `ITEMS` is a merge of two dozen content modules,
// several of which build their entries programmatically, and a textual scrape
// would silently miss those. The three derivations are called rather than copied
// for the same reason: `requiredLevelFor` reads where an item DROPS, which is a
// second index over the whole of content, and a reimplementation of it here
// would be right on the day it was written. `isUniqueEquipped` is `quality ===
// 'legendary'` today and is a one-line copy anybody would make, which is exactly
// why it is called instead: the game's own comment says it is derived from the
// quality so that a new legendary cannot forget to opt in, and the day that
// stops being how the rule is spelled, a copy here goes on answering the old
// question with no diff to show for it.
//
// WHAT IT EXTRACTS is what the game's own item tooltip draws, plus the two
// prices, which is the whole point of the table: an addon that can only NAME an
// item is a lookup box, and a player opens an item browser to compare two
// helmets. So a row carries the stats, the ratings, the Warfare pair, the
// weapon's damage and speed, the armor class, what a consumable restores, what a
// bag holds, the set it belongs to, whether it is soulbound and whether it is
// unique-equipped, the base id a heroic variant upgrades, the two derived
// levels, and what a vendor and a Quartermaster charge.
//
// The two PRICES are the one deliberate step past the tooltip, which draws
// neither: `sellValue` because no addon API states a price at all and a bag
// panel adding up what it holds is otherwise guessing, and `priceHonor` because
// it is the same fact in the other currency and a Warfare piece has no other
// price to read. `fields` in the output says as much, rather than claiming the
// file is a transcription of the tooltip when it is a little more than one.
//
// WHAT IT STILL DROPS is everything with no reader: the quest binding, the
// no-sell and no-discard flags the client enforces, the pickup denial strings,
// the mount key, weapon procs and set BONUSES.
// The procs and the bonuses are the two worth naming, because they are content a
// player reads: both are structured effect lists whose rendering is a module of
// the game's own, and copying the data without the renderer would put a raw
// shape on screen. They are a candidate for later, not an oversight.
//
// THE GAME PATH IS REQUIRED AND IS NEVER DEFAULTED. Nothing tells you a checkout
// is stale the way a 404 tells you an endpoint moved, so a remembered path is a
// silent way to regenerate against a game nobody is running. It is also checked
// rather than trusted: a directory that is not this game fails loudly instead of
// producing an empty table.
//
// THE OUTPUT IS BYTE-DETERMINISTIC. Ids sorted by code point, fixed key order,
// two-space indent, trailing newline. Re-running against an unchanged checkout
// rewrites the same bytes, so a regeneration that produces no diff proves the
// content did not move and any diff at all is real content.
//
// TWO CONTENT ASSUMPTIONS A GAME RELEASE COULD INVALIDATE, both of which show up
// as output rather than as a crash:
//
//   The KIND vocabulary. `main.js` carries its own copy of the twelve kinds and
//   DROPS a row whose kind is not among them, so a release that adds a thirteenth
//   would quietly shrink the codex. This script prints every distinct kind it
//   saw; compare that against `KINDS` in `main.js` and move both together.
//
//   Quality and slot being OPTIONAL. 96 items declare no quality and 284 no slot
//   at game 0.35.0, and the absence is meaningful rather than a gap to fill in.
//   If a release makes either mandatory, the counts printed here go to zero and
//   the "unknown" rows in the codex disappear on their own.

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
 * Prove the directory really is the game, and hand back its version.
 *
 * Both halves are checked because they fail differently: a path that is not a
 * checkout at all fails on the manifest, and a checkout whose layout has moved
 * fails on the module, and reporting one for the other sends the next person
 * looking in the wrong place.
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

/**
 * The game's `ITEMS`, bundled in memory and imported.
 *
 * `write: false` plus a data URL because this script may write exactly one file
 * and that file is `items.json`. A scratch bundle on disk would be a second one,
 * and it would be somewhere neither this directory nor the caller chose.
 */
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

/**
 * The game's `ITEMS`, its set table, and the three derivations, all imported for real.
 *
 * Four bundles rather than one because they are four entry points of the game's own; each
 * is built in memory and imported, and none of them is written anywhere. `write: false` plus a
 * data URL because this script may write exactly one file and that file is `items.json`.
 */
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

/**
 * Which files the table was actually merged from, in merge order.
 *
 * DERIVED rather than written down, which is the point: a release that adds a
 * zone adds a content module to that argument list, and the next regeneration
 * records it without anybody remembering to.
 */
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
 * The six primary stats, in the game's own order, plus armor.
 *
 * Copied one key at a time rather than spread, because `stats` is a Partial and a spread
 * would carry a key the game adds later into a file whose reader has never heard of it.
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
 * The Warfare pair, which the game keeps as two numbers and DRAWS as one.
 *
 * Both are copied because they are two declarations and the file's job is to hold what the game
 * declares; the one number a reader wants is `Math.min` of them, which is how both the tooltip
 * and the compare arrows work it out, and which cannot be recovered from a single stored min.
 * They are equal on all 47 items that carry them at game 0.35.0, so a min looks like an identity
 * today and is not one.
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
 * What the character has to be to use it, and what it is worth at a vendor.
 *
 * `requiredLevel` is the DERIVED number rather than the declared one, because the declared
 * one is usually absent: the game works it out from where the item drops and only a handful
 * of items pin it. A 1 is dropped like every other zero, since every character is level 1.
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
 * The two facts about an item that are about WHICH ITEM IT IS rather than about what it does.
 *
 * `heroicOf` is the base id a heroic dungeon variant upgrades, and it is the only thing in the
 * game that ties two identically NAMED rows together: the game resolves a variant's display name
 * to its base's unchanged, so `direfang_quiver` and `heroic_direfang_quiver` both read "Direfang
 * Quiver" and 63 pairs in the table do the same. Without it a reader has an id prefix to guess
 * from, and guessing an id out of a string is the mistake this whole file exists to make
 * unnecessary.
 *
 * `uniqueEquipped` is asked of the game rather than worked out, for the reason in the header,
 * and is written only where it is true: `false` on 825 rows would be a fact nobody reads.
 */
function identityOf(row, def, derive) {
  put(row, 'heroicOf', def.heroicOf);
  if (derive.isUniqueEquipped(def) === true) {
    row.uniqueEquipped = true;
  }
}

/**
 * One item, in the one key order the file uses.
 *
 * Every field is written only where the game declares or derives one. Absent is a different
 * answer from empty: 96 items carry no quality, most carry no stats, and a row filling either
 * in would put a fact on screen the game never stated.
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
 * Biome's own formatter, run over the rendered file.
 *
 * `JSON.stringify` and Biome disagree about exactly one thing, and it took a row with an
 * array in it to find out: stringify expands every array one element per line and Biome
 * collapses one that fits inside the line width, so `requiredClass` came out four lines long
 * and `pnpm check` failed on a file this script had just written. Reimplementing that rule
 * here would be a second formatter to keep in step with the real one, so the real one is what
 * runs. It is the same binary `pnpm lint` calls.
 */
function formatted(json) {
  return execFileSync('pnpm', ['exec', 'biome', 'format', '--stdin-file-path=items.json'], {
    input: json,
    encoding: 'utf8',
  });
}

/**
 * The file, in the shape Biome's JSON formatter prints, because anything else fails
 * `pnpm check`. `name` still gets its own line, so a RENAME, which is the diff this
 * table exists to make visible at all, stays a one-line diff.
 */
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

/**
 * A function rather than a run of top-level statements.
 *
 * Module-scope bindings named `source`, `version` and `rows` are shadowed by the
 * parameters of nearly every function above, and the names are right in both
 * places; keeping the script body in its own scope is what lets them stay right.
 */
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
