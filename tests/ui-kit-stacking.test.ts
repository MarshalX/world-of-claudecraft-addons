// @vitest-environment happy-dom

// Which loader window is in front.
//
// There was no answer before this. Windows are absolutely positioned siblings
// with no z-index, so overlap fell out of DOM order and clicking a buried one
// left it buried. With the manager and two addon frames open at once, that is not
// a polish problem: the window behind is unusable.
//
// One listener on the root does all of it, so what is asserted here is that the
// listener's reach is right (the manager and every addon frame, by the class they
// share), that the overlay bands are out of its scope, and that the ceiling is
// enforceable rather than merely high.

import { afterEach, describe, expect, it } from 'vitest';
import { createStacking, WINDOW_Z_CEILING } from '../loader/src/runtime/ui/kit/stacking.ts';

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * A loader window, which is what the raise keys on.
 *
 * `mark` is set as an attribute rather than through `dataset`, which is an index
 * signature: the linter wants dot access there and the compiler forbids it.
 */
function window_(host: HTMLElement, mark: string): HTMLElement {
  const el = document.createElement('section');
  el.className = 'woc-window panel';
  el.setAttribute('data-mark', mark);
  const child = document.createElement('button');
  el.appendChild(child);
  host.appendChild(el);
  return el;
}

function z(el: HTMLElement): number {
  return Number(el.style.zIndex);
}

/** A pointerdown on something INSIDE a window, which is the real case. */
function clickInside(el: HTMLElement): void {
  const child = el.querySelector('button');
  child?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

describe('clicking a window', () => {
  function setup() {
    const host = root();
    const stacking = createStacking({ root: host });
    return { host, stacking };
  }

  it('puts it in front of one that was raised earlier', () => {
    const { host } = setup();
    const first = window_(host, 'first');
    const second = window_(host, 'second');

    clickInside(first);
    clickInside(second);

    expect(z(second)).toBeGreaterThan(z(first));
  });

  // The reported case: the buried one has to come forward, not just the newest.
  it('brings a buried window back to the front', () => {
    const { host } = setup();
    const first = window_(host, 'first');
    const second = window_(host, 'second');
    clickInside(first);
    clickInside(second);

    clickInside(first);

    expect(z(first)).toBeGreaterThan(z(second));
  });

  // The click almost never lands on the window element itself; it lands on a row,
  // a button, a tab. Capture phase, so a child that stops propagation cannot make
  // its own window unraisable.
  it('raises from a click on any descendant', () => {
    const { host } = setup();
    const win = window_(host, 'only');
    const child = win.querySelector('button');
    child?.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });

    clickInside(win);

    expect(z(win)).toBeGreaterThan(0);
  });

  // Tabbing into a buried window and having it stay buried is the keyboard
  // version of the same bug.
  it('raises on focus as well as on pointer', () => {
    const { host } = setup();
    const first = window_(host, 'first');
    const second = window_(host, 'second');
    clickInside(second);

    first.querySelector('button')?.dispatchEvent(new Event('focusin', { bubbles: true }));

    expect(z(first)).toBeGreaterThan(z(second));
  });

  // The manager is a `.woc-window` too, which is the whole reason the listener
  // keys on that class rather than on anything addon-specific: the two kinds of
  // window overlap each other and have to be in one order.
  it('treats the manager as one of them', () => {
    const { host } = setup();
    const frame = window_(host, 'frame');
    const manager = window_(host, 'manager');
    manager.setAttribute('data-woc-manager', '');
    clickInside(frame);

    clickInside(manager);

    expect(z(manager)).toBeGreaterThan(z(frame));
  });

  it('ignores a click that is not in a window at all', () => {
    const { host } = setup();
    const loose = document.createElement('div');
    host.appendChild(loose);

    loose.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(loose.style.zIndex).toBe('');
  });

  it('stops raising once disposed', () => {
    const { host, stacking } = setup();
    const win = window_(host, 'only');

    stacking.dispose();
    clickInside(win);

    expect(win.style.zIndex).toBe('');
  });
});

describe('the ceiling', () => {
  // Toasts, the modal backdrop and the tooltip sit above WINDOW_Z_CEILING, so
  // "above every window" has to be true of every window there can ever be, not
  // just of the ones anyone expects. Without the renumbering pass the only
  // defence is that nobody clicks that many times, which is not a defence.
  it('renumbers rather than climbing into the overlay bands', () => {
    const host = root();
    const stacking = createStacking({ root: host });
    const first = window_(host, 'first');
    const second = window_(host, 'second');

    for (let click = 0; click <= WINDOW_Z_CEILING; click += 1) {
      stacking.raise(first);
    }
    stacking.raise(second);

    expect(z(first)).toBeLessThanOrEqual(WINDOW_Z_CEILING);
    expect(z(second)).toBeLessThanOrEqual(WINDOW_Z_CEILING);
    // And the order the renumbering preserved is the order it was raised in.
    expect(z(second)).toBeGreaterThan(z(first));
  });

  // A window that has been closed must not hold a slot in the renumbering, or a
  // long session would renumber ever-growing lists of dead elements.
  //
  // Read off the SLOT the surviving bottom window lands in, which is the only
  // thing about the pruning that is observable from outside: with the dead one
  // dropped the live pair renumbers to 1 and 2, and with it retained they would
  // start at 2 instead. Asserting the top window's value would not tell the two
  // apart, which is what the first version of this test got wrong.
  it('drops windows that have left the document when it renumbers', () => {
    const host = root();
    const stacking = createStacking({ root: host });
    const gone = window_(host, 'gone');
    const bottom = window_(host, 'bottom');
    const top = window_(host, 'top');
    stacking.raise(gone);
    stacking.raise(bottom);
    stacking.raise(top);
    gone.remove();

    for (let click = 0; click <= WINDOW_Z_CEILING; click += 1) {
      stacking.raise(top);
    }

    expect(z(bottom)).toBe(1);
    expect(z(top)).toBeGreaterThan(z(bottom));
  });
});
