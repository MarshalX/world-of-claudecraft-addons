// Reading addons/<id>/addon.json, for every tool that needs to. TypeScript so a Vitest suite can
// import it; the .mjs entry points run it under Node's type stripping.

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
    // A fresh third-party marketplace may have no addons directory yet.
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

/** What a preview may weigh. The manager loads it inside the running game, so it is capped. */
const PREVIEW_MAX_BYTES = 524_288;

/** The eight bytes every PNG opens with, as latin1 so it is one literal. */
const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';

const PNG_EXTENSION = '.png';

/**
 * The checks on a declared preview FILE, which the schema cannot express. The signature is checked
 * as well as the extension because a renamed JPEG renders in a browser and then fails the site build.
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
 * The checks on one declared data FILE. Parsed rather than stat'd because the host parses at
 * install, so a file that is not JSON is an addon that cannot be installed.
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
 * Read, parse, and validate one addon directory. Past the schema: the id must match the directory,
 * which the index publishes as the path, and the apiVersion must be one this loader implements.
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

/** The file name an addon's own suite has to use. */
const SUITE_FILE = 'main.test.ts';

/** Whether an addon directory carries its own suite. Here because `tests/**` cannot use `node:fs`. */
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
      // Removed between the listing and the stat.
    }
  }
  return newest;
}

export type { ReadResult };
export { ADDONS_DIR, addonDirs, hasSuite, newestManifestMs, ROOT, readAddon, SUITE_FILE };
