// The game's aura classification: harmful, dispellable and toggle. A party row's `neg` is only a
// sign test on the magnitude, so a dot, a root and a stun never carry it.

import { describe, expect, it } from 'vitest';
import {
  filterAuras,
  filterPartyAuras,
  isDispellable,
  isHarmful,
  isToggle,
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

  // A hot and a dot both carry a large positive per-tick figure and are opposite effects.
  it('does not read the magnitude for a kind in the set', () => {
    expect(isHarmful(aura({ kind: 'hot', value: 400 }))).toBe(false);
    expect(isHarmful(aura({ kind: 'dot', value: 400 }))).toBe(true);
  });

  // A mob sapping attack power reuses the buff kind with a negative sign, which the kind set
  // alone calls a benefit.
  it('answers true for a buff kind whose magnitude went negative', () => {
    expect(isHarmful(aura({ kind: 'buff_ap', value: -60 }))).toBe(true);
    expect(isHarmful(aura({ kind: 'buff_ap', value: 60 }))).toBe(false);
  });

  // The generated set lags a release that adds a kind; a throw would crash addons that day.
  it('answers false for an unknown kind without throwing', () => {
    expect(isHarmful(aura({ kind: 'kind_from_a_future_release' }))).toBe(false);
  });
});

describe('isHarmful, on a party row', () => {
  // The server sets `neg` only from `value < 0`, and a dot's per-tick figure is positive.
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

  // A row carries no value, and `neg` is the server's own sign test on it.
  it('reads neg for the sign clause only', () => {
    const drain: PartyMemberAura = { id: 'wail', kind: 'buff_ap', neg: 1 };
    const gift: PartyMemberAura = { id: 'rally', kind: 'buff_ap' };

    expect(isHarmful(drain)).toBe(true);
    expect(isHarmful(gift)).toBe(false);
  });
});

describe('the debuff filter a healer addon calls', () => {
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
  // One case per clause. The game's `encounterOwned` clause has no case: the wire never
  // carries it.
  it('refuses unbreakable control, whatever else is true of it', () => {
    expect(
      isDispellable(aura({ kind: 'stun', school: 'shadow', unbreakableControl: true }), false),
    ).toBe(false);
  });

  it('refuses the physical school, which no dispel reaches', () => {
    expect(isDispellable(aura({ kind: 'bleed_vuln', school: 'physical' }), false)).toBe(false);
  });

  it('refuses an undispellable penalty', () => {
    expect(isDispellable(aura({ kind: 'dot', school: 'shadow', undispellable: true }), false)).toBe(
      false,
    );
  });

  // The game refuses a permanent aura in both directions; polarity alone would let a permanent
  // buff through offensively.
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

  // The game refuses these two ids outright; neither carries `perm`, `ub` or `und`.
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

  it('refuses by id, not by the kind it rides', () => {
    expect(isDispellable(aura({ id: 'corruption', kind: 'dot', school: 'shadow' }), false)).toBe(
      true,
    );
  });

  it('accepts a magic-school harmful effect on the friendly direction', () => {
    expect(isDispellable(aura({ kind: 'dot', school: 'shadow' }), false)).toBe(true);
  });

  // An offensive dispel strips a benefit off an enemy.
  it('inverts the polarity for an offensive dispel', () => {
    const buff = aura({ kind: 'buff_haste', school: 'arcane', value: 0.2 });

    expect(isDispellable(buff, true)).toBe(true);
    expect(isDispellable(buff, false)).toBe(false);
  });
});

// A stance or form carries a fictional 3600s duration that `remaining` counts down through, so a
// timer drawn from it is wrong without any field saying so.
describe('isToggle', () => {
  it('answers a mode by its kind, whatever the id riding it', () => {
    expect(isToggle(aura({ id: 'cat_form', kind: 'form_cat' }))).toBe(true);
    expect(isToggle(aura({ id: 'battle_stance', kind: 'battle_stance' }))).toBe(true);
  });

  // Ghost Wolf and Sprint share `buff_speed`; the game separates them by id alone.
  it('answers a mode by its id where the kind cannot say', () => {
    expect(isToggle(aura({ id: 'ghost_wolf', kind: 'buff_speed' }))).toBe(true);
    expect(isToggle(aura({ id: 'sprint', kind: 'buff_speed' }))).toBe(false);
  });

  // The timed override runs first: Greater Invisibility rides `stealth` and is a fixed 20s buff.
  it('keeps a genuine timed buff riding a toggle kind', () => {
    expect(isToggle(aura({ id: 'greater_invisibility', kind: 'stealth' }))).toBe(false);
    expect(isToggle(aura({ id: 'vanish', kind: 'stealth' }))).toBe(true);
  });

  it('answers a rotation bank the sim never ages', () => {
    expect(isToggle(aura({ id: 'moontide', kind: 'moontide' }))).toBe(true);
  });

  it('says nothing about an ordinary timed effect', () => {
    expect(isToggle(aura({ id: 'corruption', kind: 'dot' }))).toBe(false);
  });

  // Unlike isDispellable, the rule needs only an id and a kind, which a party row carries.
  it('answers a party row', () => {
    const row: PartyMemberAura = { id: 'bear_form', kind: 'form_bear', remaining: 3599 };

    expect(isToggle(row)).toBe(true);
  });
});
