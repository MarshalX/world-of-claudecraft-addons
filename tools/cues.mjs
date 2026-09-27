// `pnpm cues`: regenerate the cue-name union from a deployed game's sound pack. Run by hand after a
// game release. Reads LIVE by default; `--host https://pbe.worldofclaudecraft.com` reads pbe.

import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cueNames, GENERATED, renderCueTypes } from './cues-core.ts';

const DEFAULT_HOST = 'https://worldofclaudecraft.com';
const PACK_PATH = '/audio/sfx/runtime-pack.json';
/** A trailing slash on --host, so the joined URL never doubles it. */
const TRAILING_SLASH = /\/$/;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function hostArg() {
  const at = process.argv.indexOf('--host');
  if (at === -1) {
    return DEFAULT_HOST;
  }
  const given = process.argv[at + 1];
  if (given === undefined) {
    throw new Error('--host needs a value, e.g. --host https://pbe.worldofclaudecraft.com');
  }
  return given.replace(TRAILING_SLASH, '');
}

async function main() {
  const source = `${hostArg()}${PACK_PATH}`;
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`${source} answered ${String(response.status)}`);
  }

  const names = cueNames(await response.json());
  writeFileSync(new URL(GENERATED, `file://${ROOT}`), renderCueTypes(names, source));
  console.log(`cues: wrote ${String(names.length)} cue names to ${GENERATED}`);
}

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`cues: ${reason(err)}`);
    process.exit(1);
  });
}
