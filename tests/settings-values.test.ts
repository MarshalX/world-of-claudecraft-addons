// Hydrating settings out of storage.
//
// The claim under test is TOTALITY: every declared setting gets a value of its
// declared type no matter what storage held. Addon code reads `woc.settings.x`
// on its first line and does arithmetic with it, so the failure mode this
// prevents is not an exception, it is a NaN or an undefined travelling into
// addon logic and surfacing somewhere else entirely.

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

  // Each dimension gets its own wrong value, because a single mixed case would
  // pass while three of the four coercions were broken.
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

  // Clamping rather than rejecting: an addon update that narrows a range should
  // keep the player's intent at the new edge, not silently reset their choice.
  it('clamps a stored number into its declared range', () => {
    expect(hydrateSettings(DECLS, { window: 900 })).toMatchObject({ window: 60 });
    expect(hydrateSettings(DECLS, { window: -4 })).toMatchObject({ window: 1 });
  });

  // The belt behind the schema's refine, which is the real fix. A manifest
  // written before that refine existed, or read by a third-party marketplace's
  // older validator, still must not hand an addon a number outside the range the
  // same manifest declared: fifteen addons dropped their own defences on the
  // strength of that promise, so the promise cannot be conditional on validation
  // having happened here.
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
  // Null is the "use the default" signal, so a rejected value and a missing one
  // do not need telling apart by the caller.
  it('answers null for a value the declaration cannot hold', () => {
    expect(coerceSetting(DECLS[0] as SettingDecl, 'true')).toBeNull();
  });

  it('answers the clamped value rather than null for an out-of-range number', () => {
    expect(coerceSetting(DECLS[1] as SettingDecl, 1000)).toBe(60);
  });

  it('accepts a boolean false, which is falsy and must not read as absent', () => {
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
