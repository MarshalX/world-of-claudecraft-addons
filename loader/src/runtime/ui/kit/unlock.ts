// The arrange-your-UI mode: one switch, every loader frame outlined.
//
// An empty bare overlay has no pixels, so it cannot be grabbed until this mode outlines it.
// ONE mode on the root, like window stacking. The drawing is entirely CSS keyed off one class
// on the root (outline, grabbable minimum size, name chip); nothing here measures anything.

import type { Teardown } from '../../disposal.ts';
import { NO_SNAP, SNAP_GRID } from '../frame/snap.ts';

/** On the root while the mode is on. */
const UNLOCKED_CLASS = 'woc-unlocked';

type UnlockHandler = (unlocked: boolean) => void;

interface UnlockMode {
  readonly unlocked: boolean;
  set: (next: boolean) => void;
  toggle: () => void;
  /**
   * The alignment grid a gesture lands on right now, or 0: snapping applies only inside the mode.
   */
  grid: () => number;
  /** Follow the mode, e.g. so the manager's checkbox tracks a keybind flip. */
  onChange: (handler: UnlockHandler) => Teardown;
  dispose: () => void;
}

/** The mode, with the snap setting read live from ui/snap-store.ts; absent is no snapping. */
function createUnlockMode(root: HTMLElement, snapping?: () => boolean): UnlockMode {
  const handlers = new Set<UnlockHandler>();
  let unlocked = false;

  const apply = (next: boolean): void => {
    if (unlocked === next) {
      return;
    }
    unlocked = next;
    root.classList.toggle(UNLOCKED_CLASS, unlocked);
    for (const handler of [...handlers]) {
      handler(unlocked);
    }
  };

  return {
    get unlocked(): boolean {
      return unlocked;
    },

    set: apply,

    grid: () => {
      if (unlocked && snapping?.() === true) {
        return SNAP_GRID;
      }
      return NO_SNAP;
    },

    toggle: () => {
      apply(!unlocked);
    },

    onChange: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    dispose: () => {
      handlers.clear();
      root.classList.remove(UNLOCKED_CLASS);
    },
  };
}

export type { UnlockHandler, UnlockMode };
export { createUnlockMode, UNLOCKED_CLASS };
