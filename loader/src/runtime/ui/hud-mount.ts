// Waiting for the game's HUD, and noticing if it is ever replaced.
//
// The whole HUD ships inside <template id="game-ui-template"> and is cloned into
// document.body only at world entry, so #ui, #options-menu and the micro-button
// rail are all absent while the player is on the start screen. A one-time lookup
// at DOMContentLoaded finds none of them, which costs both in-game routes into
// the manager without raising anything.
//
// The clone lands as a batch of direct children of body, so a childList observer
// on body alone sees it. Subtree is deliberately NOT watched: the HUD mutates
// constantly once it exists, and a subtree observer here would run a selector on
// every one of those mutations for the whole session.
//
// The observer is NOT disconnected once it fires. Today the HUD is mounted once
// and never removed (mountGameUi returns early if #ui already exists, and logout
// reloads the page), so a second attach is unreachable. It is kept because that
// is an assumption about the game rather than a guarantee, and the failure it
// guards is invisible: both in-game routes would simply stop existing, with no
// error and nothing on screen to explain it. Body-level childList mutations are
// rare, so the standing cost is one selector call each.
//
// Re-attach is keyed on the HUD element's IDENTITY, not on whether the loader's
// own elements are still present. Keying on ours would spin: an update that
// renames the rail leaves nothing for the injection to find, so "ours is
// missing" would be permanently true and every body mutation would attach again.

import { ANCHORS } from './anchors.ts';

export interface HudWaitDeps {
  doc: Document;
  /** Called with the HUD in the document, and again only if it is replaced. */
  attach: () => void;
  /** Called before a re-attach, to release what the previous one built. */
  detach: () => void;
}

export interface HudWait {
  /** True once the HUD has been seen and attached to. */
  attached: () => boolean;
  cancel: () => void;
}

export function whenHudMounts(deps: HudWaitDeps): HudWait {
  const { doc } = deps;
  let mounted: Element | null = null;

  const sync = (): void => {
    const hud = doc.querySelector(ANCHORS.hudRoot);
    if (hud === null || hud === mounted) {
      return;
    }
    // A previous attach is now pointed at detached nodes: its listeners and its
    // menu observer are watching a tree nothing can see.
    if (mounted !== null) {
      deps.detach();
    }
    mounted = hud;
    deps.attach();
  };

  // The player may already be in the world: a userscript can be enabled, or the
  // loader updated, mid-session.
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
