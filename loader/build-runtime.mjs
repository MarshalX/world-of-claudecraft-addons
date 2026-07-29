// Pre-bundle the page-realm runtime into one IIFE.
//
// The host injects this as <script> textContent at document-start, so it must be
// self-contained: no imports, no code splitting. Run before `vite build`, which
// inlines the output through a ?raw import.

import { build } from 'esbuild';

const root = `${import.meta.dirname}/`;
const ZOD_IMPORT = /^zod$/;
const HOST_MODULE = /(^|\/)loader\/src\/host\//;

const result = await build({
  metafile: true,
  entryPoints: [`${root}src/runtime/main.ts`],
  outfile: `${root}src/generated/runtime.iife.js`,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: 'inline',
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
