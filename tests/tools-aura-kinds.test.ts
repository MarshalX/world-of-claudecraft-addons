// The aura classifier sets: how they are parsed out of the game's source, and that the
// checked-in files are exactly what the generator writes. Staleness against the game is
// answered only by running `pnpm aura-kinds` against a fresh checkout.

import { describe, expect, it } from 'vitest';
import {
  DEBUFF_AURA_KINDS,
  UNDISPELLABLE_AURA_IDS,
} from '../loader/src/shared/aura-kinds.generated.ts';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model. Same reason as the cue suite.
import VALUES_TEXT from '../loader/src/shared/aura-kinds.generated.ts?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model. Same reason as the cue suite.
import TYPES_TEXT from '../packages/types/aura-kinds.generated.d.ts?raw';
import {
  displayOverrideIds,
  inlineRefusedIds,
  refusalsOnLine,
  undispellableIds,
} from '../tools/aura-ids-core.ts';
import {
  debuffKinds,
  kindOnLine,
  renderKindTypes,
  renderKindValues,
} from '../tools/aura-kinds-core.ts';
import type { ToggleRule } from '../tools/aura-toggle-core.ts';
import { setMembers, toggleRule } from '../tools/aura-toggle-core.ts';

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
/** Where each set starts in the values file, in the order they are written. */
const IDS_DECLARATION = 'const UNDISPELLABLE_AURA_IDS';
const TOGGLE_KINDS_DECLARATION = 'const TOGGLE_AURA_KINDS';
const TOGGLE_IDS_DECLARATION = 'const TOGGLE_AURA_IDS';
const TIMED_DECLARATION = 'const TIMED_AURA_IDS';
const UNION_MEMBER = /^ {2}\| '([^']+)'/gm;
const READ_FROM = /from (.+)\. Do not hand-edit/;

function readFromIn(text: string): string {
  return READ_FROM.exec(text)?.[1] ?? '';
}

/**
 * The names of ONE set in the values file, bounded by the next declaration, since every
 * set shares one layout and an unbounded pass would read them all as one.
 */
function sectionIn(text: string, from: string, to: string | null): string[] {
  const start = Math.max(text.indexOf(from), 0);
  if (to === null) {
    return namesIn(text.slice(start), VALUE_MEMBER);
  }
  return namesIn(text.slice(start, text.indexOf(to)), VALUE_MEMBER);
}

function kindsIn(text: string): string[] {
  return sectionIn(text, '', IDS_DECLARATION);
}

function idsIn(text: string): string[] {
  return sectionIn(text, IDS_DECLARATION, TOGGLE_KINDS_DECLARATION);
}

/** The toggle rule, read back out of the file in the shape the generator takes. */
function toggleIn(text: string): ToggleRule {
  return {
    kinds: sectionIn(text, TOGGLE_KINDS_DECLARATION, TOGGLE_IDS_DECLARATION),
    ids: sectionIn(text, TOGGLE_IDS_DECLARATION, TIMED_DECLARATION),
    timed: sectionIn(text, TIMED_DECLARATION, null),
  };
}

/** A minimal rule, for a case that is about something else. */
const A_RULE: ToggleRule = { kinds: ['stealth'], ids: ['ghost_wolf'], timed: ['x'] };

describe('parsing the declaration', () => {
  it('names every kind in the set, in source order', () => {
    const body = ["  'dot',", "  'slow',", "  'root',"].join('\n');

    expect(debuffKinds(declaration(body))).toEqual(['dot', 'slow', 'root']);
  });

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

  // Each is a game refactor that would otherwise generate a file that misclassifies effects.
  it('throws when the declaration has moved or been renamed', () => {
    expect(() => debuffKinds('export const HARMFUL = new Set([]);')).toThrow(/no longer declares/);
  });

  it('throws on an unterminated set', () => {
    expect(() => debuffKinds(`${OPEN}\n  'dot',\n`)).toThrow(/unterminated/);
  });

  it('throws on a set body it does not understand', () => {
    expect(() => debuffKinds(declaration('  ...LEGACY_KINDS,'))).toThrow(/does not understand/);
  });

  it('throws when the set names nothing at all', () => {
    expect(() => debuffKinds(declaration(''))).toThrow(/names no harmful aura kinds/);
  });

  it('catches a spread on any line of the block', () => {
    expect(() => kindOnLine('  ...OTHER,')).toThrow();
    expect(kindOnLine("  'dot',")).toEqual(['dot']);
    expect(kindOnLine('')).toEqual([]);
  });
});

/**
 * The game's classifier: the display set, then the predicate that consults it. The
 * signature is verbatim because its quoted `Pick<>` names must not be read as refused ids.
 */
