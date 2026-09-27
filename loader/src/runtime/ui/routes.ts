// The loader's own two entries in the game's chrome, which do different things.

import { ENTRY_ID } from './esc-inject.ts';
import { frameMenuItems } from './frame-menu.ts';
import type { FrameRoster } from './kit/frame-roster.ts';
import type { GameInjector } from './kit/injections.ts';
import type { Menus } from './kit/menu.ts';
import type { UnlockMode } from './kit/unlock.ts';
import { BUTTON_ID } from './micro-button.ts';
import type { SnapStore } from './snap-store.ts';

/** What both routes are called, in the rail and in the game menu. */
const LABEL = 'Addons';

/** What the loader's own two in-game routes need. */
interface RouteDeps {
  doc: Document;
  injector: GameInjector;
  menus: Menus;
  roster: FrameRoster;
  /** The arrange-your-UI switch, which the menu offers alongside the frames. */
  unlock: UnlockMode;
  /** Whether an arranged frame lands on the grid, offered under the switch. */
  snap: SnapStore;
  /** Open the manager. */
  onOpen: () => void;
}

/**
 * The loader's own entries in the game's chrome. The game menu entry opens the manager
 * directly, so the route for diagnosing a broken loader does not depend on addon state. The
 * rail button opens the frame menu, where a player finds a window they closed.
 */
function addLoaderRoutes(deps: RouteDeps): void {
  deps.injector.add({ kind: 'menu', id: ENTRY_ID, label: LABEL, onOpen: deps.onOpen });
  deps.injector.add({
    kind: 'micro',
    id: BUTTON_ID,
    label: LABEL,
    onOpen: () => {
      // Looked up, not held: the button is rebuilt with the HUD. No anchor opens at the origin.
      const button = deps.doc.querySelector(`#${BUTTON_ID}`);
      deps.menus.open(
        button ?? { x: 0, y: 0 },
        frameMenuItems(deps.roster.entries(), {
          openManager: deps.onOpen,
          unlocked: () => deps.unlock.unlocked,
          toggleUnlock: deps.unlock.toggle,
          snapping: () => deps.snap.enabled,
          toggleSnap: deps.snap.toggle,
        }),
      );
    },
  });
}

export { addLoaderRoutes, LABEL };
