// The controls an addon's own settings pane is made of.
//
// The CSS for all of these already existed: `.woc-field`, `.woc-input`,
// `.woc-toggle` and `.woc-btn` are what the manager's own forms are drawn with,
// and they already answer to a frame's density. What was missing was any way for
// an addon to REACH them, so an addon writing a settings pane hand-rolled inline
// styles and ended up with a form that looked foreign inside a loader frame.
//
// Grouped under `ui.field` rather than four more members on `ui`, the same way
// `ui.icon` groups its URL builders: this is one family answering one question,
// and spreading it across the top level would bury `frame`, `bar` and `tile`
// among leaves. A tab strip is NOT in the family and is `ui.tabs`, because tabs
// are navigation rather than a value the player is setting.
//
// Every builder returns the same three things: the element to place, the value to
// read, and a setter, so a pane that saves to `woc.storage` reads them all the
// same way. The change callback is the only thing an addon has to wire.
//
// WHAT a field is made of is in kit/field-shape.ts, shared with the manager's own
// preact forms. This file is one of that shape's two renderers.

import type { Teardown } from '../../disposal.ts';
import { FIELD_CLASS } from './field-shape.ts';
import { createPicker, type OpenMenu } from './picker.ts';

/** What every field hands back. `T` is what that control's value is. */
interface Field<T> {
  /** The labelled row. Append it wherever it goes; the kit does not place it. */
  readonly el: HTMLElement;
  value: () => T;
  /** Move it without calling back, which is what a reset or a reload does. */
  set: (next: T) => void;
  destroy: Teardown;
}

interface FieldOpts<T> {
  label: string;
  value: T;
  onChange: (next: T) => void;
  /** Drawn dimmed and unusable. */
  disabled?: boolean;
}

interface SelectOpts extends FieldOpts<string> {
  options: readonly string[];
}

interface SliderOpts extends FieldOpts<number> {
  min: number;
  max: number;
  /** Defaults to 1. */
  step?: number;
}

interface TextOpts extends FieldOpts<string> {
  placeholder?: string;
}

/** A label above its control, which is the shape every field but the check uses. */
function buildRow(doc: Document, label: string, control: HTMLElement, id: string): HTMLElement {
  const row = doc.createElement('div');
  row.className = FIELD_CLASS.row;
  const text = doc.createElement('label');
  text.className = FIELD_CLASS.label;
  text.htmlFor = id;
  text.textContent = label;
  row.append(text, control);
  return row;
}

/**
 * A unique id per control, so a label's `for` points at its own input.
 *
 * The document is one id space shared with the game and with every other addon,
 * and a label pointing at someone else's checkbox is a control that toggles the
 * wrong thing when its text is clicked. A counter rather than the addon's fqid
 * because a single addon can build two of the same field.
 */
let built = 0;
function nextId(): string {
  built += 1;
  return `woc-field-${String(built)}`;
}

function destroyer(el: HTMLElement): Teardown {
  return () => {
    el.remove();
  };
}

/**
 * A checkbox, drawn as the manager draws its own: the box before its label.
 *
 * The one field whose label is beside the control rather than above it, because a
 * checkbox reads as a sentence with a box in front of it and a label above one
 * reads as a heading for something else.
 */
function createCheckbox(doc: Document, opts: FieldOpts<boolean>): Field<boolean> {
  const id = nextId();
  const row = doc.createElement('label');
  row.className = FIELD_CLASS.rowInline;
  row.htmlFor = id;

  const input = doc.createElement('input');
  input.id = id;
  input.type = 'checkbox';
  input.checked = opts.value;
  input.disabled = opts.disabled === true;

  const text = doc.createElement('span');
  text.className = FIELD_CLASS.label;
  text.textContent = opts.label;

  row.append(input, text);
  input.addEventListener('change', () => {
    opts.onChange(input.checked);
  });

  return {
    el: row,
    value: () => input.checked,
    set: (next) => {
      input.checked = next;
    },
    destroy: destroyer(row),
  };
}

/**
 * A dropdown, drawn by the loader rather than by the operating system.
 *
 * It was a native `<select>` until its popup was looked at: the list is drawn by the OS, in
 * the OS font, outside the document and beyond styling, which puts a white system menu in the
 * middle of a dark fantasy HUD. The game replaced its own selects for the same reason. See
 * kit/picker.ts, which is the button and the kit's own menu.
 */
function createSelect(doc: Document, opts: SelectOpts, openMenu: OpenMenu): Field<string> {
  const id = nextId();
  const picker = createPicker(
    doc,
    {
      options: opts.options,
      value: opts.value,
      onChange: opts.onChange,
      disabled: opts.disabled === true,
    },
    openMenu,
  );
  picker.el.id = id;

  const row = buildRow(doc, opts.label, picker.el, id);
  return {
    el: row,
    value: picker.value,
    set: picker.set,
    destroy: destroyer(row),
  };
}

/**
 * A slider with its value beside the label, which is not decoration.
 *
 * A range input says nothing about where it is. The game's own sliders show the
 * number, and one that does not turns "how long is this window" into a guess the
 * player makes by dragging and watching what happens.
 */
function createSlider(doc: Document, opts: SliderOpts): Field<number> {
  const id = nextId();
  const input = doc.createElement('input');
  input.id = id;
  input.type = 'range';
  input.className = 'woc-slider';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step ?? 1);
  input.value = String(opts.value);
  input.disabled = opts.disabled === true;

  const row = buildRow(doc, opts.label, input, id);
  const readout = doc.createElement('span');
  readout.className = FIELD_CLASS.value;
  readout.textContent = String(opts.value);
  row.querySelector(`.${FIELD_CLASS.label}`)?.appendChild(readout);

  const read = (): number => input.valueAsNumber;
  input.addEventListener('input', () => {
    readout.textContent = String(read());
    opts.onChange(read());
  });

  return {
    el: row,
    value: read,
    set: (next) => {
      input.value = String(next);
      readout.textContent = String(next);
    },
    destroy: destroyer(row),
  };
}

function createText(doc: Document, opts: TextOpts): Field<string> {
  const id = nextId();
  const input = doc.createElement('input');
  input.id = id;
  input.type = 'text';
  input.className = FIELD_CLASS.control;
  input.value = opts.value;
  input.disabled = opts.disabled === true;
  if (opts.placeholder !== undefined) {
    input.placeholder = opts.placeholder;
  }
  // `input` rather than `change`: a pane that saves as you type is the behaviour
  // the manager's own settings form has, and waiting for a blur means a value
  // typed and then abandoned by closing the window is silently lost.
  input.addEventListener('input', () => {
    opts.onChange(input.value);
  });

  const row = buildRow(doc, opts.label, input, id);
  return {
    el: row,
    value: () => input.value,
    set: (next) => {
      input.value = next;
    },
    destroy: destroyer(row),
  };
}

export type { Field, FieldOpts, SelectOpts, SliderOpts, TextOpts };
export { createCheckbox, createSelect, createSlider, createText };
