// @vitest-environment happy-dom

// The context menu. Mostly dismissal: select, Escape, a click elsewhere, and disable
// of the addon that opened it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenus, MENU_ID } from '../loader/src/runtime/ui/kit/menu.ts';

const VIEW = { w: 1280, h: 800 };

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

function openMenu(entries: Parameters<ReturnType<typeof createMenus>['open']>[1]) {
  const host = root();
  const menus = createMenus({ doc: document, root: host, viewport: () => VIEW });
  const close = menus.open({ x: 40, y: 60 }, entries);
  return { menus, close };
}

function menu(): HTMLElement | null {
  return document.getElementById(MENU_ID);
}

function items(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.woc-menu-item')];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('what it draws', () => {
  it('renders one item per entry, in order', () => {
    openMenu([
      { label: 'Reset', onSelect: vi.fn() },
      { label: 'Ignore', onSelect: vi.fn() },
    ]);

    expect(items().map((el) => el.textContent)).toEqual(['Reset', 'Ignore']);
  });

  it('draws a disabled item as present and unusable', () => {
    openMenu([{ label: 'Reset', onSelect: vi.fn(), disabled: true }]);

    expect(items()[0]?.disabled).toBe(true);
  });

  // An addon building items from a filtered list cannot easily know which is first.
  it('ignores a separator on the first item', () => {
    openMenu([
      { label: 'Reset', onSelect: vi.fn(), separator: true },
      { label: 'Ignore', onSelect: vi.fn(), separator: true },
    ]);

    expect(items()[0]?.classList.contains('woc-menu-cut')).toBe(false);
    expect(items()[1]?.classList.contains('woc-menu-cut')).toBe(true);
  });

  // Labels carry names from the wire.
  it('writes a label as text', () => {
    openMenu([{ label: '<img src=x onerror=alert(1)>', onSelect: vi.fn() }]);

    expect(menu()?.querySelector('img')).toBeNull();
  });
});

describe('choosing an item', () => {
  it('calls its handler', () => {
    const onSelect = vi.fn();
    openMenu([{ label: 'Reset', onSelect }]);

    items()[0]?.click();

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('closes the menu', () => {
    openMenu([{ label: 'Reset', onSelect: vi.fn() }]);

    items()[0]?.click();

    expect(menu()).toBeNull();
  });

  // Closed before the handler runs, so the new menu survives the old one's teardown.
  it('lets a handler open another menu', () => {
    const host = root();
    const menus = createMenus({ doc: document, root: host, viewport: () => VIEW });
    menus.open({ x: 0, y: 0 }, [
      {
        label: 'More',
        onSelect: () => {
          menus.open({ x: 10, y: 10 }, [{ label: 'Second', onSelect: vi.fn() }]);
        },
      },
    ]);

    items()[0]?.click();

    expect(items().map((el) => el.textContent)).toEqual(['Second']);
  });
});

describe('dismissal', () => {
  it('closes on Escape', () => {
    openMenu([{ label: 'Reset', onSelect: vi.fn() }]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(menu()).toBeNull();
  });

  // Capture phase: the game's own controls stop propagation.
  it('closes on a pointer press that stops propagating', () => {
    openMenu([{ label: 'Reset', onSelect: vi.fn() }]);
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });

    elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(menu()).toBeNull();
  });

  it('stays open for a press inside itself', () => {
    openMenu([{ label: 'Reset', onSelect: vi.fn() }]);

    items()[0]?.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(menu()).not.toBeNull();
  });

  it('drops its listeners once closed, so a later Escape reaches the game', () => {
    openMenu([{ label: 'Reset', onSelect: vi.fn() }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const after = new KeyboardEvent('keydown', { key: 'Escape' });
    const stopped = vi.spyOn(after, 'stopPropagation');

    document.dispatchEvent(after);

    expect(stopped).not.toHaveBeenCalled();
  });
});

// One menu for the whole loader, like the banner slot.
describe('the single slot', () => {
  it('closes the first when a second opens', () => {
    const host = root();
    const menus = createMenus({ doc: document, root: host, viewport: () => VIEW });

    menus.open({ x: 0, y: 0 }, [{ label: 'First', onSelect: vi.fn() }]);
    menus.open({ x: 0, y: 0 }, [{ label: 'Second', onSelect: vi.fn() }]);

    expect(items().map((el) => el.textContent)).toEqual(['Second']);
  });

  // An addon's teardown closes only its own menu.
  it('ignores a close called after another menu replaced it', () => {
    const host = root();
    const menus = createMenus({ doc: document, root: host, viewport: () => VIEW });
    const closeFirst = menus.open({ x: 0, y: 0 }, [{ label: 'First', onSelect: vi.fn() }]);
    menus.open({ x: 0, y: 0 }, [{ label: 'Second', onSelect: vi.fn() }]);

    closeFirst();

    expect(items().map((el) => el.textContent)).toEqual(['Second']);
  });

  it('takes the open menu away on dispose', () => {
    const { menus } = openMenu([{ label: 'Reset', onSelect: vi.fn() }]);

    menus.dispose();

    expect(menu()).toBeNull();
  });
});

describe('placement', () => {
  it('opens at the point it was given', () => {
    openMenu([{ label: 'Reset', onSelect: vi.fn() }]);

    expect(menu()?.style.left).toBe('40px');
    expect(menu()?.style.top).toBe('60px');
  });

  // happy-dom measures every element as zero, so this pins that the clamp applies.
  it('keeps a menu opened past the edge on screen', () => {
    const host = root();
    const menus = createMenus({ doc: document, root: host, viewport: () => VIEW });

    menus.open({ x: 4000, y: 4000 }, [{ label: 'Reset', onSelect: vi.fn() }]);

    expect(Number.parseInt(menu()?.style.left ?? '', 10)).toBeLessThanOrEqual(VIEW.w);
    expect(Number.parseInt(menu()?.style.top ?? '', 10)).toBeLessThanOrEqual(VIEW.h);
  });

  it('opens under an element when given one', () => {
    const host = root();
    const menus = createMenus({ doc: document, root: host, viewport: () => VIEW });
    const anchor = document.createElement('div');
    host.appendChild(anchor);

    menus.open(anchor, [{ label: 'Reset', onSelect: vi.fn() }]);

    expect(menu()).not.toBeNull();
  });
});
