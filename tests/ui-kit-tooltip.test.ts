// @vitest-environment happy-dom

// Tooltips: the third shared kit surface, split out from ui-kit-overlays.test.ts
// because attachment lifetime is a topic of its own rather than a variation on
// how a toast or a modal goes away.
//
// One element serves every attachment and is refilled on hover, so the cases
// that matter are the ones about that element's lifetime: it is not built until
// something is hovered, a detached anchor stops reaching it, and dispose takes
// it away along with every listener. The alternative, a node per attachment,
// means a hundred hidden divs for a hundred rows in an addon's list.

import { afterEach, describe, expect, it } from 'vitest';
import { createTooltips, TOOLTIP_ID } from '../loader/src/runtime/ui/kit/tooltip.ts';

const VIEW = { w: 1280, h: 800 };

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tooltips', () => {
  function open() {
    return createTooltips({ doc: document, root: root(), viewport: () => VIEW });
  }

  function anchor(): HTMLElement {
    const el = document.createElement('button');
    document.body.appendChild(el);
    return el;
  }

  it('shows on hover and hides on leave', () => {
    const el = anchor();
    open().attach(el, 'Toggle the meter');

    el.dispatchEvent(new Event('pointerenter'));
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Toggle the meter');
    expect(document.getElementById(TOOLTIP_ID)?.hidden).toBe(false);

    el.dispatchEvent(new Event('pointerleave'));
    expect(document.getElementById(TOOLTIP_ID)?.hidden).toBe(true);
  });

  // The game's own tooltips answer the mouse only. Shipping that gap to every
  // addon is the one place the kit is deliberately better than what it matches.
  it('shows on focus too, so a keyboard reaches it', () => {
    const el = anchor();
    open().attach(el, 'Toggle the meter');

    el.dispatchEvent(new Event('focusin'));

    expect(document.getElementById(TOOLTIP_ID)?.hidden).toBe(false);
  });

  it('reuses one element across every attachment', () => {
    const tips = open();
    const first = anchor();
    const second = anchor();
    tips.attach(first, 'one');
    tips.attach(second, 'two');

    first.dispatchEvent(new Event('pointerenter'));
    second.dispatchEvent(new Event('pointerenter'));

    expect(document.querySelectorAll(`#${TOOLTIP_ID}`)).toHaveLength(1);
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('two');
  });

  it('creates nothing until something is actually hovered', () => {
    open().attach(anchor(), 'one');

    expect(document.getElementById(TOOLTIP_ID)).toBeNull();
  });

  it('stops answering once detached', () => {
    const el = anchor();
    const detach = open().attach(el, 'one');

    detach();
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById(TOOLTIP_ID)?.hidden ?? true).toBe(true);
  });

  it('detaches everything and removes the element on dispose', () => {
    const tips = open();
    const el = anchor();
    tips.attach(el, 'one');
    el.dispatchEvent(new Event('pointerenter'));

    tips.dispose();
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById(TOOLTIP_ID)).toBeNull();
  });
});
