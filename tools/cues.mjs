// `pnpm cues`: regenerate the cue-name union from a deployed game's sound pack.
//
// Run by hand after a game release adds a cue, not on every build. The pack is
// 119 kB over the network and the answer changes a few times a year, so wiring
// it into the build would spend a request per build to write the same file.
//
// It reads the LIVE host by default, because the published types describe what
// most players are running. Point it at pbe with --host to pick up a cue before
// it ships: `pnpm cues --host https://pbe.worldofclaudecraft.com`.

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
