// The harmful-kind set: how it is parsed out of the game's source, and that the
// two checked-in files are what the generator would write.
//
// What this does NOT check is the one thing nobody can check from here: whether
// the set still matches the deployed game. That answer lives in a checkout this
// suite has no path to, and unlike the cue and icon generators there is no
// endpoint that would 404 to say so. Staleness is a release-time question and is
// answered by running `pnpm aura-kinds` against a fresh checkout.
//
// So the guard is the narrower, honest one, the same one the cue suite puts on
// its artifact: what is on disk is exactly what its generator produces, and a
// hand-edit is a failure rather than a surprise the next regeneration reverts.

import { describe, expect, it } from 'vitest';
import { DEBUFF_AURA_KINDS } from '../loader/src/shared/aura-kinds.generated.ts';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model. Same reason as the cue suite.
import VALUES_TEXT from '../loader/src/shared/aura-kinds.generated.ts?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model. Same reason as the cue suite.
import TYPES_TEXT from '../packages/types/aura-kinds.generated.d.ts?raw';
import {
  debuffKinds,
  kindOnLine,
  renderKindTypes,
  renderKindValues,
} from '../tools/aura-kinds-core.ts';

const OPEN = 'export const DEBUFF_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([';

/** The declaration as the game writes it, around whatever body a case needs. */
function declaration(body: string): string {
  return `import type { AuraKind } from './types';\n\n${OPEN}\n${body}\n]);\n\nexport function x() {}\n`;
}

/** The names in a generated file, read back out of it. */
function namesIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '');
}

const VALUE_MEMBER = /^ {2}'([^']+)',$/gm;
const UNION_MEMBER = /^ {2}\| '([^']+)'/gm;
const READ_FROM = /from (.+)\. Do not hand-edit/;

function readFromIn(text: string): string {
  return READ_FROM.exec(text)?.[1] ?? '';
}

describe('parsing the declaration', () => {
  it('names every kind in the set, in source order', () => {
    const body = ["  'dot',", "  'slow',", "  'root',"].join('\n');

    expect(debuffKinds(declaration(body))).toEqual(['dot', 'slow', 'root']);
  });

  // The real block ends with two entries carrying a trailing comment, which is
  // the shape that would break a naive line parse.
  it('takes the name off a line that also carries a comment', () => {
    const body = [
      "  'sated', // shared exhaustion lockout",
      "  'cauterize_fatigue', // 5 min",
    ].join('\n');

    expect(debuffKinds(declaration(body))).toEqual(['sated', 'cauterize_fatigue']);
  });

  it('skips blank lines and whole-line comments', () => {
    const body = ['  // stat reductions', '', "  'sunder',"].join('\n');

    expect(debuffKinds(declaration(body))).toEqual(['sunder']);
  });

  // Each of these is a refactor of the game's source, and each would otherwise
  // generate a file that compiles, publishes, and misclassifies effects.
  it('throws when the declaration has moved or been renamed', () => {
    expect(() => debuffKinds('export const HARMFUL = new Set([]);')).toThrow(/no longer declares/);
  });

  it('throws on an unterminated set rather than reading to the end of the file', () => {
    expect(() => debuffKinds(`${OPEN}\n  'dot',\n`)).toThrow(/unterminated/);
  });

  it('throws on a set body it does not understand, rather than answering short', () => {
    expect(() => debuffKinds(declaration('  ...LEGACY_KINDS,'))).toThrow(/does not understand/);
  });

  it('throws when the set names nothing at all', () => {
    expect(() => debuffKinds(declaration(''))).toThrow(/names no harmful aura kinds/);
  });

  it('reads one line at a time, so a spread inside the block is caught wherever it sits', () => {
    expect(() => kindOnLine('  ...OTHER,')).toThrow();
    expect(kindOnLine("  'dot',")).toEqual(['dot']);
    expect(kindOnLine('')).toEqual([]);
  });
});

describe('rendering the two outputs', () => {
  it('sorts both, so a regenerate diff is one line per kind that moved', () => {
    expect(renderKindValues(['slow', 'dot'], '0.0.0')).toContain("  'dot',\n  'slow',\n");
    expect(renderKindTypes(['slow', 'dot'], '0.0.0')).toContain("  | 'dot'\n  | 'slow';");
  });

  it('keeps the union open, so a kind these types predate cannot break an addon', () => {
    expect(renderKindTypes(['dot'], '0.0.0')).toContain('| (string & Record<never, never>)');
  });

  it('records which release it read, since nothing else can say the set is stale', () => {
    expect(renderKindValues(['dot'], '0.33.0')).toContain('world-of-claudecraft 0.33.0');
    expect(renderKindTypes(['dot'], '0.33.0')).toContain('world-of-claudecraft 0.33.0');
  });

  // The two files are written from one parse and are useless if they disagree:
  // an author would autocomplete a name the runtime does not classify.
  it('names the same kinds in both', () => {
    expect(namesIn(renderKindValues(['dot', 'slow'], '0.0.0'), VALUE_MEMBER)).toEqual(
      namesIn(renderKindTypes(['dot', 'slow'], '0.0.0'), UNION_MEMBER),
    );
  });
});

describe('the checked-in files', () => {
  it('carry the set the game had when they were generated', () => {
    expect(DEBUFF_AURA_KINDS.size).toBeGreaterThan(0);
    expect(DEBUFF_AURA_KINDS.has('dot')).toBe(true);
  });

  // Formatting and header only, deliberately: the names are read back OUT of
  // each file, so a name typed in by hand would be rendered straight back in and
  // this would pass. What it catches is an edited header and drifted layout.
  it('are laid out exactly the way the generator writes them', () => {
    const kinds = namesIn(VALUES_TEXT, VALUE_MEMBER);
    const version = readFromIn(VALUES_TEXT).split(' ').at(-1) ?? '';

    expect(VALUES_TEXT).toBe(renderKindValues(kinds, version));
    expect(TYPES_TEXT).toBe(renderKindTypes(namesIn(TYPES_TEXT, UNION_MEMBER), version));
  });

  // This is the arm that catches a name someone typed in, since a hand-added
  // kind lands wherever looked right rather than in code-point order. It is also
  // what proves the two files did not drift apart on disk.
  it('agree with each other, sorted and free of duplicates', () => {
    const names = namesIn(VALUES_TEXT, VALUE_MEMBER);

    expect(names).toEqual([...new Set(names)].sort());
    expect(names).toEqual(namesIn(TYPES_TEXT, UNION_MEMBER));
    expect(names).toEqual([...DEBUFF_AURA_KINDS]);
  });
});
