// The game's design tokens, lifted out of its deployed stylesheet.
//
// The reading and the rendering live here, apart from the fetch, so a Vitest
// suite can drive both without a network. `tools/theme.mjs` is the CLI around
// them, the same split as cues-core.ts and manifests.ts.
//
// Two things are taken, and the second one is easy to miss.
//
// THE `:root` CUSTOM PROPERTIES, which is most of it. Every rule the loader writes
// is scoped to a loader-owned element (`loader/build-runtime.mjs` fails the build
// otherwise), so the palette, the faces and the radii all reach it through `var()`.
//
// THE GAME RULES FOR THE THREE CLASSES THE LOADER DELIBERATELY WEARS. `kit/`
// puts `panel` on a frame, a tooltip, a modal and a menu, `panel-title` on a title
// bar and `x-btn` on a close button, so that those surfaces inherit the game's own
// border, background, shadow and title face rather than keeping a copy of them.
// Tokens alone therefore do NOT reproduce a frame: `.panel` is where its 2px
// border, its outline and its three shadows live, and without that rule a stage
// frame renders as a bare rounded rectangle with no edge at all. That was the
// first thing the stage got visibly wrong, and it was reported as "why does the
// combat meter have no frame".
//
// Each rule is emitted INSIDE THE AT-RULES IT WAS FOUND IN, layer and media both.
// The layer is what preserves the cascade: the loader's own sheet is injected
// unlayered and so outranks every game rule whatever the specificity, and
// flattening `@layer base` here would put the two on equal footing and let the
// game win ties it loses in the real thing. The media query matters for a
// different reason: one of these rules is a `forced-colors` override that replaces
// the border, and hoisting it out of its query would apply an accessibility mode
// to every screenshot.
//
// The stylesheet is content-hashed, which is why this starts from `play.html`
// rather than from a fixed URL. That is a weaker dependency than it looks: the
// href sits in a plain `<link rel="stylesheet">` in the served markup, so it
// survives a bundler change that would break anything reading minified JS. It is
// the same shape of by-hand network read as `pnpm cues`, `pnpm icons` and
// `pnpm items`, and it is regenerated for the same reason: the answer changes a
// few times a year and a request per build would spend one to rewrite one file.

/** Where the extracted tokens are written. */
const GENERATED = 'stage/theme.generated.css';

/** A `<link rel="stylesheet">`, whose href is the only part read out of it. */
const STYLESHEET_LINK = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi;
const HREF = /href=["']([^"']+)["']/i;

/**
 * Every `:root` rule body.
 *
 * A brace-free interior is a whole one, because a custom property value carries
 * no braces: the three that are not plain values are `url()` and
 * `linear-gradient()` forms, which are parenthesised. A block that ever does
 * carry one would be truncated here rather than misread, and the token count
 * check below is what would notice.
 */
const ROOT_BLOCK = /:root\s*\{([^{}]*)\}/g;

/** One declaration, kept only when it is a custom property. */
const CUSTOM_PROPERTY = /^\s*(--[\w-]+)\s*:\s*(\S.*?)\s*$/;

/**
 * A `var()` reference, with its comma captured.
 *
 * The comma is the whole reason this is read at all: `var(--x)` with no fallback
 * resolves to nothing when the token is gone, which is a rule that silently stops
 * applying, and `var(--x, ...)` degrades to something. Only the first kind is
 * worth failing over.
 */
