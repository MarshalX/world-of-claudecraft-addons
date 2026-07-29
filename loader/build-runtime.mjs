// Pre-bundle the page-realm runtime into one IIFE.
//
// The host injects this as <script> textContent at document-start, so it must be
// self-contained: no imports, no code splitting. Run before `vite build`, which
// inlines the output through a ?raw import.

import { build } from 'esbuild';

const root = `${import.meta.dirname}/`;
const ZOD_IMPORT = /^zod$/;

const result = await build({
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
