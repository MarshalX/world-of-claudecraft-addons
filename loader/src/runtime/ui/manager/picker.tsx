// The manager's dropdown: the same control `ui.field.select` is, drawn by preact.
//
// The manager had two native `<select>` elements, and a native select's popup is drawn by the
// operating system: outside the document, in the system font, beyond styling. Inside a dark
// fantasy HUD that reads as a hole in the window. The kit stopped using one (see
// kit/picker.ts) and this is the other renderer of the same control, in the same shape
// `field-shape.ts` already governs for the other three fields, so an addon's settings pane and
// the manager's own cannot drift apart.
//
// The opener it calls is module state, in picker-menu.ts beside the stores that already live
// that way. It is here rather than threaded through five components that have no other reason
// to know about it, and it is in its OWN module because a file exporting a component may
// export nothing else: `useComponentExportOnlyModules` is what says so, and it is right, since
// a preact refresh reloads a component module and would drop any state kept beside one.

import { CARET_BOX, CARET_PATH } from '../kit/caret-glyph.ts';
import { openPickerMenu } from './picker-menu.ts';

/** How the caret is stroked, matching the markup renderer in kit/caret-glyph.ts. */
const CARET_SIZE = 12;
const CARET_STROKE = 1.6;

/**
 * The caret, as JSX.
 *
 * The second of two renderers over one geometry, exactly as the close mark is: the kit builds
 * its picker as plain DOM and needs markup, and preact would otherwise need
 * `dangerouslySetInnerHTML` for something that does not need it. `aria-hidden` because the
 * button already carries its own name.
 */
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