const PREDICATE_HEAD = [
  'export function isDispellableAura(',
  "  aura: Pick<Aura, 'kind' | 'value' | 'school'> &",
  '    Partial<',
  "      Pick<Aura, 'id' | 'unbreakableControl' | 'encounterOwned' | 'undispellable' | 'permanent'>",
  '    >,',
  '  offensive: boolean,',
  '): boolean {',
].join('\n');

const CONSULTS_SET =
  '  if (aura.id !== undefined && DEBUFF_DISPLAY_AURA_IDS.has(aura.id)) return false;';
const REFUSES_ASCENSION = "  if (aura.id === 'divine_ascension' || aura.permanent) return false;";

function classifier(display: string, body: readonly string[]): string {
  const set = `const DEBUFF_DISPLAY_AURA_IDS: ReadonlySet<string> = new Set([${display}]);`;
  return `${set}\n\n${PREDICATE_HEAD}\n${body.join('\n')}\n}\n`;
}

describe('parsing the ids no dispel takes', () => {
  it('reads both the named set and the inline literal', () => {
    const source = classifier("'shaman_stormsurge_ready'", [REFUSES_ASCENSION, CONSULTS_SET]);

    // Order is not part of the contract; the renderer sorts.
    expect([...undispellableIds(source)].sort()).toEqual([
      'divine_ascension',
      'shaman_stormsurge_ready',
    ]);
  });

  it('reads the body only, never the signature', () => {
    const source = classifier("'x'", [REFUSES_ASCENSION, CONSULTS_SET]);

    expect(inlineRefusedIds(source)).toEqual(['divine_ascension']);
  });

  it('reads the set on one line or wrapped', () => {
    const wrapped = classifier("\n  'a_mark',\n  'b_mark',\n", [REFUSES_ASCENSION, CONSULTS_SET]);

    expect(displayOverrideIds(wrapped)).toEqual(['a_mark', 'b_mark']);
  });

  // Softer than the kind parse on purpose: the game can empty this set.
  it('accepts an empty display set', () => {
    const source = classifier('', [REFUSES_ASCENSION, CONSULTS_SET]);

    expect(displayOverrideIds(source)).toEqual([]);
    expect(undispellableIds(source)).toEqual(['divine_ascension']);
  });

  it('throws when the display set is renamed', () => {
    const renamed = `const OTHER: ReadonlySet<string> = new Set(['x']);\n\n${PREDICATE_HEAD}\n}\n`;

    expect(() => undispellableIds(renamed)).toThrow(/no longer declares DEBUFF_DISPLAY_AURA_IDS/);
  });

  it('throws when the predicate is renamed or moved', () => {
    const source = classifier("'x'", [REFUSES_ASCENSION, CONSULTS_SET]);

    expect(() => undispellableIds(source.replace('isDispellableAura', 'isRemovable'))).toThrow(
      /no longer declares isDispellableAura/,
    );
  });

  // The set would still parse, and the loader would refuse ids the game allows.
  it('throws when the set is declared but the predicate stops consulting it', () => {
    const source = classifier("'x'", [REFUSES_ASCENSION]);

    expect(() => undispellableIds(source)).toThrow(/no longer consults/);
  });

  it('throws on an id comparison that is not a refusal', () => {
    const accepts = classifier("'x'", [
      "  if (aura.id === 'always_ok') return true;",
      CONSULTS_SET,
    ]);

    expect(() => undispellableIds(accepts)).toThrow(/does not\s+understand/);
  });

  it('throws when the predicate refuses nothing by id at all', () => {
    expect(() => undispellableIds(classifier('', [CONSULTS_SET]))).toThrow(/refuses no aura by id/);
  });

  it('catches a reworked statement on any line', () => {
    expect(refusalsOnLine(REFUSES_ASCENSION)).toEqual(['divine_ascension']);
    expect(refusalsOnLine("  if (aura.school === 'physical') return false;")).toEqual([]);
    expect(() => refusalsOnLine("  const x = aura.id === 'y';")).toThrow();
  });
});

describe('rendering the two outputs', () => {
  it('sorts both outputs', () => {
    expect(renderKindValues(['slow', 'dot'], ['x'], '0.0.0', A_RULE)).toContain(
      "  'dot',\n  'slow',\n",
    );
    expect(renderKindTypes(['slow', 'dot'], '0.0.0')).toContain("  | 'dot'\n  | 'slow';");
  });

  it('renders the refused ids as a second set, sorted and unpublished', () => {
    const values = renderKindValues(['dot'], ['zeta_mark', 'alpha_mark'], '0.0.0', A_RULE);

    expect(idsIn(values)).toEqual(['alpha_mark', 'zeta_mark']);
    expect(kindsIn(values)).toEqual(['dot']);
    expect(renderKindTypes(['dot'], '0.0.0')).not.toContain('alpha_mark');
  });

  it('keeps the union open', () => {
    expect(renderKindTypes(['dot'], '0.0.0')).toContain('| (string & Record<never, never>)');
  });

  it('records which release it read', () => {
    expect(renderKindValues(['dot'], ['x'], '0.33.0', A_RULE)).toContain(
      'world-of-claudecraft 0.33.0',
    );
    expect(renderKindTypes(['dot'], '0.33.0')).toContain('world-of-claudecraft 0.33.0');
  });

  it('names the same kinds in both', () => {
    expect(kindsIn(renderKindValues(['dot', 'slow'], ['x'], '0.0.0', A_RULE))).toEqual(
      namesIn(renderKindTypes(['dot', 'slow'], '0.0.0'), UNION_MEMBER),
    );
  });
});

