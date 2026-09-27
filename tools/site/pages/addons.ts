// The official catalog, generated entirely from addons/*/addon.json. Never add per-addon prose
// here: it would be a second description that nothing checks. A missing preview is a card
// without one, never a failed build. site.js injects the tag filter from `data-tags`, so there
// are no dead chips with JavaScript off.

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

/** What a card says about configuration: a count. The settings are on the addon's own page. */
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
 * The line naming the author tools this page leaves out, derived from the rows, so the count
 * visibly agrees with the in-game Browse.
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
