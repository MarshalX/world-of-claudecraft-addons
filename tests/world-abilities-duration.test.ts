// The effect union does not name its duration uniformly (`lockout`, combo terms), and the figure
// is a diminishing-returns denominator, so an ability with two answers gives none.

import { describe, expect, it } from 'vitest';
import { createAbilityReader } from '../loader/src/runtime/world/abilities.ts';

/** One entry in the shape `world.known` carries: a content `def` plus resolved values. */
function known(id: string, effects: unknown[], rank = 1): unknown {
  return {
    def: { id, name: id, school: 'shadow', effects: [{ type: 'damage', amount: 10 }] },
    rank,
    cost: 30,
    castTime: 0,
    cooldown: 6,
    effects,
  };
}

function read(entries: unknown[]): ReturnType<ReturnType<typeof createAbilityReader>> {
  return createAbilityReader()({ known: entries });
}

describe('auraDuration', () => {
  it('publishes the duration of the effect an ability applies', () => {
    const index = read([known('corruption', [{ type: 'applyDebuff', kind: 'dot', duration: 18 }])]);

    expect(index.byId('corruption')?.auraDuration).toBe(18);
  });

  it('reads an interrupt from lockout', () => {
    const index = read([known('kick', [{ type: 'interrupt', lockout: 4 }])]);

    expect(index.byId('kick')?.auraDuration).toBe(4);
  });

  // Do not change this to a max: a stun ladder would silently get the slow's length.
  it('publishes nothing for an ability applying two effects of different lengths', () => {
    const index = read([
      known('concussive', [
        { type: 'stun', duration: 3 },
        { type: 'applyDebuff', kind: 'slow', duration: 8 },
      ]),
    ]);

    expect(index.byId('concussive')?.auraDuration).toBeUndefined();
  });

  // A finisher is `base + perCombo * spent`, so the base alone is right at one combo count.
  it('publishes nothing for a combo finisher', () => {
    const index = read([known('kidney', [{ type: 'finisherStun', base: 1, perCombo: 1 }])]);

    expect(index.byId('kidney')?.auraDuration).toBeUndefined();
  });

  // Absent and zero are different answers, so the key is missing, not a falsy number.
  it('has no key at all for an ability that applies no timed effect', () => {
    const index = read([known('shot', [{ type: 'damage', amount: 40 }])]);
    const info = index.byId('shot');

    expect(info).not.toBeNull();
    expect(info === null || 'auraDuration' in info).toBe(false);
  });

  // The top-level array is the learned rank's; `def.effects` is the content default.
  it('reads the resolved array, not the content table default', () => {
    const entry = known('rejuv', [{ type: 'applyDebuff', duration: 21 }], 3);

    expect(read([entry]).byId('rejuv')?.auraDuration).toBe(21);
  });

  // The game zero-fills fields it does not send.
  it('ignores a non-positive duration', () => {
    const index = read([known('mark', [{ type: 'applyDebuff', duration: 0 }])]);

    expect(index.byId('mark')?.auraDuration).toBeUndefined();
  });

  // The index is memoized over ids and ranks, so a rank change must rebuild the entry.
  it('rebuilds when the spellbook changes rank', () => {
    const reader = createAbilityReader();
    const at = (rank: number, duration: number): unknown => ({
      known: [known('poly', [{ type: 'polymorph', duration }], rank)],
    });

    expect(reader(at(1, 10)).byId('poly')?.auraDuration).toBe(10);
    expect(reader(at(2, 15)).byId('poly')?.auraDuration).toBe(15);
  });
});
