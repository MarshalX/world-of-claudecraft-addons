// Validate every addons/<id>/addon.json against the shared schema, the same
// module the host uses at install time.
//
// The reading lives in manifests.ts so the dev server and the index generator
// agree with this, and so a Vitest suite can drive it. This file is the CLI.

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { addonDirs, readAddon } from './manifests.ts';

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
