// The loader's own two entries in the game's chrome, and what each one does.
//
// Split from mount.ts when the rail button stopped being a second copy of the
// game menu entry. They are no longer the same action, and the difference is the
// point of the file.
//
// The GAME MENU entry opens the manager directly. It is the route that has to
// keep working when everything else is broken, and the manager is how a player
// finds out that it is, so routing it through a menu assembled out of addon state
// would make it depend on the very thing it exists to let them fix.
//
// The RAIL BUTTON opens a menu of every frame the loader is holding, with the
// manager as its first entry. It is where a player looks for a window they
// closed, and a closed frame has no pixels, so neither the unlock mode nor a
// hover can find one: before this, the addon's own keybind was the only way back.

import { ENTRY_ID } from './esc-inject.ts';
import { frameMenuItems } from './frame-menu.ts';
import type { FrameRoster } from './kit/frame-roster.ts';
import type { GameInjector } from './kit/injections.ts';
import type { Menus } from './kit/menu.ts';
import type { UnlockMode } from './kit/unlock.ts';
import { BUTTON_ID } from './micro-button.ts';

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
  /** Open the manager. */
  onOpen: () => void;
}

/**
 * The loader's own entries in the game's chrome.
 *
 * The two are deliberately NOT the same action any more. The game menu entry
 * opens the manager directly, because it is the route that has to keep working
 * when everything else is broken and the manager is how a player finds out that
 * it is; routing it through a menu assembled out of addon state would make it
 * depend on the thing it exists to let them fix. The rail button opens that menu,
 * because it is where a player looks for a window they closed, and a closed frame
 * has no pixels for the unlock mode or a hover to find.
 */
function addLoaderRoutes(deps: RouteDeps): void {
  deps.injector.add({ kind: 'menu', id: ENTRY_ID, label: LABEL, onOpen: deps.onOpen });
  deps.injector.add({
    kind: 'micro',
    id: BUTTON_ID,
    label: LABEL,
    onOpen: () => {
      // Found rather than held: the rail is game DOM, so the button is rebuilt
      // whenever the HUD is, and a reference kept from the first mount would be an
      // element no longer in the document. A menu with nothing to anchor to opens
      // at the origin rather than not at all.
      const button = deps.doc.querySelector(`#${BUTTON_ID}`);
      deps.menus.open(
        button ?? { x: 0, y: 0 },
        frameMenuItems(deps.roster.entries(), {
          openManager: deps.onOpen,
          unlocked: () => deps.unlock.unlocked,
          toggleUnlock: deps.unlock.toggle,
        }),
      );
    },
  });
}

export { addLoaderRoutes, LABEL };
