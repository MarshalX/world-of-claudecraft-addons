// The #woc-addons root element, its two stacking bands, and the loader stylesheet.
//
// The root is a direct child of body and a sibling of #ui, so no HUD re-render can take it
// away. The stylesheet is injected UNLAYERED: an unlayered rule outranks every game rule
// (all layered) whatever the specificity.
//
// THE ROOT DRAWS NOTHING AND IS NOT A LAYER. `#options-menu` is a window inside `#ui`, one
// stacking context, so a single z-index above `#ui` would put addon frames over every game
// window. Hence two bands and a `display: contents` root: `position: fixed` always creates a
// stacking context, so a root with a box would trap both bands in one layer again.

const ROOT_ID = 'woc-addons';
const STYLE_ID = 'woc-addons-style';
/**
 * The two layers everything the loader draws goes into.
 *
 * Both are `position: fixed; inset: 0`, so each is its own stacking context competing with
 * `#game-canvas` (0), `#nameplates` (1) and `#ui` (10, or 80 to 90 in other layouts). The game
 * also mounts body-level dialogs between 90 and 120 (the armory inspector, store prompts),
 * which land between the two bands; place any new band against those, not `#ui` alone.
 *
 * The split is the frame/window distinction: a frame is HUD furniture and goes in the hud
 * band, below `#ui`, so game windows (and the chat and action bars) cover it. Whatever the
 * player opened or the loader raised (manager, menu, toast, modal, tooltip, banner) goes in
 * the overlay band above everything.
 */
const HUD_BAND_CLASS = 'woc-hud-band';
const OVERLAY_BAND_CLASS = 'woc-overlay-band';
/**
 * On the root while the game HUD is not in the document. It hides addon frames only: the
 * manager must stay reachable from the start screen. `ui/mount.ts` toggles it.
 */
const NO_HUD_CLASS = 'woc-no-hud';
/**
 * On the root while the Dev tab's freeze is on: the stylesheet's half of the freeze, for CSS
 * animations, which `runtime/freeze.ts` has no callback to hold.
 */
const FROZEN_CLASS = 'woc-frozen';

interface RootDeps {
  doc: Document;
  /** The loader stylesheet, bundled as text. See loader/build-runtime.mjs. */
  css: string;
}

interface AddonRoot {
  /**
   * The `#woc-addons` element, which contains both bands and draws nothing. The handle for
   * what spans both bands: the mode classes, the window-order listener, the tooltip watcher.
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
 * Create the root and inject the stylesheet, or adopt them if they already exist: a userscript
 * manager can run the loader twice against one document, and a second root orphans the first.
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
    // Hidden by default: a frame with saved visibility is restored at document-start, on the
    // landing page. ui/mount.ts clears it on the first presence report.
    el.classList.add(NO_HUD_CLASS);
    doc.body.appendChild(el);
  }

  // Hud first, so the overlay is on top even before the sheet applies.
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
