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

function feature(item: Feature): Html {
  return html`<article class="feature ${item.flip && 'feature-flip'}">
  <div>
    <p class="eyebrow">${item.eyebrow}</p>
    <h3>${item.heading}</h3>
    <p>${item.body}</p>
    <p class="muted">${item.note}</p>
  </div>
  ${item.figure}
</article>`;
}

function features(items: readonly Feature[]): Html {
  return html`<section class="column section">
  <div class="section-head">
    <h2>What ships with it</h2>
    <a class="link-more" href="/addons">The full catalog →</a>
  </div>
  <div class="features">${items.map((item) => feature(item))}</div>
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
      <p><a class="link-more" href="/docs/">Read the authoring docs →</a></p>
    </div>
  </div>
</section>`;
}

interface Feature {
  readonly eyebrow: string;
  readonly heading: string;
  readonly body: string;
  readonly note: string;
  readonly figure: Html;
  readonly flip: boolean;
}

/** What the landing page needs that only the repository knows. */
export interface LandingData {
  readonly release: Release | null;
  /** `Name · version` per shipped addon, from marketplace.json. */
  readonly features: readonly string[];
}

/** Build the landing page. */
export function landing(build: Build, data: LandingData): Page {
  const items: Feature[] = [
    {
      eyebrow: data.features[0] ?? 'Combat Meter',
      heading: 'What your damage is actually made of',
      body: 'A row per ability with crit rate, average and biggest hit, plus your real miss, dodge and parry rates and what is hitting you back.',
      note: 'The game has its own meter. This answers what that one does not.',
      figure: figure(build.context.preview('combat-meter')),
      flip: false,
    },
    {
      eyebrow: data.features[1] ?? 'Cooldown Bars',
      heading: 'Everything on cooldown, soonest first',
      body: 'A draining bar for every ability you have on cooldown, with an exact bar for anything regenerating a charge.',
      note: 'Also the example addon: one file, no build step. It is what authors copy.',
      figure: figure(build.context.preview('cooldown-bars')),
      flip: true,
    },
    {
      eyebrow: 'The whole install',
      heading: 'Press Escape. There is a new entry.',
      body: 'No launcher, no account, nothing to keep running. The loader waits for the HUD to exist and adds one button to the menu you already use.',
      note: 'Dev Harness ships too: it exercises every API surface and reports what it found, so authors can check a change in the game rather than only in a test.',
      figure: figure(build.context.shot('game-menu')),
      flip: false,
    },
  ];
  return {
    path: '/',
    title: TITLE,
    description: DESCRIPTION,
    body: html`${hero(build, data.release)}${features(items)}${trust(build)}${outside(build)}`,
  };
}
