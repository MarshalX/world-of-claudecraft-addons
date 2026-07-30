// `pnpm icons`: regenerate the skill-icon union from a deployed game's manifests.
//
// Run by hand after a game release commits art, not on every build. Nine requests to
// write a file whose answer changes a few times a year, which is the same reason
// `pnpm cues` is not wired into the build either.
//
// It reads the LIVE host by default, because the published types describe what most
// players are running. Point it at pbe with --host to see art before it ships:
// `pnpm icons --host https://pbe.worldofclaudecraft.com`.
//
// One host, not all of them. The channels diverge in both directions (pbe has carried
// 81 ids live did not while live carried one pbe had dropped), so unioning them would
// autocomplete names most players' games have no file for. That costs autocomplete and
// nothing else: the loader reads the manifest from whichever host the player is on, so
// a pbe-only ability still resolves there at run time.
//
// A class in ICON_CLASSES whose manifest does not answer is a FAILURE rather than a
// skip: art moving is the change that would otherwise shrink the union silently, and a
// union that quietly loses names is worse than one that is a release behind.

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
