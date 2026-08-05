// The loader's dropdown, which is a button and the kit's own menu.
//
// It replaces a native `<select>`, and the reason is what one LOOKS like: a select's popup is
// drawn by the operating system, so a player who opens the slot filter in an addon panel gets
// a white system list in the middle of a dark fantasy HUD, in the system font, with a system
// tick beside the chosen row. Nothing about it can be styled; the list is not in the document.
//
// The game reached the same conclusion for itself. `.ui-dd` in its own stylesheet is a button,
// a label, a caret and a menu of rows with the chosen one in gold, and its comment says in as
// many words that it replaces the native control. So this is the game's own idiom rather than
// an invention, and an addon's filter row now looks like the game's loadout picker.
//
// IT IS THE MENU, not a second implementation of one. `ui.menu` already owns the four ways a
// popup has to close (on select, on Escape, on a click anywhere else, and on its anchor being
// taken away), and every one of those is a listener on something the caller does not own. A
// dropdown that hand-rolled them would get three right.
//
// The button wears `woc-input`, the same class the text field and the old select wore, so a
// picker beside a text field is the same height and the same colour with no second rule to
// keep in step.

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
   * What the control IS, for assistive technology.
   *
   * The button's text is the VALUE, so without this it announces "helmet, button" and never
   * says what helmet is an answer to. A field's own label element carries `for`, which covers
   * the labelled case; this is for a picker built on its own.
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
  // Markup the loader authored, never anything a caller supplied. See kit/caret-glyph.ts.
  caret.innerHTML = caretGlyphMarkup();
  return { value, caret };
}

/**
 * Build a dropdown.
 *
 * `openMenu` is passed in rather than imported so the kit keeps one menu service and this
 * module keeps no state: the picker never knows whether its menu is open, because the menu
 * already answers that for the whole loader and a second copy of the answer is a second thing
 * to be wrong.
 */
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
