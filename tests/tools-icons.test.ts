// The skill-art generator's reader and renderer.
//
// The fetch is in `tools/icons.mjs` and everything it decides is here, so this suite
// drives the whole of it without a network, the same split the cue generator uses.
//
// What these are actually about is FAILING LOUDLY. A generator that answers empty
// writes a file that compiles, publishes, and quietly takes autocomplete away from
// every author, and nobody notices until someone asks why a valid id is not
// suggested. So a payload that is not a manifest throws rather than degrading, and
// the class field is checked against the class asked for, which is what catches a
// path that resolved to a different manifest than intended.

import { describe, expect, it } from 'vitest';

import {
  GENERATED,
  ICON_CLASSES,
  iconIds,
  manifestPath,
  renderIconTypes,
} from '../tools/icons-core.ts';

/** A manifest shaped the way the game serves one. */
function manifest(cls: string, ...abilityIds: readonly string[]): unknown {
  return {
    class: cls,
    license: 'irrelevant here',
    abilities: abilityIds.map((abilityId) => ({
      abilityId,
      sourceFile: `${abilityId}.png`,
      output: `${abilityId}.webp`,
    })),
  };
}

describe('where the manifests live', () => {
  it('builds the path the game serves', () => {
    expect(manifestPath('hunter')).toBe('/ui/skills/hunter/mapping.json');
  });

  // No index is served for these, so the class list is written out. It is asserted
  // rather than trusted because a class silently dropped from it shrinks the union
  // without failing anything.
  it('names every class the game files art under', () => {
    expect([...ICON_CLASSES]).toEqual([
      'druid',
      'hunter',
      'mage',
      'paladin',
      'priest',
      'rogue',
      'shaman',
      'warlock',
      'warrior',
    ]);
  });

  it('writes where the published package can see it', () => {
    expect(GENERATED).toBe('packages/types/icons.generated.d.ts');
  });
});

describe('reading one class', () => {
  it('takes the ability ids', () => {
    expect(iconIds(manifest('hunter', 'volley', 'aimed_shot'), 'hunter')).toEqual([
      'aimed_shot',
      'volley',
    ]);
  });

  it('sorts them, so the generated file does not churn on reorder', () => {
    const shuffled = manifest('mage', 'pyroblast', 'arcane_blast', 'frostbolt');

    expect(iconIds(shuffled, 'mage')).toEqual(['arcane_blast', 'frostbolt', 'pyroblast']);
  });

  it('deduplicates', () => {
    expect(iconIds(manifest('rogue', 'backstab', 'backstab'), 'rogue')).toEqual(['backstab']);
  });

  // The check that catches a path pointing at the wrong file, which would otherwise
  // fold one class's ids into another's union and look entirely plausible.
  it('refuses a manifest that is for a different class', () => {
    expect(() => iconIds(manifest('mage', 'frostbolt'), 'hunter')).toThrow(/is for mage/);
  });

  it.each([
    ['not an object', null],
    ['an object with no abilities', { class: 'hunter' }],
    ['abilities that are not an array', { class: 'hunter', abilities: 'lots' }],
  ])('throws on %s rather than answering empty', (_label, payload) => {
    expect(() => iconIds(payload, 'hunter')).toThrow();
  });

  it('throws on an entry with no abilityId', () => {
    const broken = { class: 'hunter', abilities: [{ sourceFile: '1.png' }] };

    expect(() => iconIds(broken, 'hunter')).toThrow(/no abilityId/);
  });

  it('throws on a manifest that names nothing', () => {
    expect(() => iconIds(manifest('hunter'), 'hunter')).toThrow(/names no abilities/);
  });
});

describe('the generated module', () => {
  const byClass = new Map([
    ['hunter', ['aimed_shot', 'volley']],
    ['mage', ['frostbolt']],
  ]);
  const rendered = renderIconTypes(byClass, 'https://example.test/ui/skills/<class>/mapping.json');

  it('unions every id across every class', () => {
    expect(rendered).toContain("  | 'aimed_shot'");
    expect(rendered).toContain("  | 'frostbolt'");
    expect(rendered).toContain("  | 'volley'");
  });

  it('unions the class names too', () => {
    expect(rendered).toContain('export type SkillIconClass =');
    expect(rendered).toContain("  | 'hunter'");
  });

  it('says where it came from and not to hand-edit it', () => {
    expect(rendered).toContain('Do not hand-edit');
    expect(rendered).toContain('https://example.test/ui/skills/<class>/mapping.json');
  });

  // The per-class count is what a reviewer reads on a regenerate diff: one going up is
  // art landing, and one going DOWN is art moving, which is otherwise silent.
  it('records the count per class', () => {
    expect(rendered).toContain('//   hunter: 2');
    expect(rendered).toContain('//   mage: 1');
  });

  // An author reading a union of 237 names would otherwise take it for the whole
  // ability list, when it is only the part that has a file an addon can point at.
  it('states that it is not every ability', () => {
    expect(rendered).toContain('not every ability');
  });

  // One host, not all of them: the channels diverge in both directions, so a union
  // across them would autocomplete names most players' games have no file for. The
  // generated file has to say which host it describes and that missing is not broken.
  it('says it describes live and that a pbe-only ability still resolves', () => {
    expect(rendered).toContain('Read from LIVE');
    expect(rendered).toContain('still resolves at run time');
  });

  it('sorts the ids, so the file does not churn on reorder', () => {
    const shuffled = renderIconTypes(new Map([['hunter', ['volley', 'aimed_shot']]]), 'x');

    expect(shuffled.indexOf("'aimed_shot'")).toBeLessThan(shuffled.indexOf("'volley'"));
  });

  it('does not repeat an id two classes share', () => {
    const shared = new Map([
      ['hunter', ['attack']],
      ['warrior', ['attack']],
    ]);

    expect(renderIconTypes(shared, 'x').match(/'attack'/g)).toHaveLength(1);
  });
});
