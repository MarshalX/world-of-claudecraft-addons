// Markdown to HTML, with the two references that keep prose from repeating the
// repository: `![](shot:id)` for a screenshot and an include comment for code.
//
// `html: false` is deliberate. Prose is prose; the two things a page legitimately
// needs beyond Markdown have their own syntax above, so raw HTML in a content file
// is a mistake rather than an escape hatch, and escaping it makes that visible.
//
// Neither resolver touches the filesystem. The caller passes `shot` and `include`
// functions, which keeps this module pure and testable and leaves the one place
// that does I/O in the CLI where the rest of it already lives.

import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { render } from './html.ts';
import { codeBlock, figure, slugify, trustedCode } from './markup.ts';
import type { Measured } from './shots.ts';

const INCLUDE = /^[ \t]*<!--\s*include:\s*(\S+?)(?:#([a-z0-9-]+))?\s*-->[ \t]*$/gm;
const SHOT = /^shot:([a-z0-9-]+)$/;
const BACKTICKS = /`+/g;
const WHITESPACE = /\s+/;

/** paragraph_open, inline, paragraph_close: the three tokens a lone image makes. */
const PARAGRAPH_TOKENS = 3;

/** A fence needs one more backtick than the longest run inside it, and at least three. */
const FENCE_MIN = 3;

/** h1 is the page title, which the shell renders and the aside never lists. */
const ANCHORED = new Set(['h2', 'h3']);

const LANGS: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  json: 'json',
  css: 'css',
  html: 'html',
  yml: 'yaml',
  sh: 'bash',
};

function langFor(path: string): string {
  return LANGS[path.split('.').pop() ?? ''] ?? 'text';
}

/** So a fenced block never terminates on a backtick run inside the code. */
function fenceFor(code: string): string {
  const longest = (code.match(BACKTICKS) ?? []).reduce(
    (most, run) => Math.max(most, run.length),
    0,
  );
  return '`'.repeat(Math.max(FENCE_MIN, longest + 1));
}

/**
 * Replace every include comment with a fenced block holding the real code.
 *
 * Done before parsing rather than as a token rule, so an included example goes
 * through exactly the same fence path a hand-written one does and cannot pick up
 * different highlighting or a different wrapper.
 */
function expandIncludes(source: string, context: Context): string {
  return source.replaceAll(INCLUDE, (_match, path: string, region?: string) => {
    const code = context.include(path, region ?? null);
    const fence = fenceFor(code);
    return `${fence}${langFor(path)} ${path}\n${code}\n${fence}`;
  });
}

/** The shot id of a paragraph that holds nothing but a `shot:` image. */
function shotIdAt(tokens: readonly Token[], index: number): string | undefined {
  const inline = tokens[index + 1];
  if (tokens[index]?.type !== 'paragraph_open' || inline?.type !== 'inline') {
    return;
  }
  const children = inline.children ?? [];
  if (children.length !== 1) {
    return;
  }
  return SHOT.exec(children[0]?.attrGet('src') ?? '')?.[1];
}

/** Give every h2 and h3 an id, and collect them for the on-this-page aside. */
function anchorHeadings(md: MarkdownIt, headings: Heading[]): void {
  md.core.ruler.push('heading-anchors', (state) => {
    for (const [index, token] of state.tokens.entries()) {
      if (token.type === 'heading_open' && ANCHORED.has(token.tag)) {
        const text = state.tokens[index + 1]?.content ?? '';
        const id = slugify(text);
        token.attrSet('id', id);
        headings.push({ id, text, level: Number(token.tag.slice(1)) });
      }
    }
    return true;
  });
}

/** Turn a paragraph holding only a `shot:` image into a block-level figure. */
function collapseShots(md: MarkdownIt, current: () => Context): void {
  md.core.ruler.push('shot-figures', (state) => {
    // Backwards, because each match splices three tokens down to one.
    for (let index = state.tokens.length - PARAGRAPH_TOKENS; index >= 0; index -= 1) {
      const id = shotIdAt(state.tokens, index);
      if (id) {
        const block = new state.Token('html_block', '', 0);
        block.content = render(figure(current().shot(id)));
        state.tokens.splice(index, PARAGRAPH_TOKENS, block);
      }
    }
    return true;
  });
}

/**
 * Replace a renderer rule with a constant string.
 *
 * A helper rather than `md.renderer.rules.table_open = ...` at the call site,
 * because `rules` is an index signature: TypeScript's
 * noPropertyAccessFromIndexSignature forbids the dot and Biome's useLiteralKeys
 * forbids the bracket. The computed access here has no literal key, which is the
 * idiom STYLE.md documents for exactly this pair.
 */
function setRule(md: MarkdownIt, name: string, output: string): void {
  md.renderer.rules[name] = () => output;
}

/**
 * Build the renderer.
 *
 * `highlight` is injected rather than imported so the suite can pin the pipeline
 * without pinning a shiki theme, and so this module stays synchronous: loading
 * grammars is the caller's problem, and it only happens once.
 */
export function createRenderer(highlight: Highlight): Renderer {
  const headings: Heading[] = [];
  let context: Context | null = null;
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  anchorHeadings(md, headings);
  collapseShots(md, () => {
    if (!context) {
      throw new Error('shot reference resolved outside a render');
    }
    return context;
  });
  // Every table gets the designed shell, so a wide manifest table scrolls inside
  // its own box rather than making the whole page scroll sideways on a phone.
  setRule(md, 'table_open', '<div class="table-wrap"><div class="table-scroll"><table>');
  setRule(md, 'table_close', '</table></div></div>');
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const [lang, ...rest] = (token?.info ?? '').trim().split(WHITESPACE);
    const body = highlight(token?.content ?? '', lang || 'text');
    return render(codeBlock(trustedCode(body), rest.join(' ') || null));
  };
  return {
    render(source, forPage) {
      headings.length = 0;
      context = forPage;
      try {
        return { html: md.render(expandIncludes(source, forPage)), headings: [...headings] };
      } finally {
        context = null;
      }
    },
  };
}

/** Highlight one block. Supplied by the caller so shiki stays out of the tests. */
export type Highlight = (code: string, lang: string) => string;

/** What a page needs resolved while it renders. */
export interface Context {
  /** Throws when the id is unknown, so a renamed shot fails the build. */
  readonly shot: (id: string) => Measured;
  /**
   * One addon's preview, by addon id. Throws when that addon declares none.
   *
   * Separate from `shot` rather than a fallback inside it, so that a page asking
   * for an addon's screenshot fails saying the addon has no preview rather than
   * saying there is no shot by that name, which would send whoever reads it to
   * the wrong file.
   */
  readonly preview: (id: string) => Measured;
  /** Throws when the file or region is gone. See regions.ts. */
  readonly include: (path: string, region: string | null) => string;
}

/** A heading, for the on-this-page aside. */
export interface Heading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

/** The rendered page. */
export interface Rendered {
  readonly html: string;
  readonly headings: readonly Heading[];
}

export interface Renderer {
  readonly render: (source: string, context: Context) => Rendered;
}
