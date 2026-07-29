// `pnpm dev`: the watch build and the addon dev server, together.
//
// Two processes rather than a task runner dependency. They are independent, they
// both log, and neither is useful without the other during addon work: the watch
// build is what reinstalls the userscript, the server is what serves the addon
// the userscript then loads.
//
// Either one exiting takes the other down. A half-running dev environment is the
// state that wastes the most time, because the symptom is an edit that appears
// to do nothing.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Vite's CLI entry, resolved rather than looked up on PATH.
 *
 * `spawn('vite', ...)` with no shell relies on `node_modules/.bin` being on
 * PATH, which is true under `pnpm dev` and false when this file is run
 * directly: it worked in the one case nobody debugs in. Resolving through the
 * package's own `package.json` is exact, needs no shell, and survives pnpm's
 * symlinked store, where the real files are nowhere near `node_modules/vite`.
 *
 * `require.resolve('vite/bin/vite.js')` would be more direct and does not work:
 * Vite 8's `exports` map does not publish that subpath.
 */
const VITE_CLI = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

/** Both children are `node <script>`, so neither depends on PATH. */
const TASKS = [
  { name: 'build', args: [VITE_CLI, 'build', '--watch'] },
  { name: 'serve', args: [fileURLToPath(new URL('serve.mjs', import.meta.url))] },
];

let stopping = false;

const children = TASKS.map((task) =>
  spawn(process.execPath, task.args, { cwd: ROOT, stdio: 'inherit', shell: false }),
);

/** Stop both, once, whichever of the many ways to get here fired first. */
function stopAll(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exitCode = code;
}

children.forEach((child, index) => {
  const task = TASKS[index];
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`dev: ${task.name} exited (${code ?? 'signal'}), stopping the rest`);
    }
    stopAll(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`dev: could not start ${task.name}:`, err.message);
    stopAll(1);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll(0);
  });
}
