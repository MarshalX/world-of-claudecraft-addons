// The four formatters. The ceiling cases are the point rather than incidental
// coverage, since rounding up is the whole reason `duration` exists.

import { describe, expect, it } from 'vitest';
import { compass, count, duration, titleCase } from '../loader/src/shared/fmt.ts';

const ARROWS = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
const SECTOR_RADIANS = (Math.PI * 2) / ARROWS.length;

/**
 * The glyph the addons' own counter-clockwise radian table draws at `degrees`
 * clockwise, for the full-turn comparison at the end of the compass block.
 */
function oldArrow(degrees: number): string {
  const relative = (-degrees * Math.PI) / 180;
  const sector = Math.round(relative / SECTOR_RADIANS);
  return ARROWS[((sector % ARROWS.length) + ARROWS.length) % ARROWS.length] as string;
}

describe('duration in the timer style', () => {
  it('is the default', () => {
    expect(duration(45)).toBe(duration(45, 'timer'));
  });

  it('reads bare seconds under a minute and minutes at or above one', () => {
    expect(duration(0, 'timer')).toBe('0');
    expect(duration(1, 'timer')).toBe('1');
    expect(duration(59, 'timer')).toBe('59');
    expect(duration(60, 'timer')).toBe('1m');
    expect(duration(61, 'timer')).toBe('2m');
    expect(duration(3599, 'timer')).toBe('60m');
    expect(duration(3600, 'timer')).toBe('60m');
    expect(duration(86_400, 'timer')).toBe('1440m');
  });

  it('rounds up, so nothing reads 0 while it is still running', () => {
    expect(duration(0.1, 'timer')).toBe('1');
    expect(duration(0.5, 'timer')).toBe('1');
    expect(duration(58.2, 'timer')).toBe('59');
    expect(duration(60.1, 'timer')).toBe('2m');
    expect(duration(119.9, 'timer')).toBe('2m');
  });

  // Looks like an off-by-one and is what a player reads.
  it('says 60 rather than 1m for the half second under a minute', () => {
    expect(duration(59.5, 'timer')).toBe('60');
  });

  it('does not clamp a negative, which the caller owns', () => {
    expect(duration(-5, 'timer')).toBe('-5');
    expect(duration(-0.5, 'timer')).toBe('0');
  });
});

/**
 * Null coerces to 0 through the arithmetic, so without a guard it takes the
 * ordinary path and reads as a real zero or a real dead ahead. Both are
 * reachable from a published field: `world.bearingTo` and `LootRoll.remaining`.
 */
describe('a reading that is not there', () => {
  it('draws nothing rather than a figure, in both duration styles', () => {
    expect(duration(null)).toBe('');
    expect(duration(null, 'timer')).toBe('');
    expect(duration(null, 'coarse')).toBe('');
  });

  it('draws no arrow rather than pointing straight ahead', () => {
    expect(compass(null)).toBe('');
  });

  // One rule rather than two: a caller cannot tell a null it was handed from a
  // NaN its own arithmetic produced, and neither is a reading.
  it('treats a non-finite number the same way, in both members', () => {
    expect(compass(Number.NaN)).toBe('');
    expect(compass(Number.POSITIVE_INFINITY)).toBe('');
    expect(duration(Number.NaN)).toBe('');
    expect(duration(Number.NaN, 'coarse')).toBe('');
    expect(duration(Number.POSITIVE_INFINITY, 'coarse')).toBe('');
  });

  // The case a falsy check would take down with the nulls.
  it('keeps zero, which is a reading and not an absence', () => {
    expect(duration(0)).toBe('0');
    expect(duration(0, 'coarse')).toBe('0s');
    expect(compass(0)).toBe('↑');
  });
});

