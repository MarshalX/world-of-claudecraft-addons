// `pnpm aura-kinds`: regenerate the aura classifier sets from a game CHECKOUT. By hand, after a
// game release changes them.
//
//   pnpm aura-kinds --game /path/to/world-of-claudecraft
//
// Nothing serves the classifier, so nothing 404s when the checkout is stale: `--game` is required
// and never defaulted, a missing file fails, and the checkout's version is stamped into both
// headers.

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { undispellableIds } from './aura-ids-core.ts';
import {
  debuffKinds,
  GENERATED_TYPES,
  GENERATED_VALUES,
  renderKindTypes,
  renderKindValues,
  SOURCE,
} from './aura-kinds-core.ts';
import { PERSISTENT, toggleRule } from './aura-toggle-core.ts';

/** A trailing slash on --game, so the joined path never doubles it. */
const TRAILING_SLASH = /\/$/;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function gameArg() {
  const at = process.argv.indexOf('--game');
  if (at === -1) {
    throw new Error(
      '--game is required and has no default: this reads a CHECKOUT rather than an endpoint, ' +
        'so nothing will 404 to tell you it is stale. Pass the game repository root.',
    );
  }
  const given = process.argv[at + 1];
  if (given === undefined) {
    throw new Error('--game needs a value, e.g. --game /path/to/world-of-claudecraft');
  }
  return given.replace(TRAILING_SLASH, '');
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`${path} could not be read: ${reason(err)}`, { cause: err });
  }
}

/** The checkout's own version, stamped into both headers. Missing is a failure. */
function gameVersion(checkout) {
  const parsed = JSON.parse(read(`${checkout}/package.json`));
  const version = parsed?.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`${checkout}/package.json declares no version`);
  }
  return version;
}

function main() {
  const checkout = gameArg();
  // One read for both parses, so the two sets cannot describe two states of the source.
  const source = read(`${checkout}/${SOURCE}`);
  const kinds = debuffKinds(source);
  const ids = undispellableIds(source);
  // The toggle rule's third term lives in a second file; read both before writing anything.
  const rule = toggleRule(source, read(`${checkout}/${PERSISTENT}`));
  const version = gameVersion(checkout);

  writeFileSync(
    new URL(GENERATED_VALUES, `file://${ROOT}`),
    renderKindValues(kinds, ids, version, rule),
  );
  writeFileSync(new URL(GENERATED_TYPES, `file://${ROOT}`), renderKindTypes(kinds, version));

  console.log(
    `aura-kinds: wrote ${String(kinds.length)} harmful kinds, ` +
      `${String(ids.length)} undispellable ids, and a toggle rule of ` +
      `${String(rule.kinds.length)} kinds, ${String(rule.ids.length)} ids and ` +
      `${String(rule.timed.length)} timed overrides from game ${version} to ` +
      `${GENERATED_VALUES}, and the harmful kinds to ${GENERATED_TYPES}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`aura-kinds: ${reason(err)}`);
    process.exit(1);
  }
}
