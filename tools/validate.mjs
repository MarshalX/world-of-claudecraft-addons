// Validate every addons/<id>/addon.json against the shared schema, the same
// module the host uses at install time.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { API_VERSION, validateManifest } from '../loader/src/shared/schema.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADDONS = join(ROOT, 'addons');

function main() {
  const dirs = addonDirs();
  if (dirs.length === 0) {
    console.log('validate: no addons yet, nothing to check');
    return;
  }

  let failed = 0;
  for (const dir of dirs) {
    const result = readAddon(dir);
    if (result.ok) {
      console.log(`  ok    ${dir}  ${result.manifest.name} ${result.manifest.version}`);
    } else {
      failed += 1;
      console.error(`  FAIL  ${dir}`);
      for (const issue of result.issues) {
        console.error(`          ${issue.path || '(root)'}: ${issue.message}`);
      }
    }
  }

  console.log(`validate: ${dirs.length - failed}/${dirs.length} addon manifests valid`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

/** Every addons/<dir> that contains an addon.json. */
export function addonDirs() {
  let entries;
  try {
    entries = readdirSync(ADDONS, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      try {
        return statSync(join(ADDONS, name, 'addon.json')).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Read, parse, and validate one addon directory. */
export function readAddon(dir) {
  const file = join(ADDONS, dir, 'addon.json');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { dir, ok: false, issues: [{ path: '', message: `invalid JSON: ${err.message}` }] };
  }

  const result = validateManifest(parsed);
  if (!result.ok) {
    return { dir, ok: false, issues: result.issues };
  }

  const issues = [];
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
