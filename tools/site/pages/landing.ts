// The landing page: what it is, what ships with it, the trust section, and how
// small an addon is. One screen for a player who will not read.
//
// Three corrections to the copy this page was first drafted from, which was
// written against screenshots rather than against the repository. All three are
// the kind of thing the generated-from-truth rule exists to prevent:
//
//   - Its code sample used an API that does not exist (`woc.addon(...)`,
//     `api.ui.panel`, `api.on('cooldown:tick')`). The real surface has no
//     registration call at all. The block is now included from a real file.
//   - It listed `window.woc` as a surface the GAME exposes. The game exposes
//     `window.__game`; `woc` is what the LOADER hands an addon. Backwards.
//   - Addon versions were invented (1.2.0, 1.1.0). They come from the index now.
//
// The fourth is the one this file used to be: a heading, a body and a note
// hand-written per featured addon, which described the first two addons long
// after there were thirty. A featured block is now the addon's own name, tags,
// version and description, and the only thing decided here is WHICH addons get
// one, which lives in tools/featured.ts because the README shows the same set.

import type { CatalogAddon } from '../../catalog.ts';
import { FEATURED, spellOut } from '../../featured.ts';
import type { Build } from '../build.ts';
import { type Html, html, raw } from '../html.ts';
import { figure, installButton, type Release } from '../markup.ts';
import type { Page } from '../shell.ts';

const TITLE = 'Addons for World of ClaudeCraft';

const DESCRIPTION =
  'A userscript addon platform for World of ClaudeCraft. One install button adds an ' +
  'Addons entry to the game menu. Fully external to the game, and read-only by design.';

const TRUST = [
  {
    title: 'The official marketplace',
    body: 'Ships with the loader, cannot be removed, and its contents are reviewed. It is the same repository as the loader itself.',
  },
  {
    title: 'Third-party marketplaces',
    body: 'You may add your own. Doing so means trusting whoever maintains it with your account. The loader says so at that moment, not afterwards.',
  },
  {
    title: 'Read-only, by design',
    body: 'No send API, no synthetic input, no automation of play. Addons reformat information you already have. This is a boundary, not a missing feature.',
  },
] as const;

const DECLARED = [
  'Read the world: your character, your party, your target, nearby units',
  'Draw its own windows, buttons and messages inside the game',
  'Bind keys, and see a key press before the game does',
] as const;

const SURFACES = [
  { name: 'window.__game', note: 'the global the game already exposes' },
  { name: 'WebSocket', note: 'observed, never written to' },
  { name: 'HUD DOM ids', note: 'where panels anchor themselves' },
  { name: 'audio pack', note: 'for addon sounds that match the game' },
] as const;

/** The one block on this page about the loader rather than about an addon. */
const INSTALL_BLOCK = {
  eyebrow: 'The whole install',
  heading: 'Press Escape. There is a new entry.',
  body: 'No launcher, no account, nothing to keep running. The loader waits for the HUD to exist and adds one button to the menu you already use.',
} as const;

function hero(build: Build, release: Release | null): Html {
  return html`<section class="column section">
  <p class="eyebrow">Userscript · MIT · read-only</p>
  <div class="hero">
    <div>
      <h1>${TITLE}</h1>
      <p class="lead">
        One install button adds an <strong>Addons</strong> entry to the game menu. Browse a
        built-in marketplace, install an addon, configure it, all inside the game, with nothing
        about the game itself modified.
      </p>
      <p>It runs as a userscript. It reads only what the game already hands the browser, and it never plays for you.</p>
      <div class="hero-actions">
        ${installButton(release, '/install', 'userscript')}
        <a class="btn" href="${build.site.repo}">Read the source</a>
      </div>
      <p class="muted">Needs Tampermonkey or Violentmonkey. Three minutes, mostly waiting on the store.</p>
    </div>
    ${figure(build.context.shot('addons-installed'))}
  </div>
</section>`;
}

function feature(item: Feature, index: number): Html {
  return html`<article class="feature ${index % 2 === 1 && 'feature-flip'}">
  <div>
    <p class="eyebrow">${item.eyebrow}</p>
    <h3>${item.heading}</h3>
    <p>${item.body}</p>
  </div>
  ${item.figure}
</article>`;
}

/**
 * One featured addon, said in the addon's own words.
 *
 * The eyebrow carries the version and the tags rather than a slogan, because both
 * are facts the manifest already states and a slogan is the thing this page kept
 * getting wrong. The heading is the name a player sees in Browse, so the card on
 * screen and the row in the game read the same.
 */
function featureOf(build: Build, addon: CatalogAddon): Feature {
  return {
    eyebrow: [addon.version, ...addon.tags].join(' · '),
    heading: addon.name,
    body: addon.description,
    figure: figure(build.context.preview(addon.id)),
  };
}

