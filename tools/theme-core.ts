// The game's design tokens and borrowed-class rules, read out of its deployed stylesheet. Pure, so
// a Vitest suite can drive it; `tools/theme.mjs` is the CLI around it.
//
// Two things are taken. The `:root` custom properties, since every loader rule is scoped to a
// loader element and reaches the game's palette only through `var()`. And the game's rules for
// the classes the kit WEARS (`panel`, `panel-title`, `x-btn`): tokens alone do not reproduce a
// frame, because `.panel` holds its border, outline and shadows.
//
// Each rule is emitted inside the at-rules it was found in. Flattening `@layer base` would let
// the game win ties the loader's unlayered sheet wins in the real thing, and hoisting the
// `forced-colors` override out of its media query would put an accessibility mode in every
// screenshot.

/** Where the extracted tokens are written. */
const GENERATED = 'stage/theme.generated.css';

/** A `<link rel="stylesheet">`, whose href is the only part read out of it. */
const STYLESHEET_LINK = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi;
const HREF = /href=["']([^"']+)["']/i;

/**
 * Every `:root` rule body. Assumes no custom property value contains a brace; one that did would
 * truncate the block, and `MIN_TOKENS` would notice.
 */
const ROOT_BLOCK = /:root\s*\{([^{}]*)\}/g;

/** One declaration, kept only when it is a custom property. */
const CUSTOM_PROPERTY = /^\s*(--[\w-]+)\s*:\s*(\S.*?)\s*$/;

/**
 * A `var()` reference, with its comma captured: only a reference with no fallback silently stops
 * applying when its token is gone.
 */
const VAR_REFERENCE = /var\(\s*(--[\w-]+)\s*(,)?/g;

/**
 * A custom property DECLARED anywhere in a sheet. The colon is required: a name inside `var()` is
 * followed by `)` or `,`, so matching the bare name would count every read as a declaration.
 */
const CUSTOM_PROPERTY_DECLARED = /(--[\w-]+)\s*:/g;

/**
 * A custom property NAMED as a string literal, which is how the kit declares the ones it sets from
 * JavaScript (`kit/bar.ts` passes `'--woc-bar-size'` to `style.setProperty`). Loose on purpose:
 * over-reading excludes a name nothing declares anyway, under-reading raises a false drift warning.
 */
const CUSTOM_PROPERTY_NAMED = /['"`](--[\w-]+)['"`]/g;

/**
 * Below this many tokens the read is a wrong URL, not a thin theme: a near-empty file is valid
 * CSS and renders every stage addon unstyled. Well under the real count, so a trimmed palette
 * passes.
 */
const MIN_TOKENS = 40;

/**
 * The game classes the kit wears. Written out rather than discovered; `tests/tools-theme.test.ts`
 * reads the kit through `tools/kit-classes.ts` and fails on a worn class missing here.
 */
const BORROWED_CLASSES: readonly string[] = ['panel', 'panel-title', 'x-btn'];

/**
 * A selector that is exactly one borrowed class plus pseudo-classes. Anything compound is scoped to
 * something a loader element never has (`#bags`, `.window`, a `body` mode class) and cannot fire.
 */
const BORROWED_SELECTOR = /^\.(?:panel|panel-title|x-btn)(?::[a-z-]+)*$/;

/**
 * Every same-origin stylesheet `play.html` links, in document order. Cross-origin ones (Google
 * Fonts) declare no tokens, and the stage links them itself.
 */
function stylesheetUrls(html: string): string[] {
  const urls: string[] = [];
  for (const [tag] of html.matchAll(STYLESHEET_LINK)) {
    const href = HREF.exec(tag)?.[1] ?? '';
    if (href.startsWith('/')) {
      urls.push(href);
    }
  }
  return urls;
}

/**
 * The custom properties every `:root` block in one sheet declares, in source order so an upstream
 * addition is a one-line diff. A later block wins on value and keeps the first position.
 */
function rootTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, body] of css.matchAll(ROOT_BLOCK)) {
    for (const declaration of (body ?? '').split(';')) {
      const match = CUSTOM_PROPERTY.exec(declaration);
      if (match !== null) {
        tokens.set(match[1] as string, match[2] as string);
      }
    }
  }
  return tokens;
}

/** One game rule the loader's own elements are styled by, and where it sat. */
interface BorrowedRule {
  /** The at-rule preludes enclosing it, outermost first, e.g. `['@layer base']`. */
  context: readonly string[];
  /** Only the parts of the selector list that name a borrowed class. */
  selector: string;
  /** The declarations, verbatim. */
  body: string;
}

/** Where a rule body stops: its closing brace, or the end of a truncated sheet. */
function endOf(closed: number, length: number): number {
  if (closed === -1) {
    return length;
  }
  return closed;
}

/** The parts of one selector list that a loader element can actually match. */
function borrowedParts(selectorList: string): string[] {
  return selectorList
    .split(',')
    .map((part) => part.trim())
    .filter((part) => BORROWED_SELECTOR.test(part));
}

