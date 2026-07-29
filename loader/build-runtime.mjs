// Pre-bundle the page-realm runtime into one IIFE.
//
// The host injects this as <script> textContent at document-start, so it must be
// self-contained: no imports, no code splitting. Run before `vite build`, which
// inlines the output through a ?raw import.

import { argv } from 'node:process';
import { build } from 'esbuild';

const root = `${import.meta.dirname}/`;
const ZOD_IMPORT = /^zod$/;
const HOST_MODULE = /(^|\/)loader\/src\/host\//;

/**
 * Source maps are opt-in, and inline when asked for.
 *
 * Inline is the only form that can work here: the host injects this bundle as
 * <script> textContent, so the script has no src and an external .map has no URL
 * to resolve against. That constraint is real, but it does not follow that the
 * map should always be there. It costs 8x the bundle (149 kB to 1.18 MB), and
 * that is not a download-once cost: the host re-injects the whole string on
 * every page load, so every player pays it on every visit to run a map nobody
 * reads. Pass --sourcemap when debugging the runtime.
 *
 * Read from argv rather than an env var on purpose. This script deliberately has
 * no process.env dependency (see AGENTS.md), and a flag is what a build script
 * takes anyway.
 */
const sourcemap = argv.includes('--sourcemap') && 'inline';

const result = await build({
  metafile: true,
  entryPoints: [`${root}src/runtime/main.ts`],
  outfile: `${root}src/generated/runtime.iife.js`,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  // The manager UI is preact. Kept in step with the same pair of settings in
  // tsconfig.json and vitest.config.ts.
  jsx: 'automatic',
  jsxImportSource: 'preact',
  // The loader stylesheet is bundled as text and injected as one <style>, rather
  // than emitted as a CSS file the userscript would have no way to ship.
  loader: { '.css': 'text' },
  minify: true,
  sourcemap,
  legalComments: 'none',
  logLevel: 'info',
  // A value import from shared/schema.ts would pull zod into the page realm.
  // Fail the build rather than ship it.
  plugins: [
    {
      name: 'forbid-host-only-deps',
      setup(b) {
        b.onResolve({ filter: ZOD_IMPORT }, (args) => ({
          errors: [
            {
              text: `zod must not reach the runtime bundle (imported from ${args.importer}). Import types from shared/schema.ts with \`import type\`.`,
            },
          ],
        }));
      },
    },
  ],
});

if (result.errors.length > 0) {
  throw new Error('runtime bundle failed');
}

// The GM_* globals are declared ambient project-wide so the host can reference
// them, which removes the compiler's protection against the runtime doing the
// same. Nothing under host/ may reach the page realm, so the module graph is
// what enforces it.
const hostModules = Object.keys(result.metafile.inputs).filter((input) => HOST_MODULE.test(input));
if (hostModules.length > 0) {
  throw new Error(
    `host modules must not reach the runtime bundle: ${hostModules.join(', ')}. ` +
      'Move the shared part into loader/src/shared/.',
  );
}
