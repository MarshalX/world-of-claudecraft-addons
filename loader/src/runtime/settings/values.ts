// Manifest settings schema plus storage, into the `woc.settings` object. Pure and TOTAL: every
// declared setting gets a value of its declared type whatever storage held, since storage is
// untrusted and an addon does arithmetic with these on its first line.

import type { SettingDecl } from '../../shared/schema.ts';

/** What a declared setting can hold. */
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
  // Number.isFinite, since NaN and Infinity are numbers too.
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
 * One stored value coerced, or null for "use the default". An out-of-range number is clamped, not
 * rejected, so a range moving in an update keeps the player's intent.
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

/** The default is clamped too, for a manifest an older validator let through. */
function defaultValue(decl: SettingDecl): SettingValue {
  if (decl.type === 'number') {
    return clampNumber(decl.default, decl);
  }
  return decl.default;
}

/** Keyed by declared ids only. An undeclared stored value is left in place for a downgrade. */
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
