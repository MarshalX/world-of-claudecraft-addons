// Reading addons/<id>/addon.json, for every tool that needs to.
//
// TypeScript rather than .mjs so a Vitest suite can import it directly, the same
// way it imports loader/src/shared/schema.ts. The tools themselves stay .mjs
// entry points and run this under Node's built-in type stripping, which is also
// why every relative import here carries an explicit .ts extension.

import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 * Read, parse, and validate one addon directory.
 *
 * The two checks past the schema are the ones a schema cannot express: the id
 * has to match the directory, because the directory is what the index publishes
 * as the path, and the apiVersion has to be one this loader implements.
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
  if (issues.length > 0) {
    return { dir, ok: false, issues };
  }

  return { dir, ok: true, manifest: result.value };
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
export { ADDONS_DIR, addonDirs, newestManifestMs, ROOT, readAddon };
