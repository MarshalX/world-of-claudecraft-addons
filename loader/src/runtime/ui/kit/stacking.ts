// Which loader window is in front.
//
// There was no answer before this: windows are absolutely positioned siblings
// with no z-index, so overlap fell out of DOM order and clicking a buried one
// left it buried. With the manager and several addon frames open at once that is
// not a polish problem, it is the window behind being unusable.
//
// ONE listener on the root, not one per window. The root contains every loader
// window there is, so `closest('.woc-window')` from the event target reaches the
// manager and every addon frame with no per-surface wiring, and any window a
// future feature adds participates the day it lands. Capture phase, so a child
// that stops propagation cannot make its own window unraisable.
//
// `focusin` as well as `pointerdown`, for the same reason tooltips answer focus:
// tabbing into a buried window and having it stay buried is the keyboard version
// of the same bug.
//
// Only `.woc-window` is raised. Toasts, the modal backdrop and the tooltip sit in
// their own bands ABOVE the ceiling below, so they are never candidates and can
// never be pushed under a window by a click.

import type { Teardown } from '../../disposal.ts';

/**
 * The highest z-index a window may hold, and the floor of the overlay bands.
 *
 * The counter renormalises rather than running away, so this is a real ceiling
 * and not a hope: a toast can be declared above every possible window instead of
 * above every window anyone expects. Kept in step with the overlay values in
 * styles/kit.css, which start one above it.
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
 * Renumber every tracked window from 1, preserving their current order.
 *
 * Reached only when the counter hits the ceiling, which takes as many raises as
 * the ceiling is high. It exists so the ceiling is enforceable: without it the
 * only defence against a window climbing into the toast band is that nobody
 * clicks that many times, which is not a defence.
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
    // Inside the root by construction, since the listener is on it. The instance
    // check is what makes the style write safe rather than assumed.
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
