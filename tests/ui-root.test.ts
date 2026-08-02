// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import {
  HUD_BAND_CLASS,
  mountRoot,
  OVERLAY_BAND_CLASS,
  ROOT_ID,
} from '../loader/src/runtime/ui/root.ts';

const CSS = '#woc-addons { color: red; }';
const STYLE_ID = 'woc-addons-style';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('the addon root', () => {
  // A sibling of #ui, not a child: the HUD rebuilds its own subtree, and a root
  // inside it would be swept away with whatever the game re-rendered.
  it('mounts as a direct child of body', () => {
    document.body.innerHTML = '<div id="ui"></div>';

    const root = mountRoot({ doc: document, css: CSS });

    expect(root.el.parentElement).toBe(document.body);
    expect(root.el.id).toBe(ROOT_ID);
  });

  // Verbatim is the whole mechanism. A rule inside any @layer loses to an
  // unlayered one, so wrapping what it is handed, in a layer or in anything
  // else, is what would cost the loader the cascade. Asserting the text is
  // byte-identical is the claim; scanning it for '@layer' would only assert
  // something about this fixture.
  it('injects the stylesheet verbatim, wrapping it in nothing', () => {
    mountRoot({ doc: document, css: CSS });

    expect(document.getElementById(STYLE_ID)?.textContent).toBe(CSS);
  });

  // A manager can run the loader twice against one document. A second root would
  // leave the first orphaned and still styled, which reads as a duplicated,
  // unresponsive manager rather than as the bug it is.
  it('adopts an existing root rather than making a second', () => {
    const first = mountRoot({ doc: document, css: CSS });
    const second = mountRoot({ doc: document, css: CSS });

    expect(second.el).toBe(first.el);
    expect(document.querySelectorAll(`#${ROOT_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
  });

  it('takes both the root and the stylesheet away on dispose', () => {
    mountRoot({ doc: document, css: CSS }).dispose();

    expect(document.getElementById(ROOT_ID)).toBeNull();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });
});

// The two bands exist because the game menu was opening BEHIND an addon frame:
// #options-menu is a .window inside #ui, so the old single root's one z-index
// above #ui was one z-index above every window the game has. What the stylesheet
// then does with them cannot be checked from here, since every .css import
// resolves to '' under vitest; what is checkable is that both are there, that they
// are distinct, and that a second run of the loader adopts them.
describe('the two stacking bands', () => {
  it('builds one band for HUD furniture and one for what sits over everything', () => {
    const root = mountRoot({ doc: document, css: CSS });

    expect(root.hud.parentElement).toBe(root.el);
    expect(root.overlay.parentElement).toBe(root.el);
    expect(root.hud.classList.contains(HUD_BAND_CLASS)).toBe(true);
    expect(root.overlay.classList.contains(OVERLAY_BAND_CLASS)).toBe(true);
    expect(root.hud).not.toBe(root.overlay);
  });

  // The bands carry their depth in the stylesheet. This is the fallback for the
  // moment before it applies, and it costs nothing to be right about.
  it('puts the hud band first, so document order alone already stacks them', () => {
    const root = mountRoot({ doc: document, css: CSS });

    expect(root.el.firstElementChild).toBe(root.hud);
    expect(root.el.lastElementChild).toBe(root.overlay);
  });

  // The same reason the root itself is adopted: a second pair would leave every
  // frame the first run mounted in a band nothing draws into any more.
  it('adopts the bands of an existing root rather than making a second pair', () => {
    const first = mountRoot({ doc: document, css: CSS });
    const second = mountRoot({ doc: document, css: CSS });

    expect(second.hud).toBe(first.hud);
    expect(second.overlay).toBe(first.overlay);
    expect(document.querySelectorAll(`.${HUD_BAND_CLASS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`.${OVERLAY_BAND_CLASS}`)).toHaveLength(1);
  });
});
