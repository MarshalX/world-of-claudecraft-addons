// Bundle the addon stage into one IIFE for `stage/index.html`.
//
// A second bundle rather than a mode of build-runtime.mjs, because they are two
// different programs that happen to share a directory of modules. The runtime is
// injected as `<script>` textContent into a page the loader does not control and
// carries the guards that come with that; this is a `<script src>` on a loopback
// page and carries none of them, since there is no game here to restyle and no
// player to charge for a source map.
//
// The entry is GENERATED rather than committed. The scenario registry is one
// import per `addons/*/stage.ts` and esbuild has no glob, so a committed list
// would be a file every new addon has to remember to edit, and forgetting would
// look exactly like a scenario that does not work. Discovering them also means
// `pnpm stage` picks up a scenario written while it was running, on the next
// build, with nothing to wire up.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { build, context } from 'esbuild';

const root = `${import.meta.dirname}/../`;
const ADDONS_DIR = join(root, 'addons');
const SCENARIO_FILE = 'stage.ts';
const OUT_FILE = `${root}stage/stage.js`;

/** Every addon that has written one, sorted, so the bundle is reproducible. */
function scenarioDirs() {
  return readdirSync(ADDONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        return statSync(join(ADDONS_DIR, name, SCENARIO_FILE)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * The entry module, as text.
 *
 * The registry is built from entry pairs rather than an object literal for the
 * reason `useNamingConvention` exists: an addon id is a kebab-case name this
 * project chose for a directory, not a JavaScript identifier, and half of them
 * are not valid ones.
 */
function entryModule(dirs) {
  const imports = dirs
    .map((dir, i) => `import { SCENARIOS as s${String(i)} } from '../addons/${dir}/stage.ts';`)
    .join('\n');
  const pairs = dirs.map((dir, i) => `  ['${dir}', s${String(i)}],`).join('\n');
  return `import { start } from './src/main.ts';
${imports}

start(new Map([
${pairs}
])).catch((err) => {
  document.body.textContent = \`the stage failed to start: \${String(err)}\`;
});
`;
}

function options(dirs) {
  return {
    stdin: {
      contents: entryModule(dirs),
      resolveDir: `${root}stage`,
      sourcefile: 'stage-entry.ts',
      loader: 'ts',
    },
    outfile: OUT_FILE,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    // The loader's sheets are imported as text, the same way the runtime build
    // takes them, so what the stage injects is byte for byte what ships.
    loader: { '.css': 'text' },
    // Unminified with a map, which is the opposite of the runtime's default and
    // right for the same reason: nobody downloads this, and the whole point of
    // the page is to be able to see what the loader did.
    sourcemap: 'inline',
    logLevel: 'info',
  };
}

async function main() {
  const dirs = scenarioDirs();
  if (argv.includes('--watch')) {
    const ctx = await context(options(dirs));
    await ctx.watch();
    console.log(`stage: watching, ${String(dirs.length)} scenario files`);
    return;
  }
  await build(options(dirs));
  console.log(`stage: bundled ${String(dirs.length)} scenario files into stage/stage.js`);
}

await main();
