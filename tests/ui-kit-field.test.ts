// @vitest-environment happy-dom

// The form controls and the tab strip.
//
// The styling is the manager's own and is not what this pins: what these builders
// add is a CONTRACT four controls share, so a pane that saves to storage reads
// them all the same way. Two halves of it are easy to get subtly wrong and are
// what the cases below are about.
//
// The first is `set`, which must NOT call back. It is what a reset button and a
// reload use, and a setter that reported itself as a change would write the value
// it was just given straight back to storage, or loop through an addon that saves
// on every change.
//
// The second is the label's `for`. The document is one id space shared with the
// game and every other addon, so two checkboxes built by the same addon with the
// same label must not both answer to the first one's text.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCheckbox,
  createSelect,
  createSlider,
  createText,
} from '../loader/src/runtime/ui/kit/field.ts';
import type { MenuItem } from '../loader/src/runtime/ui/kit/menu.ts';
import { createTabs } from '../loader/src/runtime/ui/kit/tabs.ts';

describe('a checkbox', () => {
  it('reports a change and reads back what it was set to', () => {
    const onChange = vi.fn();
    const field = createCheckbox(document, { label: 'Show pet', value: false, onChange });
    const input = field.el.querySelector<HTMLInputElement>('input');

    if (input !== null) {
      input.checked = true;
      input.dispatchEvent(new Event('change'));
    }

    expect(onChange).toHaveBeenCalledWith(true);
    expect(field.value()).toBe(true);
  });

  it('moves without calling back when set', () => {
    const onChange = vi.fn();
    const field = createCheckbox(document, { label: 'Show pet', value: false, onChange });

    field.set(true);

    expect(field.value()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  // Beside the box rather than above it: a checkbox reads as a sentence with a
  // box in front of it, and a label above one reads as a heading for what follows.
  it('puts its label inline, unlike every other field', () => {
    const field = createCheckbox(document, { label: 'Show pet', value: true, onChange: vi.fn() });

    expect(field.el.classList.contains('woc-field-inline')).toBe(true);
  });

  it('draws a disabled field unusable rather than absent', () => {
    const field = createCheckbox(document, {
      label: 'Show pet',
      value: true,
      onChange: vi.fn(),
      disabled: true,
    });

    expect(field.el.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
  });
});

// A select is a button and the kit's own menu rather than a native control, so what a case
// can reach is the ITEMS it would have opened. `openMenu` is captured rather than run: the
// real one puts a menu in the document, and what is under test here is the field.
describe('a select', () => {
  const opened: MenuItem[][] = [];
  const openMenu = (_at: Element, items: readonly MenuItem[]) => {
    opened.push([...items]);
    return () => undefined;
  };

  beforeEach(() => {
    opened.length = 0;
  });

  it('offers every option and reports the one chosen', () => {
    const onChange = vi.fn();
    const field = createSelect(
      document,
      { label: 'Anchor', value: 'top', options: ['top', 'bottom'], onChange },
      openMenu,
    );

    field.el.querySelector('button')?.click();
    expect(opened[0]?.map((item) => item.label)).toEqual(['top', 'bottom']);

    opened[0]?.[1]?.onSelect();

    expect(onChange).toHaveBeenCalledWith('bottom');
    expect(field.value()).toBe('bottom');
  });

  it('marks the chosen option in the menu it opens, and only that one', () => {
    const field = createSelect(
      document,
      { label: 'Anchor', value: 'bottom', options: ['top', 'bottom'], onChange: vi.fn() },
      openMenu,
    );

    field.el.querySelector('button')?.click();

    expect(opened[0]?.map((item) => item.checked)).toEqual([false, true]);
  });

  it('opens on the value it was given rather than on the first option', () => {
    const field = createSelect(
      document,
      { label: 'Anchor', value: 'bottom', options: ['top', 'bottom'], onChange: vi.fn() },
      openMenu,
    );

    expect(field.value()).toBe('bottom');
    expect(field.el.textContent).toContain('bottom');
  });
});

describe('a slider', () => {
  it('reports as it moves', () => {
    const onChange = vi.fn();
    const field = createSlider(document, {
      label: 'Window',
      value: 5,
      min: 1,
      max: 60,
      onChange,
    });
    const input = field.el.querySelector<HTMLInputElement>('input');

    if (input !== null) {
      input.value = '30';
      input.dispatchEvent(new Event('input'));
    }

    expect(onChange).toHaveBeenCalledWith(30);
  });

  // A range input says nothing about where it is. Without the number the player
  // learns the value by dragging and watching what happens.
  it('shows its number, and moves it with the control', () => {
    const field = createSlider(document, {
      label: 'Window',
      value: 5,
      min: 1,
      max: 60,
      onChange: vi.fn(),
    });

    expect(field.el.querySelector('.woc-field-value')?.textContent).toBe('5');

    field.set(30);

    expect(field.el.querySelector('.woc-field-value')?.textContent).toBe('30');
  });

  it('defaults its step rather than leaving the browser to guess', () => {
    const field = createSlider(document, {
      label: 'Window',
      value: 5,
      min: 1,
      max: 60,
      onChange: vi.fn(),
    });

    expect(field.el.querySelector<HTMLInputElement>('input')?.step).toBe('1');
  });
});

describe('a text field', () => {
  // As you type rather than on blur: a value typed and then abandoned by closing
  // the window is otherwise silently lost, which is the manager's own behaviour.
  it('reports as it is typed', () => {
    const onChange = vi.fn();
    const field = createText(document, { label: 'Title', value: '', onChange });
    const input = field.el.querySelector<HTMLInputElement>('input');

    if (input !== null) {
      input.value = 'DPS';
      input.dispatchEvent(new Event('input'));
    }

    expect(onChange).toHaveBeenCalledWith('DPS');
  });

  it('carries a placeholder when given one', () => {
    const field = createText(document, {
      label: 'Title',
      value: '',
      placeholder: 'DPS',
      onChange: vi.fn(),
    });

    expect(field.el.querySelector<HTMLInputElement>('input')?.placeholder).toBe('DPS');
  });
});

// The document is one id space shared with the game and with every other addon.
// A label pointing at someone else's input is a control that toggles the wrong
// thing when its own text is clicked.
describe('every field', () => {
  it('gives its label a control of its own to point at', () => {
    const first = createCheckbox(document, { label: 'Show pet', value: true, onChange: vi.fn() });
    const second = createCheckbox(document, { label: 'Show pet', value: true, onChange: vi.fn() });

    const forFirst = first.el.getAttribute('for');
    const forSecond = second.el.getAttribute('for');

    expect(forFirst).not.toBe(forSecond);
    expect(first.el.querySelector('input')?.id).toBe(forFirst);
  });

  it('removes itself on destroy', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const field = createText(document, { label: 'Title', value: '', onChange: vi.fn() });
    host.appendChild(field.el);

    field.destroy();

    expect(host.querySelector('.woc-field')).toBeNull();
  });
});

describe('a tab strip', () => {
  const Tabs = [
    { id: 'damage', label: 'Damage' },
    { id: 'healing', label: 'Healing' },
  ];

  it('opens on the first tab and marks it', () => {
    const strip = createTabs(document, { tabs: Tabs, onSelect: vi.fn() });

    expect(strip.active()).toBe('damage');
    expect(strip.el.querySelector('.woc-tab-active')?.textContent).toBe('Damage');
  });

  it('opens on the one it was told to', () => {
    const strip = createTabs(document, { tabs: Tabs, active: 'healing', onSelect: vi.fn() });

    expect(strip.active()).toBe('healing');
  });

  // An id nobody declared would otherwise leave the strip with no tab marked at
  // all, which reads as a broken pane rather than as a bad argument.
  it('falls back to the first tab for an id that is not in the strip', () => {
    const strip = createTabs(document, { tabs: Tabs, active: 'threat', onSelect: vi.fn() });

    expect(strip.active()).toBe('damage');
  });

  it('reports a click and moves the mark', () => {
    const onSelect = vi.fn();
    const strip = createTabs(document, { tabs: Tabs, onSelect });

    strip.el.querySelectorAll<HTMLButtonElement>('.woc-tab')[1]?.click();

    expect(onSelect).toHaveBeenCalledWith('healing');
    expect(strip.active()).toBe('healing');
  });

  it('says nothing when the tab already open is clicked again', () => {
    const onSelect = vi.fn();
    const strip = createTabs(document, { tabs: Tabs, onSelect });

    strip.el.querySelectorAll<HTMLButtonElement>('.woc-tab')[0]?.click();

    expect(onSelect).not.toHaveBeenCalled();
  });

  // Marked with aria-current rather than the tab role, which promises arrow-key
  // navigation this does not implement and cannot: the panes are the addon's, so
  // there is nothing to point aria-controls at. It is also what the manager's own
  // strip does, and the two are styled by the same rules.
  it('marks the open tab for assistive technology, as a nav rather than a tablist', () => {
    const strip = createTabs(document, { tabs: Tabs, onSelect: vi.fn() });

    strip.select('healing');

    expect(strip.el.getAttribute('role')).toBeNull();
    expect(strip.el.querySelector('[role="tab"]')).toBeNull();
    const marks = [...strip.el.querySelectorAll('.woc-tab')].map((tab) =>
      tab.getAttribute('aria-current'),
    );
    expect(marks).toEqual(['false', 'true']);
  });

  it('moves without calling back when selected in code', () => {
    const onSelect = vi.fn();
    const strip = createTabs(document, { tabs: Tabs, onSelect });

    strip.select('healing');

    expect(strip.active()).toBe('healing');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
