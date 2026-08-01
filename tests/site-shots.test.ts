import { describe, expect, it } from 'vitest';
import committed from '../site/content/shots.json' with { type: 'json' };
import { measure, parseShots, undersizeReport } from '../tools/site/shots.ts';

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

  it('rejects a missing alt, which is the field a template must never write', () => {
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

  // A tall narrow panel filling a 496px column made a row twice the height of the
  // paragraph beside it. Capping by height puts it at about its in-game size.
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

  // A large shot is served DOWN to its slot rather than at its own width: a
  // 3244px capture in a 496px column is 213 kB of AVIF nobody can see.
  it('serves a large shot at its slot width, not its own', () => {
    const big = measure(shot, { width: 3244, height: 1882 });
    expect(big.served).toBe(1000);
    expect(big.maxWidth).toBe(500);
    expect(big.width).toBe(3244);
  });

  it('serves a shot too small for its slot at its own width', () => {
    expect(measure(shot, { width: 700, height: 400 }).served).toBe(700);
  });

  // The portrait cap feeds the encoder too: shown at 388 CSS px, there is no
  // reason to encode the full 810 device pixels the file happens to carry.
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

// The committed manifest has to parse, or the site build fails on a file nobody
// edited deliberately. Imported rather than read, because noNodejsModules is not
// exempt in tests/ and AGENTS.md says not to widen that for exactly this want.
// Whether each named file EXISTS is checked by the build, which is doing the I/O
// anyway to measure it.
describe('the committed manifest', () => {
  it('parses', () => {
    const shots = parseShots(JSON.stringify(committed), AT);
    expect(shots.size).toBeGreaterThan(0);
  });

  // The manifest schema requires a caption even though the TYPE allows null: only
  // a preview synthesised from an addon.json passes null, and none of those are
  // declared here. Asserting on the parsed value is what pins that.
  it('gives every shot a caption and an alt distinct from it', () => {
    for (const shot of parseShots(JSON.stringify(committed), AT).values()) {
      expect(shot.caption).not.toBeNull();
      expect(shot.alt).not.toBe(shot.caption);
      expect(shot.alt.length).toBeGreaterThan(shot.caption?.length ?? 0);
    }
  });
});
