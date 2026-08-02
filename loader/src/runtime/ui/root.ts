// The #woc-addons root element, its two stacking bands, and the loader stylesheet.
//
// Addon DOM lives here rather than under the game's #ui, which the HUD rebuilds.
// The root is a sibling of #ui and a direct child of body, so nothing the game
// re-renders is an ancestor of it and no re-render can take it away.
//
// The stylesheet is injected UNLAYERED. Every game rule lives inside @layer base
// or @layer components, and an unlayered rule outranks any layered one whatever
// the specificity, so addon styling survives a game update that adds another
// layer or reorders the ones it has.
//
// THE ROOT DRAWS NOTHING AND IS NOT A LAYER. It used to be one, fixed and
// inset:0 at a z-index above the game's own ceiling, and that single number was
// the whole reason the game menu opened UNDERNEATH an addon frame: `#options-menu`
// is a `.window` inside `#ui`, so one z-index above `#ui` is one z-index above
// every window the game has. There is no slotting into `#ui` from outside it,
// since it is one stacking context, so the answer is two bands and a root that is
// neither. `display: contents` is what makes that possible: `position: fixed`
// ALWAYS creates a stacking context whatever its z-index, so a root that had a box
// would trap both bands inside one layer again.

const ROOT_ID = 'woc-addons';
const STYLE_ID = 'woc-addons-style';
/**
 * The two layers everything the loader draws goes into.
 *
 * Both are `position: fixed; inset: 0`, so each is its own stacking context in
 * the document's, competing directly with `#game-canvas` (0), `#nameplates` (1)
 * and `#ui` (10, and 80 or 90 in the game's other layouts).
 *
 * The split is the frame/window distinction the kit already draws, made visible:
 * a frame is HUD FURNITURE and belongs among the game's own HUD, under any window
 * the player deliberately opened, so the hud band sits below `#ui`. Everything the
 * player opened or the loader raised (the manager, a menu, a toast, a modal, a
 * tooltip, a banner) belongs above all of it, so the overlay band stays where the
 * old single root was.
 *
 * What follows and is worth being deliberate about: an addon frame is now covered
 * by the game's bags, spellbook, map and menu, and that is the point. It is also
 * covered by the game's chat and action bars, which is the price, and the right
 * one: those are controls the player needs and an addon overlay is not.
 */
const HUD_BAND_CLASS = 'woc-hud-band';
const OVERLAY_BAND_CLASS = 'woc-overlay-band';
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
  /**
   * The `#woc-addons` element, which contains both bands and draws nothing.
   *
   * Still the handle for everything that is about ALL of the loader's DOM: the
   * two mode classes, the window-order listener, and the tooltip's watcher, none
   * of which care which band a node is in.
   */
  el: HTMLElement;
  /** Addon frames and world anchors. Below the game's HUD. */
  hud: HTMLElement;
  /** The manager, menus, toasts, modals, the banner, the tooltip. Above everything. */
  overlay: HTMLElement;
  dispose: () => void;
}

/** One band, adopted if a previous run of the loader already made it. */
function band(doc: Document, root: HTMLElement, className: string): HTMLElement {
  const existing = root.querySelector(`:scope > .${className}`);
  if (existing instanceof HTMLElement) {
    return existing;
  }
  const el = doc.createElement('div');
  el.className = className;
  root.appendChild(el);
  return el;
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

  // Order matters only for the two bands that carry no z-index of their own in a
  // browser that has not applied the sheet yet: hud first, so even then the
  // manager is on top rather than behind the frames.
  return {
    el,
    hud: band(doc, el, HUD_BAND_CLASS),
    overlay: band(doc, el, OVERLAY_BAND_CLASS),
    dispose: () => {
      el.remove();
      style.remove();
    },
  };
}

export type { AddonRoot, RootDeps };
export { FROZEN_CLASS, HUD_BAND_CLASS, mountRoot, NO_HUD_CLASS, OVERLAY_BAND_CLASS, ROOT_ID };
