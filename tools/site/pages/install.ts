// The install page, which is the page that matters most: every visitor who does
// not finish it never sees the product.
//
// Built as a funnel with a sticky position indicator rather than as an article
// with three headings, because a reader has to know which step they are on and
// which branch they are in. Step 2 gets the most room on the page for one reason:
// it is where an install silently does nothing, with no error anywhere.
//
// One correction to the design's copy: it named the artifact `woc-addons.user.js`.
// The file the release workflow actually produces is `woc-loader.user.js`, and a
// download button naming a file that does not exist is the worst possible typo on
// this particular page.

import type { Build } from '../build.ts';
import { type Html, html, raw } from '../html.ts';
import { figure, installButton, type Release } from '../markup.ts';
import type { Page } from '../shell.ts';
import { CHROME_CHECKED, MANAGERS, STEPS, TROUBLE } from './install-data.ts';

const TITLE = 'Install';

const DESCRIPTION =
  'Install the World of ClaudeCraft addon loader: a userscript manager, one browser ' +
  'setting on Chromium, and one file. Three steps, with the one that fails quietly ' +
  'called out.';

const RELEASE_LATEST =
  'https://github.com/MarshalX/world-of-claudecraft-addons/releases/latest/download/woc-loader.user.js';

/**
 * Anchors only, no JavaScript.
 *
 * There is deliberately NO `aria-current` here. All three steps live on one page,
 * so which one you are "on" is a scroll position, and marking one in the markup
 * meant step 1 was announced as the current step even when you were reading step
 * 3. An attribute that says "you are here" and is wrong two thirds of the time is
 * worse for a screen reader than no attribute at all. The visible highlight
 * follows `:target` instead, which costs no script and is at least true after a
 * click. See steps.css.
 */
function steps(): Html {
  return html`<nav class="steps-wrap" aria-label="Install steps">
  <ol class="steps column">
    ${STEPS.map(
      (step) => html`<li>
      <a href="#${step.id}">
        <span class="step-n">${step.n}</span>
        <span class="step-name">${step.name}</span>
        ${step.qualifier && html`<span class="step-qualifier">${step.qualifier}</span>`}
      </a>
    </li>`,
    )}
  </ol>
</nav>`;
}

function managers(): Html {
  return html`<div class="manager-grid">
  ${MANAGERS.map(
    (one) => html`<div class="callout">
    <h3>${one.name}</h3>
    <p>${one.note}</p>
    <div class="manager-links">
      ${one.links.map((link) => html`<a class="btn" href="${link.href}">${link.label}</a>`)}
    </div>
  </div>`,
  )}
</div>`;
}

function stepOne(): Html {
  return html`<section id="step-1" class="column section">
  <p class="eyebrow">Step 1 of 3</p>
  <h2>Install a userscript manager</h2>
  <p class="lead">
    A manager is a browser extension that runs small scripts on pages you allow. Pick one, either
    works.
  </p>
  ${managers()}
</section>`;
}

/** The Chromium branch, which is the whole reason this page has a step 2. */
function chromium(build: Build): Html {
  return html`<div class="branch">
  <div class="branch-head">
    <h3>Chrome, Edge, Brave, Opera</h3>
    <p class="eyebrow">Required · do not skip</p>
  </div>
  <ol class="numbered">
    <li>Open <code>chrome://extensions</code> and click <strong>Details</strong> on your manager.</li>
    <li>
      Scroll to <strong>Allow User Scripts</strong>, below <strong>Site access</strong>, and turn
      it on. Chrome warns that the extension will be able to run code it has not reviewed, which
      is exactly what a userscript is.
    </li>
    <li>Reload the game tab. The setting does not apply to tabs that are already open.</li>
  </ol>
  ${figure(build.context.shot('chrome-user-scripts'))}
  <p class="muted">
    Wording and placement move between Chrome versions. On builds that have no such toggle, the
    equivalent is <strong>Developer mode</strong> at the top right of the extensions page.
  </p>
  <p class="muted">Checked against Chrome ${CHROME_CHECKED.version}, ${CHROME_CHECKED.date}.</p>
</div>`;
}

