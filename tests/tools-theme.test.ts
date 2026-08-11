// How the stage's game-token stylesheet is derived from a deployed game.
//
// This is `tools-cues.test.ts` MINUS its best guard, and the difference is worth
// stating rather than leaving as an absence. That suite also proves the
// checked-in artifact is exactly what its generator would write, so a hand-edit
// fails rather than being silently reverted by the next regeneration. The same
// guard cannot be written here: `stage/theme.generated.css` is a `.css` file, and
// AGENTS.md records that every `.css` import resolves to `''` under Vitest with
// `?raw` making no difference, because vite's own CSS handling wins. Reading it
// would need `node:fs`, and `noNodejsModules` is not exempt in `tests/**`.
//
// So what is checked here is the READER, exhaustively, against the shapes the
// deployed stylesheet actually contains. The artifact itself is checked by
// running `pnpm theme` and seeing an empty diff, which is also the only way to
// answer staleness: whether the tokens still match the game is two fetches
// totalling 600 kB, and a suite that made them would fail on a flight and pass
// against whatever was served that morning.
//
// The drift report has its own group, because it is the one thing here about the
// LOADER rather than about the game. A `var(--x)` with no fallback and no token
// behind it resolves to nothing, so the rule it sits in silently stops applying.

import { describe, expect, it } from 'vitest';
import { gameClassesWorn } from '../tools/kit-classes.ts';
import {
  BORROWED_CLASSES,
  borrowedRules,
  renderTheme,
  rootTokens,
  stylesheetUrls,
  unbackedTokens,
} from '../tools/theme-core.ts';

/**
 * A token block over the minimum count, so `renderTheme` does not refuse it.
 *
 * Generated names past the two real ones: the first two are what the assertions
 * are about, and the rest exist only to clear the floor that stops a wrong URL
 * being written out as a theme.
 */
const TOKEN_BLOCK = `@layer tokens{:root{--gold:#ffd100;--panel-base:#15151f;${Array.from(
  { length: 50 },
  (_, i) => `--filler-${String(i)}:${String(i)}px`,
).join(';')}}}`;

/** The rules the renderer needs to be handed, since it refuses a theme with none. */
const RULES = borrowedRules('@layer base{.panel{border:2px solid red}.x-btn{color:#fff}}');

describe('finding the stylesheets', () => {
  it('reads the href out of every same-origin stylesheet link', () => {
    const html = `<link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="stylesheet" crossorigin href="/assets/main-CK0WziLt.css">
      <link rel="stylesheet" crossorigin href="/assets/play-gjK_hwlo.css">`;
    expect(stylesheetUrls(html)).toEqual([
      '/assets/main-CK0WziLt.css',
      '/assets/play-gjK_hwlo.css',
    ]);
  });

  // The game links Google Fonts as a stylesheet, and following it would fetch a
  // sheet that declares no tokens from a third party. The stage links the fonts
  // itself, from its own markup, where a human can see which faces it asks for.
  it('drops a cross-origin stylesheet', () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Cinzel" rel="stylesheet">`;
    expect(stylesheetUrls(html)).toEqual([]);
  });

  it('ignores a link that is not a stylesheet', () => {
    expect(stylesheetUrls('<link rel="manifest" href="/manifest.webmanifest" />')).toEqual([]);
  });
});

describe('reading the tokens', () => {
  it('takes every custom property in the root block', () => {
    const tokens = rootTokens('@layer tokens{:root{--gold:#ffd100;--panel-base:#15151f}}');
    expect([...tokens]).toEqual([
      ['--gold', '#ffd100'],
      ['--panel-base', '#15151f'],
    ]);
  });

  // A value with commas and parentheses in it, which is what the panel gradient
  // and the three cursor tokens really are. Splitting a declaration list on `;`
  // has to leave these whole.
  it('keeps a value that carries commas and parentheses', () => {
    const css = ':root{--panel-bg:linear-gradient(170deg, #15151ff2 0%, #08080df2 100%)}';
    expect(rootTokens(css).get('--panel-bg')).toBe(
      'linear-gradient(170deg, #15151ff2 0%, #08080df2 100%)',
    );
  });

  // Only `:root` is taken. A token declared on a component is scoped to it, so
  // copying it into the stage's `:root` would apply it to everything.
  it('ignores a custom property declared outside :root', () => {
    expect(rootTokens('.panel{--gold:#000}').size).toBe(0);
  });

  it('takes a later declaration and keeps its original position', () => {
    const tokens = rootTokens(':root{--a:1;--b:2}:root{--a:9}');
    expect([...tokens]).toEqual([
      ['--a', '9'],
      ['--b', '2'],
    ]);
  });
});

describe('refusing a payload that is not a stylesheet', () => {
  // An empty union would generate a file that is valid CSS, commits cleanly, and
  // quietly renders every addon on the stage unstyled. It has to be loud.
  it('throws rather than writing a theme with nothing in it', () => {
    expect(() => renderTheme(new Map(), RULES, 'somewhere')).toThrow(/wrong URL/);
  });
});

