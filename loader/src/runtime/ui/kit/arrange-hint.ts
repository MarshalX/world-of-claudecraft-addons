// What a player is told when a bare frame refuses a gesture outside arrange mode.
//
// It says so on EVERY attempt: a hint that answers once and goes quiet looks like a broken
// panel. The previous message is dismissed as the next is raised, so it never piles up.
//
// The combo is wired in after the loader's keybinds exist (runtime/boot.ts) and read from
// the store, since the bind is rebindable. Until then the message names the menu route
// instead of a key the player may have moved.

import { describeCombo } from '../../../shared/combo.ts';
import type { Teardown } from '../../disposal.ts';
import type { Toaster } from './toast.ts';

const LOCKED = 'Frames are locked.';
const BY_MENU = `${LOCKED} Unlock frames from the Addons menu to move this one.`;

function byKey(combo: string): string {
  return `${LOCKED} Press ${describeCombo(combo)} to unlock and move it.`;
}

interface ArrangeHintDeps {
  toaster: Toaster;
}

interface ArrangeHint {
  /** Say it, on every refused gesture. */
  note: () => void;
  /** Where the arrange combo is read from, at the moment it is needed, since it can be rebound. */
  setCombo: (read: () => string | null) => void;
}

function createArrangeHint(deps: ArrangeHintDeps): ArrangeHint {
  let readCombo: (() => string | null) | null = null;
  /** Dismisses the message currently up, so the next one replaces it. */
  let showing: Teardown | null = null;

  const text = (): string => {
    const combo = readCombo?.() ?? null;
    if (combo === null) {
      return BY_MENU;
    }
    return byKey(combo);
  };

  return {
    note: () => {
      showing?.();
      showing = deps.toaster.show(text());
    },

    setCombo: (read) => {
      readCombo = read;
    },
  };
}

export type { ArrangeHint, ArrangeHintDeps };
export { BY_MENU, createArrangeHint };
