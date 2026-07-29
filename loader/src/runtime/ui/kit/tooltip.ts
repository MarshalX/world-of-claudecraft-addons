// A game-styled tooltip on any element.
//
// One tooltip element for the whole loader, moved and refilled, rather than one
// per attachment. Addons attach these to rows in a list, and a per-element node
// would mean a hundred hidden divs for a hundred rows.
//
// Attached to focus as well as hover. A tooltip that only answers the mouse is
// invisible to a keyboard, and the game's own tooltips have the same gap; this
// is the one place the kit is deliberately better than what it is matching,
// because the alternative is shipping the gap to every addon.

import type { Teardown } from '../../disposal.ts';

const TOOLTIP_ID = 'woc-tooltip';

/** Distance from the anchor, and how far from the viewport edge it may sit. */
const OFFSET_PX = 8;
const EDGE_MARGIN_PX = 8;

interface TooltipDeps {
  doc: Document;
  /** The #woc-addons root. */
  root: HTMLElement;
  viewport: () => { w: number; h: number };
}

interface Tooltips {
  /** Attach text to an element. Returns a detach, also held by the disposal bag. */
  attach: (el: Element, text: string) => Teardown;
  dispose: () => void;
}

function ensureTip(deps: TooltipDeps): HTMLElement {
  const existing = deps.doc.getElementById(TOOLTIP_ID);
  if (existing !== null) {
    return existing;
  }
  const tip = deps.doc.createElement('div');
  tip.id = TOOLTIP_ID;
  tip.className = 'woc-tooltip panel';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  deps.root.appendChild(tip);
  return tip;
}

/**
 * Above the anchor by preference and below when there is no room, which is what
 * keeps a tooltip on a bottom-of-screen HUD element readable rather than
 * clipped.
 */
function topFor(rect: { top: number; bottom: number }, height: number): number {
  const above = rect.top - height - OFFSET_PX;
  if (above >= EDGE_MARGIN_PX) {
    return above;
  }
  return rect.bottom + OFFSET_PX;
}

/** Place the tip near its anchor, kept inside the viewport. */
function place(tip: HTMLElement, anchor: Element, view: { w: number; h: number }): void {
  const rect = anchor.getBoundingClientRect();
  const size = tip.getBoundingClientRect();

  const top = topFor(rect, size.height);

  const maxLeft = Math.max(EDGE_MARGIN_PX, view.w - size.width - EDGE_MARGIN_PX);
  const left = Math.min(Math.max(EDGE_MARGIN_PX, rect.left), maxLeft);

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function createTooltips(deps: TooltipDeps): Tooltips {
  /** Every live attachment, so dispose() can detach them without the caller. */
  const detachers = new Set<Teardown>();

  return {
    attach: (el, text) => {
      const show = (): void => {
        const tip = ensureTip(deps);
        tip.textContent = text;
        tip.hidden = false;
        // Placed after unhiding: a hidden element measures as zero, so the
        // first placement would put every tooltip in the same wrong spot.
        place(tip, el, deps.viewport());
      };
      const hide = (): void => {
        const tip = deps.doc.getElementById(TOOLTIP_ID);
        if (tip !== null) {
          tip.hidden = true;
        }
      };

      el.addEventListener('pointerenter', show);
      el.addEventListener('pointerleave', hide);
      el.addEventListener('focusin', show);
      el.addEventListener('focusout', hide);

      const detach = (): void => {
        el.removeEventListener('pointerenter', show);
        el.removeEventListener('pointerleave', hide);
        el.removeEventListener('focusin', show);
        el.removeEventListener('focusout', hide);
        detachers.delete(detach);
        hide();
      };
      detachers.add(detach);
      return detach;
    },

    dispose: () => {
      for (const detach of [...detachers]) {
        detach();
      }
      deps.doc.getElementById(TOOLTIP_ID)?.remove();
    },
  };
}

export type { TooltipDeps, Tooltips };
export { createTooltips, TOOLTIP_ID };
