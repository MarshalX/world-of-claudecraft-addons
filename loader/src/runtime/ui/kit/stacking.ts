// Which loader window is in front.
//
// Windows are absolutely positioned siblings, so without this overlap falls out of DOM order.
//
// ONE capture-phase listener on the root, resolving `closest('.woc-window')`, so every window
// participates with no wiring and a child that stops propagation cannot bury its own window.
// `focusin` as well as `pointerdown`, for keyboard users. Toasts, the modal and the tooltip
// sit above the ceiling below and are never raised.

import type { Teardown } from '../../disposal.ts';

/**
 * The highest z-index a window may hold; the counter renormalises at it. Keep in step with the
 * overlay values in styles/kit.css, which start one above it.
 */
const WINDOW_Z_CEILING = 100_000;

/** Capture, so a child that stops propagation cannot bury its own window. */
const CAPTURE = { capture: true } as const;

const WINDOW_SELECTOR = '.woc-window';

interface StackingDeps {
  /** The #woc-addons root, which contains every loader window. */
  root: HTMLElement;
}

interface Stacking {
  /** Bring one loader window to the front. Safe to call on a hidden one. */
  raise: (el: HTMLElement) => void;
  dispose: () => void;
}

/**
 * Renumber every tracked window from 1, preserving their order, when the counter hits the ceiling.
 */
function renormalise(tracked: Set<HTMLElement>): number {
  const live = [...tracked].filter((el) => el.isConnected);
  tracked.clear();
  live.sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
  let next = 1;
  for (const el of live) {
    el.style.zIndex = String(next);
    tracked.add(el);
    next += 1;
  }
  return next;
}

function createStacking(deps: StackingDeps): Stacking {
  /** Every window that has been raised, for the renumbering pass. */
  const tracked = new Set<HTMLElement>();
  let next = 1;

  const raise = (el: HTMLElement): void => {
    if (next > WINDOW_Z_CEILING) {
      next = renormalise(tracked);
    }
    el.style.zIndex = String(next);
    tracked.add(el);
    next += 1;
  };

  const onInteract = (event: Event): void => {
    const { target } = event;
    if (!(target instanceof Element)) {
      return;
    }
    const win = target.closest(WINDOW_SELECTOR);
    // The instance check makes the style write safe.
    if (win instanceof HTMLElement) {
      raise(win);
    }
  };

  const stop: Teardown = () => {
    deps.root.removeEventListener('pointerdown', onInteract, CAPTURE);
    deps.root.removeEventListener('focusin', onInteract, CAPTURE);
  };

  deps.root.addEventListener('pointerdown', onInteract, CAPTURE);
  deps.root.addEventListener('focusin', onInteract, CAPTURE);

  return { raise, dispose: stop };
}

export type { Stacking, StackingDeps };
export { createStacking, WINDOW_Z_CEILING };
