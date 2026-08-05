// One page per addon: everything its manifest declares, in the order somebody
// deciding whether to install it asks for it.
//
// It exists because the catalog card ran out of room. A card is a name, a
// picture and a sentence, and an addon also declares what it lets you change
// (143 settings across the catalog, up to nine on one addon), what it binds, what
// it reads and what it works well beside. Cramming that into a grid cell makes
// one card three times the height of its neighbours; hiding it behind a
// disclosure makes it something nobody finds.
//
// Everything here is the manifest, and the settings and keybinds are the same
// declarations the LOADER reads to build the panes a player will actually meet.
// So this page cannot describe a control that does not exist, and an addon that
// adds a setting documents it by shipping.
//
// Author tools get no page, for the reason they get no card: the catalog is what
// a player reads. dev-harness is named on the catalog page and pointed at the
// docs, which is where somebody who wants it is already standing.

import { describeCombo } from '../../../loader/src/shared/combo.ts';
import type { CatalogAddon } from '../../catalog.ts';
import type { Build } from '../build.ts';
import { type Html, html, join } from '../html.ts';
import { figure } from '../markup.ts';
import { countOf, describeSetting } from '../settings.ts';
import type { Page } from '../shell.ts';
import { fillsOwnRow } from '../shots.ts';

/** Where an addon's page lives. One place, so a link cannot disagree with it. */
function addonPath(id: string): string {
  return `/addons/${id}`;
}

function settingRow(setting: ReturnType<typeof describeSetting>): Html {
  const parts = [setting.kind, setting.detail, `default ${setting.fallback}`].filter(
    (one) => one !== null,
  );
  return html`<li>
  <p class="setting-label">${setting.label}</p>
  <p class="setting-meta">${parts.join(' · ')}</p>
</li>`;
}

/**
 * What the addon lets a player change.
 *
 * Absent is a real answer and is printed as one: an addon with nothing to
 * configure is a fact about that addon, and a section that simply vanishes reads
 * as a page that failed to render.
 */
function settings(addon: CatalogAddon): Html {
  if (addon.settings.length === 0) {
    return html`<section class="addon-block">
  <h2>Settings</h2>
  <p class="muted">This addon declares none. There is nothing to configure.</p>
</section>`;
  }
  return html`<section class="addon-block">
  <h2>Settings</h2>
  <p class="muted">
    ${countOf(addon.settings.length, 'setting')}, changed in <strong>Addons → Installed →
    Configure</strong>. The loader draws these controls from the manifest, so this is the pane
    itself rather than a description of one.
  </p>
  <ul class="setting-list">${addon.settings.map((one) => settingRow(describeSetting(one)))}</ul>
</section>`;
}

/**
 * What the addon binds, printed the way the manager prints it.
 *
 * Through the loader's own `describeCombo`, so `Alt+KeyB` reads as `Alt+B` here
 * and in the game with one implementation between them.
 */
function keybinds(addon: CatalogAddon): Html | false {
  if (addon.keybinds.length === 0) {
    return false;
  }
  return html`<section class="addon-block">
  <h2>Keys</h2>
  <p class="muted">
    ${countOf(addon.keybinds.length, 'default binding')}, rebindable in the same place, and the
    manager says when one is already taken by the game.
  </p>
  <ul class="keybind-list">
    ${addon.keybinds.map(
      (one) => html`<li><span>${one.label}</span><kbd>${describeCombo(one.default)}</kbd></li>`,
    )}
  </ul>
</section>`;
}

/**
 * The declared permissions, with the sentence that makes them honest.
 *
 * The caveat is not optional and never appears without them: addon code runs in
 * the page with the page's globals in scope, so a list on its own reads as a
 * sandbox and there is not one. Same statement as the install confirmation makes
 * in the game, at the moment somebody is reading the same list.
 */
