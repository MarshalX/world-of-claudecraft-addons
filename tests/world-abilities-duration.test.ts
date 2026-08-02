// The aura length a known ability applies.
//
// Separate from world-abilities.test.ts, which is about the index and its memo.
// The subject here is one field read off the resolved effect array, and the
// reason it needs its own suite is that the effect union does NOT name its
// duration field uniformly: an interrupt carries `lockout`, and two combo
// finishers carry a base plus a per-point term that has no value until the cast.
// An implementation that probed for a `duration` property would pass every case
// but the ones that matter.
//
// The figure exists to be a DENOMINATOR. A diminishing-returns ladder reads an
// observed duration as a fraction of the undiminished base, so a base that has
// already been modified is the wrong one to divide by, and an ability with two
// answers has to give none rather than the longer.

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

  // The case a `duration` probe answers nothing for, and the one an interrupt
  // tracker is built on.
  it('reads an interrupt from lockout, which is not called duration', () => {
    const index = read([known('kick', [{ type: 'interrupt', lockout: 4 }])]);

    expect(index.byId('kick')?.auraDuration).toBe(4);
  });

  // Two right answers, so the honest answer is none. Pinned so nobody improves
  // it into a max: the caller wanting a stun ladder would silently get the slow.
  it('publishes nothing for an ability applying two effects of different lengths', () => {
    const index = read([
      known('concussive', [
        { type: 'stun', duration: 3 },
        { type: 'applyDebuff', kind: 'slow', duration: 8 },
      ]),
    ]);

    expect(index.byId('concussive')?.auraDuration).toBeUndefined();
  });

  // Deliberately absent from the table rather than missing from it. A finisher is
  // `base + perCombo * spent`, so the base alone is right at one combo count.
  it('publishes nothing for a combo finisher', () => {
    const index = read([known('kidney', [{ type: 'finisherStun', base: 1, perCombo: 1 }])]);

    expect(index.byId('kidney')?.auraDuration).toBeUndefined();
  });

  // Absent and zero are different answers and the published type says so, so the
  // KEY has to be missing rather than holding a falsy number.
  it('has no key at all for an ability that applies no timed effect', () => {
    const index = read([known('shot', [{ type: 'damage', amount: 40 }])]);
    const info = index.byId('shot');

    expect(info).not.toBeNull();
    expect(info === null || 'auraDuration' in info).toBe(false);
  });

  // The rank-resolution contract. The game replaces `def.effects` with the
  // highest learned rank's before the loader sees it, so the top-level array is
  // the rank's; a fixture built from `def.effects` alone would pass by accident.
  it('reads the resolved array rather than the content table default', () => {
    const entry = known('rejuv', [{ type: 'applyDebuff', duration: 21 }], 3);

    expect(read([entry]).byId('rejuv')?.auraDuration).toBe(21);
  });

  // A zero or negative length is not a length. The game zero-fills fields it does
  // not send, which is the trap that made a shipped meter read `inCombat` forever.
  it('ignores a non-positive duration rather than publishing it', () => {
    const index = read([known('mark', [{ type: 'applyDebuff', duration: 0 }])]);

    expect(index.byId('mark')?.auraDuration).toBeUndefined();
  });

  // The index is memoized on a signature over ids and ranks, so a rank change has
  // to rebuild the entry. Without this, a talent point would leave the previous
  // rank's denominator in place for the rest of the session.
  it('rebuilds when the spellbook changes rank', () => {
    const reader = createAbilityReader();
    const at = (rank: number, duration: number): unknown => ({
      known: [known('poly', [{ type: 'polymorph', duration }], rank)],
    });

    expect(reader(at(1, 10)).byId('poly')?.auraDuration).toBe(10);
    expect(reader(at(2, 15)).byId('poly')?.auraDuration).toBe(15);
  });
});
