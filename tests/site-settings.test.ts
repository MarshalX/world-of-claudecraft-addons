// How a declared setting reads on an addon's site page.

import { describe, expect, it } from 'vitest';
import type { SettingDecl } from '../loader/src/shared/schema.ts';
import { countOf, describeSetting } from '../tools/site/settings.ts';

function boolean(value: boolean): SettingDecl {
  return { id: 'flag', type: 'boolean', label: 'A flag', default: value };
}

function number(bounds: { min?: number; max?: number }): SettingDecl {
  return { id: 'size', type: 'number', label: 'A size', default: 8, ...bounds };
}

describe('a declared setting', () => {
  it('says on or off rather than true or false', () => {
    // The manager draws a checkbox, which is on or off.
    expect(describeSetting(boolean(true))).toMatchObject({ kind: 'on or off', fallback: 'on' });
    expect(describeSetting(boolean(false)).fallback).toBe('off');
  });

  it('carries no detail when a boolean has nothing to constrain', () => {
    expect(describeSetting(boolean(true)).detail).toBeNull();
  });

  it('reads a number range four ways, one per set of bounds', () => {
    expect(describeSetting(number({ min: 0, max: 20 })).detail).toBe('0 to 20');
    expect(describeSetting(number({ min: 3 })).detail).toBe('at least 3');
    expect(describeSetting(number({ max: 60 })).detail).toBe('at most 60');
    expect(describeSetting(number({})).detail).toBeNull();
  });

  it('treats a zero bound as a bound', () => {
    // `min: 0` is falsy, and most settings floor at zero.
    expect(describeSetting(number({ min: 0 })).detail).toBe('at least 0');
    expect(describeSetting(number({ max: 0 })).detail).toBe('at most 0');
  });

  it('lists a select’s options and names the one it starts on', () => {
    const setting: SettingDecl = {
      id: 'layout',
      type: 'select',
      label: 'Layout',
      default: 'bars',
      options: ['bars', 'tiles'],
    };
    expect(describeSetting(setting)).toMatchObject({
      kind: 'one of',
      detail: 'bars, tiles',
      fallback: 'bars',
    });
  });

  it('names an empty text default instead of printing nothing', () => {
    const setting: SettingDecl = { id: 'words', type: 'string', label: 'Words', default: '' };
    expect(describeSetting(setting)).toMatchObject({ kind: 'text', fallback: 'empty' });
  });

  it('keeps a text default that has something in it', () => {
    const setting: SettingDecl = { id: 'words', type: 'string', label: 'Words', default: 'wipe' };
    expect(describeSetting(setting).fallback).toBe('wipe');
  });
});

describe('counting what an addon declares', () => {
  it('agrees with itself about plurals', () => {
    expect(countOf(0, 'setting')).toBe('no settings');
    expect(countOf(1, 'setting')).toBe('1 setting');
    expect(countOf(9, 'setting')).toBe('9 settings');
    expect(countOf(1, 'default binding')).toBe('1 default binding');
  });
});
