// Regenerate marketplace.json from addons/<id>/addon.json.
//
// Run by CI on any push touching addons/**. Never hand-edit marketplace.json.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateIndex } from '../loader/src/shared/schema.ts';
import { addonDirs, readAddon } from './manifests.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'marketplace.json');
const MS_PER_SECOND = 1000;

/** The index timestamp: a --timestamp=<unix seconds> argument, else now. */
function generatedAt() {
  const arg = process.argv.find((value) => value.startsWith('--timestamp='));
  if (arg === undefined) {
    return new Date().toISOString();
  }
  return new Date(Number(arg.slice('--timestamp='.length)) * MS_PER_SECOND).toISOString();
}

function build() {
  const addons = [];
  for (const dir of addonDirs()) {
    const result = readAddon(dir);
    if (!result.ok) {
      console.error(`index: ${dir} is invalid, run "pnpm validate" for detail`);
      process.exit(1);
    }
    addons.push({ ...result.manifest, path: `addons/${dir}` });
  }

  const index = {
    schema: 1,
    name: 'Official Marketplace',
    maintainer: 'MarshalX',
    // Stamped from the commit when CI passes --timestamp, so rebuilding the same
    // commit is byte-identical and produces no diff.
    generated: generatedAt(),
    addons,
  };

  // Validate the generated index too, so a generator bug fails here rather than
  // shipping a broken index.
  const check = validateIndex(index);
  if (!check.ok) {
    console.error('index: generated marketplace.json failed validation');
    for (const issue of check.issues) {
      console.error(`  ${issue.path || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  writeFileSync(OUT, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`index: wrote marketplace.json with ${addons.length} addon(s)`);
}

build();
