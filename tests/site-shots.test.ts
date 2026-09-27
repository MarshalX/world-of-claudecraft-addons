import { describe, expect, it } from 'vitest';
import committed from '../site/content/shots.json' with { type: 'json' };
import { fillsOwnRow, measure, parseShots, undersizeReport } from '../tools/site/shots.ts';

const AT = 'site/content/shots.json';

function manifest(shots: unknown): string {
  return JSON.stringify({ shots });
}

const ONE = {
  file: 'combat-meter.png',
  minWidth: 1000,
  caption: 'Bars tinted by damage school',
  alt: 'Combat Meter panel showing 17,602 damage in 11 seconds.',
};

describe('parseShots', () => {
  it('reads a shot and carries its id', () => {
    const shots = parseShots(manifest({ 'combat-meter': ONE }), AT);
    expect(shots.get('combat-meter')).toMatchObject({ id: 'combat-meter', minWidth: 1000 });
  });

  it('accepts the $comment the real manifest carries', () => {
    const source = JSON.stringify({ $comment: 'why', shots: { a: ONE } });
    expect(parseShots(source, AT).size).toBe(1);
  });

  it('rejects a missing alt', () => {
    const { alt, ...noAlt } = ONE;
    expect(() => parseShots(manifest({ a: noAlt }), AT)).toThrow(/alt/);
  });

  it('rejects an empty caption', () => {
    expect(() => parseShots(manifest({ a: { ...ONE, caption: '' } }), AT)).toThrow(/caption/);
  });

  it('rejects an id that is not kebab-case', () => {
    expect(() => parseShots(manifest({ 'Combat Meter': ONE }), AT)).toThrow();
  });

  it('rejects a non-integer minWidth', () => {
    expect(() => parseShots(manifest({ a: { ...ONE, minWidth: 1000.5 } }), AT)).toThrow(/minWidth/);
  });

  it('names the file when the JSON is malformed', () => {
    expect(() => parseShots('{not json', AT)).toThrow(/shots\.json: not valid JSON/);
  });
});

describe('measure', () => {
  const shot = { id: 'a', ...ONE };

  it('caps a landscape shot at half its natural width, so it is never upscaled', () => {
    expect(measure(shot, { width: 900, height: 500 }).maxWidth).toBe(450);
  });

  it('rounds the cap down, so it never rounds up into a blur', () => {
    expect(measure(shot, { width: 901, height: 500 }).maxWidth).toBe(450);
  });

  // Filling the column's width would make a tall panel twice the height of its paragraph.
  it('caps a portrait shot by height, not by column width', () => {
    const tall = measure(shot, { width: 810, height: 980 });
    expect(tall.portrait).toBe(true);
    expect(tall.maxWidth).toBe(388);
    // Which is the height cap, give or take the floor that keeps it from upscaling.
    expect(Math.round((tall.maxWidth * 980) / 810)).toBeLessThanOrEqual(470);
  });

  it('never lets the portrait cap exceed what the file can supply', () => {
    const small = measure(shot, { width: 200, height: 300 });
    expect(small.maxWidth).toBe(100);
  });

  it('serves a large shot at its slot width, not its own', () => {
    const big = measure(shot, { width: 3244, height: 1882 });
    expect(big.served).toBe(1000);
    expect(big.maxWidth).toBe(500);
    expect(big.width).toBe(3244);
  });

  it('serves a shot too small for its slot at its own width', () => {
    expect(measure(shot, { width: 700, height: 400 }).served).toBe(700);
  });

  // The portrait cap feeds the encoder too.
  it('serves a portrait shot at its capped size rather than its full width', () => {
    const tall = measure(shot, { width: 810, height: 980 });
    expect(tall.served).toBeLessThan(810);
    expect(tall.served).toBe(tall.maxWidth * 2 + 1);
  });

  it('does not flag a portrait shot that satisfies its height cap', () => {
    expect(measure(shot, { width: 810, height: 980 }).undersize).toBe(false);
  });

  it('flags a landscape shot narrower than its slot', () => {
    expect(measure(shot, { width: 700, height: 400 }).undersize).toBe(true);
  });

  it('does not flag a shot at exactly its slot width', () => {
    expect(measure(shot, { width: 1000, height: 700 }).undersize).toBe(false);
  });
});

describe('undersizeReport', () => {
  it('reports only the undersized ones, with the number they want', () => {
    const shots = [
      measure({ id: 'small', ...ONE }, { width: 700, height: 400 }),
      measure({ id: 'fine', ...ONE }, { width: 2000, height: 1200 }),
    ];
    const lines = undersizeReport(shots);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('small');
    expect(lines[0]).toContain('wants 1000px');
  });

  it('is empty when every shot clears its slot', () => {
    expect(undersizeReport([measure({ id: 'a', ...ONE }, { width: 2000, height: 9 })])).toEqual([]);
  });
});

// Imported rather than read, because noNodejsModules is not exempt in tests/. Whether each
// named file exists is checked by the build, which does the I/O anyway.
describe('the committed manifest', () => {
  it('parses', () => {
    const shots = parseShots(JSON.stringify(committed), AT);
    expect(shots.size).toBeGreaterThan(0);
  });

  // The type allows a null caption, for a preview synthesised from an addon.json, and none of
  // those are declared here.
  it('gives every shot a caption and an alt distinct from it', () => {
    for (const shot of parseShots(JSON.stringify(committed), AT).values()) {
      expect(shot.caption).not.toBeNull();
      expect(shot.alt).not.toBe(shot.caption);
      expect(shot.alt.length).toBeGreaterThan(shot.caption?.length ?? 0);
    }
  });
});

// A preview sits beside the description when it fits there at its own resolution and on a row
// of its own when it does not, decided from the file rather than a list of ids.
describe('a preview big enough for a row of its own', () => {
  it('keeps a single HUD panel beside the description', () => {
    // About 390 CSS px, and half a content column is 500.
    expect(fillsOwnRow({ width: 776, height: 736 })).toBe(false);
    expect(fillsOwnRow({ width: 782, height: 412 })).toBe(false);
  });

  it('gives a two-panel sheet the whole row', () => {
    expect(fillsOwnRow({ width: 1904, height: 1086 })).toBe(true);
    expect(fillsOwnRow({ width: 2136, height: 806 })).toBe(true);
    expect(fillsOwnRow({ width: 1984, height: 1446 })).toBe(true);
    expect(fillsOwnRow({ width: 2348, height: 1430 })).toBe(true);
  });

  it('reads the width rather than the shape', () => {
    // An aspect-ratio test misplaces both a tall narrow capture and a wide short strip.
    expect(fillsOwnRow({ width: 736, height: 2000 })).toBe(false);
    expect(fillsOwnRow({ width: 1044, height: 306 })).toBe(false);
  });
});
