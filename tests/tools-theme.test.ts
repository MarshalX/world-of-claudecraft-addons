// How the stage's game-token stylesheet is derived from a deployed game. Only the reader is
// tested: a `.css` import is `''` under Vitest, so the committed artifact is checked by
// running `pnpm theme` and seeing an empty diff.

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
 * A token block over the minimum count, so `renderTheme` does not refuse it. Only the first
 * two tokens are asserted on; the fillers clear the floor.
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

  // The game's Google Fonts sheet declares no tokens; the stage links its fonts itself.
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

  // The panel gradient and cursor tokens are shaped like this.
  it('keeps a value that carries commas and parentheses', () => {
    const css = ':root{--panel-bg:linear-gradient(170deg, #15151ff2 0%, #08080df2 100%)}';
    expect(rootTokens(css).get('--panel-bg')).toBe(
      'linear-gradient(170deg, #15151ff2 0%, #08080df2 100%)',
    );
  });

  // A component-scoped token copied into `:root` would apply to everything.
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
  // An empty theme is valid CSS that quietly renders every addon on the stage unstyled.
  it('throws on a theme with nothing in it', () => {
    expect(() => renderTheme(new Map(), RULES, 'somewhere')).toThrow(/wrong URL/);
  });
});

describe('the drift report', () => {
  it('names a token read with no fallback that the game no longer declares', () => {
    expect(unbackedTokens('a{color:var(--gone)}', '', new Map())).toEqual(['--gone']);
  });

  // A `var()` with a fallback still resolves to something.
  it('says nothing about a token that carries a fallback', () => {
    expect(unbackedTokens('a{color:var(--gone, red)}', '', new Map())).toEqual([]);
  });

  it('says nothing about a token the game still declares', () => {
    expect(unbackedTokens('a{color:var(--gold)}', '', new Map([['--gold', '#ffd100']]))).toEqual(
      [],
    );
  });

  // The report is the SET of tokens that went away.
  it('names each missing token once, sorted', () => {
    const css = 'a{color:var(--zeta)}b{color:var(--alpha)}c{border-color:var(--zeta)}';
    expect(unbackedTokens(css, '', new Map())).toEqual(['--alpha', '--zeta']);
  });

  // The game never declares the loader's own tokens, so they must not be reported.
  it('says nothing about a token the loader declares itself', () => {
    const css = '.woc-row{--woc-gap:6px;gap:var(--woc-gap)}';
    expect(unbackedTokens(css, '', new Map())).toEqual([]);
  });

  // `kit/bar.ts` sets `--woc-bar-size` per element from JavaScript, which no sheet shows.
  it('says nothing about a property the loader sets from its own source', () => {
    const css = '.woc-bar-sized{height:calc(var(--woc-bar-size) * 1px)}';
    expect(unbackedTokens(css, "const SIZE = '--woc-bar-size';", new Map())).toEqual([]);
  });

  // The exclusion is the declaring set, not the `--woc-` prefix.
  it('names a loader token that is read and never declared', () => {
    expect(unbackedTokens('.woc-row{gap:var(--woc-never)}', '', new Map())).toEqual([
      '--woc-never',
    ]);
  });

  // The colon tells a declaration from a read; without it every token excludes itself.
  it('does not read a var() as a declaration of the token it reads', () => {
    expect(
      unbackedTokens('a{color:var(--gone)}b{border-color:var(--gone)}', '', new Map()),
    ).toEqual(['--gone']);
  });
});

describe('the classes the loader wears', () => {
  // A game class the kit starts wearing without theme-core copying its rule leaves stage
  // frames silently unstyled.
  it('is the list the theme extracts rules for', () => {
    expect(gameClassesWorn()).toEqual([...BORROWED_CLASSES].sort());
  });

  it('takes the rule for a borrowed class', () => {
    const rules = borrowedRules('@layer base{.panel{border:2px solid red}}');
    expect(rules).toEqual([
      { context: ['@layer base'], selector: '.panel', body: 'border:2px solid red' },
    ]);
  });

  it('keeps a pseudo-class variant', () => {
    expect(borrowedRules('.x-btn:hover{color:#fff}')[0]?.selector).toBe('.x-btn:hover');
  });

  // A loader frame wears `panel` and not `window`, so such a rule never applies in a session.
  it('drops a rule scoped to something the loader never wears', () => {
    const css = '.window .panel-title{padding:0}#bags .panel-title{margin:0}.ta-panel{top:0}';
    expect(borrowedRules(css)).toEqual([]);
  });

  it('keeps only the borrowed part of a shared selector list', () => {
    expect(borrowedRules('.panel,.window,.hud-skip{opacity:1}')[0]?.selector).toBe('.panel');
  });

  // Hoisted, the forced-colors border would replace the border in every screenshot.
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

  // The layer keeps the loader's unlayered sheet outranking the game's rule, as in a session.
  it('wraps a rule back in the at-rules it came from', () => {
    const css = renderTheme(rootTokens(TOKEN_BLOCK), RULES, 'somewhere');
    expect(css).toContain('@layer base {\n.panel {');
  });

  it('records which game it read', () => {
    expect(renderTheme(rootTokens(TOKEN_BLOCK), RULES, 'https://example/play.html')).toContain(
      'from https://example/play.html.',
    );
  });

  // Tokens without rules render every colour right and a frame with no edge.
  it('refuses a theme with no borrowed rule', () => {
    expect(() => renderTheme(rootTokens(TOKEN_BLOCK), [], 'somewhere')).toThrow(/no border/);
  });

  // The round trip is what makes an empty `pnpm theme` diff meaningful.
  it('round-trips through its own readers', () => {
    const tokens = rootTokens(TOKEN_BLOCK);
    const css = renderTheme(tokens, RULES, 'somewhere');
    expect([...rootTokens(css)]).toEqual([...tokens]);
    expect(borrowedRules(css).map((rule) => rule.selector)).toEqual(
      RULES.map((rule) => rule.selector),
    );
  });
});
