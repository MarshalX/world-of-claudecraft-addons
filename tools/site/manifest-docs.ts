// What each manifest field is for, in prose, keyed by the field name.
//
// The obvious home for this is `.describe()` calls inside shared/schema.ts, so
// the schema would be the single source. It is here instead for two reasons: the
// prose is long enough to double that file against a 300-line limit, and schema.ts
// is a validator that the loader, the dev server and CI all import, so filling it
// with documentation would make every one of them carry text only the site reads.
//
// The guarantee that alternative was after is unchanged, because
// tests/site-manifest-docs.test.ts asserts that the keys here and the keys of
// AddonManifest are the SAME SET. A field added to the schema without a line here
// fails `pnpm check`, and so does a line here for a field that no longer exists.
// The drift is caught in the fast suite rather than at a deploy.

/** Fields a manifest cannot omit. Derived from the schema by the test, not here. */
const REQUIRED = new Set(['id', 'name', 'version', 'apiVersion', 'author', 'description', 'entry']);

const FIELDS: Record<string, string> = {
  id: "Lower-case kebab-case, and the same as your directory name. It is your storage namespace and your keybind scope, so it **cannot change once published**: a rename orphans every installed player's settings, keybinds and window position, and shows in Browse as a different addon installing alongside the old one. Get it right before anyone has it.",
  name: 'What Browse shows and what the install confirmation repeats. Unlike the id, this is free to change.',
  version:
    'Semver. A marketplace serves one version per ref, so this is what an update compares against.',
  apiVersion:
    'The addon API major, currently `1`. A loader that cannot honour it marks the addon incompatible and never evaluates it, rather than running it and failing somewhere unhelpful.',
  author: 'Shown on every row and on the install confirmation.',
  description:
    'One line. It is what Browse shows and what the install confirmation repeats, so write it for someone deciding whether to trust you.',
  entry:
    'A relative path inside your directory, usually `main.js`. It must not traverse outside, and the file is evaluated as a function **body**: no exports, no registration call, `woc` already in scope.',
  icon: 'A relative path to an image inside your directory.',
  homepage: 'A URL shown on the addon row.',
  tags: 'Up to six, same shape as an id. They become the filter controls in Browse, which is why they are bounded and why two authors cannot publish `Combat` and `combat` as different tags.',
  gameVersion:
    'A semver range, for example `">=0.31.0"`. Outside it the addon is marked incompatible rather than left to break, which is the difference between a clear message and a mystery.',
  channels:
    'Restrict to some of `live`, `pbe`, `pbe2`. Omit it unless your addon genuinely depends on something only one deployment has.',
  permissions:
    'What you use, out of `net.read`, `world.read`, `ui`, `sound`, `keys`, `storage`. Shown one line each on the install confirmation. **This is a disclosure, not a boundary**: see below.',
  keybinds:
    '`{ id, label, default }` each. You can only bind an id you declared, and the manager renders the editor and the conflict warnings for you.',
  settings:
    '`boolean`, `number` (with optional `min` and `max`), `string`, or `select` (with `options`). The manager renders the form; you read `woc.settings` and hear about changes through `woc.onSettingsChange`.',
};

/** One documented field, ready to render as a table row. */
export interface FieldDoc {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

/** Every manifest field, in schema order, with its prose. */
export function fieldDocs(order: readonly string[]): FieldDoc[] {
  return order.map((name) => {
    const description = FIELDS[name];
    if (!description) {
      throw new Error(`manifest-docs: no prose for field \`${name}\`; add one`);
    }
    return { name, required: REQUIRED.has(name), description };
  });
}

/** The field names this module documents, for the test that binds it to the schema. */
export function documentedFields(): string[] {
  return Object.keys(FIELDS);
}

/** The field names this module marks required, likewise. */
export function requiredFields(): string[] {
  return [...REQUIRED];
}
