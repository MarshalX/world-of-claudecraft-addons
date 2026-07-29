// Transient messages.
//
// One stack for the whole loader rather than one per addon, so two addons
// reporting something at once produce a readable column instead of two piles in
// the same corner. The stack element is created on the first toast and left in
// place: it is an empty div with no pointer events, and creating it per toast
// would mean a layout thrash on every message.
//
// Toasts are announced to assistive technology through a live region rather than
// by moving focus. Stealing focus for a message the player did not ask for would
// interrupt whatever they were typing, and a toast is by definition not worth
// that.

import type { Teardown } from '../../disposal.ts';

const STACK_ID = 'woc-toasts';
const DEFAULT_TIMEOUT_MS = 4000;

/** Beyond this the column runs off the screen, so the oldest is dropped. */
const MAX_VISIBLE = 5;

type ToastKind = 'info' | 'warn' | 'error';

interface ToastOpts {
  /** Milliseconds on screen. Zero keeps it up until dismissed. */
  timeout?: number;
  kind?: ToastKind;
}

interface Toaster {
  /** Returns a dismiss function, which is also what the disposal bag holds. */
  show: (text: string, opts?: ToastOpts) => Teardown;
  dispose: () => void;
}

interface ToasterDeps {
  doc: Document;
  /** The #woc-addons root. */
  root: HTMLElement;
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

function ensureStack(deps: ToasterDeps): HTMLElement {
  const existing = deps.doc.getElementById(STACK_ID);
  if (existing !== null) {
    return existing;
  }
  const stack = deps.doc.createElement('div');
  stack.id = STACK_ID;
  // polite rather than assertive: a toast is informational, and assertive
  // interrupts a screen reader mid-sentence.
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('role', 'status');
  deps.root.appendChild(stack);
  return stack;
}

function createToaster(deps: ToasterDeps): Toaster {
  /** Live toasts, oldest first, so the overflow rule has an order to work on. */
  const live: Array<{ el: HTMLElement; dismiss: Teardown }> = [];

  const drop = (el: HTMLElement): void => {
    const at = live.findIndex((entry) => entry.el === el);
    if (at >= 0) {
      live.splice(at, 1);
    }
    el.remove();
  };

  return {
    show: (text, opts) => {
      const stack = ensureStack(deps);
      const el = deps.doc.createElement('div');
      el.className = `woc-toast woc-toast-${opts?.kind ?? 'info'}`;
      // textContent, never innerHTML: the text may come from a game event, a
      // player name, or another addon, and none of those are markup.
      el.textContent = text;
      stack.appendChild(el);

      const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
      let timer: number | null = null;

      const dismiss = (): void => {
        if (timer !== null) {
          deps.clearTimer(timer);
          timer = null;
        }
        drop(el);
      };

      if (timeout > 0) {
        timer = deps.setTimer(dismiss, timeout);
      }
      live.push({ el, dismiss });

      // The oldest goes rather than the newest being refused: the newest message
      // is the one the player is most likely to be waiting for.
      while (live.length > MAX_VISIBLE) {
        live[0]?.dismiss();
      }

      return dismiss;
    },

    dispose: () => {
      for (const entry of [...live]) {
        entry.dismiss();
      }
      deps.doc.getElementById(STACK_ID)?.remove();
    },
  };
}

export type { Toaster, ToasterDeps, ToastKind, ToastOpts };
export { createToaster, DEFAULT_TIMEOUT_MS, MAX_VISIBLE, STACK_ID };
