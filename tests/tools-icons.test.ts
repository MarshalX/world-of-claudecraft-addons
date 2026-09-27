// The skill-art generator's reader and renderer, without a network. A payload that is not a
// manifest throws: an empty union compiles and silently takes autocomplete away.

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

  // No index is served, so the list is written out; a dropped class shrinks the union silently.
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

  it('sorts them', () => {
    const shuffled = manifest('mage', 'pyroblast', 'arcane_blast', 'frostbolt');

    expect(iconIds(shuffled, 'mage')).toEqual(['arcane_blast', 'frostbolt', 'pyroblast']);
  });

  it('deduplicates', () => {
    expect(iconIds(manifest('rogue', 'backstab', 'backstab'), 'rogue')).toEqual(['backstab']);
  });

  // Catches a path pointing at the wrong file, which would look entirely plausible.
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

  // On a regenerate diff, a count going DOWN is art moving, which is otherwise silent.
  it('records the count per class', () => {
    expect(rendered).toContain('//   hunter: 2');
    expect(rendered).toContain('//   mage: 1');
  });

  // The union is only the abilities with a file, not the whole ability list.
  it('states that it is not every ability', () => {
    expect(rendered).toContain('not every ability');
  });

  // The channels diverge both ways, so the file names its one host.
  it('says it describes live and that a pbe-only ability still resolves', () => {
    expect(rendered).toContain('Read from LIVE');
    expect(rendered).toContain('still resolves at run time');
  });

  it('sorts the ids', () => {
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
