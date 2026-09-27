// `pnpm icons`: regenerate the skill-icon union from a deployed game's manifests. Run by hand after
// a game release. Reads LIVE by default; `--host https://pbe.worldofclaudecraft.com` reads pbe.
// A class whose manifest does not answer is a FAILURE, never a skip, so the union cannot silently
// lose names.

import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GENERATED, ICON_CLASSES, iconIds, manifestPath, renderIconTypes } from './icons-core.ts';

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

async function readClass(host, cls) {
  const url = `${host}${manifestPath(cls)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  return [cls, iconIds(await response.json(), cls)];
}

async function main() {
  const host = hostArg();
  const byClass = new Map(await Promise.all(ICON_CLASSES.map((cls) => readClass(host, cls))));

  const source = `${host}${manifestPath('<class>')}`;
  writeFileSync(new URL(GENERATED, `file://${ROOT}`), renderIconTypes(byClass, source));

  const total = new Set([...byClass.values()].flat()).size;
  console.log(
    `icons: wrote ${String(total)} ability ids from ${String(byClass.size)} classes to ${GENERATED}`,
  );
}

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`icons: ${reason(err)}`);
    process.exit(1);
  });
}
