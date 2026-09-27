// Regenerate `floors.json` from a World of ClaudeCraft checkout.
//
//   node addons/ledgerline/generate.mjs --game=/path/to/world-of-claudecraft
//   node addons/ledgerline/generate.mjs --game /path/to/world-of-claudecraft
//
// `ItemDef.sellValue` is the only absolute price in the game and is on no wire: a vendor pays a
// flat `sellValue * count` (`src/sim/items.ts`), so a listing priced under it is risk-free. If
// `sellItem` ever gains a modifier, every floor here is silently wrong; re-read that formula on a
// release that touches vendors.
//
// Reads `package.json` (the stamped version) and `src/sim/data.ts` (`ITEMS` and `NPCS`), bundled
// with esbuild in memory and imported: several content modules build items programmatically, so a
// textual scrape would miss them.
//
// Three fields only; every other item fact belongs to `lorebind`. `noVendorSell` voids the floor
// and must be emitted, or the addon promises a vendor sale nobody will take. `buyValue` is a
// ceiling only where a non-dev NPC stocks the id, because `buyItem` checks `vendorItems` before
// the price. Vendor row gates are advisory and are not consulted.
//
// Items the server refuses to list (quest, `noMarketList`, soulbound; `src/sim/market.ts`) are
// dropped, as is a row with none of the three fields.
//
// `--game` is required and never defaulted: a remembered path silently regenerates against a
// stale checkout. Output is byte-deterministic (code point order, Biome's formatter), so any diff
// is real.

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

/** Resolved against this script, not the cwd. */
const OUTPUT = join(import.meta.dirname, 'floors.json');

function fail(message) {
  console.error(`generate: ${message}`);
  exit(1);
}

/** Accepts `--game=<path>` and `--game <path>`: the wrong form reads as a missing flag. */
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
 * Prove the directory is the game and return its version. Not-a-checkout and moved-layout are
 * reported separately so the error points at the right cause.
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

/** Bundled in memory (`write: false` plus a data URL): `floors.json` is the only file written. */
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

/** Every item id a non-dev NPC sells. Empty fails: it means `vendorItems` moved. */
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
 * One row, or null. `noVendorSell` is emitted alone too: it refuses a claim, where a missing row
 * only means "unknown".
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

/** Biome's own formatter: `JSON.stringify` output fails `pnpm lint` on short objects. */
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

/** Counts to read after a release, since a changed vendor formula shows up only here. */
function report(rows) {
  const floors = rows.filter((row) => row.sellValue !== undefined).length;
  const ceilings = rows.filter((row) => row.buyValue !== undefined).length;
  const refused = rows.filter((row) => row.noVendorSell === true).length;
  console.log(`generate: ${String(rows.length)} listable items carry a price fact`);
  console.log(`generate: ${String(floors)} a vendor floor, ${String(ceilings)} a shop ceiling`);
  console.log(`generate: ${String(refused)} refuse a vendor sale, so they have no floor at all`);
}

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
