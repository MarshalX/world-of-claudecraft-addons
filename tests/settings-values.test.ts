// Every declared setting gets a value of its declared type whatever storage held, so a NaN or an
// undefined never reaches addon arithmetic.

import { describe, expect, it } from 'vitest';
import {
  coerceSetting,
  defaultSettings,
  findSetting,
  hydrateSettings,
} from '../loader/src/runtime/settings/values.ts';
import type { SettingDecl } from '../loader/src/shared/schema.ts';

const DECLS: SettingDecl[] = [
  { id: 'show-pet', type: 'boolean', label: 'Include pet damage', default: true },
  { id: 'window', type: 'number', label: 'Rolling window', default: 5, min: 1, max: 60 },
  { id: 'title', type: 'string', label: 'Window title', default: 'DPS' },
  {
    id: 'anchor',
    type: 'select',
    label: 'Anchor',
    default: 'top',
    options: ['top', 'bottom'],
  },
];

describe('hydrateSettings', () => {
  it('answers the declared defaults when storage is empty', () => {
    expect(defaultSettings(DECLS)).toEqual({
      'show-pet': true,
      window: 5,
      title: 'DPS',
      anchor: 'top',
    });
  });

  it('takes stored values of the right type', () => {
    const values = hydrateSettings(DECLS, {
      'show-pet': false,
      window: 12,
      title: 'Damage',
      anchor: 'bottom',
    });

    expect(values).toEqual({
      'show-pet': false,
      window: 12,
      title: 'Damage',
      anchor: 'bottom',
    });
  });

  // One wrong value per type, so one broken coercion cannot hide behind the others.
  it.each([
    ['boolean given a string', { 'show-pet': 'yes' }, 'show-pet', true],
    ['boolean given a number', { 'show-pet': 1 }, 'show-pet', true],
    ['number given a string', { window: '12' }, 'window', 5],
    ['number given NaN', { window: Number.NaN }, 'window', 5],
    ['number given Infinity', { window: Number.POSITIVE_INFINITY }, 'window', 5],
    ['string given a number', { title: 7 }, 'title', 'DPS'],
    ['select given an option it does not have', { anchor: 'left' }, 'anchor', 'top'],
    ['anything given null', { window: null }, 'window', 5],
    ['anything given undefined', { window: undefined }, 'window', 5],
  ])('falls back to the default for a %s', (_case, stored, key, expected) => {
    expect(hydrateSettings(DECLS, stored)[key]).toBe(expected);
  });

  // A narrowed range keeps the player's choice at the new edge instead of resetting it.
  it('clamps a stored number into its declared range', () => {
    expect(hydrateSettings(DECLS, { window: 900 })).toMatchObject({ window: 60 });
    expect(hydrateSettings(DECLS, { window: -4 })).toMatchObject({ window: 1 });
  });

  // The schema refuses this, but an older validator may not have; addons rely on the clamp
  // unconditionally.
  it('clamps a DECLARED default that sits outside its own range', () => {
    const overCeiling: SettingDecl = {
      id: 'window',
      type: 'number',
      label: 'W',
      default: 100,
      max: 40,
    };
    const underFloor: SettingDecl = { id: 'rows', type: 'number', label: 'R', default: 0, min: 1 };

    expect(defaultSettings([overCeiling, underFloor])).toEqual({ window: 40, rows: 1 });
  });

  it('ignores a stored key that is no longer declared', () => {
    const values = hydrateSettings(DECLS, { removed: 'gone', window: 9 });

    expect(values).not.toHaveProperty('removed');
    expect(Object.keys(values).sort()).toEqual(['anchor', 'show-pet', 'title', 'window']);
  });

  it('survives storage holding something that is not a record', () => {
    for (const stored of [{}, Object.create(null) as Record<string, unknown>]) {
      expect(hydrateSettings(DECLS, stored)).toMatchObject({ window: 5 });
    }
  });
});

describe('coerceSetting', () => {
  // Null means "use the default".
  it('answers null for a value the declaration cannot hold', () => {
    expect(coerceSetting(DECLS[0] as SettingDecl, 'true')).toBeNull();
  });

  it('answers the clamped value for an out-of-range number', () => {
    expect(coerceSetting(DECLS[1] as SettingDecl, 1000)).toBe(60);
  });

  it('accepts a boolean false as present', () => {
    expect(coerceSetting(DECLS[0] as SettingDecl, false)).toBe(false);
  });

  it('accepts an empty string and the number zero for their own types', () => {
    expect(coerceSetting(DECLS[2] as SettingDecl, '')).toBe('');
    const noMinimum: SettingDecl = { id: 'n', type: 'number', label: 'N', default: 3 };
    expect(coerceSetting(noMinimum, 0)).toBe(0);
  });
});

describe('findSetting', () => {
  it('finds a declared id and answers null for anything else', () => {
    expect(findSetting(DECLS, 'window')?.type).toBe('number');
    expect(findSetting(DECLS, 'nope')).toBeNull();
  });
});
