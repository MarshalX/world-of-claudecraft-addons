// The #woc-addons root element and the loader stylesheet.
//
// Addon DOM lives here rather than under the game's #ui, which the HUD rebuilds.
// The root is a sibling of #ui and a direct child of body, so nothing the game
// re-renders is an ancestor of it and no re-render can take it away.
//
// The stylesheet is injected UNLAYERED. Every game rule lives inside @layer base
// or @layer components, and an unlayered rule outranks any layered one whatever
// the specificity, so addon styling survives a game update that adds another
// layer or reorders the ones it has.

const ROOT_ID = 'woc-addons';
const STYLE_ID = 'woc-addons-style';
/**
 * On the root while the game HUD is not in the document.
 *
 * The stylesheet hides addon frames under it, and only addon frames: the manager
 * has to stay reachable from the start screen, since it is how a player finds out
 * the loader is broken and one of its three routes in is host-side and works with
 * no game at all.
 *
 * Exported rather than written twice. `ui/mount.ts` is what clears and re-sets it
 * from the HUD presence signal, and a second copy of the string there would be a
 * class one file sets and another styles with nothing holding them together.
 */
const NO_HUD_CLASS = 'woc-no-hud';
/**
 * On the root while the Dev tab's freeze is on.
 *
 * The callback gates in `runtime/freeze.ts` stop every addon that repaints on a
 * cadence, and they cannot stop a CSS animation, which has no callback to hold.
 * This is the half of the freeze the stylesheet owns. Here rather than in
 * freeze.ts for the same reason NO_HUD_CLASS is here: one home for a class one
 * module writes and another styles.
 */
const FROZEN_CLASS = 'woc-frozen';

interface RootDeps {
  doc: Document;
  /** The loader stylesheet, bundled as text. See loader/build-runtime.mjs. */
  css: string;
}

interface AddonRoot {
  el: HTMLElement;
  dispose: () => void;
}

/**
 * Create the root and inject the stylesheet, or adopt them if they already exist.
 *
 * Adoption matters because a userscript manager can run the loader twice against
 * one document, through a soft navigation or a second matching @match rule. A
 * second root would leave the first orphaned and still styled, which reads to a
 * player as a duplicated, unresponsive manager rather than as the bug it is.
 */
function mountRoot(deps: RootDeps): AddonRoot {
  const { doc } = deps;
  if (doc.body === null) {
    throw new Error('the addon root cannot mount before document.body exists');
  }

  const style = doc.getElementById(STYLE_ID) ?? doc.createElement('style');
  if (style.id !== STYLE_ID) {
    style.id = STYLE_ID;
    style.textContent = deps.css;
    doc.head.appendChild(style);
  }

  const el = doc.getElementById(ROOT_ID) ?? doc.createElement('div');
  if (el.id !== ROOT_ID) {
    el.id = ROOT_ID;
    // Addon frames are hidden until the HUD is seen. The safe default, not a
    // waiting state: a frame with a saved visibility is restored as soon as its
    // addon starts, which is at document-start on the landing page, and the
    // failure that produced this was a meter window sitting over the PLAY
    // button. ui/mount.ts clears it on the first presence report.
    el.classList.add(NO_HUD_CLASS);
    doc.body.appendChild(el);
  }

  return {
    el,
    dispose: () => {
      el.remove();
      style.remove();
    },
  };
}

export type { AddonRoot, RootDeps };
export { FROZEN_CLASS, mountRoot, NO_HUD_CLASS, ROOT_ID };