describe('duration in the coarse style', () => {
  it('reads the two largest units', () => {
    expect(duration(0, 'coarse')).toBe('0s');
    expect(duration(1, 'coarse')).toBe('1s');
    expect(duration(45, 'coarse')).toBe('45s');
    expect(duration(59, 'coarse')).toBe('59s');
    expect(duration(60, 'coarse')).toBe('1m 0s');
    expect(duration(61, 'coarse')).toBe('1m 1s');
    expect(duration(252, 'coarse')).toBe('4m 12s');
    expect(duration(3599, 'coarse')).toBe('59m 59s');
    expect(duration(3600, 'coarse')).toBe('1h 0m');
    expect(duration(3840, 'coarse')).toBe('1h 4m');
    expect(duration(86_400, 'coarse')).toBe('1d 0h');
    expect(duration(183_600, 'coarse')).toBe('2d 3h');
  });

  it('rounds up before it splits, so the seconds place never reads a stale figure', () => {
    expect(duration(0.1, 'coarse')).toBe('1s');
    expect(duration(59.5, 'coarse')).toBe('1m 0s');
    expect(duration(3599.5, 'coarse')).toBe('1h 0m');
  });

  it('does not clamp a negative either', () => {
    expect(duration(-5, 'coarse')).toBe('-5s');
  });

  it('drops to h/m above an hour and to m/s above a minute', () => {
    expect(duration(21_600, 'coarse')).toBe('6h 0m');
    expect(duration(270, 'coarse')).toBe('4m 30s');
    expect(duration(90, 'coarse')).toBe('1m 30s');
  });
});

describe('titleCase', () => {
  it('turns an id into words', () => {
    expect(titleCase('aimed_shot')).toBe('Aimed Shot');
    expect(titleCase('shot')).toBe('Shot');
    expect(titleCase('elderwood_log')).toBe('Elderwood Log');
  });

  it('leaves an already-capitalized id alone', () => {
    expect(titleCase('Fell Shot')).toBe('Fell Shot');
  });

  it('reads an empty segment as one break rather than a run of spaces', () => {
    expect(titleCase('foo__bar')).toBe('Foo Bar');
    expect(titleCase('_foo')).toBe('Foo');
    expect(titleCase('foo_')).toBe('Foo');
    expect(titleCase('___')).toBe('');
  });

  it('answers the empty string for the empty string', () => {
    expect(titleCase('')).toBe('');
  });
});

describe('count', () => {
  it('takes the singular at one and the plural everywhere else', () => {
    expect(count(0, 'item')).toBe('0 items');
    expect(count(1, 'item')).toBe('1 item');
    expect(count(2, 'item')).toBe('2 items');
    expect(count(4, 'item')).toBe('4 items');
  });

  it('takes a given plural for an irregular one', () => {
    expect(count(1, 'entry', 'entries')).toBe('1 entry');
    expect(count(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('counts any noun, derived or given', () => {
    expect(count(1, 'listing', 'listings')).toBe('1 listing');
    expect(count(7, 'cell')).toBe('7 cells');
    expect(count(1, 'visit')).toBe('1 visit');
  });
});

describe('compass', () => {
  it('points forward at 0', () => {
    expect(compass(0)).toBe('↑');
  });

  it('turns clockwise through all eight sectors', () => {
    expect(compass(0)).toBe('↑');
    expect(compass(45)).toBe('↗');
    expect(compass(90)).toBe('→');
    expect(compass(135)).toBe('↘');
    expect(compass(-180)).toBe('↓');
    expect(compass(-135)).toBe('↙');
    expect(compass(-90)).toBe('←');
    expect(compass(-45)).toBe('↖');
  });

  it('keeps a whole sector, not just its centre', () => {
    expect(compass(10)).toBe('↑');
    expect(compass(-10)).toBe('↑');
    expect(compass(80)).toBe('→');
    expect(compass(100)).toBe('→');
    expect(compass(170)).toBe('↓');
  });

  it('normalises a bearing handed in from outside the range', () => {
    expect(compass(360)).toBe('↑');
    expect(compass(-360)).toBe('↑');
    expect(compass(450)).toBe('→');
    expect(compass(-270)).toBe('→');
    expect(compass(3600)).toBe('↑');
  });

  // A full turn rather than eight samples: a clockwise table agrees at every
  // sector centre and disagrees on every boundary.
  it('agrees with the counter-clockwise radian table at every bearing', () => {
    const disagreed: number[] = [];
    for (let degrees = -180; degrees < 180; degrees += 0.5) {
      if (compass(degrees) !== oldArrow(degrees)) {
        disagreed.push(degrees);
      }
    }
    expect(disagreed).toEqual([]);
  });
});
