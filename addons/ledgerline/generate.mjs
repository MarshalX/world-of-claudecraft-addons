// Regenerate `floors.json` from a World of ClaudeCraft checkout.
//
//   node addons/ledgerline/generate.mjs --game=/path/to/world-of-claudecraft
//   node addons/ledgerline/generate.mjs --game /path/to/world-of-claudecraft
//
// WHAT IT IS FOR. The Merchant's market has no price history and no reference
// price, so every figure ledgerline draws is inferred from pages its player
// happened to browse. There is exactly ONE absolute price in the game, and it is
// not on any wire: `ItemDef.sellValue`, what a vendor pays for the item, applied
// as a flat `sellValue * count` with no haggling (`src/sim/items.ts`). That makes
// a listing priced under it the only risk-free trade the game contains, and this
// table is what lets an addon see one.
//
// WHAT IT READS, all of it inside the checkout and none of it written to:
//
//   package.json     the game version, stamped into the output
//   src/sim/data.ts  the `ITEMS` merge, which is the table itself, and `NPCS`,
//                    which is what proves a shop price is a real ceiling
//
// Bundled with esbuild IN MEMORY and imported, so what it reads is the table the
// game assembles rather than a regex over source. `ITEMS` merges two dozen
// content modules and several build their entries programmatically, so a textual
// scrape would silently miss those.
//
// THREE FIELDS AND NO MORE. `sellValue` is the floor. `buyValue` is the vendor's
// shop price, which is a CEILING: an ask above it can never sell, because the
// buyer walks to the vendor instead. `noVendorSell` is what voids the floor, and
// it is the field whose absence would make this table lie: a vendor refuses to
// buy those items, and without the flag the addon would promise guaranteed profit
// on a stack nobody will take. Every other item fact belongs to `lorebind`, which
// already ships the whole catalogue; duplicating it here would be a second copy
// to keep in step for no reader.
//
// A `buyValue` IS NOT A CEILING ON ITS OWN, which is the trap this script exists
// to close. `buyItem` gates on `npc.vendorItems.includes(itemId)` before it ever
// reads the price (`src/sim/items.ts`), so an item can declare a shop price that
// no counter in the world stocks, and calling that a ceiling would tell a player
// their listing can never sell when nobody can buy the thing anywhere else. So
// the price is emitted only where some NPC actually stocks the id, read from
// `NPCS` out of the same bundle. The dev vendor is excluded: it sells its stock
// for free and only on a dev-command realm, so its rows are a ceiling of zero on
// a realm nobody plays. Vendor ROW GATES are deliberately not consulted, because
// they are advisory by design and every counter sells ahead freely
// (`src/sim/content/vendor_row_gates.ts`).
//
// WHAT IT DROPS is anything that can never reach the market at all. The server
// refuses to list a quest item, a `noMarketList` item and a soulbound one, on
// both listing paths (`src/sim/market.ts`), so a floor for one of those could
// never be read. It also drops a row that would carry nothing usable: no
// `sellValue`, no `buyValue` and no `noVendorSell` is an item this addon has
// nothing to say about, and a lookup miss already means "no floor known".
//
// THE GAME PATH IS REQUIRED AND IS NEVER DEFAULTED. Nothing tells you a checkout
// is stale the way a 404 tells you an endpoint moved, so a remembered path is a
// silent way to regenerate against a game nobody is running. BOTH argument forms
// are accepted, because the six generators in this repository had drifted into
// two and passing the wrong one trips the required-argument error, which reads as
// a missing flag rather than a wrong one.
//
// THE OUTPUT IS BYTE-DETERMINISTIC. Ids sorted by code point, fixed key order,
// Biome's own formatter over the result. Re-running against an unchanged checkout
// rewrites the same bytes, so a regeneration with no diff proves content did not
// move and any diff at all is real.
//
// ONE CONTENT ASSUMPTION A RELEASE COULD INVALIDATE, and it shows up as output
// rather than as a crash: that a vendor pays a flat per-unit price. The day
// `sellItem` grows a modifier, every floor here is still a number and is no
// longer the number a vendor pays. The counts printed at the end are what to
// read; the formula is in `src/sim/items.ts` and is worth re-reading on a
// release that touches vendors.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

/** What the checkout's own `package.json` has to call itself to be the game. */
const GAME_PACKAGE_NAME = 'world-of-claudecraft';

/** The module that assembles the table, relative to the checkout root. */
const DATA_MODULE = join('src', 'sim', 'data.ts');

/** The module the exclusion rule is read from, quoted in the output's `fields`. */
const MARKET_MODULE = join('src', 'sim', 'market.ts');

/** The one file this script writes, resolved against ITSELF rather than the cwd. */
const OUTPUT = join(import.meta.dirname, 'floors.json');

function fail(message) {
  console.error(`generate: ${message}`);
  exit(1);
}

/**
 * The checkout path, which is required and is never guessed.
 *
 * Both `--game=<path>` and `--game <path>`, because this repository's generators
 * ship both spellings and the wrong one fails as though the flag were missing.
 */
