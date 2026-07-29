// Pre-bundle the page-realm runtime into one IIFE.
//
// The host injects this as <script> textContent at document-start, so it must be
// self-contained: no imports, no code splitting. Run before `vite build`, which
// inlines the output through a ?raw import.

import { readdir, readFile } from 'node:fs/promises';
import { argv } from 'node:process';
import { build } from 'esbuild';

const root = `${import.meta.dirname}/`;
const ZOD_IMPORT = /^zod$/;
const HOST_MODULE = /(^|\/)loader\/src\/host\//;

/** Whatever precedes a `{` that opens a rule body, which is its selector list. */
const RULE_HEAD = /(^|\})\s*([^{}@]+?)\s*\{/g;
const COMMENT = /\/\*[\s\S]*?\*\//g;
const WHITESPACE = /\s+/g;

/**
 * A selector the loader owns: under its root, or one of the two ids it puts in
 * the game's own DOM, which are the only elements it has outside that root.
 */
const LOADER_OWNED = /^(#woc-addons\b|#woc-tooltip\b|#woc-toasts\b|#woc-addons-|\[id\^=["']woc-)/;

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

/**
 * The stylesheet's three invariants, checked here because no test can reach it.
 *
 * The sheets are imported as TEXT, which Vite hands back processed rather than
 * raw, so a Vitest cannot read what actually ships. This script already fails
 * the build on what must not reach the bundle, and the same argument applies:
 *
 *  1. NO CASCADE LAYER. The sheet is injected unlayered so it outranks every
 *     game rule whatever the specificity. One `@layer` here and that rule loses
 *     to the game silently.
 *  2. EVERY RULE SCOPED to a loader-owned element. The flip side of being
 *     unlayered is that these rules also beat the game's, so an unscoped one
 *     restyles the game itself.
 *  3. NO SELECTOR IN TWO SHEETS. `styles/index.ts` concatenates them, so a
 *     selector defined twice makes the result depend on the join order, which
 *     is exactly the kind of coupling splitting the file was meant to avoid.
 */
const cssDir = `${root}src/runtime/ui/styles/`;
const sheetNames = (await readdir(cssDir)).filter((name) => name.endsWith('.css'));
const sheets = await Promise.all(
  sheetNames.map(async (name) => ({
    name,
    css: (await readFile(`${cssDir}${name}`, 'utf8')).replaceAll(COMMENT, ''),
  })),
);

const selectorsOf = ({ name, css }) =>
  [...css.matchAll(RULE_HEAD)]
    .map(([, , selectorList]) => selectorList.trim().replaceAll(WHITESPACE, ' '))
    .filter((selector) => selector.length > 0 && !selector.startsWith('@'))
    .map((selector) => ({ sheet: name, selector }));

const rules = sheets.flatMap(selectorsOf);
const layered = sheets.filter(({ css }) => css.includes('@layer')).map(({ name }) => name);
const unscoped = rules
  .filter(({ selector }) => !selector.split(',').every((one) => LOADER_OWNED.test(one.trim())))
  .map(({ sheet, selector }) => `${sheet}: ${selector}`);

const definedIn = new Map();
for (const { sheet, selector } of rules) {
  definedIn.set(selector, [...(definedIn.get(selector) ?? []), sheet]);
}
const duplicated = [...definedIn].filter(([, where]) => where.length > 1);

if (layered.length > 0) {
  throw new Error(
    `the loader stylesheet must not use @layer (${layered.join(', ')}). ` +
      'It is injected unlayered so it outranks the game, which a layer gives up.',
  );
}
if (unscoped.length > 0) {
  throw new Error(
    `every loader rule must be scoped to a loader-owned element:\n  ${unscoped.join('\n  ')}\n` +
      'An unlayered rule outranks the game, so an unscoped one restyles the game itself.',
  );
}
if (duplicated.length > 0) {
  throw new Error(
    `a selector is defined in more than one sheet, which makes the result depend on join order:\n  ${duplicated
      .map(([selector, where]) => `${selector} (${where.join(', ')})`)
      .join('\n  ')}`,
  );
}