describe('the drift report', () => {
  it('names a token read with no fallback that the game no longer declares', () => {
    expect(unbackedTokens('a{color:var(--gone)}', new Map())).toEqual(['--gone']);
  });

  // A `var()` carrying a fallback degrades to something rather than to nothing,
  // so it is not what this exists to catch and reporting it would bury the ones
  // that are.
  it('says nothing about a token that carries a fallback', () => {
    expect(unbackedTokens('a{color:var(--gone, red)}', new Map())).toEqual([]);
  });

  it('says nothing about a token the game still declares', () => {
    expect(unbackedTokens('a{color:var(--gold)}', new Map([['--gold', '#ffd100']]))).toEqual([]);
  });

  // Reported once however many rules read it, and sorted, because the point of
  // the line is the SET of tokens that went away: a report that repeated
  // `--color-border-default` fifteen times would bury the other fourteen.
  it('names each missing token once, sorted', () => {
    const css = 'a{color:var(--zeta)}b{color:var(--alpha)}c{border-color:var(--zeta)}';
    expect(unbackedTokens(css, new Map())).toEqual(['--alpha', '--zeta']);
  });

  // The loader's own tokens, which the game never declared and never will. Read
  // against the game's set alone they were reported on every regeneration, which
  // is a drift report that is wrong every time it fires.
  it('says nothing about a token the loader declares itself', () => {
    const css = '.woc-row{--woc-gap:6px;gap:var(--woc-gap)}';
    expect(unbackedTokens(css, new Map())).toEqual([]);
  });

  // The exclusion is the declaring set rather than the `--woc-` prefix, so a
  // loader token nothing declares is still a rule resolving to nothing.
  it('still names a loader token that is read and never declared', () => {
    expect(unbackedTokens('.woc-row{gap:var(--woc-never)}', new Map())).toEqual(['--woc-never']);
  });

  // The colon is the whole of what tells a declaration from a read, and the
  // first case in this block is what proves it: drop it from the declaration
  // pattern and every `var(--x)` becomes its own declaration, which excludes
  // every token and reports nothing ever again.
  it('does not read a var() as a declaration of the token it reads', () => {
    expect(unbackedTokens('a{color:var(--gone)}b{border-color:var(--gone)}', new Map())).toEqual([
      '--gone',
    ]);
  });
});

describe('the classes the loader wears', () => {
  // The guard on the list in theme-core, and the one test here that is about the
  // LOADER. Adding `classList.add('window')` to the kit and nothing else would
  // otherwise produce a stage whose frames are styled by a rule the theme never
  // copied: no error, no missing file, just a frame that does not look like the
  // game's. That is exactly how the panel border went missing.
  it('is the list the theme extracts rules for', () => {
    expect(gameClassesWorn()).toEqual([...BORROWED_CLASSES].sort());
  });

  it('takes the rule for a borrowed class', () => {
    const rules = borrowedRules('@layer base{.panel{border:2px solid red}}');
    expect(rules).toEqual([
      { context: ['@layer base'], selector: '.panel', body: 'border:2px solid red' },
    ]);
  });

  it('keeps a pseudo-class variant, which is how the close button reacts', () => {
    expect(borrowedRules('.x-btn:hover{color:#fff}')[0]?.selector).toBe('.x-btn:hover');
  });

  // A loader frame wears `panel` and NOT the game's `window`, so a rule scoped to
  // a game window cannot fire on one. Copying it would style the stage from a rule
  // that never applies in a real session.
  it('drops a rule scoped to something the loader never wears', () => {
    const css = '.window .panel-title{padding:0}#bags .panel-title{margin:0}.ta-panel{top:0}';
    expect(borrowedRules(css)).toEqual([]);
  });

  it('keeps only the borrowed part of a shared selector list', () => {
    expect(borrowedRules('.panel,.window,.hud-skip{opacity:1}')[0]?.selector).toBe('.panel');
  });

  // Hoisting this one out of its query would apply an accessibility mode to every
  // screenshot: it REPLACES the border rather than adding to it.
  it('keeps a rule inside the media query it was found in', () => {
    const css = '@layer base{@media (forced-colors:active){.panel{border:1px solid canvastext}}}';
    expect(borrowedRules(css)[0]?.context).toEqual([
      '@layer base',
      '@media (forced-colors:active)',
    ]);
  });

  it('reads the same class in two layers as two rules', () => {
    const css = '@layer base{.panel{border:2px}}@layer components{.panel{opacity:1}}';
    expect(borrowedRules(css).map((rule) => rule.context[0])).toEqual([
      '@layer base',
      '@layer components',
    ]);
  });
});

describe('rendering the sheet', () => {
  it('writes one declaration per token, in reading order', () => {
    const css = renderTheme(rootTokens(TOKEN_BLOCK), RULES, 'somewhere');
    expect(css).toContain('  --gold: #ffd100;\n');
    expect(css.indexOf('--gold:')).toBeLessThan(css.indexOf('--panel-base:'));
  });

  // The layer is what keeps the loader's unlayered sheet outranking the game's
  // rule exactly as it does in the real thing. Flattened, the two would compete
  // on specificity and the game would win ties it currently loses.
  it('wraps a rule back in the at-rules it came from', () => {
    const css = renderTheme(rootTokens(TOKEN_BLOCK), RULES, 'somewhere');
    expect(css).toContain('@layer base {\n.panel {');
  });

  it('records where it read them, so a stale file says which game it came from', () => {
    expect(renderTheme(rootTokens(TOKEN_BLOCK), RULES, 'https://example/play.html')).toContain(
      'from https://example/play.html.',
    );
  });

  // A theme with tokens and no rules is the exact failure this whole group exists
  // for: every colour right, and a frame with no edge.
  it('refuses a theme that carries no borrowed rule at all', () => {
    expect(() => renderTheme(rootTokens(TOKEN_BLOCK), [], 'somewhere')).toThrow(/no border/);
  });

  // Round trip: what the renderer writes is what the reader takes back out. That
  // is what makes `pnpm theme` producing an empty diff mean something, since the
  // generated file cannot be read from here to check directly.
  it('writes a sheet its own readers take the same content back out of', () => {
    const tokens = rootTokens(TOKEN_BLOCK);
    const css = renderTheme(tokens, RULES, 'somewhere');
    expect([...rootTokens(css)]).toEqual([...tokens]);
    expect(borrowedRules(css).map((rule) => rule.selector)).toEqual(
      RULES.map((rule) => rule.selector),
    );
  });
});
