// Aura filtering, on an entity and on a party row.

import { describe, expect, it } from 'vitest';
import { filterAuras, filterPartyAuras } from '../loader/src/runtime/world/auras.ts';
import type { Aura } from '../loader/src/runtime/world/game-types.ts';
import type { PartyMemberAura } from '../loader/src/runtime/world/party-types.ts';

const ME = 1;
const SOMEONE_ELSE = 2;

function aura(id: string, over: Partial<Aura> = {}): Aura {
  return {
    id,
    name: id,
    kind: 'dot',
    remaining: 5,
    duration: 10,
    value: 1,
    sourceId: ME,
    school: 'physical',
    ...over,
  };
}

describe('filterAuras', () => {
  const auras = [
    aura('serpent_sting'),
    aura('serpent_sting', { sourceId: SOMEONE_ELSE }),
    aura('rally', { kind: 'buff_haste' }),
  ];

  it('keeps everything for an empty query', () => {
    expect(filterAuras(auras, {}, ME)).toHaveLength(3);
  });

  it('filters by id and by kind', () => {
    expect(filterAuras(auras, { id: 'serpent_sting' }, ME)).toHaveLength(2);
    expect(filterAuras(auras, { kind: 'buff_haste' }, ME)).toHaveLength(1);
  });

  // Two players' copies of one debuff on a target is ordinary in a group.
  it("separates your own copy of an effect from somebody else's", () => {
    const mine = filterAuras(auras, { id: 'serpent_sting', mine: true }, ME);

    expect(mine).toHaveLength(1);
    expect(mine[0]?.sourceId).toBe(ME);
  });

  it('matches nothing for mine when there is no player yet', () => {
    expect(filterAuras(auras, { mine: true }, null)).toHaveLength(0);
  });

  it('answers an empty list when the unit carries no auras', () => {
    expect(filterAuras(null, {}, ME)).toEqual([]);
  });
});

describe('filterPartyAuras', () => {
  const rows: PartyMemberAura[] = [
    { id: 'rally', kind: 'buff_haste' },
    { id: 'crippling_pursuit', kind: 'slow', neg: 1 },
  ];

  it('filters a row strip by its debuff flag in both directions', () => {
    expect(filterPartyAuras(rows, { debuff: true })).toHaveLength(1);
    expect(filterPartyAuras(rows, { debuff: false })).toHaveLength(1);
    expect(filterPartyAuras(rows, {})).toHaveLength(2);
  });

  it('answers an empty list for a row with no strip', () => {
    expect(filterPartyAuras(undefined, {})).toEqual([]);
  });
});
