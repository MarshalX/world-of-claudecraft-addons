// The docs shell: the seven-page sidebar, the on-this-page aside, and the
// prev/next pagination.
//
// All three generate from ONE fact, the `order` in each page's frontmatter, plus
// the h2s the markdown renderer collected. There is no index file and no nav
// array to keep in step, so adding a docs page is adding one Markdown file. That
// is the thing that rots first in a docs section: someone writes the page and
// forgets the list, and the page exists but is unreachable.

import type { Build } from '../build.ts';
import { type Html, html, raw } from '../html.ts';
import type { Heading } from '../markdown.ts';
import type { Page } from '../shell.ts';

const NOTE =
  'The manifest reference is generated from the schema in the repository. If the two ever disagree, the schema wins.';

function sidebar(pages: readonly DocPage[], current: DocPage): Html {
  return html`<nav class="doc-nav docs-side" aria-label="Documentation">
  <p>Authoring an addon</p>
  <ol>
    ${pages.map(
      (page) => html`<li>
      <a href="${page.href}" ${page.slug === current.slug && html`aria-current="page"`}>${page.title}</a>
    </li>`,
    )}
  </ol>
  <p class="doc-nav-note">${NOTE}</p>
</nav>`;
}

/** Only h2s: h3s under them would make the aside as long as the page. */
function toc(headings: readonly Heading[]): Html {
  const tops = headings.filter((one) => one.level === 2);
  if (tops.length === 0) {
    return html``;
  }
  return html`<aside class="toc docs-side">
  <p>On this page</p>
  <ul>${tops.map((one) => html`<li><a href="#${one.id}">${one.text}</a></li>`)}</ul>
</aside>`;
}

function pager(previous: DocPage | undefined, next: DocPage | undefined): Html {
  if (!(previous || next)) {
    return html``;
  }
  return html`<nav class="doc-pager" aria-label="Documentation pagination">
  ${
    previous &&
    html`<a href="${previous.href}">
    <span class="doc-pager-dir">Previous</span>
    <span class="doc-pager-title">← ${previous.title}</span>
  </a>`
  }
  ${
    next &&
    html`<a class="doc-pager-next" href="${next.href}">
    <span class="doc-pager-dir">Next</span>
    <span class="doc-pager-title">${next.title} →</span>
  </a>`
  }
</nav>`;
}

/**
 * Render one docs page inside the shell.
 *
 * `pages` is every page in sidebar order, so this function needs no knowledge of
 * where the current one sits beyond its index.
 */
export function docsPage(build: Build, pages: readonly DocPage[], index: number): Page {
  const current = pages[index];
  if (!current) {
    throw new Error(`docs: no page at index ${index}`);
  }
  const rendered = build.markdown.render(current.body, build.context);
  return {
    path: current.href,
    title: `${current.title} · ClaudeCraft Addons`,
    description: current.summary,
    body: html`<div class="docs column column-wide">
  ${sidebar(pages, current)}
  <article class="docs-prose">
    <p class="eyebrow">Authoring</p>
    <h1>${current.title}</h1>
    <p class="lead">${current.summary}</p>
    ${raw(rendered.html)}
    ${pager(pages[index - 1], pages[index + 1])}
  </article>
  ${toc(rendered.headings)}
</div>`,
  };
}

/** One docs page, after its frontmatter has been read. */
export interface DocPage {
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly summary: string;
  readonly order: number;
  readonly body: string;
}
