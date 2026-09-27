// `pnpm items`: regenerate the item-icon union from a deployed game's manifest. Run by hand after a
// game release. Reads LIVE by default; `--host https://pbe.worldofclaudecraft.com` reads pbe.

import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GENERATED, itemIconIds, manifestPath, renderItemTypes } from './items-core.ts';

const DEFAULT_HOST = 'https://worldofclaudecraft.com';
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

async function readManifest(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  return itemIconIds(await response.json());
}

async function main() {
  const source = `${hostArg()}${manifestPath()}`;
  const ids = await readManifest(source);

  writeFileSync(new URL(GENERATED, `file://${ROOT}`), renderItemTypes(ids, source));
  console.log(`items: wrote ${String(ids.length)} item ids to ${GENERATED}`);
}

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`items: ${reason(err)}`);
    process.exit(1);
  });
}
