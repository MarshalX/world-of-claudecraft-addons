// The game DOM the loader injects into, reproduced from the real markup.
//
// Copied from the game rather than invented: the options panel from what
// options_window.ts renders (the title bar it builds, the .opt-list it appends,
// the .opt-version it appends after it, and the [data-back] control that only a
// sub-view carries), and the rail from the static markup in index.html and
// play.html, where #mm-options really is the last child.
//
// Reproducing it exactly is the point. Every one of these details is a thing the
// injection rules read, and a fake that simplifies one of them tests the fake.

const MENU_ENTRY_LABELS = ['Interface', 'Controls', 'Graphics', 'Sound'];
const RAIL_BUTTON_IDS = ['mm-arena', 'mm-social', 'mm-options'];

const BACK_BUTTON = '<button type="button" class="x-btn back-btn" data-back></button>';

function backControl(withBack: boolean): string {
  if (withBack) {
    return BACK_BUTTON;
  }
  return '';
}

function titleBar(title: string, withBack: boolean): string {
  const back = backControl(withBack);
  const close = '<button type="button" class="x-btn" data-close></button>';
  // Built as a string for the same reason the game does: it assigns innerHTML.
  return `<div class="panel-title">${back}<span id="options-title">${title}</span>${close}</div>`;
}

export interface GameDom {
  doc: Document;
  menu: HTMLElement;
  /** Render the menu's root view, the only one that carries .opt-list. */
  renderMainView: () => void;
  /** Render a sub-view: a [data-back] control and no button list. */
  renderSubView: () => void;
  /** The labels of the menu's buttons, in order. Our entry shows up last. */
  entryLabels: () => string[];
  /** True when our entry sits ahead of the version line in document order. */
  entryPrecedesVersion: () => boolean;
}

/**
 * The options panel, which the game empties and rebuilds on every view change.
 *
 * #options-menu itself is static markup that outlives every render, which is
 * what the observer relies on.
 */
export function mountGameMenu(doc: Document): GameDom {
  doc.body.innerHTML = '<div id="ui"></div><div id="options-menu" class="window panel"></div>';
  const menu = doc.getElementById('options-menu') as HTMLElement;

  const renderMainView = (): void => {
    menu.innerHTML = titleBar('Game Menu', false);
    const list = doc.createElement('div');
    list.className = 'opt-list';
    for (const label of MENU_ENTRY_LABELS) {
      const button = doc.createElement('button');
      button.className = 'btn opt-btn';
      button.textContent = label;
      list.appendChild(button);
    }
    menu.appendChild(list);
    const version = doc.createElement('div');
    version.className = 'opt-version';
    version.textContent = 'v0.31 build 1a2b3c4d5e6f';
    menu.appendChild(version);
  };

  return {
    doc,
    menu,
    renderMainView,

    renderSubView: () => {
      menu.innerHTML = `${titleBar('Controls', true)}<div class="opt-body"></div>`;
    },

    entryLabels: () =>
      [...menu.querySelectorAll('.opt-list .opt-btn')].map((el) => el.textContent ?? ''),

    entryPrecedesVersion: () => {
      const entry = menu.querySelector('#woc-addons-menu-entry');
      const version = menu.querySelector('.opt-version');
      if (entry === null || version === null) {
        return false;
      }
      // The version line must come after the entry, so the entry never lands
      // under the build string.
      return entry.compareDocumentPosition(version) === Node.DOCUMENT_POSITION_FOLLOWING;
    },
  };
}

/** The micro-button rail, where #mm-options is the last child. */
export function mountGameRail(doc: Document): HTMLElement {
  const buttons = RAIL_BUTTON_IDS.map(
    (id) => `<button type="button" class="micro-btn" id="${id}"></button>`,
  ).join('');
  doc.body.innerHTML = `<div id="side-buttons-col-b" class="side-buttons-col">${buttons}</div>`;
  return doc.getElementById('side-buttons-col-b') as HTMLElement;
}

/** The footer build readout, the one anchor that is in the live DOM from the start. */
export function mountGameVersion(doc: Document, text: string): void {
  const el = doc.createElement('div');
  el.id = 'game-version';
  el.textContent = text;
  doc.body.appendChild(el);
}

/**
 * The start screen, before world entry.
 *
 * The whole HUD ships inside <template id="game-ui-template">, so none of it is
 * in the document yet. This is what the loader really sees at DOMContentLoaded.
 */
export function mountStartScreen(doc: Document): void {
  doc.body.innerHTML =
    '<div id="game-canvas"></div>' +
    '<template id="game-ui-template">' +
    '<div id="ui" tabindex="-1"></div>' +
    '<div id="options-menu" class="window panel"></div>' +
    '<div id="side-buttons-col-b" class="side-buttons-col">' +
    '<button type="button" class="micro-btn" id="mm-options"></button>' +
    '</div>' +
    '</template>' +
    '<div id="start-screen"></div>';
}

/**
 * World entry, as the game performs it.
 *
 * mountGameUi() clones the template's content into body before #start-screen, in
 * one insertion, and never removes it. Reproducing the fragment insert matters:
 * it is one mutation record carrying many added nodes, which is what the HUD
 * watcher actually receives.
 */
export function enterWorld(doc: Document): void {
  const template = doc.getElementById('game-ui-template') as HTMLTemplateElement;
  const startScreen = doc.getElementById('start-screen');
  doc.body.insertBefore(template.content.cloneNode(true), startScreen);
  doc.body.classList.add('game-active');
}

/**
 * Logout, as a soft navigation performs it: the cloned HUD goes, the page stays.
 *
 * The loader's own root is a sibling of #ui precisely so a HUD re-render cannot
 * take it away, which means nothing takes addon UI away when the HUD legitimately
 * goes. A live session found the result: an addon's window sitting on top of the
 * game's landing page, over the PLAY button.
 */
export function leaveWorld(doc: Document): void {
  for (const id of ['ui', 'options-menu', 'side-buttons-col-b']) {
    doc.getElementById(id)?.remove();
  }
  doc.body.classList.remove('game-active');
}
