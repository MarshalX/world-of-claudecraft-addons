// Aura polarity: what is working against the unit carrying it, and what can be
// taken off.
//
// Separate from world-auras.test.ts, which is about the three query filters. The
// subject here is the game's classification rule, and it is the one place in the
// loader where a wrong answer is silent in both directions: a missed debuff is a
// row a healer never sees, and a false positive is a global cooldown spent on
// something that was never removable.
//
// The regression that motivated the whole lane is the first case below. A party
// row's `neg` flag is a SIGN test on the aura's magnitude and nothing more, so a
// dot (positive per-tick figure), a root and a stun (both 0) never carry it. The
// published comment on the field said "1 when the effect is a debuff", the row
// filter implemented `debuff` as `neg === 1` on the strength of that, and a
// shipped healer addon used that filter as its primary one. The result was a
// removable-effects strip that dropped every dot, root, silence and hex in the
// group.

import { describe, expect, it } from 'vitest';
import {
  filterAuras,
  filterPartyAuras,
  isDispellable,
  isHarmful,
} from '../loader/src/runtime/world/auras.ts';
import type { Aura } from '../loader/src/runtime/world/game-types.ts';
import type { PartyMemberAura } from '../loader/src/runtime/world/party-types.ts';

/** A full aura in the shape the game hands over, with only the fields under test set. */
function aura(fields: Partial<Aura>): Aura {
  return {
    id: 'x',
    name: 'X',
    kind: 'dot',
    remaining: 8,
    duration: 12,
    value: 40,
    sourceId: 1,
    school: 'shadow',
    ...fields,
  };
}

describe('isHarmful, on a full aura', () => {
  it('answers true for a kind the game classifies as harmful by nature', () => {
    expect(isHarmful(aura({ kind: 'dot' }))).toBe(true);
    expect(isHarmful(aura({ kind: 'root', value: 0 }))).toBe(true);
    expect(isHarmful(aura({ kind: 'silence', value: 0 }))).toBe(true);
  });

  // The magnitude is never consulted for a kind in the set, which is the mistake
  // a `value`-shaped field invites: a heal-over-time and a damage-over-time both
  // carry a large positive per-tick figure and they are opposite effects.
  it('does not read the magnitude for a kind in the set', () => {
    expect(isHarmful(aura({ kind: 'hot', value: 400 }))).toBe(false);
    expect(isHarmful(aura({ kind: 'dot', value: 400 }))).toBe(true);
  });

  // The second clause, and it is not redundant with the set. `debuff_ap` is the
  // AUTHORED drain and is in the set; a mob sapping attack power reuses the
  // ordinary buff kind and flips the sign, and a set-only implementation calls
  // that a benefit.
  it('answers true for a buff kind whose magnitude went negative', () => {
    expect(isHarmful(aura({ kind: 'buff_ap', value: -60 }))).toBe(true);
    expect(isHarmful(aura({ kind: 'buff_ap', value: 60 }))).toBe(false);
  });

  // The generated set is a release behind the day a release adds to it, and the
  // conservative direction is the published contract. A throw here would be an
  // addon crash on the day the game ships a kind.
  it('answers false for a kind from a future release rather than throwing', () => {
    expect(isHarmful(aura({ kind: 'kind_from_a_future_release' }))).toBe(false);
  });
});

describe('isHarmful, on a party row', () => {
  // THE PURELIGHT REGRESSION. No `neg`, because the server only sets it from
  // `value < 0` and a dot's per-tick figure is positive.
  it('answers true for a dot with no neg flag at all', () => {
    const row: PartyMemberAura = { id: 'corruption', kind: 'dot', remaining: 8 };

    expect(isHarmful(row)).toBe(true);
  });

  it('answers true for a root and a stun, which the server sends carrying 0', () => {
    const root: PartyMemberAura = { id: 'entangle', kind: 'root', remaining: 4 };
    const stun: PartyMemberAura = { id: 'hammer', kind: 'stun', remaining: 3 };

    expect(isHarmful(root)).toBe(true);
    expect(isHarmful(stun)).toBe(true);
  });

  // The row form of the sign clause. A row carries no value, and `neg` is the
  // server's own test on that value, so this is the same function rather than an
  // approximation of it.
  it('reads neg for the sign clause, which is the only thing neg answers', () => {
    const drain: PartyMemberAura = { id: 'wail', kind: 'buff_ap', neg: 1 };
    const gift: PartyMemberAura = { id: 'rally', kind: 'buff_ap' };

    expect(isHarmful(drain)).toBe(true);
    expect(isHarmful(gift)).toBe(false);
  });
});

