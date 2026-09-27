// Small helpers the manager's panes share, kept out of the .tsx files because
// `useComponentExportOnlyModules` lets a component module export only components.

/** How many log lines an addon's page shows. The buffer holds more. */
const TAIL_LINES = 25;

/** Characters that cannot appear in a DOM id fragment. */
const UNSAFE_ID_CHARS = /[^a-zA-Z0-9-]/g;

/** A DOM id for one setting's control, qualified by fqid since a setting id is unique per addon. */
function fieldId(fqid: string, id: string): string {
  return `woc-setting-${fqid.replace(UNSAFE_ID_CHARS, '-')}-${id}`;
}

export { fieldId, TAIL_LINES };
