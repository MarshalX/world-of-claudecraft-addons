// The loader's dropdown, which is a button and the kit's own menu.
//
// Never a native `<select>`: its popup is drawn by the OS, outside the document and beyond
// styling. The game's own `.ui-dd` is the same idiom: a button, a caret and a menu with the
// chosen row in gold.
//
// IT IS THE MENU (`ui.menu`), which owns every way a popup closes. The button wears
// `woc-input`, so it matches a text field beside it.

import type { Teardown } from '../../disposal.ts';
import { caretGlyphMarkup } from './caret-glyph.ts';
import { FIELD_CLASS } from './field-shape.ts';
import type { MenuItem } from './menu.ts';

/** What a picker is told, which is what a `<select>` was told. */
interface PickerOpts {
  /** The choices, in the order they are offered. */
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /**
   * What the control IS, for assistive technology, when no label element names it; its text is the
   * VALUE.
   */
  label?: string;
}

/** How the picker reaches the one menu the loader has. See kit/menu.ts. */
type OpenMenu = (at: Element, items: readonly MenuItem[]) => Teardown;

interface Picker {
  readonly el: HTMLElement;
  value: () => string;
  /** Move it without calling back, which is what a reset or a reload does. */
  set: (next: string) => void;
  destroy: Teardown;
}

/** The button's own two parts: what is chosen, and the mark saying there is a list. */
function buildParts(doc: Document): { value: HTMLElement; caret: HTMLElement } {
  const value = doc.createElement('span');
  value.className = 'woc-picker-value';
  const caret = doc.createElement('span');
  caret.className = 'woc-picker-caret';
  // Loader-authored markup only (kit/caret-glyph.ts).
  caret.innerHTML = caretGlyphMarkup();
  return { value, caret };
}

/** Build a dropdown. `openMenu` is passed in, so this module keeps no state about the one menu. */
function createPicker(doc: Document, opts: PickerOpts, openMenu: OpenMenu): Picker {
  let chosen = opts.value;
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = `${FIELD_CLASS.control} woc-picker`;
  el.disabled = opts.disabled === true;
  el.setAttribute('aria-haspopup', 'menu');
  if (opts.label !== undefined) {
    el.setAttribute('aria-label', opts.label);
  }

  const parts = buildParts(doc);
  parts.value.textContent = chosen;
  el.append(parts.value, parts.caret);

  const items = (): MenuItem[] =>
    opts.options.map((option) => ({
      label: option,
      checked: option === chosen,
      onSelect: () => {
        chosen = option;
        parts.value.textContent = option;
        opts.onChange(option);
      },
    }));

  el.addEventListener('click', () => {
    openMenu(el, items());
  });

  return {
    el,
    value: () => chosen,
    set: (next) => {
      chosen = next;
      parts.value.textContent = next;
    },
    destroy: () => {
      el.remove();
    },
  };
}

export type { OpenMenu, Picker, PickerOpts };
export { createPicker };
