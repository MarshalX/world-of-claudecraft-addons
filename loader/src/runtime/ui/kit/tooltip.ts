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
//
// WHAT is drawn lives in kit/tooltip-content.ts. This file is the element, its
// placement and the attachment lifecycle, and it takes either a string or the
// structured form without caring which.
//
// A shown tooltip is dismissed by THREE things, and each covers a hole the others
// leave. `pointerleave` is the ordinary one. The removal observer covers an anchor
// taken out of the document while the pointer is over it, which fires no leave at
// all. And a pointer move away from the anchor covers the case those two miss
// together: an anchor that is still in the document but which the browser has
// stopped considering hovered.
//
// That third case is not hypothetical and is the second stuck tooltip reported
// from a live session, both times from Cooldown Bars. Re-appending an element that
// is already in the DOM MOVES it, which is a removal and an insertion, and the
// browser drops the hover state on the removal without firing a leave. The list
// re-appends its rows on every animation frame to keep them in order, so a
// tooltip shown at 60fps was near-certain to be orphaned within a frame or two:
// the pointer was never again "over" the anchor as far as the browser was
// concerned, so no event it could listen for was ever coming.

import type { Teardown } from '../../disposal.ts';
import type { TooltipInput } from './tooltip-content.ts';
import { renderTooltip } from './tooltip-content.ts';

const TOOLTIP_ID = 'woc-tooltip';

/** Distance from the anchor, and how far from the viewport edge it may sit. */
const OFFSET_PX = 8;
const EDGE_MARGIN_PX = 8;

interface TooltipDeps {
  doc: Document;
  /**
   * The #woc-addons root, which is what the anchor watcher covers.
   *
   * The root rather than the band the tip is drawn in, because the anchor being
   * watched is an addon's own row, and those are down in the hud band. Still
   * scoped rather than the document: addon DOM is all under here and the game's
   * HUD is not, and a body-level subtree observer would wake on every HUD change
   * at snapshot rate to answer a question about our own elements.
   */
  root: HTMLElement;
  /** The band the tip element is drawn in, which has to be over every frame. */
  layer: HTMLElement;
  viewport: () => { w: number; h: number };
}

interface Tooltips {
  /** Attach content to an element. Returns a detach, also held by the disposal bag. */
  attach: (el: Element, content: TooltipInput) => Teardown;
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
  deps.layer.appendChild(tip);
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
  showFor: (el: Element, content: TooltipInput) => void;
  hide: () => void;
  /** Whether the visible tooltip belongs to this anchor. */
  isShown: (el: Element) => boolean;
}

function attachTooltip(ctx: AttachContext, el: Element, content: TooltipInput): Teardown {
  ctx.attachments.reap();

  const show = (): void => {
    ctx.showFor(el, content);
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

/** What the dismissal watchers need from the tooltip that owns them. */
interface DismissDeps {
  deps: TooltipDeps;
  /** The anchor whose tooltip is up, or null. */
  shown: () => Element | null;
  hide: () => void;
  /** Release attachments whose anchors have gone. See `createAttachments`. */
  reap: () => void;
}

/**
 * Everything that takes a shown tooltip down, started and stopped together.
 *
 * Both watchers exist only while something is on screen, which is what makes them
 * affordable: a pointer move is a `contains` call on one element, and the observer
 * is scoped to the loader's own root rather than the document, so it does not wake
 * on every change the game's HUD makes at snapshot rate.
 */
function createDismissal(own: DismissDeps): { start: () => void; stop: () => void } {
  const { doc } = own.deps;
  let watcher: MutationObserver | null = null;

  /**
   * The pointer is somewhere the anchor is not.
   *
   * Capture phase and on the document, because the move that matters may be over
   * the game's own DOM, and a bubbling listener never sees an event whose handler
   * stops propagation. This is the watcher that covers an anchor the browser has
   * stopped considering hovered while it is still in the document: see the note at
   * the top of this file.
   */
  const onPointerMove = (event: Event): void => {
    const anchor = own.shown();
    const target = event.target as Node | null;
    if (anchor !== null && (target === null || !anchor.contains(target))) {
      own.hide();
    }
  };

  return {
    start: () => {
      doc.addEventListener('pointermove', onPointerMove, { capture: true });
      if (watcher !== null) {
        return;
      }
      watcher = new MutationObserver(() => {
        if (own.shown()?.isConnected === false) {
          own.hide();
        }
        own.reap();
      });
      watcher.observe(own.deps.root, { childList: true, subtree: true });
    },

    stop: () => {
      doc.removeEventListener('pointermove', onPointerMove, { capture: true });
      watcher?.disconnect();
      watcher = null;
    },
  };
}

function createTooltips(deps: TooltipDeps): Tooltips {
  const attachments = createAttachments();
  /** The anchor the visible tooltip belongs to, or null when nothing is shown. */
  let shown: Element | null = null;

  const hide = (): void => {
    shown = null;
    dismissal.stop();
    const tip = deps.doc.getElementById(TOOLTIP_ID);
    if (tip !== null) {
      tip.hidden = true;
    }
  };

  const dismissal = createDismissal({
    deps,
    shown: () => shown,
    hide,
    reap: attachments.reap,
  });

  const showFor = (el: Element, content: TooltipInput): void => {
    const tip = ensureTip(deps);
    renderTooltip(deps.doc, tip, content);
    tip.hidden = false;
    // Placed after unhiding: a hidden element measures as zero, so the first
    // placement would put every tooltip in the same wrong spot.
    place(tip, el, deps.viewport());
    shown = el;
    dismissal.start();
  };

  const ctx: AttachContext = {
    deps,
    attachments,
    showFor,
    hide,
    isShown: (el) => shown === el,
  };

  return {
    attach: (el, content) => attachTooltip(ctx, el, content),
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
