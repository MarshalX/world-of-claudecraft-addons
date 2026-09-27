// The manager's dropdown: the same control as `ui.field.select` (kit/picker.ts), drawn by preact.
// Never a native `<select>`: its popup is drawn by the OS, outside every rule the loader has.

import { CARET_BOX, CARET_PATH } from '../kit/caret-glyph.ts';
import { openPickerMenu } from './picker-menu.ts';

/** How the caret is stroked, matching the markup renderer in kit/caret-glyph.ts. */
const CARET_SIZE = 12;
const CARET_STROKE = 1.6;

/** The caret, as JSX: the preact renderer of the geometry in kit/caret-glyph.ts. */
function CaretGlyph() {
  return (
    <svg viewBox={CARET_BOX} width={CARET_SIZE} height={CARET_SIZE} aria-hidden="true">
      <path
        d={CARET_PATH}
        stroke="currentColor"
        strokeWidth={CARET_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** One choice: what it is called, and what choosing it means. */
interface PickerOption {
  value: string;
  label: string;
}

interface PickerProps {
  /** The label element's `for` points here. See kit/field-shape.ts. */
  id: string;
  /** What the control is, for a reader who gets the value and not the question. */
  label: string;
  value: string;
  options: readonly PickerOption[];
  onChange: (next: string) => void;
}

/** What the button reads: the chosen option's label, or the raw value if it is not on offer. */
function labelOf(props: PickerProps): string {
  return props.options.find((option) => option.value === props.value)?.label ?? props.value;
}

function Picker(props: PickerProps) {
  return (
    <button
      type="button"
      id={props.id}
      className="woc-input woc-picker"
      aria-haspopup="menu"
      aria-label={props.label}
      onClick={(event) => {
        openPickerMenu(
          event.currentTarget as HTMLElement,
          props.options.map((option) => ({
            label: option.label,
            checked: option.value === props.value,
            onSelect: () => {
              props.onChange(option.value);
            },
          })),
        );
      }}
    >
      <span className="woc-picker-value">{labelOf(props)}</span>
      <span className="woc-picker-caret">
        <CaretGlyph />
      </span>
    </button>
  );
}

export { Picker };