describe('the debuff filter a healer addon calls', () => {
  // The end-to-end form of the same regression, at the call site a shipped addon
  // actually uses. Every row here would have been dropped before the fix.
  const rows: PartyMemberAura[] = [
    { id: 'corruption', kind: 'dot', remaining: 8 },
    { id: 'entangle', kind: 'root', remaining: 4 },
    { id: 'rally', kind: 'buff_haste', remaining: 30 },
  ];

  it('returns the effects working against the member, flag or no flag', () => {
    expect(filterPartyAuras(rows, { debuff: true }).map((row) => row.id)).toEqual([
      'corruption',
      'entangle',
    ]);
  });

  it('returns the benefits for the other direction', () => {
    expect(filterPartyAuras(rows, { debuff: false }).map((row) => row.id)).toEqual(['rally']);
  });
});

describe('the harmful clause on an entity query', () => {
  const auras: Aura[] = [
    aura({ id: 'corruption', kind: 'dot' }),
    aura({ id: 'renew', kind: 'hot', value: 90 }),
    aura({ id: 'wail', kind: 'buff_ap', value: -60 }),
  ];

  it('filters in both directions and leaves an absent clause alone', () => {
    expect(filterAuras(auras, { harmful: true }, null).map((a) => a.id)).toEqual([
      'corruption',
      'wail',
    ]);
    expect(filterAuras(auras, { harmful: false }, null).map((a) => a.id)).toEqual(['renew']);
    expect(filterAuras(auras, {}, null)).toHaveLength(3);
  });
});

describe('isDispellable', () => {
  // One case per clause, because each is the difference between a cast that does
  // something and a global cooldown thrown away. There is no case for the fifth
  // clause the GAME has, `encounterOwned`, and there cannot be: the wire does not
  // carry it, so a fixture setting it would be asserting on a field no client
  // ever sees.
  it('refuses control an encounter owns, whatever else is true of it', () => {
    expect(
      isDispellable(aura({ kind: 'stun', school: 'shadow', unbreakableControl: true }), false),
    ).toBe(false);
  });

  it('refuses the physical school, which no dispel reaches', () => {
    expect(isDispellable(aura({ kind: 'bleed_vuln', school: 'physical' }), false)).toBe(false);
  });

  // The recovery sicknesses. On the wire as `und` since well before game
  // 0.41.0 and read by nothing here until this pass, so the loader was
  // promising a dispel the game refuses.
  it('refuses an undispellable penalty', () => {
    expect(isDispellable(aura({ kind: 'dot', school: 'shadow', undispellable: true }), false)).toBe(
      false,
    );
  });

  // A permanent aura has no natural expiry and the game refuses it in BOTH
  // directions, so the offensive half has to be pinned too: polarity is the
  // clause that would otherwise let a permanent buff through.
  it('refuses a permanent aura in either direction', () => {
    const permanentBuff = aura({
      kind: 'buff_haste',
      school: 'arcane',
      value: 0.2,
      permanent: true,
    });

    expect(isDispellable(permanentBuff, true)).toBe(false);
    expect(isDispellable(permanentBuff, false)).toBe(false);
  });

  // The two ids the game refuses whatever every flag on them says: neither
  // carries `perm`, `ub` or `und`, so every flag clause answers yes to both.
  it('refuses a resource state the game only surfaces as an aura', () => {
    const ascension = aura({ id: 'divine_ascension', kind: 'buff_haste', value: 0.2 });

    expect(isDispellable(ascension, true)).toBe(false);
    expect(isDispellable(ascension, false)).toBe(false);
  });

  // Rides a mostly-buff kind and is drawn on the DEBUFF surface, so the friendly
  // direction is the one that would wrongly accept it; both are pinned.
  it('refuses a proc marker that is only displayed as a debuff', () => {
    const ready = aura({ id: 'shaman_stormsurge_ready', kind: 'internal_cd', value: 0 });

    expect(isDispellable(ready, true)).toBe(false);
    expect(isDispellable(ready, false)).toBe(false);
  });

  it('keeps refusing by id alone, rather than by the kind it happens to ride', () => {
    expect(isDispellable(aura({ id: 'corruption', kind: 'dot', school: 'shadow' }), false)).toBe(
      true,
    );
  });

  it('accepts a magic-school harmful effect on the friendly direction', () => {
    expect(isDispellable(aura({ kind: 'dot', school: 'shadow' }), false)).toBe(true);
  });

  // Dispel has a DIRECTION: offensive strips a benefit off an enemy. A predicate
  // that only implemented the friendly half is right for a healer addon and
  // wrong as a loader primitive.
  it('inverts the polarity for an offensive dispel', () => {
    const buff = aura({ kind: 'buff_haste', school: 'arcane', value: 0.2 });

    expect(isDispellable(buff, true)).toBe(true);
    expect(isDispellable(buff, false)).toBe(false);
  });
});
