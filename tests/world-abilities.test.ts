import { describe, expect, it } from 'vitest';
import {
  abilityIndexSignature,
  createAbilityReader,
  emptyAbilities,
} from '../loader/src/runtime/world/abilities.ts';

/**
 * A resolved entry as a live client holds it: the content `def` plus what talents
 * resolved to, so the resolved cooldown differs from the def's.
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

    // Talents moved both def figures (6 and 25).
    expect(info?.cooldown).toBe(5.4);
    expect(info?.cost).toBe(55);
    expect(info?.rank).toBe(3);
  });

  it('answers null for an unknown name', () => {
    const read = createAbilityReader();
    const book = read(world([resolved()]));

    // Every mob ability arrives as a display name with no id behind it.
    expect(book.byName('Cleave')).toBeNull();
    expect(book.byId('cleave')).toBeNull();
  });

  /** `charges` already includes `bonusCharges`; summing them publishes three uses for two. */
  it('reads a charge pool as the resolved total', () => {
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

describe('the ability description', () => {
  it('answers the game own name for an ability the player knows', () => {
    const read = createAbilityReader();

    // A name derived from the id would answer "Arcane Shot".
    expect(read(world([resolved()])).describe('arcane_shot')).toEqual({
      name: 'Fell Shot',
      school: 'arcane',
      known: true,
    });
  });

  it('derives a name from the id for an ability the player does not know', () => {
    const read = createAbilityReader();

    expect(read(world([resolved()])).describe('mortal_strike')).toEqual({
      name: 'Mortal Strike',
      school: null,
      known: false,
    });
  });

  /** The mark belongs to the caller: this same string goes into an `aria-label`. */
  it('leaves the guess unmarked in the name itself', () => {
    const read = createAbilityReader();
    const guess = read(world([resolved()])).describe('mortal_strike');

    expect(guess.name).not.toContain('?');
    expect(guess.known).toBe(false);
  });

  it('derives a name on the landing page, where the book is empty', () => {
    const read = createAbilityReader();

    expect(emptyAbilities().describe('aimed_shot')).toEqual({
      name: 'Aimed Shot',
      school: null,
      known: false,
    });
    expect(read(world(undefined)).describe('aimed_shot').known).toBe(false);
  });
});

describe('the ability memo', () => {
  /** A live client hands back fresh entry objects on every snapshot, 20 times a second. */
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

  it('freezes what it hands out', () => {
    const read = createAbilityReader();
    const info = read(world([resolved()])).byId('arcane_shot');

    const mutable = info as unknown as { name: string };
    expect(() => {
      mutable.name = 'Something Else';
    }).toThrow();
  });
});

/** The three fields read off the DEF, which talent resolution never touches. */
describe('the ability shape read off the def', () => {
  it('publishes the charge stage count', () => {
    const read = createAbilityReader();
    const charged = resolved({
      def: { id: 'glacial_front', name: 'Glacial Front', castTime: 2.4, empowerStages: 4 },
    });

    const info = read(world([charged])).byId('glacial_front');

    expect(info?.empowerStages).toBe(4);
    expect(read(world([resolved()])).byId('arcane_shot')?.empowerStages).toBeUndefined();
  });

  it('publishes a channel as its length and tick count', () => {
    const read = createAbilityReader();
    const channelled = resolved({
      def: {
        id: 'arcane_missiles',
        name: 'Aether Darts',
        castTime: 0,
        channel: { duration: 3, ticks: 3 },
      },
    });

    const info = read(world([channelled])).byId('arcane_missiles');

    expect(info?.channel).toEqual({ duration: 3, ticks: 3 });
    // A channel's castTime is 0, so without the channel it reads as instant.
    expect(info?.castTime).toBe(0);
  });

  it('refuses a channel carrying only one of its two figures', () => {
    const read = createAbilityReader();
    const half = resolved({
      def: { id: 'arcane_missiles', name: 'Aether Darts', channel: { duration: 3 } },
    });

    expect(read(world([half])).byId('arcane_missiles')?.channel).toBeUndefined();
  });

  it('marks an off-global-cooldown ability by presence', () => {
    const read = createAbilityReader();
    const instant = resolved({
      def: { id: 'aimed_shot', name: 'Measured Shot', offGcd: true },
    });

    expect(read(world([instant])).byId('aimed_shot')?.offGcd).toBe(true);
    expect(read(world([resolved()])).byId('arcane_shot')?.offGcd).toBeUndefined();
  });
});

describe('the ability signature', () => {
  it('changes on rank, and not on a resolved figure moving', () => {
    expect(abilityIndexSignature({ known: [{ id: 'a', rank: 1 }] })).toBe('a#1');
    expect(abilityIndexSignature({ known: [{ id: 'a', rank: 2 }] })).not.toBe('a#1');
    expect(abilityIndexSignature({ known: [{ id: 'a', rank: 1, cooldown: 3 }] })).toBe('a#1');
  });

  it('reads an empty book as an empty signature', () => {
    expect(abilityIndexSignature(emptyAbilities())).toBe('');
    expect(abilityIndexSignature(null)).toBe('');
  });
});
