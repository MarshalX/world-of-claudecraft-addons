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

/** One live attachment, and whether its anchor has ever been in the document. */
interface Attachment {
  el: Element;
  detach: Teardown;
  /**
   * True once the anchor has been seen connected.
   *
   * Load-bearing. An addon may attach BEFORE inserting the element, which is the
   * natural order when building a row: create it, describe it, then append it.
   * Reaping anything disconnected would kill exactly those, so nothing is reaped
   * until it has been seen in the document at least once.
   */
  seen: boolean;
}

interface Attachments {
  add: (el: Element, detach: Teardown) => Attachment;
  drop: (entry: Attachment) => void;
  /** Release every attachment whose anchor has left the document. */
  reap: () => void;
  all: () => readonly Attachment[];
}

/**
 * The live attachments, and the reaping of the dead ones.
 *
 * Swept rather than observed continuously. The removal observer in
 * `createTooltips` runs only while a tooltip is visible, and running one
 * permanently to catch a leak would be a standing cost against a set that only
 * grows when rows are created; so `attach` sweeps, because that is the one moment
 * a rebuild is definitely happening.
 */
function createAttachments(): Attachments {
  const live = new Set<Attachment>();
  return {
    add: (el, detach) => {
      const entry: Attachment = { el, detach, seen: el.isConnected };
      live.add(entry);
      return entry;
    },
    drop: (entry) => {
      live.delete(entry);
    },
    reap: () => {
      for (const entry of [...live]) {
        if (entry.el.isConnected) {
          entry.seen = true;
        } else if (entry.seen) {
          entry.detach();
        }
      }
    },
    all: () => [...live],
  };
}

/** What one attachment needs from the tooltip that owns it. */
interface AttachContext {
  deps: TooltipDeps;
  attachments: Attachments;
  /** Draw the tip for this anchor and remember that it is the visible one. */
  showFor: (el: Element, text: string) => void;
  hide: () => void;
  /** Whether the visible tooltip belongs to this anchor. */
  isShown: (el: Element) => boolean;
}

function attachTooltip(ctx: AttachContext, el: Element, text: string): Teardown {
  ctx.attachments.reap();

  const show = (): void => {
    ctx.showFor(el, text);
  };

  el.addEventListener('pointerenter', show);
  el.addEventListener('pointerleave', ctx.hide);
  el.addEventListener('focusin', show);
  el.addEventListener('focusout', ctx.hide);

  const detach = (): void => {
    el.removeEventListener('pointerenter', show);
    el.removeEventListener('pointerleave', ctx.hide);
    el.removeEventListener('focusin', show);
    el.removeEventListener('focusout', ctx.hide);
    ctx.attachments.drop(entry);
    // Only if it is THIS anchor's tooltip on screen. Detaching one row while
    // another row's tooltip is up would otherwise blank the wrong one.
    if (ctx.isShown(el)) {
      ctx.hide();
    }
  };
  const entry = ctx.attachments.add(el, detach);
  return detach;
}

function createTooltips(deps: TooltipDeps): Tooltips {
  const attachments = createAttachments();
  /** The anchor the visible tooltip belongs to, or null when nothing is shown. */
  let shown: Element | null = null;
  /**
   * Watches for the shown anchor being removed. Runs ONLY while one is shown.
   *
   * Scoped to the loader's own root rather than to the document: addon DOM lives
   * there and the game's HUD does not, so the mutations it wakes for are the ones
   * that can actually take an anchor away. A body-level subtree observer would
   * fire on every HUD change the game makes at snapshot rate to answer the same
   * one question.
   */
  let watcher: MutationObserver | null = null;

  const hide = (): void => {
    shown = null;
    watcher?.disconnect();
    watcher = null;
    const tip = deps.doc.getElementById(TOOLTIP_ID);
    if (tip !== null) {
      tip.hidden = true;
    }
  };

  const showFor = (el: Element, text: string): void => {
    const tip = ensureTip(deps);
    tip.textContent = text;
    tip.hidden = false;
    // Placed after unhiding: a hidden element measures as zero, so the first
    // placement would put every tooltip in the same wrong spot.
    place(tip, el, deps.viewport());
    shown = el;
    if (watcher === null) {
      watcher = new MutationObserver(() => {
        if (shown !== null && !shown.isConnected) {
          hide();
        }
        attachments.reap();
      });
      watcher.observe(deps.root, { childList: true, subtree: true });
    }
  };

  const ctx: AttachContext = {
    deps,
    attachments,
    showFor,
    hide,
    isShown: (el) => shown === el,
  };

  return {
    attach: (el, text) => attachTooltip(ctx, el, text),
    dispose: () => {
      for (const entry of attachments.all()) {
        entry.detach();
      }
      hide();
      deps.doc.getElementById(TOOLTIP_ID)?.remove();
    },
  };
}

export type { TooltipDeps, Tooltips };
export { createTooltips, TOOLTIP_ID };
