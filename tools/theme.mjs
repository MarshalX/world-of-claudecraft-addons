// `pnpm theme`: regenerate the stage's game-token stylesheet from a deployed game.
//
// Run by hand after a game release changes the palette, not on every build, for
// the same reason `pnpm cues`, `pnpm icons` and `pnpm items` are: the answer
// changes a few times a year and wiring it into the build would spend two
// requests per build to rewrite one file.
//
// It reads the LIVE host by default, because a preview screenshot is a picture of
// what most players are running. Point it at pbe with --host to pick up a palette
// change early: `pnpm theme --host https://pbe.worldofclaudecraft.com`.
//
// The stylesheet URL is content-hashed, so this reads `play.html` and follows the
// `<link rel="stylesheet">` it finds. Both sheets are read and merged in document
// order, which is what the browser does with them.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  borrowedRules,
  GENERATED,
  renderTheme,
  rootTokens,
  stylesheetUrls,
  unbackedTokens,
} from './theme-core.ts';

const DEFAULT_HOST = 'https://worldofclaudecraft.com';
const PLAY_PATH = '/play.html';
/** A trailing slash on --host, so the joined URL never doubles it. */
const TRAILING_SLASH = /\/$/;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOADER_CSS_DIR = new URL('../loader/src/runtime/ui/styles/', import.meta.url);

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

async function text(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  return await response.text();
}

/** Every loader stylesheet as one string, which is how index.ts concatenates them. */
function loaderCss() {
  return readdirSync(LOADER_CSS_DIR)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(new URL(name, LOADER_CSS_DIR), 'utf8'))
    .join('\n');
}

/**
 * Say which loader tokens the game no longer declares, without failing.
 *
 * A warning rather than an error because the loader is what would have to change
 * and this tool only reads. It is still the only place the drift is visible: a
 * `var()` with no fallback and no token resolves to nothing, so the symptom is one
 * declaration quietly not applying.
 */
function reportDrift(tokens) {
  const missing = unbackedTokens(loaderCss(), tokens);
  if (missing.length > 0) {
    console.warn(
      `theme: the loader reads ${missing.join(', ')} with no fallback, ` +
        'and the game no longer declares it. Those rules now resolve to nothing.',
    );
  }
}

async function main() {
  const host = hostArg();
  const page = await text(`${host}${PLAY_PATH}`);
  const urls = stylesheetUrls(page);
  if (urls.length === 0) {
    throw new Error(`${host}${PLAY_PATH} links no same-origin stylesheet`);
  }

  const sheets = await Promise.all(urls.map((url) => text(`${host}${url}`)));
  const all = sheets.join('\n');
  const tokens = rootTokens(all);
  const rules = borrowedRules(all);
  const source = `${host}${PLAY_PATH} via ${urls.join(', ')}`;
  writeFileSync(new URL(GENERATED, `file://${ROOT}`), renderTheme(tokens, rules, source));
  reportDrift(tokens);
  console.log(
    `theme: wrote ${String(tokens.size)} game tokens and ` +
      `${String(rules.length)} borrowed-class rules to ${GENERATED}`,
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
    console.error(`theme: ${reason(err)}`);
    process.exit(1);
  });
}
