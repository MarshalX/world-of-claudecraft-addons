// The official catalog, generated entirely from the addon manifests.
//
// Nothing here is written twice. Name, version, author, description, tags and the
// declared permissions all come from addons/*/addon.json, which is the same file
// the loader validates, the marketplace index is built from, and the install
// confirmation reads. A catalog maintained by hand would be a fourth copy, and it
// would be the one that goes stale, because it is the only one nothing checks.
//
// A preview is optional: an addon whose addon.json declares no screenshot gets a
// card without one rather than failing the build, so publishing an addon is not
// gated on someone taking a picture of it. Where there IS one it is declared in
// the addon's own manifest, beside the file, which is why nothing about a shot
// appears in this file either.

import type { Build } from '../build.ts';
import { type Html, html, join } from '../html.ts';
import { figure } from '../markup.ts';
import type { Page } from '../shell.ts';

const TITLE = 'Addons';

const DESCRIPTION =
  'The official addon catalog for World of ClaudeCraft: what each one does that the ' +
  'game does not, what it declares, and where it comes from.';

/** What each addon adds that the game does not, which the manifest cannot say. */
const GAPS: Record<string, string> = {
  'combat-meter':
    'The game has its own meter, so this does not compete on party totals or threat. It answers what nothing in the game answers: what your damage and healing are made of.',
  'cooldown-bars':
    'The example to copy. Small enough to read in a sitting, and it teaches the one thing that is not obvious from the API: subscribe for the change, animate from the read.',
  'dev-harness':
    'Every surface at once. It runs a check against each part of the API and reports what it found, which is also how the loader gets checked against a live game.',
};

function card(build: Build, addon: CatalogAddon): Html {
  const shot = build.previews.get(addon.id);
  return html`<article class="addon-card">
  <p class="addon-meta">${addon.version} · ${addon.author}</p>
  <h2>${addon.name}</h2>
  ${shot && figure(shot)}
  <p>${addon.description}</p>
  ${GAPS[addon.id] && html`<p class="muted">${GAPS[addon.id]}</p>`}
  ${addon.tags.length > 0 && html`<ul class="tags">${addon.tags.map((tag) => html`<li>${tag}</li>`)}</ul>`}
  ${
    addon.permissions.length > 0 &&
    html`<p class="addon-declares">Declares ${join(
      addon.permissions.map((one) => html`<code>${one}</code>`),
      ', ',
    )}</p>`
  }
  <p><a class="link-more" href="${build.site.repo}/tree/main/addons/${addon.id}">Read the source →</a></p>
</article>`;
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

/** Build the catalog page. */
export function addons(build: Build, catalog: readonly CatalogAddon[]): Page {
  return {
    path: '/addons',
    title: `${TITLE} · ClaudeCraft Addons`,
    description: DESCRIPTION,
    body: html`<section class="column section">
  <p class="eyebrow">${catalog.length} addons · official marketplace</p>
  <h1>The official catalog</h1>
  <p class="lead">
    Built in, reviewed, and installed from inside the game. Open <strong>Addons → Browse</strong>
    and everything below is already there.
  </p>
  <div class="card-grid">${catalog.map((addon) => card(build, addon))}</div>
  ${trust()}
</section>`,
  };
}

/** One row of the catalog, as the manifest declares it. */
export interface CatalogAddon {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly permissions: readonly string[];
}
