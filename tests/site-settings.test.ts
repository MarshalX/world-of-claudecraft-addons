// How a declared setting reads on an addon's page.
//
// Each of these is a small decision that is invisible when it is wrong: a
// boolean default printed as `true` beside a checkbox, an empty string default
// printed as nothing at all, a number with a floor and no ceiling rendering a
// stray separator. The page decides none of them, which is why they are testable
// here rather than only visible in a screenshot.

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
    // The manager draws a checkbox from this declaration, and a checkbox is on or
    // off. `true` is what the file says and is not what the player is shown.
    expect(describeSetting(boolean(true))).toMatchObject({ kind: 'on or off', fallback: 'on' });
    expect(describeSetting(boolean(false)).fallback).toBe('off');
  });

  it('carries no detail when a boolean has nothing to constrain', () => {
    expect(describeSetting(boolean(true)).detail).toBeNull();
  });

  it('reads a number range four ways, one per set of bounds it declares', () => {
    expect(describeSetting(number({ min: 0, max: 20 })).detail).toBe('0 to 20');
    expect(describeSetting(number({ min: 3 })).detail).toBe('at least 3');
    expect(describeSetting(number({ max: 60 })).detail).toBe('at most 60');
    expect(describeSetting(number({})).detail).toBeNull();
  });

  it('treats a zero bound as a bound rather than as an absent one', () => {
    // The trap this pins: `min: 0` is falsy, and a truthiness check here would
    // report an unbounded number for every setting that floors at zero, which is
    // most of them.
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