const VAR_REFERENCE = /var\(\s*(--[\w-]+)\s*(,)?/g;

/**
 * A custom property DECLARED anywhere in a sheet, as opposed to read from one.
 *
 * Deliberately not anchored to a line the way `CUSTOM_PROPERTY` is: this runs
 * over the loader's whole concatenated stylesheet rather than one `:root` body,
 * and all it needs is whether the name is written on the left of a colon. The
 * COLON is what separates the two, and it separates them completely: a name
 * being read is inside `var()`, where what follows it is `)` or `,` and never
 * `:`. Matching the name alone would make every read its own declaration and
 * silence the report entirely.
 */
const CUSTOM_PROPERTY_DECLARED = /(--[\w-]+)\s*:/g;

/**
 * A custom property NAMED as a string literal, which is how the kit declares the
 * few it writes from JavaScript rather than from a stylesheet.
 *
 * `kit/bar.ts` holds `'--woc-bar-size'` and hands it to `style.setProperty`, so
 * the property exists on every element the kit sized and appears in no `.css`
 * file at all. Read against the sheets alone that is a token nothing declares,
 * which is exactly the shape of a game token that went away, and the report said
 * so on the first regeneration after the sizing work landed. It is not drift:
 * `styles/bar.css` guards those rules behind the `woc-bar-sized` class the same
 * code adds, which is a deliberate alternative to a fallback and is why there is
 * no comma to find.
 *
 * A quoted name is the whole heuristic, and it is loose on purpose: over-reading
 * costs a token being excluded that nothing declares anyway, while under-reading
 * puts a wrong warning in front of the next person to run this.
 */
const CUSTOM_PROPERTY_NAMED = /['"`](--[\w-]+)['"`]/g;

/**
 * A token count below which the read is treated as a wrong URL rather than a
 * thin theme.
 *
 * The deployed sheet carries 192. An empty or near-empty result would generate a
 * file that is valid CSS, commits cleanly, and quietly makes the stage render
 * every addon unstyled, which is the failure this exists to make loud. Set well
 * under the real number so a game release trimming its palette is not an error.
 */
const MIN_TOKENS = 40;

/**
 * The game classes the loader wears, which is the whole list.
 *
 * Six sites, all in `runtime/ui/kit/`: `panel` on a frame (frame-chrome.ts), a
 * tooltip, a modal and a menu; `panel-title` on a title bar; `x-btn` on a close
 * button. Written out here rather than discovered, because discovering a class
 * name from TypeScript source means a regex over string literals that is wrong
 * the first time somebody builds one by concatenation. `tests/tools-theme.test.ts`
 * is what stops the list going stale: it reads the kit and fails on a game class
 * that is not named here.
 */
const BORROWED_CLASSES: readonly string[] = ['panel', 'panel-title', 'x-btn'];

/**
 * A selector that is exactly one of the borrowed classes, with pseudo-classes.
 *
 * A single compound and nothing else, which is the point rather than a shortcut.
 * The game's sheet carries 58 rules mentioning these names and almost all of them
 * are scoped to something the loader never has: a game window id (`#bags`), a game
 * container (`.ta-panel`), the game's own `window` class, which a loader frame
 * deliberately does not wear, or a `body` state class for an accessibility or
 * performance mode nobody is screenshotting. Taking those would style the stage
 * from rules that cannot fire in a real session.
 */
const BORROWED_SELECTOR = /^\.(?:panel|panel-title|x-btn)(?::[a-z-]+)*$/;

/**
 * Every same-origin stylesheet `play.html` links, in document order.
 *
 * Cross-origin ones are dropped rather than followed: the only one is the Google
 * Fonts sheet, which declares no tokens and which the stage links for itself.
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
 * The custom properties every `:root` block in one sheet declares.
 *
 * Insertion order is source order, which is what keeps the generated file a real
 * diff: a token added upstream shows up as one added line rather than reshuffling
 * the whole thing. A later block wins on value and keeps its original position,
 * which is what the cascade does anyway.
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
 * Every rule styling a borrowed class, with the at-rules it was nested in.
 *
 * A brace walker rather than a regex, because the answer depends on nesting: the
 * same `.panel` selector appears in `@layer base`, in `@layer components` and
 * inside a `forced-colors` query, and all three mean different things. Rule bodies
 * are assumed flat, which holds for the minified sheet the game deploys: a nested
 * rule would be read as a declaration and dropped rather than misapplied.
 *
 * It compares the next `{` against the next `}` rather than matching a prelude
 * pattern, so whitespace between a rule and the brace closing its at-rule is
 * ordinary rather than the end of the walk. The minified sheet has none, which is
 * what makes that worth stating: the first version bailed silently on the first
 * newline, and only the round trip through `renderTheme` found it.
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

/**
 * Handle one block opening: descend into an at-rule, or record a rule and skip it.
 *
 * Split out of the walker because the two arms have nothing to do with each other
 * and together they push the loop past the length a function body is allowed.
 */
interface Block {
  css: string;
  prelude: string;
  /** The index just past the brace that opened this block. */
  opened: number;
}

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
 * Tokens the loader's own sheet reads WITHOUT a fallback and the game no longer
 * declares.
 *
 * This is the drift report the stage buys almost for free. A game release that
 * renames a token leaves a `var()` resolving to nothing, and the symptom is one
 * loader declaration silently not applying: no error, no console warning, and
 * nothing on screen except a colour that is now the inherited one. Reading the
 * loader's sheets against the theme is the only place that is visible before a
 * player reports it.
 *
 * A token the loader DECLARES is not one of these and is excluded, because the
 * game never declared it and never will: `--woc-gap` and `--woc-wrap-gap` are
 * written and read inside `ui/styles/layout.css` alone. Reported, they made the
 * warning fire on a regeneration where nothing had drifted, and a drift report
 * that cries wolf every run is one the next person learns to scroll past. The
 * exclusion is the DECLARING set rather than the `--woc-` prefix, so a loader
 * token that is read and never declared is still caught.
 *
 * DECLARING includes writing the property from JavaScript, which is `loaderSource`
 * and is the half a stylesheet cannot see. `--woc-bar-size` is set by `kit/bar.ts`
 * and read by `styles/bar.css`, so against the sheets alone it read as a token the
 * game had taken away, on the first regeneration after the sizing work shipped.
 *
 * The sets are read from whole concatenations rather than per file, which is what
 * makes this cheap and also what it rests on: a token declared in one file and
 * read in another is still excluded.
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
 * The generated stylesheet's text.
 *
 * Unlayered, unlike the game's own, which wraps these in `@layer tokens`. The
 * layer is what lets the game's later layers override its own base rules, and the
 * stage has no later layers: it is one `:root` and nothing else, so a layer here
 * would only be a thing to explain.
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