/**
 * Every addon that is not featured above, as a link into its catalog card.
 *
 * Names only. The point of the strip is the SIZE of the catalog, which a visitor
 * cannot get from a handful of cards, and thirty descriptions on a landing page is
 * the catalog page with a different heading on it.
 */
function strip(rest: readonly CatalogAddon[]): Html {
  return html`<p class="eyebrow addon-strip-head">The other ${rest.length}</p>
<ul class="addon-strip">
  ${rest.map((one) => html`<li><a href="/addons#${one.id}">${one.name}</a></li>`)}
</ul>`;
}

/**
 * The featured rows, or a failed build naming the id that is gone.
 *
 * Loud rather than skipped, for the reason `Context.preview` throws: a featured
 * addon that has been renamed would otherwise take its block off the landing page
 * and nothing would say so, which is a page that quietly shows three cards.
 */
function chosen(catalog: readonly CatalogAddon[]): CatalogAddon[] {
  return FEATURED.map((id) => {
    const found = catalog.find((one) => one.id === id);
    if (!found) {
      throw new Error(`featured addon \`${id}\` is not in the catalog; see tools/featured.ts`);
    }
    return found;
  });
}

function features(build: Build, catalog: readonly CatalogAddon[]): Html {
  const shown = chosen(catalog);
  const items = [
    ...shown.map((addon) => featureOf(build, addon)),
    { ...INSTALL_BLOCK, figure: figure(build.context.shot('game-menu')) },
  ];
  const rest = catalog.filter((one) => !shown.includes(one));
  return html`<section class="column section">
  <div class="section-head">
    <h2>What ships with it</h2>
    <a class="link-more" href="/addons">The full catalog →</a>
  </div>
  <p class="lead">
    ${catalog.length} addons ship with the loader, reviewed and installed from inside the game.
    ${spellOut(shown.length)} of them:
  </p>
  <div class="features">${items.map((item, index) => feature(item, index))}</div>
  ${rest.length > 0 && strip(rest)}
</section>`;
}

function trust(build: Build): Html {
  return html`<section class="column section" aria-labelledby="trust-h">
  <p class="eyebrow">Before you install anything</p>
  <h2 id="trust-h">Installing an addon is equivalent in trust to installing a browser extension.</h2>
  <p class="lead">
    Addon code runs in the game page and can read anything the page can, including your session
    token. The <code>woc</code> API is an ergonomic surface, not a security boundary.
  </p>
  <div class="trust-grid">
    ${TRUST.map(
      (item) => html`<div class="callout">
      <h3>${item.title}</h3>
      <p>${item.body}</p>
    </div>`,
    )}
  </div>
  <div class="trust-panel">
    <div>
      <h3>What you see before it runs</h3>
      <p>The loader shows what the addon declares. Read the declaration and the caveat under it together: they are one statement.</p>
      <ul class="declared">${DECLARED.map((line) => html`<li>${line}</li>`)}</ul>
      <p class="muted">The declared list is what the author says the addon is for, not a limit the loader enforces.</p>
    </div>
    ${figure(build.context.shot('install-confirm'))}
  </div>
</section>`;
}

function outside(build: Build): Html {
  const example = build.markdown.render(
    '<!-- include: site/content/examples/minimal.js#whole -->',
    build.context,
  );
  return html`<section class="column section">
  <div class="two-up">
    <div>
      <h2>Fully outside the game</h2>
      <p>No game source is modified and no build is forked. The loader reaches the game only through surfaces a browser already gets:</p>
      <ul class="surfaces">
        ${SURFACES.map(
          (one) => html`<li><code>${one.name}</code><span class="muted">${one.note}</span></li>`,
        )}
      </ul>
    </div>
    <div>
      <h2>Writing one is small</h2>
      <p>A folder, a JSON manifest, one plain JavaScript file. No bundler, no toolchain, no framework.</p>
      ${raw(example.html)}
      <p class="muted">Dev Harness ships with the loader for this: it exercises every API surface and reports what it found, so a change can be checked in the game rather than only in a test.</p>
      <p><a class="link-more" href="/docs/">Read the authoring docs →</a></p>
    </div>
  </div>
</section>`;
}

interface Feature {
  readonly eyebrow: string;
  readonly heading: string;
  readonly body: string;
  readonly figure: Html;
}

/** What the landing page needs that only the repository knows. */
export interface LandingData {
  readonly release: Release | null;
  /** Every addon a player installs, in directory order. Author tools are not here. */
  readonly catalog: readonly CatalogAddon[];
}

/** Build the landing page. */
export function landing(build: Build, data: LandingData): Page {
  return {
    path: '/',
    title: TITLE,
    description: DESCRIPTION,
    body: html`${hero(build, data.release)}${features(build, data.catalog)}${trust(build)}${outside(build)}`,
  };
}