function stepTwo(build: Build): Html {
  return html`<section id="step-2" class="column section">
  <p class="eyebrow">Step 2 of 3 · branches by browser</p>
  <h2>Allow user scripts</h2>
  <p class="lead">
    This is the step that fails quietly. On Chromium the manager is installed, the loader is
    installed, the game loads, and nothing happens, with no error anywhere, because the browser is
    holding the script back behind one setting.
  </p>
  <p>Find your browser below and do only that block.</p>
  ${chromium(build)}
  <div class="branch">
    <div class="branch-head">
      <h3>Firefox</h3>
      <p class="eyebrow">Nothing to do</p>
    </div>
    <p>
      Firefox has no equivalent setting. Your manager can already run scripts.
      <a class="link-more" href="#step-3">Go to step 3 →</a>
    </p>
    <p class="muted">On Greasemonkey there is still nothing to switch on here, but see the caveat in step 1.</p>
  </div>
  <div class="branch">
    <div class="branch-head">
      <h3>Safari</h3>
      <p class="eyebrow">Not tested</p>
    </div>
    <p>
      The loader has never been run on Safari, so there are no instructions here worth following.
      Safari's userscript managers are separate paid apps rather than the extensions above, and
      recommending one for a browser nobody has tested this against would be a guess.
    </p>
    <p class="muted">
      If you get it working on Safari, <a href="${build.site.repo}/issues">say so in an issue</a>
      and this section can become real.
    </p>
  </div>
</section>`;
}

function stepThree(build: Build, release: Release | null): Html {
  return html`<section id="step-3" class="column section">
  <p class="eyebrow">Step 3 of 3</p>
  <h2>Install the loader</h2>
  <p class="lead">One file. Your manager will show you the source and ask you to confirm.</p>
  <div class="hero-actions">
    ${installButton(release, RELEASE_LATEST, 'woc-loader.user.js')}
    <a class="btn" href="${build.site.repo}/blob/main/loader/src">View the source first →</a>
  </div>
  <div class="two-up">
    <div>
      <h3>Did it work?</h3>
      <ol class="numbered">
        <li>Open the game and log in until you are in the world.</li>
        <li>Press <kbd>Esc</kbd>.</li>
        <li>The Game Menu has an <strong>Addons</strong> entry at the bottom.</li>
      </ol>
      <p class="muted">Nothing is installed by default. Open <strong>Addons → Browse</strong> and pick something.</p>
    </div>
    ${figure(build.context.shot('game-menu'))}
  </div>
</section>`;
}

function troubleshooting(build: Build): Html {
  return html`<section class="column section">
  <h2>If something is wrong</h2>
  <p>Keyed on what you can see, not on what went wrong internally.</p>
  <div class="table-wrap">
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th scope="col">Symptom</th><th scope="col">Cause and fix</th></tr>
        </thead>
        <tbody>
          ${TROUBLE.map(
            (row) => html`<tr><td>${raw(row.symptom)}</td><td>${raw(row.cause)}</td></tr>`,
          )}
        </tbody>
      </table>
    </div>
  </div>
  <p>
    Still stuck? <a href="${build.site.repo}/issues">Open an issue</a>, including your browser
    version and what Diagnostics reported.
  </p>
  <aside class="aside-rule">
    <p>
      Before you install addons: addon code runs in the game page with the same access the game
      has, including your session token. <a class="link-more" href="/#trust-h">What that means →</a>
    </p>
  </aside>
</section>`;
}

/** Build the install page. */
export function install(build: Build, release: Release | null): Page {
  return {
    path: '/install',
    title: `${TITLE} · ClaudeCraft Addons`,
    description: DESCRIPTION,
    body: html`${steps()}${stepOne()}${stepTwo(build)}${stepThree(build, release)}${troubleshooting(build)}`,
  };
}
