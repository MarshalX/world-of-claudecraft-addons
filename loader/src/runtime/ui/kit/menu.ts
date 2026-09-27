// A context menu: per-row actions without spending frame space on them.
//
// The kit owns the DISMISSAL: close on select, on Escape, on a click anywhere else, and on
// the anchor going away, all listeners on things the addon does not own.
//
// ONE menu for the whole loader, like the banner: opening a second closes the first. It is
// NOT a window (no stacking, no saved position, no drag) and sits in the overlay band.

import type { Teardown } from '../../disposal.ts';
import { clampNumber } from '../frame/geometry.ts';

const MENU_ID = 'woc-menu';

/** How far the menu is kept from the edge it would otherwise run past. */
const EDGE_MARGIN_PX = 8;

interface MenuItem {
  label: string;
  /** Runs after the menu is closed, so a handler may open another one. */
  onSelect: () => void;
  /** Drawn dimmed and unselectable. The reason belongs in the label. */
  disabled?: boolean;
  /** A rule above this item. Ignored on the first, where it would draw a lid. */
  separator?: boolean;
  /**
   * This item is the one currently chosen, drawn in the game's own accent. For a CHOICE menu
   * (`ui.field.select`), set it on every item, `false` on the rest, or the others announce as
   * commands. An item that leaves it out stays an ordinary action.
   */
  checked?: boolean;
}

interface MenuDeps {
  doc: Document;
  /** The #woc-addons root. */
  root: HTMLElement;
  viewport: () => { w: number; h: number };
}

interface Menus {
  /** Open a menu at an element, or at a point. Returns a close, which the disposal bag holds. */
  open: (at: Element | { x: number; y: number }, items: readonly MenuItem[]) => Teardown;
  dispose: () => void;
}

/** Where the menu's top left corner goes, in page pixels. */
function anchorPoint(at: Element | { x: number; y: number }): { x: number; y: number } {
  if ('getBoundingClientRect' in at) {
    const rect = at.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  }
  return at;
}

/** The least room a menu is given before it starts scrolling, even on a shorter viewport. */
const MIN_MENU_HEIGHT_PX = 120;

/**
 * Keep the whole menu on screen, in BOTH directions. Measured after it is in the document and
 * unhidden, since a hidden element measures as zero (as in kit/tooltip.ts). The height cap is
 * written before measuring: a box taller than the viewport cannot be clamped into it.
 */
function place(el: HTMLElement, point: { x: number; y: number }, view: { w: number; h: number }) {
  el.style.maxHeight = `${Math.max(MIN_MENU_HEIGHT_PX, view.h - EDGE_MARGIN_PX * 2)}px`;
  const size = el.getBoundingClientRect();
  const maxLeft = Math.max(EDGE_MARGIN_PX, view.w - size.width - EDGE_MARGIN_PX);
  const maxTop = Math.max(EDGE_MARGIN_PX, view.h - size.height - EDGE_MARGIN_PX);
  el.style.left = `${clampNumber(point.x, EDGE_MARGIN_PX, maxLeft)}px`;
  el.style.top = `${clampNumber(point.y, EDGE_MARGIN_PX, maxTop)}px`;
}

function buildItem(doc: Document, item: MenuItem, first: boolean): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'woc-menu-item';
  // `aria-checked` carries what the colour shows.
  if (item.checked !== undefined) {
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(item.checked));
  }
  // No rule above the first item, where it would draw a lid.
  if (item.separator === true && !first) {
    button.classList.add('woc-menu-cut');
  }
  button.disabled = item.disabled === true;
  // textContent, never innerHTML: a label carries ability and player names.
  button.textContent = item.label;
  return button;
}

function buildMenu(deps: MenuDeps, items: readonly MenuItem[], close: Teardown): HTMLElement {
  const el = deps.doc.createElement('div');
  el.id = MENU_ID;
  el.className = 'woc-menu panel';
  el.setAttribute('role', 'menu');

  for (const [at, item] of items.entries()) {
    const button = buildItem(deps.doc, item, at === 0);
    if (!button.hasAttribute('role')) {
      button.setAttribute('role', 'menuitem');
    }
    button.addEventListener('click', () => {
      // Closed FIRST, so a handler that opens another menu keeps it open.
      close();
      item.onSelect();
    });
    el.appendChild(button);
  }
  return el;
}

/**
 * The listeners that close a menu. The pointer listener is on the DOCUMENT in the capture
 * phase, since the game's own controls stop propagation.
 */
function watchForDismissal(deps: MenuDeps, el: HTMLElement, close: Teardown): Teardown {
  const onPointerDown = (event: Event): void => {
    if (!el.contains(event.target as Node)) {
      close();
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
    }
  };

  deps.doc.addEventListener('pointerdown', onPointerDown, { capture: true });
  deps.doc.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    deps.doc.removeEventListener('pointerdown', onPointerDown, { capture: true });
    deps.doc.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}

function createMenus(deps: MenuDeps): Menus {
  /** The teardown of the one open menu, or null. */
  let closeOpen: Teardown | null = null;

  const close = (): void => {
    const closing = closeOpen;
    closeOpen = null;
    closing?.();
  };

  return {
    open: (at, items) => {
      close();

      const point = anchorPoint(at);
      const el = buildMenu(deps, items, () => {
        close();
      });
      deps.root.appendChild(el);
      place(el, point, deps.viewport());

      const unwatch = watchForDismissal(deps, el, () => {
        close();
      });
      const teardown = (): void => {
        unwatch();
        el.remove();
      };
      closeOpen = teardown;

      // Comparing the teardown keeps this handle from closing a LATER menu.
      return () => {
        if (closeOpen === teardown) {
          close();
        }
      };
    },

    dispose: close,
  };
}

export type { MenuDeps, MenuItem, Menus };
export { createMenus, MENU_ID };
