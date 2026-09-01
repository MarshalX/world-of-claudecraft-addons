// Follow the game's own HUD edit mode ("Edit Frames", game 0.41.0) onto the loader's
// arrange mode, ONE WAY: the game's mode early-returns from `onMouseDown`
// (`src/input.ts`) and takes camera drag and click-to-target with it, so the loader's
// switch must never write it back. The signal is the class the game writes on
// `document.body` (`INTERFACE_UNLOCKED_BODY_CLASS`, `src/ui/interface_unlock.ts`),
// which outlives every HUD mount; a missing class reads as locked.

import type { Teardown } from '../disposal.ts';
import { GAME_UNLOCKED_CLASS } from './anchors.ts';
import type { UnlockMode } from './kit/unlock.ts';

interface GameUnlockDeps {
  doc: Document;
  /** The loader's own mode, which this drives and never reads back. */
  unlock: UnlockMode;
}

/**
 * Mirror the game's edit mode onto the loader's, and hand back the teardown.
 *
 * Edge triggered, and the idempotence of `unlock.set` is not what makes that safe:
 * body's class flips for unrelated game modes (`pad-active`, `src/game/input_hint_mode.ts`,
 * on every controller input), and writing the reading on each would drop a player who
 * turned the loader's mode on from its own switch out of arrange mode mid-drag.
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
