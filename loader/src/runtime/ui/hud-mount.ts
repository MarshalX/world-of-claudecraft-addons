// Waiting for the game's HUD, and noticing if it is ever replaced or removed.
//
// The HUD is cloned from <template id="game-ui-template"> into document.body only at world
// entry, so a one-time lookup at DOMContentLoaded finds nothing. The clone lands as direct
// children of body, so a childList observer on body alone sees it; a subtree observer would
// run a selector on every HUD mutation for the whole session.
//
// The observer stays connected after it fires, since the game mounting the HUD only once is
// an assumption, and losing both in-game routes would be silent. Body-level childList
// mutations are rare, so the standing cost is one selector call each.
//
// Re-attach is keyed on the HUD element's IDENTITY. Keying on the loader's own elements
// would spin whenever a game update leaves the injection nothing to find.
//
// Removal is reported too, so addon frames (which live outside #ui) can hide when the HUD
// goes, rather than sitting over the landing page after a logout.

import { ANCHORS } from './anchors.ts';

export interface HudWaitDeps {
  doc: Document;
  /** Called with the HUD in the document, and again only if it is replaced. */
  attach: () => void;
  /** Called before a re-attach or a removal, to release what the last one built. */
  detach: () => void;
  /**
   * Whether the HUD is in the document, on every change. Never called for the starting absent
   * state, so a consumer should default to hidden.
   */
  onPresence?: (present: boolean) => void;
}

export interface HudWait {
  /** Whether the HUD is in the document NOW, not whether it ever was. */
  attached: () => boolean;
  cancel: () => void;
}

export function whenHudMounts(deps: HudWaitDeps): HudWait {
  const { doc } = deps;
  let mounted: Element | null = null;

  const sync = (): void => {
    const hud = doc.querySelector(ANCHORS.hudRoot);
    if (hud === mounted) {
      return;
    }
    // A previous attach is watching detached nodes, on a replacement and a removal alike.
    if (mounted !== null) {
      deps.detach();
    }
    mounted = hud;
    if (hud === null) {
      deps.onPresence?.(false);
      return;
    }
    deps.attach();
    deps.onPresence?.(true);
  };

  // The player may already be in the world: the loader can start mid-session.
  sync();

  const observer = new MutationObserver(sync);
  if (doc.body !== null) {
    observer.observe(doc.body, { childList: true });
  }

  return {
    attached: () => mounted !== null,
    cancel: () => {
      observer.disconnect();
    },
  };
}
