// An entry in the game menu.
//
// The game rebuilds #options-menu with innerHTML on every view change, so a MutationObserver
// on the (static) container re-adds the entry. Appending to .opt-list places it above
// .opt-version, which is a sibling of the list. The id is a parameter because
// `woc.ui.menuEntry` hands the same mechanism to addons.

import { ANCHORS, GAME_MENU_BUTTON_CLASS } from './anchors.ts';

/** The loader's own entry, the one that opens the manager. */
const ENTRY_ID = 'woc-addons-menu-entry';

function buildEntry(deps: MenuEntryDeps): HTMLButtonElement {
  const button = deps.doc.createElement('button');
  button.type = 'button';
  button.id = deps.id;
  button.className = GAME_MENU_BUTTON_CLASS;
  button.textContent = deps.label;
  button.addEventListener('click', deps.onOpen);
  return button;
}

export interface MenuEntryDeps {
  doc: Document;
  /** Unique per entry: the loader's own, plus one per addon that asks for one. */
  id: string;
  label: string;
  onOpen: () => void;
}

export interface MenuEntry {
  /** Inject if the current render can take the entry. True when it was added. */
  inject: () => boolean;
  dispose: () => void;
}

/**
 * Where the entry belongs in the menu as currently rendered, or null when the menu shows a
 * sub-view, shows no button list, or already holds this entry.
 */
export function menuInsertionPoint(menu: ParentNode, entryId: string): Element | null {
  if (menu.querySelector(ANCHORS.optionsBack) !== null) {
    return null;
  }
  const list = menu.querySelector(ANCHORS.optionsList);
  if (list === null || list.querySelector(`#${entryId}`) !== null) {
    return null;
  }
  return list;
}

export function mountMenuEntry(deps: MenuEntryDeps): MenuEntry {
  const menu = deps.doc.querySelector(ANCHORS.optionsMenu);
  if (menu === null) {
    return { inject: () => false, dispose: () => undefined };
  }

  // Our own append mutates the observed tree; this flag keeps the callback from re-entering.
  let injecting = false;
  const inject = (): boolean => {
    if (injecting) {
      return false;
    }
    const list = menuInsertionPoint(menu, deps.id);
    if (list === null) {
      return false;
    }
    injecting = true;
    try {
      list.appendChild(buildEntry(deps));
    } finally {
      injecting = false;
    }
    return true;
  };

  const observer = new MutationObserver(() => {
    inject();
  });
  observer.observe(menu, { childList: true, subtree: true });
  // The menu may already be open and rendered, which raises no mutation.
  inject();

  return {
    inject,
    dispose: () => {
      observer.disconnect();
      menu.querySelector(`#${deps.id}`)?.remove();
    },
  };
}

export { ENTRY_ID };
