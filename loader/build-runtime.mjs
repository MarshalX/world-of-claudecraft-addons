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

/**
 * Anything Node-only, by import specifier.
 *
 * `node:` covers the prefixed form and the bare list covers the legacy one.
 * @types/node is ambient project-wide because tools/*.ts needs it, which means
 * the compiler will happily accept `readFileSync` in a runtime module; this is
 * what stops it, the same way HOST_MODULE stops a GM reference.
 */
const NODE_IMPORT =
  /^(node:|(fs|path|url|crypto|http|https|os|child_process|worker_threads|process|util|stream|buffer|events|zlib|net|tls|dns|readline|assert|module|v8|vm|perf_hooks)$)/;

/** Whatever precedes a `{` that opens a rule body, which is its selector list. */
const RULE_HEAD = /(^|\})\s*([^{}@]+?)\s*\{/g;
const COMMENT = /\/\*[\s\S]*?\*\//g;
const WHITESPACE = /\s+/g;

/**
 * A whole `@keyframes` block, removed before selectors are read out of a sheet.
 *
 * Its interior is `from`, `to` and percentages, which are positions on a timeline
 * rather than selectors: they match no element, so the scoping rule below has
 * nothing to say about them and reading them as selectors only produces a false
 * failure. The interior is exactly one level of nesting deep, which is what makes
 * this matchable without a parser.
 */
const KEYFRAMES_BLOCK = /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g;

/**
 * The NAME of a keyframes rule, which does need checking.
 *
 * An animation name is global to the document rather than scoped to a subtree, so an
 * unprefixed one can shadow a game animation of the same name and the symptom is the
 * game's own element animating wrongly. That is the same class of bug the selector
 * rule prevents, reached by the one route a selector check cannot see.
 */
const KEYFRAMES_NAME = /@keyframes\s+([^\s{]+)/g;

/**
 * A selector the loader owns.
 *
 * Three shapes. Its root, and anything under it. The fixed ids it creates for the
 * overlay surfaces, which live under the root but are addressed by id alone because
 * each is one element for the whole loader rather than one per addon. And the id
 * namespace it uses inside the game's own DOM, which is where the rail buttons go.
 *
 * Adding an overlay surface means adding it here, and the failure if you forget is
 * the build refusing rather than a rule quietly restyling the game.
 */
const LOADER_OWNED =
  /^(#woc-addons\b|#woc-tooltip\b|#woc-toasts\b|#woc-banner\b|#woc-addons-|\[id\^=["']woc-)/;

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
        b.onResolve({ filter: NODE_IMPORT }, (args) => ({
          errors: [
            {
              text: `${args.path} is a Node module and must not reach the runtime bundle (imported from ${args.importer}). The runtime is injected into a page.`,
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
 *  4. EVERY KEYFRAMES NAME PREFIXED. An animation name is global to the document
 *     rather than scoped to a subtree, so this is what rule 2 means for a
 *     keyframes rule: its steps match nothing, and its name can collide.
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
  [...css.replaceAll(KEYFRAMES_BLOCK, '').matchAll(RULE_HEAD)]
    .map(([, , selectorList]) => selectorList.trim().replaceAll(WHITESPACE, ' '))
    .filter((selector) => selector.length > 0 && !selector.startsWith('@'))
    .map((selector) => ({ sheet: name, selector }));

const animationsOf = ({ name, css }) =>
  [...css.matchAll(KEYFRAMES_NAME)].map(([, animation]) => ({ sheet: name, animation }));

const rules = sheets.flatMap(selectorsOf);
const unprefixed = sheets
  .flatMap(animationsOf)
  .filter(({ animation }) => !animation.startsWith('woc-'))
  .map(({ sheet, animation }) => `${sheet}: @keyframes ${animation}`);
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
if (unprefixed.length > 0) {
  throw new Error(
    `every keyframes name must start with woc-:\n  ${unprefixed.join('\n  ')}\n` +
      'An animation name is global to the document, so an unprefixed one can shadow the game"s own.',
  );
}
if (duplicated.length > 0) {
  throw new Error(
    `a selector is defined in more than one sheet, which makes the result depend on join order:\n  ${duplicated
      .map(([selector, where]) => `${selector} (${where.join(', ')})`)
      .join('\n  ')}`,
  );
}
