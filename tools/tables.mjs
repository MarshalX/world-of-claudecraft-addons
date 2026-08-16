// `pnpm tables`: regenerate every committed addon data table from a game
// checkout and say which of them actually MOVED.
//
// Run by hand after a game release, for the reason `pnpm aura-kinds` is: it
// reads a CHECKOUT rather than an endpoint, so nothing will 404 to tell you a
// table is stale. That is the whole point of it. Game 0.35.0 re-sited 18 gather
// nodes in one editorial pass, and nothing on the wire says a node moved, no
// request fails, and no test can catch it: the player walks to a marker and
// finds an empty field. Regenerating and reading the diff is the only safeguard
// there is, and the stamp in each table's header is the only thing on disk that
// says how old its claims are.
//
//   pnpm tables --game /path/to/world-of-claudecraft
//   pnpm tables --game /path/to/world-of-claudecraft --dry-run
//
// `--dry-run` restores every table afterwards, for the reading alone.
//
// It answers three states, and the middle one decides a version bump. A table
// whose CONTENT moved needs its addon's version bumped, because an addon changed
// without a bump is an addon changed for nobody. A table whose STAMP alone moved
// must not be bumped, because that ships a download saying nothing changed.
//
// The two --game spellings in the tree disagree (`--game=` for most of the
// generators, `--game ` for some) and the wrong one trips a required-argument
// error that reads as a missing flag rather than a wrong one, so this tries both
// before believing a failure.
//
// Reading is not modifying. The never-modify-the-game rule is untouched.

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
  // A generator writing a table that did not exist before is a new table rather
  // than a silent no-op, so say so rather than letting it pass unmentioned.
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
    // biome-ignore lint/performance/noAwaitInLoops: the generators share one working tree and one of them holds the whole item table in memory, so these run serially by design rather than for want of a Promise.all.
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
