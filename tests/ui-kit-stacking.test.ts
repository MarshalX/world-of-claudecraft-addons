// @vitest-environment happy-dom

// One listener on the root orders every loader window: it must reach the manager and
// every addon frame, leave the overlay bands alone, and enforce the ceiling.

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
 * A loader window. `mark` is set as an attribute because `dataset` is an index
 * signature, where the linter wants dot access and the compiler forbids it.
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

/** A pointerdown on something inside a window. */
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

  it('brings a buried window back to the front', () => {
    const { host } = setup();
    const first = window_(host, 'first');
    const second = window_(host, 'second');
    clickInside(first);
    clickInside(second);

    clickInside(first);

    expect(z(first)).toBeGreaterThan(z(second));
  });

  // Capture phase, so a child that stops propagation cannot bury its own window.
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

  it('raises on focus as well as on pointer', () => {
    const { host } = setup();
    const first = window_(host, 'first');
    const second = window_(host, 'second');
    clickInside(second);

    first.querySelector('button')?.dispatchEvent(new Event('focusin', { bubbles: true }));

    expect(z(first)).toBeGreaterThan(z(second));
  });

  // The listener keys on `.woc-window` so the manager and addon frames share one order.
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

/**
 * Both ceiling cases raise WINDOW_Z_CEILING times, which can pass the default five
 * second budget on a loaded machine. Reaching the ceiling is the only way in from outside.
 */
const CEILING_TIMEOUT_MS = 30_000;

describe('the ceiling', () => {
  // Toasts, the modal backdrop and the tooltip sit above WINDOW_Z_CEILING.
  it(
    'renumbers rather than climbing into the overlay bands',
    () => {
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
      expect(z(second)).toBeGreaterThan(z(first));
    },
    CEILING_TIMEOUT_MS,
  );

  // Read off the bottom window's slot: pruned, the live pair renumbers to 1 and 2;
  // retained, it starts at 2. The top window's value cannot tell the two apart.
  it(
    'drops windows that have left the document when it renumbers',
    () => {
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
    },
    CEILING_TIMEOUT_MS,
  );
});
