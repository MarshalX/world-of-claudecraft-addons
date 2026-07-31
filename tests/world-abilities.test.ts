import { describe, expect, it } from 'vitest';
import {
  abilityIndexSignature,
  createAbilityReader,
  emptyAbilities,
} from '../loader/src/runtime/world/abilities.ts';

/**
 * A resolved entry in the game's own shape: the content `def` plus what talents
 * resolved to. Shaped from a live PBE client rather than from the game's
 * declarations, which is why the resolved cooldown differs from the def's.
 */
function resolved(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    def: {
      id: 'arcane_shot',
      name: 'Fell Shot',
      school: 'arcane',
      cost: 25,
      castTime: 0,
      cooldown: 6,
      range: 35,
      minRange: 8,
      requiresTarget: true,
    },
    rank: 3,
    cost: 55,
    castTime: 0,
    cooldown: 5.4,
    ...overrides,
  };
}

function world(known: unknown): Record<string, unknown> {
  return { known };
}

describe('the ability projection', () => {
  it('bridges an id to the display name an event carries', () => {
    const read = createAbilityReader();
    const book = read(world([resolved()]));

    expect(book.byId('arcane_shot')?.name).toBe('Fell Shot');
    expect(book.byName('Fell Shot')?.id).toBe('arcane_shot');
  });

  it('publishes the resolved figures, not the content table ones', () => {
    const read = createAbilityReader();
    const info = read(world([resolved()])).byId('arcane_shot');

    // The def says 6 and 25; talents moved both, and a countdown drawn from the
    // def's numbers would be wrong for anyone who has spent a point.
    expect(info?.cooldown).toBe(5.4);
    expect(info?.cost).toBe(55);
    expect(info?.rank).toBe(3);
  });

  it('answers null rather than guessing at a name nobody knows', () => {
    const read = createAbilityReader();
    const book = read(world([resolved()]));

    // Every mob ability reaches a meter exactly like this: a display name with
    // no id behind it.
    expect(book.byName('Cleave')).toBeNull();
    expect(book.byId('cleave')).toBeNull();
  });

  /**
   * The charge pool is the resolved total already, not a base to add a bonus to.
   *
   * Shaped from a live hunter carrying the charge talent: `charges: 2` alongside
   * `bonusCharges: 1` and no `def.maxCharges`, which the game documents as a base of
   * one. Summing the two would publish three uses for a two-use pool, and the field
   * name is inviting enough that someone will try.
   */
  it('reads a charge pool as the resolved total, never adding the bonus again', () => {
    const read = createAbilityReader();
    const pooled = resolved({
      def: { id: 'trailbreak', name: 'Trailbreak' },
      charges: 2,
      bonusCharges: 1,
    });

    expect(read(world([pooled])).byId('trailbreak')?.charges).toBe(2);
  });

  it('leaves charges absent for an ability with no pool', () => {
    const read = createAbilityReader();

    expect(read(world([resolved()])).byId('arcane_shot')?.charges).toBeUndefined();
  });

  it('drops an entry carrying no usable id and name', () => {
    const read = createAbilityReader();
    const book = read(world([resolved(), { def: { id: 'no_name' } }, { rank: 1 }]));

    expect(book.known.map((info) => info.id)).toEqual(['arcane_shot']);
  });

  it('reads an absent or malformed list as an empty book', () => {
    const read = createAbilityReader();

    expect(read(world(undefined)).known).toEqual([]);
    expect(read(world('not a list')).known).toEqual([]);
    expect(read(null).known).toEqual([]);
  });
});

describe('the ability memo', () => {
  /**
   * The reason the reader is stateful at all.
   *
   * A live client hands back a fresh array AND fresh entry objects on every
   * snapshot, twenty times a second. Rebuilding on each one would allocate
   * constantly and hand an addon a different object every frame, so a cached
   * `AbilityInfo` could never be compared by identity.
   */
  it('holds identity across snapshots that changed nothing', () => {
    const read = createAbilityReader();
    const first = read(world([resolved()]));
    const second = read(world([resolved()]));

    expect(second).toBe(first);
    expect(second.byId('arcane_shot')).toBe(first.byId('arcane_shot'));
  });

  it('rebuilds when a rank moves', () => {
    const read = createAbilityReader();
    const first = read(world([resolved()]));
    const second = read(world([resolved({ rank: 4 })]));

    expect(second).not.toBe(first);
    expect(second.byId('arcane_shot')?.rank).toBe(4);
  });

  it('rebuilds when an ability is learned', () => {
    const read = createAbilityReader();
    const first = read(world([resolved()]));
    const second = read(
      world([resolved(), resolved({ def: { id: 'aimed_shot', name: 'Measured Shot' } })]),
    );

    expect(second).not.toBe(first);
    expect(second.byName('Measured Shot')?.id).toBe('aimed_shot');
  });

  it('freezes what it hands out, so one addon cannot edit another addon read', () => {
    const read = createAbilityReader();
    const info = read(world([resolved()])).byId('arcane_shot');

    const mutable = info as unknown as { name: string };
    expect(() => {
      mutable.name = 'Something Else';
    }).toThrow();
  });
});

describe('the ability signature', () => {
  it('changes on rank, and not on a resolved figure moving', () => {
    expect(abilityIndexSignature({ known: [{ id: 'a', rank: 1 }] })).toBe('a#1');
    expect(abilityIndexSignature({ known: [{ id: 'a', rank: 2 }] })).not.toBe('a#1');
    // A cooldown ticking is not a different spellbook.
    expect(abilityIndexSignature({ known: [{ id: 'a', rank: 1, cooldown: 3 }] })).toBe('a#1');
  });

  it('reads an empty book as an empty signature', () => {
    expect(abilityIndexSignature(emptyAbilities())).toBe('');
    expect(abilityIndexSignature(null)).toBe('');
  });
});
