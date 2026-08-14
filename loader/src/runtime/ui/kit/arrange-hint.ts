// What a player is told when a frameless overlay refuses to move.
//
// A bare frame is its own drag handle (kit/frame-chrome.ts hands back `handle: el`
// for one) and its pointer policy hands the gesture back over exactly the rows a
// player clicks, so before this rule any press that travelled a few pixels moved
// the panel. The rule takes both gestures away outside arrange mode; the cost is
// that the frame now does nothing at all, with nothing on screen to say why.
//
// So it says why, on EVERY attempt. Once a session was the first shape and it was
// wrong: a player who tries a drag is asking a question, and the second time they
// ask is usually minutes later on another panel, having forgotten. A rule that
// answers once and then goes quiet is indistinguishable from a panel that has
// broken, which is the state this exists to prevent.
//
// What it does not do is pile up. The previous message is dismissed as the next
// one is raised, so a player wiggling a locked overlay sees one line rather than
// the toaster's five, because five copies of one sentence are not five answers.
//
// The combo is wired in AFTER the loader's keybinds exist, because they are built
// after the UI is mounted (runtime/boot.ts) and the bind is rebindable, so the
// only honest source is the store rather than the declared default. Until then,
// and if the bind never registers, the message names the route through the menu
// instead: an instruction naming a key the player may have moved is worse than
// one naming a button that cannot move.

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
  /** Say it. Every refused gesture is a question, so every one gets the answer. */
  note: () => void;
  /**
   * Where the arrange combo is read from, at the moment it is needed.
   *
   * A reader rather than a string: the player may rebind the key at any point in
   * the session, and a message that had captured the old combo would be telling
   * them to press something that no longer does anything.
   */
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
