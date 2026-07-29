// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountMicroButton } from '../loader/src/runtime/ui/micro-button.ts';
import { mountGameRail } from './fakes/game-dom.ts';

const LABEL = 'Addons';
const BUTTON = '#woc-addons-micro-button';

function mount(onOpen = (): undefined => undefined) {
  return mountMicroButton({ doc: document, label: LABEL, onOpen });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the rail button', () => {
  // Placed after the game-menu button rather than appended, so the two menu
  // routes stay together however many buttons the game adds above them.
  it('sits immediately after the game-menu button', () => {
    mountGameRail(document);

    mount();

    const button = document.querySelector(BUTTON);
    expect(document.getElementById('mm-options')?.nextElementSibling).toBe(button);
  });

  it('carries the game rail class and an accessible name', () => {
    mountGameRail(document);

    const { el } = mount();

    expect(el?.className).toBe('micro-btn');
    expect(el?.getAttribute('aria-label')).toBe(LABEL);
  });

  // The game hydrates [data-icon] from a closed registry of its own names, so
  // borrowing that attribute would render nothing, or silently pick up whatever
  // the game later assigns to a name we guessed.
  it('draws its own glyph rather than borrowing the game icon mechanism', () => {
    mountGameRail(document);

    const { el } = mount();

    expect(el?.hasAttribute('data-icon')).toBe(false);
    expect(el?.querySelector('svg')).not.toBeNull();
  });

  it('opens the manager when clicked', () => {
    const onOpen = vi.fn();
    mountGameRail(document);

    mount(onOpen).el?.click();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // A rail whose last button the game renames still gets the entry, at the end,
  // rather than losing it.
  it('falls back to the end of the rail when the menu button is gone', () => {
    mountGameRail(document);
    document.getElementById('mm-options')?.remove();

    const { el } = mount();

    expect(document.getElementById('side-buttons-col-b')?.lastElementChild).toBe(el);
  });

  // A game update that renames the rail must cost this route, not the loader.
  it('is inert when the rail is gone', () => {
    document.body.innerHTML = '<div id="ui"></div>';

    const button = mount();

    expect(button.el).toBeNull();
    expect(() => {
      button.dispose();
    }).not.toThrow();
  });

  it('takes the button away on dispose', () => {
    mountGameRail(document);

    mount().dispose();

    expect(document.querySelector(BUTTON)).toBeNull();
  });
});
