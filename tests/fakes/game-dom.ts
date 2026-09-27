// The game DOM the loader injects into, copied from the game's own markup (options_window.ts and
// play.html). Every detail here is something the injection rules read, so do not simplify it.

const MENU_ENTRY_LABELS = ['Interface', 'Controls', 'Graphics', 'Sound'];
const RAIL_BUTTON_IDS = ['mm-arena', 'mm-social', 'mm-options'];

/**
 * The classes the game puts on a menu row and a rail button, as of game 0.43.2. The loader's
 * injections must wear these; asserting against a literal would only restate the loader's constant.
 */
const GAME_OWN_MENU_ENTRY_CLASS = 'btn ui-btn opt-btn';
const GAME_OWN_RAIL_BUTTON_CLASS = 'micro-btn ui-icon-btn ui-icon-btn--micro';

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

/** The options panel, rebuilt on every view change inside a #options-menu that outlives it. */
export function mountGameMenu(doc: Document): GameDom {
  doc.body.innerHTML = '<div id="ui"></div><div id="options-menu" class="window panel"></div>';
  const menu = doc.getElementById('options-menu') as HTMLElement;

  const renderMainView = (): void => {
    menu.innerHTML = titleBar('Game Menu', false);
    const list = doc.createElement('div');
    list.className = 'opt-list';
    for (const label of MENU_ENTRY_LABELS) {
      const button = doc.createElement('button');
      button.className = GAME_OWN_MENU_ENTRY_CLASS;
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
      return entry.compareDocumentPosition(version) === Node.DOCUMENT_POSITION_FOLLOWING;
    },
  };
}

/** The micro-button rail, where #mm-options is the last child. */
export function mountGameRail(doc: Document): HTMLElement {
  const buttons = RAIL_BUTTON_IDS.map(
    (id) => `<button type="button" class="${GAME_OWN_RAIL_BUTTON_CLASS}" id="${id}"></button>`,
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

/** The start screen: the whole HUD is still inside <template id="game-ui-template">. */
export function mountStartScreen(doc: Document): void {
  doc.body.innerHTML =
    '<div id="game-canvas"></div>' +
    '<template id="game-ui-template">' +
    '<div id="ui" tabindex="-1"></div>' +
    '<div id="options-menu" class="window panel"></div>' +
    '<div id="side-buttons-col-b" class="side-buttons-col">' +
    `<button type="button" class="${GAME_OWN_RAIL_BUTTON_CLASS}" id="mm-options"></button>` +
    '</div>' +
    '</template>' +
    '<div id="start-screen"></div>';
}

/**
 * World entry, as the game performs it: one fragment insert before #start-screen, so the HUD
 * watcher receives one mutation record carrying many added nodes.
 */
export function enterWorld(doc: Document): void {
  const template = doc.getElementById('game-ui-template') as HTMLTemplateElement;
  const startScreen = doc.getElementById('start-screen');
  doc.body.insertBefore(template.content.cloneNode(true), startScreen);
  doc.body.classList.add('game-active');
}

/** Logout as a soft navigation performs it: the cloned HUD goes and the page stays. */
export function leaveWorld(doc: Document): void {
  for (const id of ['ui', 'options-menu', 'side-buttons-col-b']) {
    doc.getElementById(id)?.remove();
  }
  doc.body.classList.remove('game-active');
}

export { GAME_OWN_MENU_ENTRY_CLASS, GAME_OWN_RAIL_BUTTON_CLASS };
