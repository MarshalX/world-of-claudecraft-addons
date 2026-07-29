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

const AddonId = z.string().regex(ID_RE, 'must be lower-case kebab-case, e.g. "dps-meter"');

/** Browse renders one filter control per distinct tag across every source. */
const MAX_TAGS = 6;

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
    }),
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

export const AddonManifest = z.object({
  id: AddonId,
  name: z.string().min(1),
  version: z.string().regex(SEMVER_RE, 'must be semver, e.g. "1.2.0"'),
  apiVersion: z.number().int(),
  author: z.string().min(1),
  description: z.string().min(1),
  entry: z
    .string()
    .regex(ENTRY_RE, 'must be a relative path inside the addon directory')
    .refine((p) => !p.includes('..'), 'must not traverse outside the addon directory'),
  icon: z.string().min(1).optional(),
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
});

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
