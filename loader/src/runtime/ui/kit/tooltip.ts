// A game-styled tooltip on any element.
//
// One tooltip element for the whole loader, moved and refilled. Attached to focus as well as
// hover, so keyboard users get it too. WHAT is drawn lives in kit/tooltip-content.ts.
//
// A shown tooltip is dismissed by THREE things, each covering a hole the others leave:
// `pointerleave`; a removal observer, for an anchor removed while hovered (no leave fires);
// and a pointer move off the anchor, for an anchor the browser silently stopped considering
// hovered. Re-appending an element MOVES it, which drops hover without a leave, so a list that
// reorders rows every frame orphans a tooltip without the third.

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
   * The #woc-addons root, which the anchor watcher covers: anchors are addon rows in the hud
   * band, and a document-level observer would wake on every game HUD change.
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

/** Above the anchor by preference and below when there is no room. */
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
   * True once the anchor has been seen connected. An addon may attach BEFORE inserting the
   * element, so nothing is reaped until it has been in the document once.
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
 * The live attachments, and the reaping of the dead ones. Swept on `attach`, the moment a
 * rebuild is definitely happening, rather than by a standing observer.
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
    // Only if it is THIS anchor's tooltip on screen, or another row's would blank.
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

/** Everything that takes a shown tooltip down. Both watchers run only while one is shown. */
function createDismissal(own: DismissDeps): { start: () => void; stop: () => void } {
  const { doc } = own.deps;
  let watcher: MutationObserver | null = null;

  /**
   * The pointer is somewhere the anchor is not. Capture phase on the document, since the move
   * may be over game DOM that stops propagation.
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
    // Placed after unhiding: a hidden element measures as zero.
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
