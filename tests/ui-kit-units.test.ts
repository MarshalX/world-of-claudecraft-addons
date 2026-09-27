// Dividing a box between units: gaps come out before the division, and the share is floored.

import { describe, expect, it } from 'vitest';
import { units } from '../loader/src/runtime/ui/kit/units.ts';

describe('dividing a box', () => {
  it('gives the whole thing to a single unit', () => {
    expect(units(120)).toBe(120);
  });

  it('splits it between the count', () => {
    expect(units(120, { count: 4 })).toBe(30);
  });

  // Eight rows in 205 with a 3px gap is 23 each, not 25.
  it('pays the gaps out of the box before dividing', () => {
    expect(units(205, { count: 8, gap: 3 })).toBe(23);
  });

  it('counts one fewer gap than units', () => {
    expect(units(100, { count: 2, gap: 10 })).toBe(45);
  });

  // A caption band, footer or header row: space the units never get.
  it('takes a fixed extra off the top', () => {
    expect(units(60, { extra: 15 })).toBe(45);
  });

  // Rounding up pushes the last row past a box that clips.
  it('floors the share instead of rounding it', () => {
    expect(units(100, { count: 3 })).toBe(33);
  });

  it('holds the answer at the floor', () => {
    expect(units(20, { count: 4, min: 12 })).toBe(12);
  });

  it('holds the answer at the ceiling', () => {
    expect(units(400, { count: 2, max: 69 })).toBe(69);
  });

  // As with frame bounds, the floor is the one about staying readable.
  it('lets the floor beat a ceiling under it', () => {
    expect(units(100, { min: 40, max: 10 })).toBe(40);
  });

  // An unmeasured box must not yield a NaN, which a style property drops silently.
  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('answers the floor for a box that is %s', (_label, bad) => {
    expect(units(bad, { count: 4, min: 23 })).toBe(23);
  });

  it('answers the floor instead of dividing by nothing', () => {
    expect(units(100, { count: 0, min: 23 })).toBe(23);
  });

  it('never answers below zero when no floor was given', () => {
    expect(units(10, { count: 4, gap: 8 })).toBe(0);
  });
});
