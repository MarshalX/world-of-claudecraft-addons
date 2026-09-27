// Follow the game's own HUD edit mode ("Edit Frames") onto the loader's arrange mode, ONE
// WAY: the game's mode disables camera drag and click-to-target, so the loader must never
// write it back. The signal is a class on `document.body`; a missing class reads as locked.

import type { Teardown } from '../disposal.ts';
import { GAME_UNLOCKED_CLASS } from './anchors.ts';
import type { UnlockMode } from './kit/unlock.ts';

interface GameUnlockDeps {
  doc: Document;
  /** The loader's own mode, which this drives and never reads back. */
  unlock: UnlockMode;
}

/**
 * Mirror the game's edit mode onto the loader's. Edge triggered: body's class also flips for
 * unrelated game modes (`pad-active` on controller input), and writing the level on each
 * would drop a player out of the loader's own arrange mode mid-drag.
 */
function followGameUnlock(deps: GameUnlockDeps): Teardown {
  const { body } = deps.doc;
  if (body === null) {
    return () => undefined;
  }

  let last = body.classList.contains(GAME_UNLOCKED_CLASS);

  const sync = (): void => {
    const now = body.classList.contains(GAME_UNLOCKED_CLASS);
    if (now === last) {
      return;
    }
    last = now;
    deps.unlock.set(now);
  };

  // The class may already be there: the loader can start while the mode is open.
  deps.unlock.set(last);
  const observer = new MutationObserver(sync);
  // Filtered to the class alone, or every body attribute write wakes this.
  observer.observe(body, { attributes: true, attributeFilter: ['class'] });

  return () => {
    observer.disconnect();
  };
}

export type { GameUnlockDeps };
export { followGameUnlock };
