// Blocks shared by Markdown prose and hand-built pages, so both emit the same markup.

import { type Html, html, raw } from './html.ts';
import type { Measured } from './shots.ts';

/** Where the site serves derivatives from. The PNG of record stays in screenshots/. */
const BASE = '/shots';

/**
 * A screenshot, on its near-black plate, with its caption under it.
 *
 * A portrait shot gets a class that caps its height in CSS; only the generator knows the file's
 * real shape. The plate is capped at the file's natural size, so a shot is never upscaled.
 * `alt` and the caption come from a manifest, never a template.
 */
export function figure(shot: Measured): Html {
  const { stem } = shot;
  return html`<figure class="${shot.portrait && 'shot-portrait'}">
  <div class="figure-plate" style="max-width:${shot.maxWidth}px">
    <picture>
      <source srcset="${BASE}/${stem}.avif" type="image/avif" />
      <source srcset="${BASE}/${stem}.webp" type="image/webp" />
      <img
        src="${BASE}/${shot.file}"
        alt="${shot.alt}"
        width="${shot.width}"
        height="${shot.height}"
        loading="lazy"
        decoding="async"
      />
    </picture>
  </div>
  ${shot.caption !== null && html`<figcaption>${shot.caption}</figcaption>`}
</figure>`;
}

/**
 * A code block, with the file it came from named in its header. `body` is shiki's markup. The
 * client script injects the copy button, so there is no dead button with JavaScript off.
 */
export function codeBlock(body: Html, name: string | null): Html {
  return html`<div class="code">
  ${name && html`<div class="code-head"><span class="code-name">${name}</span></div>`}
  ${body}
</div>`;
}

/** A hatched slot for a screenshot not taken yet, so a missing illustration reads as a gap. */
export function placeholder(lines: readonly string[], caption: string): Html {
  return html`<figure>
  <div class="figure-plate">
    <div class="figure-todo">${lines.map((line) => html`<span>${line}</span>`)}</div>
  </div>
  <figcaption>${caption}</figcaption>
</figure>`;
}

/**
 * The install button, shared by the landing page and the install page.
 *
 * The version is omitted with no release, since package.json always says 0.0.0. Put a filename
 * in `meta`, never the label: the label is Cinzel, which has no lowercase.
 */
export function installButton(release: Release | null, href: string, meta: string): Html {
  const version = release && `${release.version} · ${release.size} · `;
  return html`<a class="btn-install" href="${href}">
  <span class="btn-install-label">Install the loader</span>
  <span class="btn-install-meta">${version}${meta}</span>
</a>`;
}

/** A heading's slug, used for its id and by the on-this-page aside. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

/** Wrap already-highlighted markup that shiki produced. */
export function trustedCode(rendered: string): Html {
  return raw(rendered);
}

/** The current release, or null before one exists. */
export interface Release {
  readonly version: string;
  readonly size: string;
}