function declares(build: Build, addon: CatalogAddon): Html | false {
  if (addon.permissions.length === 0) {
    return false;
  }
  return html`<section class="addon-block">
  <h2>What it declares</h2>
  <ul class="tags">${addon.permissions.map((one) => html`<li><code>${one}</code></li>`)}</ul>
  <p class="muted">
    A disclosure, not a boundary. Addon code runs in the game page with the page's own globals in
    scope, so this is what the author says the addon is for rather than a limit the loader
    enforces. <a href="${build.site.repo}/tree/main/addons/${addon.id}">Read the source</a> if that
    matters to you, and it should.
  </p>
</section>`;
}

/**
 * One companion, named and explained. The reason is the author's own sentence
 * about what that addon adds; a companion named without one is just the link,
 * rather than a manufactured sentence saying nothing.
 */
function companionLine(one: CatalogAddon, reason: string): Html {
  const link = html`<a href="${addonPath(one.id)}">${one.name}</a>`;
  if (reason === '') {
    return link;
  }
  return html`${link}, which ${reason}`;
}

/** Addons this one works better beside, as links. A note, never a dependency. */
function companions(addon: CatalogAddon, catalog: readonly CatalogAddon[]): Html | false {
  const found = addon.companions
    .map((id) => catalog.find((one) => one.id === id))
    .filter((one) => one !== undefined);
  if (found.length === 0) {
    return false;
  }
  return html`<p class="addon-companions">
  Works well beside ${join(
    found.map((one) => companionLine(one, addon.companionReasons[one.id] ?? '')),
    '; ',
  )}. A note from the author rather than a dependency: nothing here installs anything.
</p>`;
}

function intro(addon: CatalogAddon): Html {
  return html`<div>
  <p class="eyebrow"><a href="/addons">Addons</a> · ${addon.version} · ${addon.author}</p>
  <h1>${addon.name}</h1>
  <p class="lead">${addon.description}</p>
  ${addon.tags.length > 0 && html`<ul class="tags">${addon.tags.map((tag) => html`<li>${tag}</li>`)}</ul>`}
  <p class="muted">Install it from <strong>Addons → Browse</strong> inside the game.</p>
</div>`;
}

/**
 * The name, what it does, and the picture, placed by how big the picture is.
 *
 * Beside the text is the good shape and is what most addons get: a single HUD
 * panel is 776 device pixels wide, it fills its half of the row at the size it
 * has in the game, and the description reads next to it. What broke that was
 * never the layout, it was the FILE: previews were measured once for a catalog
 * cell, so every one of them capped at 350 CSS px and used two thirds of the
 * column it was given. `previewsWide` is the same picture measured for this slot.
 *
 * The exception is the two-panel sheets. Satchel, Ledgerline, Longwatch and
 * Emberwatch carry between 1900 and 2350 device pixels, and half a row is not a
 * small version of that picture, it is an unreadable one. Those take a row of
 * their own, and `fillsOwnRow` decides it from the file rather than from a list
 * of ids, so an addon that re-shoots its preview wider is laid out for what it
 * shipped rather than for what it used to be.
 */
function head(build: Build, addon: CatalogAddon): Html {
  const shot = build.previewsWide.get(addon.id);
  if (shot === undefined) {
    return html`<div class="addon-head addon-head-alone">${intro(addon)}</div>`;
  }
  if (fillsOwnRow(shot)) {
    return html`<div class="addon-head addon-head-alone">${intro(addon)}</div>
${figure(shot)}`;
  }
  return html`<div class="addon-head">${intro(addon)}${figure(shot)}</div>`;
}

/** Build one addon's page. */
function addonPage(build: Build, addon: CatalogAddon, catalog: readonly CatalogAddon[]): Page {
  return {
    path: addonPath(addon.id),
    title: `${addon.name} · ClaudeCraft Addons`,
    description: addon.description,
    body: html`<section class="column section">
  ${head(build, addon)}
  ${settings(addon)}
  ${keybinds(addon)}
  ${declares(build, addon)}
  ${companions(addon, catalog)}
  <p><a class="link-more" href="/addons">Every addon in the catalog →</a></p>
</section>`,
  };
}

export { addonPage, addonPath };
