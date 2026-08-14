// Dividing a box between the units drawn in it.
//
// Pure arithmetic, which is why it is worth having in one place: five addons had written
// it, all five agreed about the shape and each stated the parts differently. What is
// pinned here is the two decisions a caller would otherwise have to rediscover, which are
// that the gaps come out BEFORE the division and that the share is FLOORED.

import { describe, expect, it } from 'vitest';
import { units } from '../loader/src/runtime/ui/kit/units.ts';

describe('dividing a box', () => {
  it('gives the whole thing to a single unit', () => {
    expect(units(120)).toBe(120);
  });

  it('splits it between the count', () => {
    expect(units(120, { count: 4 })).toBe(30);
  });

  // Before, not after. Eight rows in 205 with a 3px gap is 23 each and not 25: the
  // difference is two rows' worth of overflow at the bottom of a frame that clips.
  it('pays the gaps out of the box before dividing', () => {
    expect(units(205, { count: 8, gap: 3 })).toBe(23);
  });

  it('counts one fewer gap than units', () => {
    expect(units(100, { count: 2, gap: 10 })).toBe(45);
  });

  // A caption band under a strip of art, a footer, a header row: space the units never
  // get. `emberwatch` and `purelight` each carry one, and each had to solve the box back
  // for the square by hand.
  it('takes a fixed extra off the top', () => {
    expect(units(60, { extra: 15 })).toBe(45);
  });

  // A share rounded UP is a last row a pixel or two past the bottom of the box, and a
  // bare frame clips rather than scrolls, so what that costs is the bottom row.
  it('floors the share rather than rounding it', () => {
    expect(units(100, { count: 3 })).toBe(33);
  });

  it('holds the answer at the floor', () => {
    expect(units(20, { count: 4, min: 12 })).toBe(12);
  });

  it('holds the answer at the ceiling', () => {
    expect(units(400, { count: 2, max: 69 })).toBe(69);
  });

  // The floor wins, the same way the frame's own bounds resolve a contradiction: only
  // one of the two is about the display staying readable.
  it('lets the floor beat a ceiling under it', () => {
    expect(units(100, { min: 40, max: 10 })).toBe(40);
  });

  // A box that has not been measured yet has to give back a usable number rather than a
  // NaN, which would drop whatever style property it reached silently.
  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('answers the floor for a box that is %s', (_label, bad) => {
    expect(units(bad, { count: 4, min: 23 })).toBe(23);
  });

  it('answers the floor rather than dividing by nothing', () => {
    expect(units(100, { count: 0, min: 23 })).toBe(23);
  });

  it('never answers below zero when no floor was given', () => {
    expect(units(10, { count: 4, gap: 8 })).toBe(0);
  });
});