function gamePathFrom(args) {
  const joined = args.find((arg) => arg.startsWith('--game='));
  if (joined !== undefined) {
    const path = joined.slice('--game='.length);
    if (path !== '') {
      return path;
    }
  }
  const at = args.indexOf('--game');
  if (at >= 0) {
    const path = args[at + 1] ?? '';
    if (path !== '' && !path.startsWith('-')) {
      return path;
    }
  }
  return fail('pass --game=/path/to/world-of-claudecraft. It is never defaulted.');
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
 * and that file is `floors.json`. A scratch bundle on disk would be a second one,
 * and it would be somewhere neither this directory nor the caller chose.
 */
async function readGame(gamePath) {
  const esbuild = await import('esbuild');
  const built = await esbuild.build({
    entryPoints: [join(gamePath, DATA_MODULE)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const code = built.outputFiles[0]?.text ?? '';
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const data = await import(url);
  const items = data.ITEMS;
  if (typeof items !== 'object' || items === null) {
    fail(`${DATA_MODULE} exported no ITEMS record.`);
  }
  const npcs = data.NPCS;
  if (typeof npcs !== 'object' || npcs === null) {
    fail(`${DATA_MODULE} exported no NPCS record, so no shop price can be proved to be one.`);
  }
  return { items, stocked: stockedBy(npcs) };
}

/**
 * Every item id some counter in the world actually sells. See the header.
 *
 * Empty is a FAILURE rather than an answer: the field moving would leave every shop ceiling
 * silently unemitted, which reads on screen as a game that stopped selling anything.
 */
function stockedBy(npcs) {
  const stocked = new Set();
  for (const npc of Object.values(npcs)) {
    if (npc.devVendor !== true && Array.isArray(npc.vendorItems)) {
      for (const itemId of npc.vendorItems) {
        if (typeof itemId === 'string' && itemId !== '') {
          stocked.add(itemId);
        }
      }
    }
  }
  if (stocked.size === 0) {
    fail('no NPC stocks anything. NpcDef.vendorItems has moved.');
  }
  return stocked;
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

/** Whether the server would refuse to list this at all. See the header. */
function unlistable(def) {
  return def.kind === 'quest' || def.noMarketList === true || def.soulbound === true;
}

/** A price the game declares, or nothing. Zero is dropped: a floor of zero is no floor. */
function price(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return null;
}

/** A shop price is a ceiling only where a counter stocks the id. See the header. */
function shopCeiling(id, def, stocked) {
  if (!stocked.has(id)) {
    return null;
  }
  return price(def.buyValue);
}

/**
 * One row, or null for an item this addon has nothing to say about.
 *
 * `noVendorSell` is emitted even with no `sellValue` beside it, because it is the
 * field that REFUSES a claim: an addon reading a row with only that flag on it
 * knows not to promise a vendor sale, and an addon reading no row at all knows
 * only that it does not know.
 */
function rowOf(id, def, stocked) {
  if (unlistable(def)) {
    return null;
  }
  const sellValue = price(def.sellValue);
  const buyValue = shopCeiling(id, def, stocked);
  const refused = def.noVendorSell === true;
  if (sellValue === null && buyValue === null && !refused) {
    return null;
  }
  const row = { id };
  if (sellValue !== null) {
    row.sellValue = sellValue;
  }
  if (buyValue !== null) {
    row.buyValue = buyValue;
  }
  if (refused) {
    row.noVendorSell = true;
  }
  return row;
}

function rowsOf(game) {
  return Object.keys(game.items)
    .sort(byCodePoint)
    .map((id) => rowOf(id, game.items[id], game.stocked))
    .filter((row) => row !== null);
}

/**
 * Biome's own formatter, run over the rendered file.
 *
 * `JSON.stringify` and Biome disagree about whether a short object stays on one
 * line, so a file this script had just written would fail `pnpm check`.
 * Reimplementing that rule here would be a second formatter to keep in step with
 * the real one, so the real one is what runs. Same binary `pnpm lint` calls.
 */
function formatted(json) {
  return execFileSync('pnpm', ['exec', 'biome', 'format', '--stdin-file-path=floors.json'], {
    input: json,
    encoding: 'utf8',
  });
}

function render(gameVersion, rows) {
  const fields =
    'the three item facts that decide what a market listing is worth against something other ' +
    'than another listing: sellValue, the flat per-unit copper a vendor pays, which is the only ' +
    'absolute price in the game; buyValue, the vendor shop price, present ONLY where some NPC ' +
    'actually stocks the id, which makes it a ceiling an ask above can never sell over; and ' +
    'noVendorSell, which voids the floor. An item the server refuses to list (quest, ' +
    'noMarketList, soulbound) is absent, as is one declaring none of the three. See ' +
    `${MARKET_MODULE} for the listing gate.`;
  const file = { gameVersion, generatedFrom: [DATA_MODULE], fields, items: rows };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** What a release could change without breaking anything here. See the header. */
function report(rows) {
  const floors = rows.filter((row) => row.sellValue !== undefined).length;
  const ceilings = rows.filter((row) => row.buyValue !== undefined).length;
  const refused = rows.filter((row) => row.noVendorSell === true).length;
  console.log(`generate: ${String(rows.length)} listable items carry a price fact`);
  console.log(`generate: ${String(floors)} a vendor floor, ${String(ceilings)} a shop ceiling`);
  console.log(`generate: ${String(refused)} refuse a vendor sale, so they have no floor at all`);
}

/**
 * A function rather than a run of top-level statements, so the module-scope names
 * this script would otherwise take are free for the parameters that want them.
 */
async function main() {
  const gamePath = gamePathFrom(argv.slice(2));
  const version = gameVersionAt(gamePath);
  const rows = rowsOf(await readGame(gamePath));
  if (rows.length === 0) {
    fail('no item declared a price. The ItemDef price fields have moved.');
  }
  writeFileSync(OUTPUT, formatted(render(version, rows)), 'utf8');
  report(rows);
  console.log(`generate: wrote ${OUTPUT} from game ${version}`);
}

await main();
