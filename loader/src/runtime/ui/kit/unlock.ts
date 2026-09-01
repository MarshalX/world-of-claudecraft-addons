// The arrange-your-UI mode: one switch, every loader frame outlined.
//
// It exists because a frame can be impossible to grab, and the clearest case is
// the one the kit deliberately allows: a `density: 'bare'` overlay whose content
// is a list of timers has no pixels at all while nothing is running, which is
// exactly when a player wants to put it somewhere. Hover cannot help, because
// hover needs something to be over.
//
// ONE mode on the root rather than an affordance per frame, for the reason
// window ordering is one service rather than per window: otherwise every addon
// invents its own idle state, they all look different, and a player with a
// frame they cannot find has to work out which addon owns it. Any frame a future
// addon creates participates the day it is written.
//
// The drawing is entirely CSS. Every frame already carries `data-woc-addon` and
// `data-woc-frame`, so the outline, the minimum size that makes an empty frame
// grabbable, and the label naming what it belongs to are all rules keyed off one
// class on the root. Nothing here measures or positions anything.

import type { Teardown } from '../../disposal.ts';
import { NO_SNAP, SNAP_GRID } from '../frame/snap.ts';

/**
 * On the root while the mode is on.
 *
 * Here rather than in the stylesheet's own module for the reason NO_HUD_CLASS is
 * where it is: one home for a class one module writes and another styles.
 */
const UNLOCKED_CLASS = 'woc-unlocked';

type UnlockHandler = (unlocked: boolean) => void;

interface UnlockMode {
  readonly unlocked: boolean;
  set: (next: boolean) => void;
  toggle: () => void;
  /**
   * The alignment grid a gesture lands on right now, or 0 for none. On the mode rather
   * than on a frame or the setting because snapping applies to an arranging drag and
   * nothing else: outside the mode there are no lines on screen to explain a quantized drag.
   */
  grid: () => number;
  /**
   * Follow the mode.
   *
   * The manager's own control needs this: the mode can be switched by a keybind
   * while the manager is open, and a checkbox that did not follow would be
   * telling the player the opposite of what the screen is doing.
   */
  onChange: (handler: UnlockHandler) => Teardown;
  dispose: () => void;
}

/**
 * The mode, and optionally the player's standing answer about snapping, read live
 * because it changes all session. ui/snap-store.ts owns the boolean and is built
 * first; absent is no snapping.
 */
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
