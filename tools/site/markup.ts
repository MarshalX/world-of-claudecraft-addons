// The two blocks that appear in both prose and page templates: a screenshot
// figure and a code block. Built here so a docs page written in Markdown and a
// hand-built landing section emit the same markup for the same thing.

import { type Html, html, raw } from './html.ts';
import type { Measured } from './shots.ts';

/** Where the site serves derivatives from. The PNG of record stays in screenshots/. */
const BASE = '/shots';

const PNG_SUFFIX = /\.png$/;

/**
 * A screenshot, on its near-black plate, with its caption under it.
 *
 * A PORTRAIT shot is additionally capped by height. The Combat Meter panel and the
 * Game Menu are tall and narrow because the things they show are, and filling a
 * 496px column with one produced a 600px-tall row with the paragraph beside it
 * floating in dead space. Capping the height puts such a shot at roughly the size
 * it occupies in the game, which is also where its rows are most legible. The
 * class is emitted here rather than guessed in CSS because only the generator
 * knows the file's real shape.
 *
 * The plate is capped at the file's natural size in CSS pixels, which is the whole
 * no-upscale rule: a shot wider than its column is unaffected, and a narrower one
 * stops short and centres rather than stretching. So an undersized screenshot is
 * smaller and sharp instead of full-width and soft.
 *
 * Both `alt` and the caption come from the manifest and are never written into a
 * template, so a re-shoot changes the page without a template edit and a
 * description cannot go stale in a second place. An addon's preview carries alt
 * text from its own `addon.json` and no caption, because the card it sits in has
 * already named it.
 */
export function figure(shot: Measured): Html {
  const stem = shot.file.replace(PNG_SUFFIX, '');
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
 * A code block, with the file it came from named in its header.
 *
 * `body` is markup rather than text because shiki has already turned it into
 * spans carrying both themes. The copy button is NOT here: it is injected by the
 * client script, so there is no dead button with JavaScript off.
 */
export function codeBlock(body: Html, name: string | null): Html {
  return html`<div class="code">
  ${name && html`<div class="code-head"><span class="code-name">${name}</span></div>`}
  ${body}
</div>`;
}

/**
 * A slot for a screenshot that has not been taken yet.
 *
 * The design drew these as hatched boxes and they earn their place: a step whose
 * illustration is simply absent reads as a finished step, while a box saying what
 * belongs there reads as a gap. The install page's step 2 is the one that matters,
 * since that is where an install silently does nothing.
 */
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
 * The VERSION is omitted when there is no release rather than showing
 * package.json's 0.0.0, which the tag-driven release model leaves permanently
 * unreleased. See tools/site.mjs.
 *
 * The label is fixed, and a filename belongs in `meta` rather than in it: the
 * label is set in Cinzel, which has no lowercase and renders at text sizes as
 * small caps, so `woc-loader.user.js` came out as WOC-LOADER.USER.JS and stopped
 * reading as a filename at all. The meta line is mono, where it reads as typed.
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
