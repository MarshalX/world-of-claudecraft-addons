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
 * Anything Node-only, prefixed or bare. @types/node is ambient project-wide for tools/*.ts, so
 * the compiler accepts `readFileSync` in a runtime module and only this check refuses it.
 */
const NODE_IMPORT =
  /^(node:|(fs|path|url|crypto|http|https|os|child_process|worker_threads|process|util|stream|buffer|events|zlib|net|tls|dns|readline|assert|module|v8|vm|perf_hooks)$)/;

const COMMENT = /\/\*[\s\S]*?\*\//g;
const WHITESPACE = /\s+/g;

/**
 * A whole `@keyframes` block, stripped before selectors are read: its `from`, `to` and
 * percentages match no element and would fail the scoping check falsely. The interior is
 * exactly one level deep, which is what makes it matchable without a parser.
 */
const KEYFRAMES_BLOCK = /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g;

/** The NAME of a keyframes rule, which is global to the document and so is checked instead. */
const KEYFRAMES_NAME = /@keyframes\s+([^\s{]+)/g;

/**
 * A selector the loader owns: its root and anything under it, the fixed overlay ids (addressed
 * by id alone), and the `woc-` id namespace it injects into the game's DOM. A new overlay
 * surface must be added here or the build refuses its rules.
 */
const LOADER_OWNED =
  /^(#woc-addons\b|#woc-tooltip\b|#woc-toasts\b|#woc-banner\b|#woc-addons-|\[id\^=["']woc-)/;

/**
 * Source maps are opt-in via --sourcemap, and inline because the bundle is injected as
 * textContent with no URL for an external .map. Off by default: the map is 8x the bundle and
 * the host re-injects the whole string on every page load. Read from argv, never process.env.
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
  // Must match the JSX settings in tsconfig.json and vitest.config.ts.
  jsx: 'automatic',
  jsxImportSource: 'preact',
  // Bundled as text and injected as one <style>: a userscript cannot ship a CSS file.
  loader: { '.css': 'text' },
  minify: true,
  sourcemap,
  legalComments: 'none',
  logLevel: 'info',
  // Bundle bans: zod (the runtime may import only types from shared/schema.ts) and every Node
  // builtin. Host modules are checked on the module graph below.
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

// The GM_* globals are ambient project-wide, so the compiler cannot stop the runtime reaching
// host/; the module graph does.
const hostModules = Object.keys(result.metafile.inputs).filter((input) => HOST_MODULE.test(input));
if (hostModules.length > 0) {
  throw new Error(
    `host modules must not reach the runtime bundle: ${hostModules.join(', ')}. ` +
      'Move the shared part into loader/src/shared/.',
  );
}

/**
 * The stylesheet's four invariants, checked here because Vitest reads every `.css` as `''`.
 *
 *  1. NO CASCADE LAYER. The sheet is injected unlayered so it outranks every game rule; one
 *     `@layer` and it silently loses to the game.
 *  2. EVERY RULE SCOPED to a loader-owned element, since an unlayered rule also beats the
 *     game's and an unscoped one restyles the game itself.
 *  3. NO SELECTOR IN TWO SHEETS UNDER THE SAME CONDITION. `styles/index.ts` concatenates them,
 *     so a duplicate makes the result depend on join order. The enclosing at-rules are part of
 *     the identity, so touch.css may override panes.css from `@media (pointer: coarse)`; it is
 *     joined LAST for that reason.
 *  4. EVERY KEYFRAMES NAME PREFIXED `woc-`, since an animation name is global to the document.
 */
const cssDir = `${root}src/runtime/ui/styles/`;
const sheetNames = (await readdir(cssDir)).filter((name) => name.endsWith('.css'));
const sheets = await Promise.all(
  sheetNames.map(async (name) => ({
    name,
    css: (await readFile(`${cssDir}${name}`, 'utf8')).replaceAll(COMMENT, ''),
  })),
);

/**
 * Every rule in a sheet, with the conditional at-rules it sits inside. A character scan, since
 * a regex over rule heads misses the first rule inside an `@media` and loses its condition.
 */
const rulesOf = ({ name, css }) => {
  const found = [];
  const enclosing = [];
  let prelude = '';
  for (const char of css.replaceAll(KEYFRAMES_BLOCK, '')) {
    if (char === '{') {
      const head = prelude.trim().replaceAll(WHITESPACE, ' ');
      // Pushed for every block so depth tracks the braces; only an at-rule adds a condition.
      if (head.startsWith('@')) {
        enclosing.push(head);
      } else {
        enclosing.push(null);
        if (head.length > 0) {
          const when = enclosing.filter((one) => one !== null).join(' ');
          found.push({ sheet: name, selector: head, when });
        }
      }
      prelude = '';
    } else if (char === '}') {
      enclosing.pop();
      prelude = '';
    } else if (char === ';') {
      // A declaration, or a statement at-rule like `@import`. Neither is a head.
      prelude = '';
    } else {
      prelude += char;
    }
  }
  return found;
};

const animationsOf = ({ name, css }) =>
  [...css.matchAll(KEYFRAMES_NAME)].map(([, animation]) => ({ sheet: name, animation }));

const rules = sheets.flatMap(rulesOf);
const unprefixed = sheets
  .flatMap(animationsOf)
  .filter(({ animation }) => !animation.startsWith('woc-'))
  .map(({ sheet, animation }) => `${sheet}: @keyframes ${animation}`);
const layered = sheets.filter(({ css }) => css.includes('@layer')).map(({ name }) => name);
const unscoped = rules
  .filter(({ selector }) => !selector.split(',').every((one) => LOADER_OWNED.test(one.trim())))
  .map(({ sheet, selector }) => `${sheet}: ${selector}`);

// Keyed on condition plus selector: the same selector under another `@media` is no collision.
const definedIn = new Map();
for (const { sheet, selector, when } of rules) {
  let key = selector;
  if (when.length > 0) {
    key = `${when} { ${selector} }`;
  }
  definedIn.set(key, [...(definedIn.get(key) ?? []), sheet]);
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
      "An animation name is global to the document, so an unprefixed one can shadow the game's own.",
  );
}
if (duplicated.length > 0) {
  throw new Error(
    `a selector is declared twice under the same condition, so which one wins depends on join order:\n  ${duplicated
      .map(([selector, where]) => `${selector} (${where.join(', ')})`)
      .join('\n  ')}`,
  );
}
