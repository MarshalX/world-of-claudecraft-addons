// 404.html, served from the artifact root by GitHub Pages, through the same shell as every page.

import { html } from '../html.ts';
import type { Page } from '../shell.ts';

/** Build the not-found page. */
export function notFound(): Page {
  return {
    path: '/404',
    title: 'Not found · ClaudeCraft Addons',
    description: 'That page does not exist.',
    body: html`<section class="column section">
  <p class="eyebrow">404</p>
  <h1>That page does not exist</h1>
  <p class="lead">
    The link may be old, or it may be a page that was never written. Nothing here is behind a
    login, so if you expected content, it is missing rather than hidden.
  </p>
  <div class="hero-actions">
    <a class="btn" href="/">Home</a>
    <a class="btn" href="/install">Install</a>
    <a class="btn" href="/addons">Addons</a>
    <a class="btn" href="/docs/">Docs</a>
  </div>
</section>`,
  };
}
