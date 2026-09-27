// `pnpm dev`: the watch build and the addon dev server, together. Either one exiting takes the
// other down, since a half-running environment shows up as an edit that appears to do nothing.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Vite's CLI entry, resolved rather than looked up on PATH, which only holds under `pnpm dev`.
 * `require.resolve('vite/bin/vite.js')` fails: Vite's `exports` map does not publish that subpath.
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

/** Stop both, once. */
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
