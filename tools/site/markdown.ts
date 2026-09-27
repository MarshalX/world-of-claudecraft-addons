// Markdown to HTML, with `![](shot:id)` for a screenshot and an include comment for code. Keep
// `html: false`: raw HTML in a content file is a mistake, and escaping it makes that visible.
// The caller supplies `shot` and `include`, so this module does no I/O.

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
 * Done before parsing so an included example takes the same fence path as a hand-written one.
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
 * `rules` is an index signature, so TypeScript forbids the dot and Biome's useLiteralKeys forbids a
 * literal bracket; a computed key satisfies both (see STYLE.md).
 */
function setRule(md: MarkdownIt, name: string, output: string): void {
  md.renderer.rules[name] = () => output;
}

/**
 * Build the renderer. `highlight` is injected so the suite needs no shiki theme and this module
 * stays synchronous.
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
  // A wide table scrolls inside its own box instead of scrolling the page sideways on a phone.
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
   * One addon's preview, by addon id. Throws when that addon declares none, naming the addon's
   * manifest as the file to fix.
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
