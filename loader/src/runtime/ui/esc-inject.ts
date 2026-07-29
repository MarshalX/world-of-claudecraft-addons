// An entry in the game menu.
//
// The game rebuilds #options-menu with innerHTML on every view change, so the
// entry is re-added by a MutationObserver rather than inserted once. Nothing
// about that rebuild is announced, and the menu container is static markup that
// outlives every render, which is why the observer watches the container rather
// than waiting for a panel to appear.
//
// The entry goes inside .opt-list, as the last game-menu button. That puts it
// above .opt-version without referencing it: the version line is a SIBLING of
// the list rather than a child, so appending to the list already places the
// entry ahead of it in document order.
//
// The id is a parameter rather than a constant because `woc.ui.menuEntry` hands
// the same mechanism to addons, and every entry present has to be distinguished
// from every other for the already-there check to mean anything.

import { ANCHORS, GAME_MENU_BUTTON_CLASS } from './anchors.ts';

/** The loader's own entry, the one that opens the manager. */
const ENTRY_ID = 'woc-addons-menu-entry';

function buildEntry(deps: MenuEntryDeps): HTMLButtonElement {
  const button = deps.doc.createElement('button');
  button.type = 'button';
  button.id = deps.id;
  // The game's own classes, so the entry inherits the menu's look rather than
  // carrying a copy of it that a restyle would leave behind.
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
 * Where the entry belongs in the menu as currently rendered, or null.
 *
 * Three distinct reasons to decline: the menu is showing a sub-view, the menu is
 * not showing its button list at all, or this entry is already there.
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

  // Our own append mutates the tree the observer watches. The already-present
  // check in menuInsertionPoint is what settles that; this flag keeps the
  // callback from re-entering the append itself.
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
