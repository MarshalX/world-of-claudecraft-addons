// The parser `tests/site-api-coverage.test.ts` rests on. A member this LOSES is a
// member the docs guard stops requiring, so the mistake makes that suite greener
// rather than redder and nothing anywhere goes red.

import { describe, expect, it } from 'vitest';
import { apiSurface, membersOf } from '../tools/site/api-surface.ts';

/** An interface body, as `apiSurface` slices one out. */
function body(...lines: string[]): string {
  return lines.join('\n');
}

describe('membersOf', () => {
  it('finds the members of a plain interface', () => {
    expect(membersOf(body('  first: () => void;', '  second: number;'))).toEqual([
      'first',
      'second',
    ]);
  });

  it('skips the fields of a nested object literal', () => {
    expect(
      membersOf(body('  outer: {', '    inner: number;', '  };', '  after: () => void;')),
    ).toEqual(['outer', 'after']);
  });

  // Interval notation is the precise way to say what a bearing returns, so the
  // parser is what has to give.
  it('keeps counting after a doc comment carrying an unmatched close paren', () => {
    const source = body(
      '  /**',
      '   * Degrees clockwise, in [-180, 180). 0 is straight ahead.',
      '   */',
      '  bearingTo: (at: { x: number; z: number }) => number | null;',
      '  raw: unknown;',
    );

    expect(membersOf(source)).toEqual(['bearingTo', 'raw']);
  });

  it('keeps counting after a doc comment carrying an unmatched open paren', () => {
    const source = body(
      '  /**',
      '   * The opening half of a parenthetical (which never closes.',
      '   */',
      '  first: () => void;',
      '  second: number;',
    );

    expect(membersOf(source)).toEqual(['first', 'second']);
  });

  // A fenced example in a doc comment is code with braces in it.
  it('ignores braces inside a fenced example in a doc comment', () => {
    const source = body(
      '  /**',
      '   * ```js',
      '   * if (ready) {',
      '   * ```',
      '   */',
      '  first: () => void;',
      '  second: number;',
    );

    expect(membersOf(source)).toEqual(['first', 'second']);
  });

  it('still reads a line comment that is genuinely code', () => {
    const source = body('  first: () => void; // a trailing note (unbalanced', '  second: number;');

    expect(membersOf(source)).toEqual(['first', 'second']);
  });
});

describe('the surface of the real tree', () => {
  const surface = apiSurface();
  const qualified = new Set(surface.map((one) => one.qualified));

  // `fmt.compass` is declared under a doc comment carrying a parenthetical, and
  // it is the last member of its interface, so losing it shows up nowhere else.
  it('finds a member declared after a parenthetical in its own doc comment', () => {
    expect(qualified).toContain('fmt.compass');
  });

  // The tail is where a dropped member hides: everything after a break goes at
  // once.
  it('finds the members at the end of WorldApi, which is the longest interface', () => {
    expect(qualified).toContain('world.on');
    expect(qualified).toContain('world.raw');
  });
});