/**
 * Every rule styling a borrowed class, with the at-rules it was nested in. A brace walker, because
 * the same selector means different things inside different layers and media queries.
 *
 * Rule bodies are assumed flat (true of the minified deployed sheet); a nested rule is dropped.
 * The walk compares the next `{` against the next `}`, so it must tolerate whitespace between
 * braces even though the minified input has none: `renderTheme` output is formatted.
 */
function borrowedRules(css: string): BorrowedRule[] {
  const found: BorrowedRule[] = [];
  const context: string[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', at);
    if (open === -1 && close === -1) {
      return found;
    }
    if (close !== -1 && (open === -1 || close < open)) {
      context.pop();
      at = close + 1;
    } else {
      at = collect({ css, prelude: css.slice(at, open).trim(), opened: open + 1 }, context, found);
    }
  }
  return found;
}

interface Block {
  css: string;
  prelude: string;
  /** The index just past the brace that opened this block. */
  opened: number;
}

/** Handle one block opening: descend into an at-rule, or record a rule and skip past it. */
function collect(block: Block, context: string[], found: BorrowedRule[]): number {
  const { css, prelude, opened } = block;
  if (prelude.startsWith('@')) {
    context.push(prelude);
    return opened;
  }
  const closed = css.indexOf('}', opened);
  const end = endOf(closed, css.length);
  const selectors = borrowedParts(prelude);
  if (selectors.length > 0) {
    found.push({
      context: [...context],
      selector: selectors.join(', '),
      body: css.slice(opened, end).trim(),
    });
  }
  return end + 1;
}

/** One rule, wrapped back in the at-rules it was found inside. */
function renderRule(rule: BorrowedRule): string {
  const open = rule.context.map((prelude) => `${prelude} {\n`).join('');
  const close = rule.context.map(() => '}\n').join('');
  return `${open}${rule.selector} {\n  ${rule.body.replaceAll(';', ';\n  ').trim()}\n}\n${close}`;
}

/**
 * Tokens the loader reads WITHOUT a fallback that neither the game nor the loader declares, i.e. a
 * `var()` that now resolves to nothing and silently drops its declaration.
 *
 * Tokens the loader declares itself, in a sheet or from JavaScript (`loaderSource`), are excluded
 * by name rather than by the `--woc-` prefix, so a loader token read and never declared is still
 * reported. Both sets are read across whole concatenations, so cross-file declarations count.
 */
function unbackedTokens(
  loaderCss: string,
  loaderSource: string,
  tokens: Map<string, string>,
): string[] {
  const declared = new Set([
    ...[...loaderCss.matchAll(CUSTOM_PROPERTY_DECLARED)].map(([, name]) => name as string),
    ...[...loaderSource.matchAll(CUSTOM_PROPERTY_NAMED)].map(([, name]) => name as string),
  ]);
  const missing = new Set<string>();
  for (const [, name, comma] of loaderCss.matchAll(VAR_REFERENCE)) {
    if (comma === undefined && !tokens.has(name as string) && !declared.has(name as string)) {
      missing.add(name as string);
    }
  }
  return [...missing].sort();
}

/**
 * The generated stylesheet's text. The tokens are unlayered, unlike the game's `@layer tokens`:
 * the stage has no later game layers for that layer to yield to.
 */
function renderTheme(
  tokens: Map<string, string>,
  rules: readonly BorrowedRule[],
  source: string,
): string {
  if (tokens.size < MIN_TOKENS) {
    throw new Error(
      `${source} declared ${tokens.size} :root tokens, under the ${MIN_TOKENS} expected. ` +
        'That is a wrong URL rather than a thin theme.',
    );
  }
  if (rules.length === 0) {
    throw new Error(
      `${source} carries no rule for ${BORROWED_CLASSES.join(', ')}, which the loader wears. ` +
        'Without them a frame has no border at all.',
    );
  }
  const declarations = [...tokens].map(([name, value]) => `  ${name}: ${value};`).join('\n');
  return `/* Generated by tools/theme.mjs from ${source}. Do not hand-edit. */
/*
 * What stage/index.html borrows from the deployed game, which is two things.
 *
 * Its :root design tokens, which is how the loader's own stylesheet gets the
 * game's palette, faces and radii: every rule the loader writes is scoped to a
 * loader-owned element and reaches the game only through var().
 *
 * Its rules for the ${BORROWED_CLASSES.length} classes the loader deliberately WEARS
 * (${BORROWED_CLASSES.join(', ')}), so a frame, tooltip, modal and menu inherit the
 * game's border, background, shadow and title face instead of keeping a copy.
 * Each is emitted inside the at-rules it was found in: the layer keeps the
 * loader's unlayered sheet outranking it exactly as in the game, and the media
 * query keeps an accessibility override out of an ordinary screenshot.
 *
 * Regenerate with \`pnpm theme\` after a game release changes either.
 */
:root {
${declarations}
}

${rules.map(renderRule).join('\n')}`;
}

export type { BorrowedRule };
export {
  BORROWED_CLASSES,
  borrowedRules,
  GENERATED,
  renderTheme,
  rootTokens,
  stylesheetUrls,
  unbackedTokens,
};