/** The toggle rule as the game declares it, across its two files. */
const TOGGLE_SOURCE = [
  "export const TOGGLE_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([\n  'stealth',\n  'form_cat',\n]);",
  "export const TOGGLE_AURA_IDS: ReadonlySet<string> = new Set([\n  'ghost_wolf',\n]);",
  "export const TIMED_AURA_IDS: ReadonlySet<string> = new Set(['greater_invisibility']);",
  'export function isToggleAura(kind: AuraKind, id: string): boolean {',
  '  return (',
  '    (TOGGLE_AURA_KINDS.has(kind) || TOGGLE_AURA_IDS.has(id) || isPersistentEngineAura(id)) &&',
  '    !TIMED_AURA_IDS.has(id)',
  '  );',
  '}',
].join('\n\n');

const ENGINE_SOURCE =
  "const PERSISTENT_ENGINE_AURA_IDS: ReadonlySet<string> = new Set([\n  'moontide',\n  'ghost_wolf',\n]);";

describe('parsing the toggle rule', () => {
  // Merged because the game's predicate ORs them.
  it('merges the authored toggles with the engine banks, deduped', () => {
    const rule = toggleRule(TOGGLE_SOURCE, ENGINE_SOURCE);

    expect(rule.kinds).toEqual(['stealth', 'form_cat']);
    expect([...rule.ids].sort()).toEqual(['ghost_wolf', 'moontide']);
    expect(rule.timed).toEqual(['greater_invisibility']);
  });

  // Declarations can survive a rewrite of the predicate that stops applying them.
  it('throws when the predicate stops consulting a set it still declares', () => {
    const rewritten = TOGGLE_SOURCE.replace('TOGGLE_AURA_IDS.has(id) || ', '');

    expect(() => toggleRule(rewritten, ENGINE_SOURCE)).toThrow(/no longer consults/);
  });

  it('throws when the predicate itself has moved or been renamed', () => {
    expect(() => toggleRule(TOGGLE_SOURCE.replace('isToggleAura', 'isModeAura'), ENGINE_SOURCE)) //
      .toThrow(/no longer declares/);
  });

  // A short set would put a countdown under every stance in the game.
  it('throws on a set it cannot read', () => {
    expect(() =>
      setMembers(
        'x.ts',
        'const S: ReadonlySet<string> = new Set([\n  ...OTHER,\n]);',
        'const S: ReadonlySet<string> = new Set([',
        'S',
      ),
    ) //
      .toThrow(/cannot read/);
    expect(() => setMembers('x.ts', 'nothing here', 'const S = new Set([', 'S')) //
      .toThrow(/no longer declares/);
  });
});

describe('the checked-in files', () => {
  it('carry the set the game had when they were generated', () => {
    expect(DEBUFF_AURA_KINDS.size).toBeGreaterThan(0);
    expect(DEBUFF_AURA_KINDS.has('dot')).toBe(true);
  });

  // Header and layout only: names are read back out of the file, so a hand-typed one passes.
  it('are laid out exactly the way the generator writes them', () => {
    const version = readFromIn(VALUES_TEXT).split(' ').at(-1) ?? '';

    expect(VALUES_TEXT).toBe(
      renderKindValues(kindsIn(VALUES_TEXT), idsIn(VALUES_TEXT), version, toggleIn(VALUES_TEXT)),
    );
    expect(TYPES_TEXT).toBe(renderKindTypes(namesIn(TYPES_TEXT, UNION_MEMBER), version));
  });

  // A hand-added kind lands out of code-point order, which this catches.
  it('agree with each other, sorted and free of duplicates', () => {
    const names = kindsIn(VALUES_TEXT);

    expect(names).toEqual([...new Set(names)].sort());
    expect(names).toEqual(namesIn(TYPES_TEXT, UNION_MEMBER));
    expect(names).toEqual([...DEBUFF_AURA_KINDS]);
  });

  it('carry the refused ids, sorted, and publish no union of them', () => {
    const ids = idsIn(VALUES_TEXT);

    expect(ids).toEqual([...new Set(ids)].sort());
    expect(ids).toEqual([...UNDISPELLABLE_AURA_IDS]);
    expect(ids.length).toBeGreaterThan(0);
    expect(TYPES_TEXT).not.toContain('UNDISPELLABLE');
  });
});
