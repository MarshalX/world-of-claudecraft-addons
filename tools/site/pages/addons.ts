// The official catalog, generated entirely from the addon manifests.
//
// Nothing here is written twice. Name, version, author, description, tags and the
// declared permissions all come from addons/*/addon.json, which is the same file
// the loader validates, the marketplace index is built from, and the install
// confirmation reads. A catalog maintained by hand would be a fourth copy, and it
// would be the one that goes stale, because it is the only one nothing checks.
//
// That rule was half kept. Beside every card sat a hand-written line saying what
// the addon added that the game does not, and it covered three addons out of the
// three that existed the day it was written. It is gone rather than extended: a
// per-addon paragraph in the site generator is a description in a second place,
// and the manifest's own description is the one the manager and the install
// confirmation already show.
//
// A preview is optional: an addon whose addon.json declares no screenshot gets a
// card without one rather than failing the build, so publishing an addon is not
// gated on someone taking a picture of it. Where there IS one it is declared in
// the addon's own manifest, beside the file, which is why nothing about a shot
// appears in this file either.
//
// Filtering is INJECTED by site/assets/site.js from the `data-tags` each card
// carries, never rendered here, for the reason the theme toggle and the copy
// buttons are: a visitor with JavaScript off gets the whole grid rather than a
// row of dead chips. The tags themselves are the manifest's, so the filter offers
// exactly what Browse offers in the game.

import type { CatalogAddon } from '../../catalog.ts';
import type { Build } from '../build.ts';
import { type Html, html, join } from '../html.ts';
import { figure } from '../markup.ts';
import { countOf } from '../settings.ts';
import type { Page } from '../shell.ts';
import { addonPath } from './addon.ts';

const TITLE = 'Addons';

const DESCRIPTION =
  'The official addon catalog for World of ClaudeCraft: what each one does that the ' +
  'game does not, what it declares, and where it comes from.';

/**
 * What a card says about configuration, which is a COUNT and a link.
 *
 * The settings themselves are on the addon's own page. 143 of them across the
 * catalog, up to nine on one addon, is a grid where one cell is three times the
 * height of the ones beside it, and a card is a name, a picture and a sentence.
 */
function configurable(addon: CatalogAddon): Html | false {
  const parts = [countOf(addon.settings.length, 'setting')];
  if (addon.keybinds.length > 0) {
    parts.push(countOf(addon.keybinds.length, 'key'));
  }
  if (addon.settings.length === 0 && addon.keybinds.length === 0) {
    return false;
  }
  return html`<p class="addon-config">${parts.join(' · ')}</p>`;
}

function card(build: Build, addon: CatalogAddon): Html {
  const shot = build.previews.get(addon.id);
  return html`<article class="addon-card" id="${addon.id}" data-tags="${addon.tags.join(' ')}">
  <p class="addon-meta">${addon.version} · ${addon.author}</p>
  <h2><a href="${addonPath(addon.id)}">${addon.name}</a></h2>
  ${shot && figure(shot)}
  <p>${addon.description}</p>
  ${addon.tags.length > 0 && html`<ul class="tags">${addon.tags.map((tag) => html`<li>${tag}</li>`)}</ul>`}
  ${configurable(addon)}
  ${
    addon.permissions.length > 0 &&
    html`<p class="addon-declares">Declares ${join(
      addon.permissions.map((one) => html`<code>${one}</code>`),
      ', ',
    )}</p>`
  }
  <p><a class="link-more" href="${addonPath(addon.id)}">Settings, keys and what it declares →</a></p>
</article>`;
}

/**
 * The line naming what this page is not listing.
 *
 * Derived from the excluded rows rather than written out, so it cannot name an
 * author tool that has been renamed or miss one that was added. It is here at all
 * because the in-game Browse lists these and this page does not, and a count that
 * silently disagrees with the one in the game reads as a bug in one of them.
 */
function omitted(tools: readonly CatalogAddon[]): Html | false {
  if (tools.length === 0) {
    return false;
  }
  const names = join(
    tools.map((one) => html`<strong>${one.name}</strong>`),
    ', ',
  );
  return html`<p class="muted">
  Also shipped, for people writing addons rather than playing with them: ${names}. In
  <strong>Addons → Browse</strong> in the game and in <a href="/docs/">the authoring docs</a>,
  not here.
</p>`;
}

function trust(): Html {
  return html`<div class="trust-grid">
  <div class="callout">
    <p class="callout-label">Trust</p>
    <p>
      Everything here ships with the loader and cannot be removed, and its contents are reviewed.
      That is what makes it the trust anchor: it is the same repository as the loader itself.
    </p>
  </div>
  <div class="callout">
    <h3>Adding your own</h3>
    <p>
      A marketplace is a GitHub repository with an <code>addons/</code> directory and a generated
      index. Open a pull request to publish through this one, or run your own.
    </p>
  </div>
  <div class="callout">
    <h3>Third-party marketplaces</h3>
    <p>
      You may add any repository as a source. Doing so means trusting whoever maintains it with
      your account, and the loader says so at that moment. None are listed here.
    </p>
  </div>
</div>`;
}

/** What the catalog page needs that only the repository knows. */
export interface CatalogData {
  /** Everything a player installs, in directory order. */
  readonly catalog: readonly CatalogAddon[];
  /** The author tools this page leaves out, so it can say that it did. */
  readonly tools: readonly CatalogAddon[];
}

/** Build the catalog page. */
export function addons(build: Build, data: CatalogData): Page {
  return {
    path: '/addons',
    title: `${TITLE} · ClaudeCraft Addons`,
    description: DESCRIPTION,
    body: html`<section class="column section">
  <p class="eyebrow">${data.catalog.length} addons · official marketplace</p>
  <h1>The official catalog</h1>
  <p class="lead">
    Built in, reviewed, and installed from inside the game. Open <strong>Addons → Browse</strong>
    and everything below is already there.
  </p>
  ${omitted(data.tools)}
  <div class="card-grid" data-addon-grid>${data.catalog.map((addon) => card(build, addon))}</div>
  ${trust()}
</section>`,
  };
}
