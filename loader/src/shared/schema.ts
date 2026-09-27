// The manifest and marketplace-index schemas, used by the host at install and by the tools in CI.
// The runtime may import only TYPES from here, or zod reaches the page bundle and the build fails.

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
 * A path the loader joins onto a marketplace's base URL, so one that escapes the addon directory
 * fetches somebody else's file. Every file a manifest names goes through this.
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

/** One JSON file in the addon's own directory, `.json` only because `woc.data` parses it. */
const DataFile = RelativeFile.refine(
  (p) => p.toLowerCase().endsWith('.json'),
  'must be a .json file, because woc.data parses what it reads',
);

/** How many other addons one may be recommended alongside. See `companions`. */
const MAX_COMPANIONS = 4;

/** How long one companion's reason may be: one sentence, drawn as a single hover line. */
const MAX_COMPANION_REASON = 140;

/** The screenshot the manager and the site both show, with the alt text both of them need. */
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
    // values.ts clamps a STORED number; an out-of-range default is refused so CI catches the
    // manifest rather than the loader silently clamping it.
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
     * The smallest API minor carrying every member this addon uses. Absent reads as 0, so a
     * third-party addon declaring only `apiVersion` is not refused.
     */
    apiMinor: z.number().int().min(0).optional(),
    author: z.string().min(1),
    description: z.string().min(1),
    entry: RelativeFile,
    /** A screenshot in the addon's own directory. Absent is ordinary, not a defect. */
    preview: PreviewDecl.optional(),
    /**
     * JSON files in this addon's own directory, fetched at install and read through
     * `woc.data(name)`. Declared so the loader fetches a fixed list, and `woc.data` refuses any
     * name not on it.
     */
    data: z
      .array(DataFile)
      .max(MAX_DATA_FILES)
      .refine((files) => new Set(files).size === files.length, 'duplicate data file')
      .optional(),
    /**
     * Other addons this one works better with. A note that gates nothing. Bare ids, not fqids, so
     * the same addon installed from a fork still matches.
     */
    companions: z.array(AddonId).max(MAX_COMPANIONS).optional(),
    /**
     * What each named companion ADDS, one short sentence per id.
     *
     * Must stay a separate key: an index is one array parse, so reshaping `companions` would fail
     * the whole index on an older loader, while an unknown key is dropped. Every key must name a
     * companion, enforced below.
     */
    companionReasons: z.record(AddonId, z.string().min(1).max(MAX_COMPANION_REASON)).optional(),
    homepage: z.string().url().optional(),
    /**
     * Browse's filter categories, shaped like an addon id so 'Combat' and 'combat' cannot both
     * exist. Bounded because the filter draws one control per distinct tag.
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
 * One installed addon, as the registry persists it. Validated on read too: GM storage is editable
 * and may hold an older loader's shape.
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
