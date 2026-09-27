// The controls an addon's own settings pane is made of.
//
// Drawn with the same classes as the manager's own forms, so they answer to a frame's
// density. Every builder returns the element, the value and a setter; the change callback is
// the only thing an addon wires. The structure is kit/field-shape.ts, shared with the
// manager's preact renderer.

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
 * A unique id per control, so a label's `for` points at its own input in a document shared
 * with the game and every addon. A counter, since one addon can build two of the same field.
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

/** A checkbox, drawn as the manager draws its own: the box before its label. */
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
 * A dropdown drawn by the loader (kit/picker.ts). Never a native `<select>`: its popup is
 * drawn by the OS, outside the document and beyond styling.
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

/** A slider with its value beside the label, as the game's own sliders show it. */
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
  // `input`, not `change`: waiting for a blur loses a value typed before closing the window.
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
