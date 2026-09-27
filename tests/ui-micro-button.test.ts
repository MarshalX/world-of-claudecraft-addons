// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUTTON_ID, mountMicroButton } from '../loader/src/runtime/ui/micro-button.ts';
import { GAME_OWN_RAIL_BUTTON_CLASS, mountGameRail } from './fakes/game-dom.ts';

const LABEL = 'Addons';
const BUTTON = '#woc-addons-micro-button';

function mount(onOpen = (): undefined => undefined) {
  return mountMicroButton({ doc: document, id: BUTTON_ID, label: LABEL, onOpen });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the rail button', () => {
  // Keeps the two menu routes together however many buttons the game adds.
  it('sits immediately after the game-menu button', () => {
    mountGameRail(document);

    mount();

    const button = document.querySelector(BUTTON);
    expect(document.getElementById('mm-options')?.nextElementSibling).toBe(button);
  });

  // Compared against the game's own buttons, since a literal would only restate the loader's
  // constant; a missing plate class renders a bare glyph and fails nothing else.
  it('wears exactly what the game puts on its own rail buttons', () => {
    const rail = mountGameRail(document);
    const theirs = rail.querySelector('#mm-options')?.className;

    const { el } = mount();

    expect(el?.className).toBe(theirs);
    expect(el?.className).toBe(GAME_OWN_RAIL_BUTTON_CLASS);
  });

  it('carries an accessible name', () => {
    mountGameRail(document);

    const { el } = mount();

    expect(el?.getAttribute('aria-label')).toBe(LABEL);
  });

  // The game hydrates [data-icon] from a closed registry of its own names.
  it('draws its own glyph without the game icon mechanism', () => {
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
