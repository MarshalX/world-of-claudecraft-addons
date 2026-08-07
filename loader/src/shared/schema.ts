// The manifest and marketplace-index schemas, and the types inferred from them.
//
// Shared by the host at install time and by tools/validate.mjs and
// tools/index.mjs in CI.
//
// The runtime must import only TYPES from here. A value import would pull zod
// into the page-realm bundle; loader/build-runtime.mjs fails the build if it
// does.

import { z } from 'zod';
import { isValidRange } from './gameversion.ts';
import { CHANNELS } from './hosts.ts';
import { PERMISSIONS } from './permissions.ts';

/** Addon ids form the storage namespace and cannot change once published. */
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** Relative path inside the addon directory: no traversal, no absolute, no scheme. */
const ENTRY_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * A path the loader will join onto a marketplace's base URL.
 *
 * One definition for both places a manifest names a file, because both are the
 * same risk: whatever this accepts is appended to a raw.githubusercontent.com
 * base, so a value that escapes the addon directory is a value that fetches
 * somebody else's.
 */
const RelativeFile = z
  .string()
  .regex(ENTRY_RE, 'must be a relative path inside the addon directory')
  .refine((p) => !p.includes('..'), 'must not traverse outside the addon directory');

const AddonId = z.string().regex(ID_RE, 'must be lower-case kebab-case, e.g. "combat-meter"');

/** Browse renders one filter control per distinct tag across every source. */
const MAX_TAGS = 6;

/** How many sibling data files one addon may declare. */
const MAX_DATA_FILES = 8;

/**
 * One JSON file in the addon's own directory, readable through `woc.data`.
 *
 * The same relative path `entry` and `preview` are, narrowed to `.json`: the
 * surface hands back a PARSED value, so there is nothing else the loader would
 * parse it as, and a declared `.txt` would be a file `woc.data` could only fail
 * on. Written as a refinement rather than a second `.regex`, because
 * `RelativeFile` already carries one and a refinement composes onto anything.
 */
const DataFile = RelativeFile.refine(
  (p) => p.toLowerCase().endsWith('.json'),
  'must be a .json file, because woc.data parses what it reads',
);

/** How many other addons one may be recommended alongside. See `companions`. */
const MAX_COMPANIONS = 4;

/**
 * How long one companion's reason may be. See `companionReasons`.
 *
 * A sentence rather than a paragraph, because the manager draws it as one hover
 * line on a row: a reason that wrapped four times would be a second description
 * competing with the first, which is the thing this field exists to stop.
 */
const MAX_COMPANION_REASON = 140;

/**
 * The screenshot the manager and the site both show.
 *
 * A structure rather than a bare path because a picture with no alt text is a
 * picture nobody using a screen reader can act on, and the one place that text
 * can be written where both consumers see it is the manifest. It is also the
 * reason this replaced an `icon` field that had been declared since the first
 * release and read by nothing: a field with no consumer collects no alt text and
 * teaches nobody it is missing.
 */
export const PreviewDecl = z.object({
  /** Relative to the addon's own directory, e.g. `preview.png`. */
  file: RelativeFile,
  /** What the screenshot shows, for anyone who cannot see it. */
  alt: z.string().min(1),
});

export const KeybindDecl = z.object({
  id: AddonId,
  label: z.string().min(1),
  /** Canonical combo, e.g. 'Alt+KeyD'. See shared/combo.ts. */
  default: z.string().min(1),
});

