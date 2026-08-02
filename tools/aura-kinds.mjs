// `pnpm aura-kinds`: regenerate the harmful-aura kind set from a game checkout.
//
// Run by hand after a game release changes the set, not on every build, for the
// same reason `pnpm cues` and `pnpm icons` are not wired in: the answer changes a
// few times a year and the file it writes is the same one every other time.
//
// The third generator here and the FIRST that reads a local checkout rather than
// an endpoint. The classifier is bundled into the play chunk and nothing serves
// it, so there is no URL to point at. That costs the one thing the other two get
// for free: a 404 when the source moves. `--game` is therefore REQUIRED and is
// deliberately never defaulted, a missing file is a failure rather than a
// warning, and the checkout's version is written into both generated headers so
// a reviewer can see which release the set claims to describe.
//
//   pnpm aura-kinds --game /path/to/world-of-claudecraft
//
// Reading is not modifying. The never-modify-the-game rule is untouched.

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  debuffKinds,
  GENERATED_TYPES,
  GENERATED_VALUES,
  renderKindTypes,
  renderKindValues,
  SOURCE,
} from './aura-kinds-core.ts';

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

/**
 * The checkout's own version, which both headers record.
 *
 * A failure rather than an unstamped file: a generator pointed at the wrong
 * directory is exactly the silent failure the parse throws exist to prevent, and
 * a header saying nothing about which release it read is how that goes unnoticed.
 */
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
  const kinds = debuffKinds(read(`${checkout}/${SOURCE}`));
  const version = gameVersion(checkout);

  writeFileSync(new URL(GENERATED_VALUES, `file://${ROOT}`), renderKindValues(kinds, version));
  writeFileSync(new URL(GENERATED_TYPES, `file://${ROOT}`), renderKindTypes(kinds, version));

  console.log(
    `aura-kinds: wrote ${String(kinds.length)} harmful kinds from game ${version} to ` +
      `${GENERATED_VALUES} and ${GENERATED_TYPES}`,
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
