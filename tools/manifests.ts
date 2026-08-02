// Reading addons/<id>/addon.json, for every tool that needs to.
//
// TypeScript rather than .mjs so a Vitest suite can import it directly, the same
// way it imports loader/src/shared/schema.ts. The tools themselves stay .mjs
// entry points and run this under Node's built-in type stripping, which is also
// why every relative import here carries an explicit .ts extension.

import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_MAX_BYTES } from '../loader/src/shared/addon-data.ts';
import { API_VERSION } from '../loader/src/shared/api-version.ts';
import type { AddonManifest, ValidationIssue } from '../loader/src/shared/schema.ts';
import { validateManifest } from '../loader/src/shared/schema.ts';

/** The repository root, with a trailing separator. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const ADDONS_DIR = join(ROOT, 'addons');

type ReadResult =
  | { dir: string; ok: true; manifest: AddonManifest }
  | { dir: string; ok: false; issues: ValidationIssue[] };

/** Every addons/<dir> that contains an addon.json, sorted. */
function addonDirs(): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(ADDONS_DIR, { withFileTypes: true });
  } catch {
    // No addons directory at all is an ordinary state for a fresh clone of a
    // third-party marketplace, not an error.
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      try {
        return statSync(join(ADDONS_DIR, name, 'addon.json')).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * What a preview may weigh.
 *
 * Half a megabyte, and it is a ceiling rather than a target. The manager loads
 * this INSIDE the running game, over whatever connection the player has, so a
 * preview is the one asset here whose size a player pays for at a moment they
 * did not choose. The shipped shots sit at 100 kB and 270 kB; the cap is set
 * where a full-window capture at retina still fits and a lossless export of a
 * whole desktop does not.
 */
const PREVIEW_MAX_BYTES = 524_288;

/** The eight bytes every PNG opens with, as latin1 so it is one literal. */
const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';

const PNG_EXTENSION = '.png';

/**
 * The checks on a declared preview, which are about the FILE rather than the
 * manifest and so cannot live in the schema.
 *
 * PNG is required rather than merely conventional: the README links these
 * directly so GitHub renders them, the site builds its own AVIF and WebP from
 * them, and both of those want one lossless file of record rather than whatever
 * the author's screenshot tool produced. The signature is checked as well as the
 * extension because a renamed JPEG passes an extension test, renders in a
 * browser, and then fails the site build with an error about a decoder.
 */
function previewIssues(dir: string, file: string): ValidationIssue[] {
  const path = join(ADDONS_DIR, dir, file);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return [{ path: 'preview.file', message: `no such file: addons/${dir}/${file}` }];
  }
  const issues: ValidationIssue[] = [];
  if (!file.toLowerCase().endsWith(PNG_EXTENSION)) {
    issues.push({ path: 'preview.file', message: 'must be a .png' });
  }
  if (bytes.subarray(0, PNG_SIGNATURE.length).toString('latin1') !== PNG_SIGNATURE) {
    issues.push({ path: 'preview.file', message: 'is not a PNG, whatever it is named' });
  }
  if (bytes.length > PREVIEW_MAX_BYTES) {
    issues.push({
      path: 'preview.file',
      message: `is ${bytes.length} bytes, over the ${PREVIEW_MAX_BYTES} the manager will load in game`,
    });
  }
  return issues;
}

/**
 * The checks on one declared data file, which are about the FILE rather than the
 * manifest and so cannot live in the schema.
 *
 * Parsed rather than merely stat'd, because the host parses at install: a file
 * that is not JSON is an addon that cannot be installed, and CI is where that
 * should surface rather than in a player's manager. The ceiling is the same
 * constant the host applies, imported rather than repeated.
 *
 * One file per call so the missing-file case can return early. A loop with a
 * `continue` is the shape this would otherwise take, and `noContinue` is on.
 */
function dataFileIssues(dir: string, file: string): ValidationIssue[] {
  const path = join(ADDONS_DIR, dir, file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [{ path: 'data', message: `no such file: addons/${dir}/${file}` }];
  }
  const bytes = Buffer.byteLength(text);
  if (bytes > DATA_MAX_BYTES) {
    return [
      {
        path: 'data',
        message: `${file} is ${bytes} bytes, over the ${DATA_MAX_BYTES} the loader fetches at install`,
      },
    ];
  }
  try {
    JSON.parse(text);
  } catch (err) {
    return [{ path: 'data', message: `${file} is not valid JSON: ${String(err)}` }];
  }
  return [];
}

/**
 * Read, parse, and validate one addon directory.
 *
 * The checks past the schema are the ones a schema cannot express: the id has to
 * match the directory, because the directory is what the index publishes as the
 * path; the apiVersion has to be one this loader implements; and a declared
 * preview has to be a file that is actually there and actually a PNG, and a
 * declared data file has to be there and actually parse.
 */
function readAddon(dir: string): ReadResult {
  const file = join(ADDONS_DIR, dir, 'addon.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { dir, ok: false, issues: [{ path: '', message: `invalid JSON: ${String(err)}` }] };
  }

  const result = validateManifest(parsed);
  if (!result.ok) {
    return { dir, ok: false, issues: result.issues };
  }

  const issues: ValidationIssue[] = [];
  if (result.value.id !== dir) {
    issues.push({ path: 'id', message: `must match the directory name "${dir}"` });
  }
  if (result.value.apiVersion > API_VERSION) {
    issues.push({
      path: 'apiVersion',
      message: `is ${result.value.apiVersion}, but this loader implements ${API_VERSION}`,
    });
  }
  const { preview } = result.value;
  if (preview !== undefined) {
    issues.push(...previewIssues(dir, preview.file));
  }
  for (const declared of result.value.data ?? []) {
    issues.push(...dataFileIssues(dir, declared));
  }
  if (issues.length > 0) {
    return { dir, ok: false, issues };
  }

  return { dir, ok: true, manifest: result.value };
}

/**
 * The file name an addon's own suite has to use.
 *
 * Fixed rather than discovered, so the coverage check is a `statSync` on one path
 * instead of a directory walk deciding what looks like a test, and so every addon
 * directory reads the same way: `addon.json`, `main.js`, `main.test.ts`.
 */
const SUITE_FILE = 'main.test.ts';

/**
 * Whether an addon directory carries its own suite.
 *
 * Here rather than in the suite that asserts it because `noNodejsModules` is not
 * exempt under `tests/**`, which is the same reason this module is TypeScript at
 * all: a Vitest file imports it and lets it do the reading.
 */
function hasSuite(dir: string): boolean {
  try {
    return statSync(join(ADDONS_DIR, dir, SUITE_FILE)).isFile();
  } catch {
    return false;
  }
}

/** The newest addon.json mtime in milliseconds, or 0 when there are none. */
function newestManifestMs(dirs: readonly string[]): number {
  let newest = 0;
  for (const dir of dirs) {
    try {
      newest = Math.max(newest, statSync(join(ADDONS_DIR, dir, 'addon.json')).mtimeMs);
    } catch {
      // Removed between the listing and the stat. The index simply omits it.
    }
  }
  return newest;
}

export type { ReadResult };
export { ADDONS_DIR, addonDirs, hasSuite, newestManifestMs, ROOT, readAddon, SUITE_FILE };