export const SettingDecl = z.discriminatedUnion('type', [
  z.object({
    id: AddonId,
    type: z.literal('boolean'),
    label: z.string().min(1),
    default: z.boolean(),
  }),
  z
    .object({
      id: AddonId,
      type: z.literal('number'),
      label: z.string().min(1),
      default: z.number(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .refine((s) => s.min === undefined || s.max === undefined || s.min <= s.max, {
      message: 'min must not exceed max',
      path: ['min'],
    })
    // values.ts clamps a STORED number, so this is the only other route by which
    // one reaches an addon outside its declared range. Refused rather than
    // clamped: `{ default: 100, max: 40 }` is a manifest to fix, and CI catches
    // it before anything is published.
    .refine(
      (s) =>
        (s.min === undefined || s.default >= s.min) && (s.max === undefined || s.default <= s.max),
      { message: 'default must be within min and max', path: ['default'] },
    ),
  z.object({
    id: AddonId,
    type: z.literal('string'),
    label: z.string().min(1),
    default: z.string(),
  }),
  z
    .object({
      id: AddonId,
      type: z.literal('select'),
      label: z.string().min(1),
      default: z.string(),
      options: z.array(z.string()).min(1),
    })
    .refine((s) => s.options.includes(s.default), {
      message: 'default must be one of options',
      path: ['default'],
    }),
]);

export const AddonManifest = z
  .object({
    id: AddonId,
    name: z.string().min(1),
    version: z.string().regex(SEMVER_RE, 'must be semver, e.g. "1.2.0"'),
    apiVersion: z.number().int(),
    /**
     * The smallest API minor carrying every member this addon uses.
     *
     * Optional, and absent reads as 0, which is what an addon published before the
     * minor existed was written against. That default is the point: the loader
     * accepts other people's marketplaces, so an addon already in the wild
     * declaring only `apiVersion` keeps working rather than being refused by a
     * field its author never saw.
     */
    apiMinor: z.number().int().min(0).optional(),
    author: z.string().min(1),
    description: z.string().min(1),
    entry: RelativeFile,
    /** A screenshot in the addon's own directory. Absent is ordinary, not a defect. */
    preview: PreviewDecl.optional(),
    /**
     * JSON files in this addon's own directory, fetched by the host at install and
     * read back through `woc.data(name)`.
     *
     * Declared rather than discovered, for the reason `entry` is declared: what the
     * loader will fetch out of a marketplace has to be a fixed list the manifest
     * states, never a path an addon composes at run time. It is also what makes the
     * surface refusable, since `woc.data` checks its argument against this list
     * instead of joining it onto a URL.
     */
    data: z
      .array(DataFile)
      .max(MAX_DATA_FILES)
      .refine((files) => new Set(files).size === files.length, 'duplicate data file')
      .optional(),
    /**
     * Other addons this one works better with. A NOTE, never a dependency.
     *
     * Bare addon ids rather than fqids: the same addon installed from a fork is a
     * different fqid and is still the companion the author meant. It gates nothing,
     * installs nothing, and stops nothing from starting. See the manager's
     * `companions.ts` for how one is resolved.
     */
    companions: z.array(AddonId).max(MAX_COMPANIONS).optional(),
    /**
     * What each named companion ADDS, one short sentence per id.
     *
     * The half of the field a description used to have to carry. `companions`
     * answers which addon and the manager answers whether it is here; neither says
     * why a player should care, so the sentence went into descriptions instead,
     * where it is read before the player knows the companion exists and cannot say
     * anything about state.
     *
     * A SECOND KEY rather than a richer shape for `companions`, and the reason is
     * not taste. A marketplace index is one `z.array(MarketplaceEntry)` parse, so
     * one entry an older loader cannot read fails the whole index and takes that
     * source dark for every player still on that loader. An unrecognised key is
     * dropped, which is the compatibility this whole schema already relies on.
     *
     * Keyed by an id the same manifest names, enforced below rather than trusted:
     * two keys describing one relationship is exactly the shape that drifts, and a
     * reason for an addon nobody named is the drift.
     */
    companionReasons: z.record(AddonId, z.string().min(1).max(MAX_COMPANION_REASON)).optional(),
    homepage: z.string().url().optional(),
    /**
     * Browse's filter categories. Same shape as an addon id, so the filter can
     * compare them without normalizing and two authors cannot publish 'Combat'
     * and 'combat' as different tags. Bounded because the filter renders one
     * control per distinct tag across every source in the list.
     */
    tags: z.array(AddonId).max(MAX_TAGS).optional(),
    gameVersion: z
      .string()
      .refine(isValidRange, 'must be a semver range, e.g. ">=0.31.0" or "^0.31.0"')
      .optional(),
    channels: z.array(z.enum(CHANNELS)).min(1).optional(),
    permissions: z.array(z.enum(PERMISSIONS)).optional(),
    keybinds: z
      .array(KeybindDecl)
      .refine((k) => new Set(k.map((x) => x.id)).size === k.length, 'duplicate keybind id')
      .optional(),
    settings: z
      .array(SettingDecl)
      .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'duplicate setting id')
      .optional(),
  })
  .refine(
    (m) => Object.keys(m.companionReasons ?? {}).every((id) => (m.companions ?? []).includes(id)),
    'every companionReasons key must be an addon named in companions',
  );

/** One row of marketplace.json: a manifest plus the addon's directory in the repo. */
export const MarketplaceEntry = AddonManifest.extend({
  path: z.string().regex(ENTRY_RE, 'must be a relative directory path'),
});

export const MarketplaceIndex = z.object({
  schema: z.literal(1),
  name: z.string().min(1),
  maintainer: z.string().min(1).optional(),
  generated: z.string().min(1),
  addons: z.array(MarketplaceEntry),
});

/**
 * One installed addon, as the registry persists it.
 *
 * Validated on read as well as on write. The record lives in GM storage, which
 * the player can edit and which an older loader may have written in a different
 * shape, so what comes back out is untrusted input like anything else.
 */
export const InstalledAddon = z.object({
  fqid: z.string().min(1),
  marketplace: z.string().min(1),
  manifest: AddonManifest,
  enabled: z.boolean(),
  /** Pinned version, or null to track the marketplace index. */
  pin: z.string().regex(SEMVER_RE, 'must be semver, e.g. "1.2.0"').nullable(),
});

export type KeybindDecl = z.infer<typeof KeybindDecl>;
export type PreviewDecl = z.infer<typeof PreviewDecl>;
export type SettingDecl = z.infer<typeof SettingDecl>;
export type AddonManifest = z.infer<typeof AddonManifest>;
export type MarketplaceEntry = z.infer<typeof MarketplaceEntry>;
export type MarketplaceIndex = z.infer<typeof MarketplaceIndex>;
export type InstalledAddon = z.infer<typeof InstalledAddon>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/**
 * Validate against a schema, flattening zod issues into the `{ path, message }`
 * shape the manager and CI both render. Reports every issue, not just the first.
 */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}

export const validateManifest = (input: unknown): ValidationResult<AddonManifest> =>
  validate(AddonManifest, input);

export const validateIndex = (input: unknown): ValidationResult<MarketplaceIndex> =>
  validate(MarketplaceIndex, input);
