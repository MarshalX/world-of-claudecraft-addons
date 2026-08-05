// A context menu: per-row actions without spending frame space on them.
//
// The reason this is in the kit rather than in each addon is not the markup, it
// is the DISMISSAL. A menu has to close on select, on Escape, on a click anywhere
// else, and on the anchor being taken away, and every one of those is a listener
// on something the addon does not own. An addon that hand-rolls it gets three of
// the four right and leaves a menu floating over the HUD on the fourth.
//
// ONE menu for the whole loader, like the banner. Opening a second closes the
// first, because two open context menus is not a state anyone means to be in, and
// the alternative is a stack whose dismissal order is a new thing to be wrong
// about.
//
// It is NOT a window: no stacking participation, no saved position, no drag. It
// sits in the overlay band above every window, exactly where a transient thing
// belongs, and it is gone before anything could be arranged around it.

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
   * This item is the one currently chosen, drawn in the game's own accent.
   *
   * For a menu that is a CHOICE rather than a list of actions, which is what a dropdown is:
   * `ui.field.select` is built on this. Stated rather than implied, and stated as a flag on
   * every item of such a menu rather than only on the chosen one, because a menu where one
   * item says `checked: true` and the rest say nothing announces one radio button and a list
   * of commands. An item that leaves it out stays an ordinary action.
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
  /**
   * Open a menu at an element, or at a point.
   *
   * Returns a close, which is also what the caller's disposal bag holds: an addon
   * disabled with its menu open must not leave it on screen.
   */
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

/**
 * The least room a menu is given before it starts scrolling.
 *
 * A floor rather than a target: on a viewport shorter than this the menu takes
 * what there is, because a menu clipped to nothing is worse than one that
 * overhangs a little.
 */
const MIN_MENU_HEIGHT_PX = 120;

/**
 * Keep the whole menu on screen, in BOTH directions.
 *
 * Measured after it is in the document and unhidden: a hidden element measures as
 * zero, so a placement computed before that puts every menu in the same wrong
 * corner. The same order kit/tooltip.ts uses, for the same reason.
 *
 * The height cap is written before the measurement rather than after, so what is
 * measured is a menu that already fits and the clamp below has something true to
 * work with. Without it a long menu had its `top` pinned to the margin and then
 * simply ran off the bottom of the window: clamping a position can only move a
 * box, and a box taller than the viewport has nowhere to be moved to. The rail
 * button's own menu found it, at twenty-five rows, but it is every menu's
 * problem: `ui.menu` is on the addon API and an addon listing its own rows has
 * no way to know how many will fit.
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
  // A choice rather than a command, so it is announced as one and drawn as one. The colour
  // is the game's own for a chosen dropdown row; `aria-checked` is what carries the same
  // fact to a reader who cannot see the colour.
  if (item.checked !== undefined) {
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(item.checked));
  }
  // A rule above the first item would draw a lid on the menu rather than
  // separating anything, so the flag is honoured everywhere else and dropped here.
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
      // Closed FIRST, so a handler that opens another menu is not immediately
      // shut by the teardown of the one that launched it.
      close();
      item.onSelect();
    });
    el.appendChild(button);
  }
  return el;
}

/**
 * The listeners that close a menu, and the one thing they all have in common.
 *
 * Every one of them is on something outside the menu, which is exactly why this
 * is not each addon's job. The pointer listener is on the DOCUMENT and in the
 * capture phase: a click on a game control has to dismiss the menu as well as
 * reach the game, and a bubbling listener never sees a click whose handler stops
 * propagation, which the game's own controls do.
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

      // The caller's own handle. Calling it while a LATER menu is open must not
      // take that one down, which is what comparing the teardown checks.
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
