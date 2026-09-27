// The shape of a labelled control, in one place, for two renderers.
//
// A field is a CONTAINER carrying `row`, holding a `label` element with the `label` class
// and a `for` naming its control, then the control itself with `control` on it. The
// control's id is unique in the document, an id space shared with the game and every addon.
//
// A checkbox uses `rowInline` instead: the container IS the label, the box comes first, and
// the text follows in a span. It still carries `for`.

/**
 * The classes a field is assembled from, declared in ui/styles/panes.css and written by both
 * renderers.
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
