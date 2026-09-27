// /changelog, rendered from the generated CHANGELOG.md with its contributor preamble replaced.
// Keep git-cliff's link definitions at the end: the version headings are reference links.

import type { Build } from '../build.ts';
import { type Html, html, raw } from '../html.ts';
import type { Heading } from '../markdown.ts';
import type { Page } from '../shell.ts';

const TITLE = 'Changelog';

const DESCRIPTION =
  'Every release of the World of ClaudeCraft addon loader, newest first, generated from the commits it shipped.';

/** The first version heading. Everything above it is about the file, not the releases. */
const FIRST_VERSION = /^## /m;

/** A version is an h2. Every other level is a category inside one. */
const VERSION_LEVEL = 2;

/** Below this an index costs more space than it saves. Unrelated to VERSION_LEVEL. */
const TOC_THRESHOLD = 2;

/** Everything from the first version heading down, or nothing if there is none. */
function versionsFrom(source: string): string {
  const from = source.search(FIRST_VERSION);
  if (from === -1) {
    return '';
  }
  return source.slice(from);
}

function versionList(headings: readonly Heading[]): Html {
  const versions = headings.filter((one) => one.level === VERSION_LEVEL);
  if (versions.length < TOC_THRESHOLD) {
    return html``;
  }
  return html`<aside class="toc docs-side">
  <p>Releases</p>
  <ul>${versions.map((one) => html`<li><a href="#${one.id}">${one.text}</a></li>`)}</ul>
</aside>`;
}

/** Build the changelog page from the raw CHANGELOG.md. */
export function changelog(build: Build, source: string): Page {
  const body = versionsFrom(source);
  const rendered = build.markdown.render(body, build.context);
  return {
    path: '/changelog',
    title: `${TITLE} · ClaudeCraft Addons`,
    description: DESCRIPTION,
    body: html`<div class="prose-page column">
  <article class="docs-prose">
    <p class="eyebrow">Loader releases</p>
    <h1>${TITLE}</h1>
    <p class="lead">
      Newest first. Each entry is generated from the commits that release shipped, so what is
      listed here is what actually changed rather than a summary written afterwards.
    </p>
    ${body === '' && html`<p class="muted">No releases yet.</p>`}
    ${body !== '' && raw(rendered.html)}
    <p class="muted">
      Your installed addons, settings, keybinds and window positions survive every loader update:
      they are keyed to the userscript's identity, which never changes.
    </p>
  </article>
  ${versionList(rendered.headings)}
</div>`,
  };
}
