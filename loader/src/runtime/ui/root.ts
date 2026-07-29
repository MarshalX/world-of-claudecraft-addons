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
export { mountRoot, ROOT_ID };
