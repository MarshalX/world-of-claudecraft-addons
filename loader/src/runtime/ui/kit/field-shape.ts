// The shape of a labelled control, in one place, for two renderers.
//
// THE SHAPE, stated once:
//
//   A field is a CONTAINER carrying `row`, holding a `label` element with the
//   `label` class and a `for` naming its control, then the control itself with
//   `control` on it. The control's id is unique in the document, which is one id
//   space shared with the game and with every other addon.
//
//   The one exception is a checkbox, which uses `rowInline`: the container IS the
//   label, the box comes first, and the text follows in a span. A checkbox reads
//   as a sentence with a box in front of it, and a label above one reads as a
//   heading for whatever comes next. It still carries `for`, so clicking the text
//   reaches the box rather than relying on the wrap.
//
// The class names are here as well because they are the other half of the same
// agreement: `ui/styles/panes.css` declares them once and both renderers write
// them, so a rename that missed one would style half the fields in the loader.

/**
 * The classes a field is assembled from. Declared in ui/styles/panes.css.
 *
 * Scoped to the FIELD family on purpose. A `.woc-btn` is one element with one
 * class and nothing to get wrong, so pulling every class name in the loader
 * through a constant would be ceremony rather than a guard; what earned this is
 * a family with two structures, two renderers, and a demonstrated drift.
 */
const FIELD_CLASS = Object.freeze({
  /** The container: a label above its control. */
  row: 'woc-field',
  /** The container for a checkbox, which IS the label. */
  rowInline: 'woc-field woc-field-inline',
  /** The label element. Carries `for`, always. */
  label: 'woc-field-label',
  /** A live figure inside the label, e.g. a slider's number. */
  value: 'woc-field-value',
  /** Every text, number, select and search control. */
  control: 'woc-input',
  /** A column of fields. */
  form: 'woc-form',
});

export { FIELD_CLASS };
