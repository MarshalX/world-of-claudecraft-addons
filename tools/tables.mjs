// `pnpm tables`: regenerate every committed addon data table from a game checkout and say which of
// them actually MOVED. A stale table raises no error anywhere, so this is the only safeguard.
//
//   pnpm tables --game /path/to/world-of-claudecraft
//   pnpm tables --game /path/to/world-of-claudecraft --dry-run
//
// `--dry-run` restores every table afterwards. The generators disagree on the --game spelling, so
// each is tried both ways; a real failure is therefore reported as the second spelling's error,
// and running that generator directly shows the actual cause.

import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { classifyTable, exitCodeFor, renderReport } from './tables-core.ts';

/** A trailing slash on --game, so the joined path never doubles it. */
const TRAILING_SLASH = /\/$/;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADDONS = join(ROOT, 'addons');

const GENERATOR = 'generate.mjs';
const OUTPUT_LIMIT_BYTES = 67_108_864;
const ERROR_TAIL_LINES = 4;

const run = promisify(execFile);

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function gameArg() {
  const at = process.argv.indexOf('--game');
  const joined = process.argv.find((arg) => arg.startsWith('--game='));
  if (at === -1 && joined === undefined) {
    throw new Error(
      '--game is required and has no default: this reads a CHECKOUT rather than an endpoint, ' +
        'so nothing will 404 to tell you a table is stale. Pass the game repository root.',
    );
  }
  let given = process.argv[at + 1];
  if (at === -1) {
    given = joined.slice('--game='.length);
  }
  if (given === undefined || given === '') {
    throw new Error('--game needs a value, e.g. --game /path/to/world-of-claudecraft');
  }
  const checkout = given.replace(TRAILING_SLASH, '');
  if (!statSync(checkout, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game is not a readable directory: ${checkout}`);
  }
  return checkout;
}

function generators() {
  return readdirSync(ADDONS)
    .map((id) => ({ id, script: join(ADDONS, id, GENERATOR) }))
    .filter(({ script }) => statSync(script, { throwIfNoEntry: false })?.isFile() === true);
}

/** Every .json in the addon's directory except the manifest, read as bytes. */
function tablesOf(id) {
  const dir = join(ADDONS, id);
  const files = readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'addon.json');
  return new Map(files.map((name) => [join(dir, name), readFileSync(join(dir, name), 'utf8')]));
}

async function generate(script, checkout) {
  const attempts = [
    [script, `--game=${checkout}`],
    [script, '--game', checkout],
  ];
  let last = null;
  for (const args of attempts) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: the two spellings are one fallback chain, so the second must not start until the first has failed.
      await run(process.execPath, args, { cwd: ROOT, maxBuffer: OUTPUT_LIMIT_BYTES });
      return null;
    } catch (err) {
      last = err;
    }
  }
  const text = String(last?.stderr || reason(last)).trim();
  return text.split('\n').slice(-ERROR_TAIL_LINES).join(' | ');
}

function compare(id, before, dryRun) {
  const rows = [];
  for (const [path, previous] of before) {
    const current = readFileSync(path, 'utf8');
    const state = classifyTable(previous, current);
    rows.push({ id, table: `${id}/${basename(path)}`, state, note: '' });
    if (dryRun && current !== previous) {
      writeFileSync(path, previous);
    }
  }
  // A table that did not exist before is new content, not a no-op.
  for (const path of tablesOf(id).keys()) {
    if (!before.has(path)) {
      rows.push({ id, table: `${id}/${basename(path)}`, state: 'content', note: '(new file)' });
    }
  }
  return rows;
}

async function readOne({ id, script }, checkout, dryRun) {
  const before = tablesOf(id);
  const failure = await generate(script, checkout);
  if (failure !== null) {
    return [{ id, table: `${id}/*.json`, state: 'error', note: failure }];
  }
  return compare(id, before, dryRun);
}

async function main() {
  const checkout = gameArg();
  const dryRun = process.argv.includes('--dry-run');
  const found = generators();
  if (found.length === 0) {
    throw new Error(`no addons/*/${GENERATOR} found under ${ADDONS}`);
  }
  const rows = [];
  for (const entry of found) {
    // biome-ignore lint/performance/noAwaitInLoops: the generators share one working tree and one holds the whole item table in memory, so they run serially by design.
    rows.push(...(await readOne(entry, checkout, dryRun)));
  }
  console.log(renderReport(rows));
  return exitCodeFor(rows);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (err) {
    console.error(`tables: ${reason(err)}`);
    process.exit(1);
  }
}
