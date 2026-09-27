// Bundle the addon stage into one IIFE for `stage/index.html`. It carries none of the runtime
// build's guards: it is a `<script src>` on a loopback page with no game to restyle.
//
// The entry is generated from `addons/*/stage.ts` because esbuild has no glob, and a committed
// list would silently drop any addon that forgot to edit it.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
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

/** The entry module, as text. Built from pairs because a kebab-case addon id is no identifier. */
function entryModule(dirs) {
  const imports = dirs
    .map((dir, i) => `import { SCENARIOS as s${String(i)} } from '../addons/${dir}/stage.ts';`)
    .join('\n');
  const pairs = dirs.map((dir, i) => `  ['${dir}', s${String(i)}],`).join('\n');
  return `import { start } from './src/main.ts';
${imports}

// start() reports its own failures into the page status line and never rejects. A catch here
// that wrote into the body would replace its children and delete that line.
start(new Map([
${pairs}
]));
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
    // As text, like the runtime build, so the stage injects byte for byte what ships.
    loader: { '.css': 'text' },
    // Unminified with a map: nobody downloads this, and the page exists to inspect the loader.
    sourcemap: 'inline',
    logLevel: 'info',
  };
}

/**
 * Bundle once, for a caller that has already bound the stage port. Callers must build after
 * the bind: the port is what makes stage runs exclusive, and this rewrites the one
 * `stage/stage.js` a running stage is serving.
 */
async function buildStage() {
  const dirs = scenarioDirs();
  await build(options(dirs));
  console.log(`stage: bundled ${String(dirs.length)} scenario files into stage/stage.js`);
}

async function main() {
  if (argv.includes('--watch')) {
    const dirs = scenarioDirs();
    const ctx = await context(options(dirs));
    await ctx.watch();
    console.log(`stage: watching, ${String(dirs.length)} scenario files`);
    return;
  }
  await buildStage();
}

// Only when run directly: importing this module must not build before the caller binds the port.
if (argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export { buildStage };
