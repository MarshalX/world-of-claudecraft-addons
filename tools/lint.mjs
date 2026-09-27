// `pnpm lint`: Biome, failing on info-level findings too. `--diagnostic-level` controls what is
// DISPLAYED, not what fails, and most of the rules that bite here report at info, so the verdict
// comes from the JSON reporter's counts. A second run renders the diagnostics when there are any.
//
// Takes paths: `pnpm lint loader/src/host/fetcher.ts` while writing that file.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import process, { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

/** Biome's JSON report over the whole tree runs to a few megabytes. */
const MAX_REPORT_MB = 64;
const BYTES_PER_MB = 1_048_576;
const MAX_REPORT_BYTES = MAX_REPORT_MB * BYTES_PER_MB;

/** More than anyone reads in one pass, and enough that the count is not a lie. */
const MAX_SHOWN = 200;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

/** Biome's own binary, resolved: `node_modules/.bin` is on PATH only under pnpm. */
const BIOME = require.resolve('@biomejs/biome/bin/biome');

/** The paths to check: whatever was passed, or the whole tree. */
function targetPaths() {
  const given = argv.slice(2);
  if (given.length > 0) {
    return given;
  }
  return ['.'];
}

/** The runtime bundle host/boot.ts imports, and the script that writes it. */
const RUNTIME_ARTIFACT = fileURLToPath(
  new URL('../loader/src/generated/runtime.iife.js', import.meta.url),
);
const BUILD_RUNTIME = fileURLToPath(new URL('../loader/build-runtime.mjs', import.meta.url));

/**
 * Build the runtime bundle if it is missing, because the lint verdict depends on it.
 *
 * `host/boot.ts` imports the git-ignored bundle with `?raw`. Present, `noUnresolvedImports` fires
 * and the suppression on that line is used; absent, Biome reports nothing and the suppression is
 * UNUSED, which fails the run. Ensuring the file keeps the suppression true in every tree.
 */
function ensureRuntimeArtifact() {
  if (existsSync(RUNTIME_ARTIFACT)) {
    return;
  }
  const built = spawnSync(process.execPath, [BUILD_RUNTIME], { cwd: ROOT, encoding: 'utf8' });
  if (built.status === 0) {
    return;
  }
  stderr.write(`lint: could not build the runtime bundle first\n${built.stderr ?? ''}\n`);
  exit(built.status ?? 1);
}

ensureRuntimeArtifact();

const paths = targetPaths();
const FLAGS = ['check', '--error-on-warnings', '--diagnostic-level=info'];

const probe = spawnSync(process.execPath, [BIOME, ...FLAGS, '--reporter=json', ...paths], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: MAX_REPORT_BYTES,
});

if (probe.error) {
  stderr.write(`lint: could not run Biome: ${probe.error.message}\n`);
  exit(1);
}

let summary;
try {
  ({ summary } = JSON.parse(probe.stdout));
} catch {
  // Biome failed before it could report (a config error, say); its own message is the output.
  stderr.write(probe.stderr);
  exit(probe.status ?? 1);
}

const found = summary.errors + summary.warnings + summary.infos;
if (found === 0) {
  stdout.write(`lint: clean across ${String(summary.unchanged + summary.changed)} files\n`);
  exit(0);
}

// Re-run so Biome renders the diagnostics itself, with its source excerpts.
const show = spawn(
  process.execPath,
  [BIOME, ...FLAGS, `--max-diagnostics=${String(MAX_SHOWN)}`, ...paths],
  {
    cwd: ROOT,
    stdio: 'inherit',
  },
);
show.on('exit', () => {
  stderr.write(
    `\nlint: ${String(summary.errors)} error(s), ${String(summary.warnings)} warning(s), ` +
      `${String(summary.infos)} info(s). All three are regressions here. See STYLE.md.\n`,
  );
  exit(1);
});
