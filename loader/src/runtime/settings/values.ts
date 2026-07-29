// Turning a manifest's settings schema plus whatever is in storage into the
// object an addon reads synchronously as `woc.settings`.
//
// Pure, and deliberately total: every declared setting gets a value of the
// declared type no matter what came back from storage. Addon code reads
// `woc.settings.window` on its first line and does arithmetic with it, so a
// stored null, a string where a number belongs, or a select whose option was
// removed in an update all have to resolve to something usable rather than
// reaching the addon. Storage is the player's to edit and an older version of
// the addon may have written a different shape, so what comes out is untrusted
// input like anything else.

import type { SettingDecl } from '../../shared/schema.ts';

/** What a declared setting can hold. The schema has no other types. */
type SettingValue = boolean | number | string;

type SettingValues = Readonly<Record<string, SettingValue>>;

function clampNumber(value: number, decl: Extract<SettingDecl, { type: 'number' }>): number {
  let out = value;
  if (decl.min !== undefined) {
    out = Math.max(decl.min, out);
  }
  if (decl.max !== undefined) {
    out = Math.min(decl.max, out);
  }
  return out;
}

function coerceBoolean(stored: unknown): boolean | null {
  if (typeof stored !== 'boolean') {
    return null;
  }
  return stored;
}

function coerceNumber(
  stored: unknown,
  decl: Extract<SettingDecl, { type: 'number' }>,
): number | null {
  // Number.isFinite rather than a typeof check: NaN and Infinity are numbers
  // and both poison any arithmetic the addon does with them.
  if (typeof stored !== 'number' || !Number.isFinite(stored)) {
    return null;
  }
  return clampNumber(stored, decl);
}

/** An option removed in an addon update leaves a stored value nothing to match. */
function coerceSelect(stored: unknown, options: readonly string[]): string | null {
  if (typeof stored !== 'string' || !options.includes(stored)) {
    return null;
  }
  return stored;
}

function coerceString(stored: unknown): string | null {
  if (typeof stored !== 'string') {
    return null;
  }
  return stored;
}

/**
 * Coerce one stored value, or null if it cannot be one.
 *
 * Null means "fall back to the default" rather than "the value is absent", so a
 * caller never has to tell a rejected value from a missing one. A number outside
 * its declared range is clamped rather than rejected: the range moving in an
 * addon update is ordinary, and clamping keeps the player's intent where
 * discarding it would silently reset their choice.
 */
function coerceSetting(decl: SettingDecl, stored: unknown): SettingValue | null {
  if (decl.type === 'boolean') {
    return coerceBoolean(stored);
  }
  if (decl.type === 'number') {
    return coerceNumber(stored, decl);
  }
  if (decl.type === 'select') {
    return coerceSelect(stored, decl.options);
  }
  return coerceString(stored);
}

/** The value a setting takes when storage holds nothing usable for it. */
function defaultValue(decl: SettingDecl): SettingValue {
  return decl.default;
}

/**
 * Build the full values object.
 *
 * Keyed only by declared ids, so a setting an addon dropped in an update stops
 * being read even though its stored value is still there. Leaving the value
 * behind is deliberate: a downgrade, or an update that restores the setting,
 * finds the player's choice intact.
 */
function hydrateSettings(
  decls: readonly SettingDecl[],
  stored: Readonly<Record<string, unknown>>,
): SettingValues {
  const out: Record<string, SettingValue> = {};
  for (const decl of decls) {
    out[decl.id] = coerceSetting(decl, stored[decl.id]) ?? defaultValue(decl);
  }
  return out;
}

/** The defaults alone, for an addon whose storage has never been written. */
function defaultSettings(decls: readonly SettingDecl[]): SettingValues {
  return hydrateSettings(decls, {});
}

function findSetting(decls: readonly SettingDecl[], id: string): SettingDecl | null {
  return decls.find((decl) => decl.id === id) ?? null;
}

export type { SettingValue, SettingValues };
export { coerceSetting, defaultSettings, defaultValue, findSetting, hydrateSettings };
