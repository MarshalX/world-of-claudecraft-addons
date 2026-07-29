// `pnpm lint`: Biome, failing on info-level findings too.
//
// AGENTS.md says the tree is clean at `--diagnostic-level=info` and that a new
// info finding is a regression. Nothing enforced that: `--diagnostic-level`
// controls what is DISPLAYED, not what fails, and most of the rules that bite
// here (noTernary, useTopLevelRegex, noExcessiveLinesPerFunction, noMagicNumbers)
// report at info. So `pnpm check` passed while findings accumulated, and they
// were discovered in a batch at the end of a change, which is the expensive
// moment: these rules usually want a real split rather than a formatting fix.
//
// The JSON reporter carries the counts, so the decision is exact rather than
// scraped from the rendered output. On the happy path that is the only run;
// Biome renders the diagnostics properly on the second one, when there is
// something to read.
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

/**
 * Biome's own binary, resolved rather than looked up on PATH.
 *
 * Same reason as tools/dev.mjs: `node_modules/.bin` is on PATH under pnpm and
 * not when this file is run directly.
 */
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
 * Not a convenience. `host/boot.ts` imports the bundle with Vite's `?raw`, and
 * Biome's answer about that import flips on whether the file is on disk:
 *
 * - Present: the path exists but the file is git-ignored, and biome.json sets
 *   `vcs.useIgnoreFile`, so it is not in Biome's module graph and
 *   `noUnresolvedImports` fires. The suppression on that line is USED.
 * - Absent: Biome declines to judge a specifier carrying a loader query it
 *   cannot resolve, reports nothing, and the same suppression is UNUSED, which
 *   `suppressions/unused` raises and `--error-on-warnings` turns into a failure.
 *
 * So the same tree passed locally, where a dev build had always run, and failed
 * in CI, which lints before it builds. Ensuring the artifact removes the
 * variable instead of silencing the rule for that file: the rule stays on
 * everywhere, and the suppression stays true in every tree.
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
  // Biome failed before it could report, for instance on a config error. Its
  // own message is the useful output, so hand the run over unchanged.
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
