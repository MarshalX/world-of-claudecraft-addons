// Small helpers the manager's panes share.
//
// Separated from the .tsx files because a module that renders components exports
// only components: mixing a plain helper in makes the module something a fast
// refresh boundary cannot reason about, which `useComponentExportOnlyModules`
// is what enforces.

/** How many log lines an addon's page shows. The buffer holds more. */
const TAIL_LINES = 25;

/** Characters that cannot appear in a DOM id fragment. */
const UNSAFE_ID_CHARS = /[^a-zA-Z0-9-]/g;

/**
 * A DOM id for one setting's control.
 *
 * The setting id is unique only within its addon, and the document is one id
 * space, so the fqid goes in the id and the label's `for` can point at it.
 */
function fieldId(fqid: string, id: string): string {
  return `woc-setting-${fqid.replace(UNSAFE_ID_CHARS, '-')}-${id}`;
}

export { fieldId, TAIL_LINES };
