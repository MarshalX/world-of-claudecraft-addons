// The document every page is wrapped in: head, header, footer.
//
// Two scripts, and the order matters. The theme snippet is INLINE and BLOCKING in
// the head, before any paint, because a visitor whose stored theme differs from
// their system preference would otherwise see a flash of the wrong one. The other
// is a module (deferred by definition, and scoped, so nothing leaks to the page's
// globals) and it INJECTS its own controls, so there is no dead button with
// JavaScript off.

import { type Html, html, raw } from './html.ts';

const NAV = [
  { href: '/install', label: 'Install' },
  { href: '/addons', label: 'Addons' },
  { href: '/docs/', label: 'Docs' },
] as const;

/**
 * The copyright line, matching LICENSE exactly.
 *
 * The year is the year of first publication and is deliberately a CONSTANT rather
 * than the current one. Generating it would put a clock in the build, which makes
 * two builds of the same commit differ, and the site build is meant to be
 * reproducible for the same reason `pnpm index` takes its timestamp from the
 * commit. It is also what the convention actually asks for: the year the work was
 * published, extended to a range only when the work materially changes.
 */
const COPYRIGHT = { year: '2026', holder: 'Ilya Siamionau', handle: 'MarshalX' } as const;

/**
 * Read the stored theme before the first paint.
 *
 * Deliberately tiny, deliberately inline, and deliberately not in a file: an
 * external script cannot run before paint whatever its attributes say, and this
 * one exists only to prevent a flash. It writes the attribute tokens.css reads.
 */
const THEME_SNIPPET = `try{var t=localStorage.getItem('woc-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * Only the two faces that are certain to be used above the fold.
 *
 * Cinzel 700 is every heading including the h1, and Alegreya Sans 400 is the lead
 * paragraph. The other three (Cinzel 400 for nav and labels, Alegreya 500 and 700)
 * are discovered from the inlined stylesheet a moment later, which is soon enough
 * for type that is not the first thing read. Preloading all five would put 101 kB
 * on the critical path to save a reflow on 50 kB of it.
 */
const PRELOADS = ['cinzel-700', 'alegreya-sans-400']
  .map(
    (name) =>
      `<link rel="preload" href="/assets/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin />`,
  )
  .join('\n');

function meta(page: Page, site: Site): Html {
  const url = `${site.origin}${page.path}`;
  return html`<meta name="description" content="${page.description}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${site.name}" />
<meta property="og:title" content="${page.title}" />
<meta property="og:description" content="${page.description}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${site.origin}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />`;
}

function header(page: Page): Html {
  return html`<header class="site-header">
  <div class="column">
    <a class="lockup" href="/">${'ClaudeCraft Addons'}</a>
    <nav class="site-nav" aria-label="Primary">
      ${NAV.map(
        (item) => html`<a
        href="${item.href}"
        ${page.path.startsWith(item.href) && html`aria-current="page"`}
      >${item.label}</a>`,
      )}
      <a href="${'https://github.com/MarshalX/world-of-claudecraft-addons'}">Source</a>
    </nav>
  </div>
</header>`;
}

function footer(site: Site): Html {
  return html`<footer class="site-footer">
  <div class="column">
    <div class="site-footer-legal">
      <p>
        © ${COPYRIGHT.year} ${COPYRIGHT.holder}
        (<a href="${`https://github.com/${COPYRIGHT.handle}`}">@${COPYRIGHT.handle}</a>).
        MIT licensed.
      </p>
      <p>Not affiliated with or endorsed by the World of ClaudeCraft project.</p>
    </div>
    <nav class="site-footer-links" aria-label="Footer">
      <a href="${site.repo}">Source</a> · <a href="/changelog">Changelog</a> ·
      <a href="${site.repo}/issues">Report a problem</a>
    </nav>
  </div>
</footer>`;
}

/**
 * Wrap a page body in the document.
 *
 * `styles` is the concatenated stylesheet, inlined rather than linked: it is
 * small enough that a request on the critical path costs more than the bytes,
 * and it means a page has no render-blocking fetch at all.
 */
export function shell(page: Page, site: Site, styles: string): Html {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${page.title}</title>
${meta(page, site)}
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
${raw(PRELOADS)}
<script>${raw(THEME_SNIPPET)}</script>
<style>${raw(styles)}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${header(page)}
<main id="main">${page.body}</main>
${footer(site)}
<script src="/assets/site.js" type="module"></script>
</body>
</html>`;
}

/** One rendered page, before it is wrapped. */
export interface Page {
  /** Site-absolute, with a leading slash, ending in / for a directory route. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly body: Html;
}

/** Everything that is the same on every page. */
export interface Site {
  readonly name: string;
  readonly origin: string;
  readonly repo: string;
}
