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
  // The HUD rebuilds its own subtree, so a root inside #ui would be swept away.
  it('mounts as a direct child of body', () => {
    document.body.innerHTML = '<div id="ui"></div>';

    const root = mountRoot({ doc: document, css: CSS });

    expect(root.el.parentElement).toBe(document.body);
    expect(root.el.id).toBe(ROOT_ID);
  });

  // A layered rule loses to an unlayered one, so any wrapper costs the loader the cascade.
  it('injects the stylesheet verbatim, wrapping it in nothing', () => {
    mountRoot({ doc: document, css: CSS });

    expect(document.getElementById(STYLE_ID)?.textContent).toBe(CSS);
  });

  // A manager can run the loader twice against one document; a second root orphans the first.
  it('adopts an existing root', () => {
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

// #options-menu is a window inside #ui, so one z-index above #ui would cover the game menu.
// The band depths live in the stylesheet, which is '' under Vitest.
describe('the two stacking bands', () => {
  it('builds one band for HUD furniture and one for what sits over everything', () => {
    const root = mountRoot({ doc: document, css: CSS });

    expect(root.hud.parentElement).toBe(root.el);
    expect(root.overlay.parentElement).toBe(root.el);
    expect(root.hud.classList.contains(HUD_BAND_CLASS)).toBe(true);
    expect(root.overlay.classList.contains(OVERLAY_BAND_CLASS)).toBe(true);
    expect(root.hud).not.toBe(root.overlay);
  });

  // The fallback before the stylesheet applies.
  it('puts the hud band first in document order', () => {
    const root = mountRoot({ doc: document, css: CSS });

    expect(root.el.firstElementChild).toBe(root.hud);
    expect(root.el.lastElementChild).toBe(root.overlay);
  });

  it('adopts the bands of an existing root', () => {
    const first = mountRoot({ doc: document, css: CSS });
    const second = mountRoot({ doc: document, css: CSS });

    expect(second.hud).toBe(first.hud);
    expect(second.overlay).toBe(first.overlay);
    expect(document.querySelectorAll(`.${HUD_BAND_CLASS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`.${OVERLAY_BAND_CLASS}`)).toHaveLength(1);
  });
});
