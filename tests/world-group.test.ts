// The group, encounter and threat readings. A roll deadline is on the sim clock, which
// no addon has, so it is published as seconds remaining, or null with no clock yet.

import { describe, expect, it } from 'vitest';
import { readEncounter } from '../loader/src/runtime/world/encounter.ts';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import { readGroup } from '../loader/src/runtime/world/group.ts';
import { remainingFrom } from '../loader/src/runtime/world/sim-clock.ts';
import { readThreat } from '../loader/src/runtime/world/threat.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';

const ME = 1;
const TANK = 2;
const MOB = 3;
const DELVE = 'drowned_reliquary';

function mobWith(threat: [number, number][], dead = false): Entity {
  return {
    ...(PLAYER_ENTITY as unknown as Entity),
    id: MOB,
    kind: 'mob',
    dead,
    threat: new Map(threat),
  };
}

describe('readGroup', () => {
  const World = {
    lootRollPrompts: [
      {
        rollId: 7,
        itemId: 'redbrook_blade',
        itemName: 'Redbrook Blade',
        quality: 'rare',
        expiresAt: 130,
      },
    ],
    partyInfo: { master: { enabled: true, looter: 0, threshold: 'rare' } },
    selfLockouts: { thornpeak: 1_785_600_000_000 },
  };

  it('turns a sim deadline into seconds remaining', () => {
    expect(readGroup(World, 100)?.rolls[0]?.remaining).toBe(30);
  });

  it('answers null for a deadline with no clock', () => {
    expect(readGroup(World, null)?.rolls[0]?.remaining).toBeNull();
  });

  // A lapsed roll stays on the list for a moment.
  it('clamps a lapsed deadline at zero', () => {
    expect(readGroup(World, 999)?.rolls[0]?.remaining).toBe(0);
  });

  it('carries the item name a roll arrives with', () => {
    expect(readGroup(World, 100)?.rolls[0]?.itemName).toBe('Redbrook Blade');
  });

  it('reports lockouts as the absolute stamps they are sent as', () => {
    expect(readGroup(World, 100)?.lockouts.get('thornpeak')).toBe(1_785_600_000_000);
  });

  it('answers null for master loot that is off', () => {
    const off = { partyInfo: { master: { enabled: false, looter: 4, threshold: 'rare' } } };

    expect(readGroup(off, 100)?.masterLoot).toBeNull();
    expect(readGroup(World, 100)?.masterLoot?.looter).toBe(0);
  });

  it('answers empties for a world carrying none of it', () => {
    const group = readGroup({}, 100);

    expect(group?.rolls).toEqual([]);
    expect(group?.lockouts.size).toBe(0);
    expect(group?.masterLoot).toBeNull();
  });
});

describe('remainingFrom', () => {
  it('is null when either half is missing', () => {
    expect(remainingFrom(null, 10)).toBeNull();
    expect(remainingFrom(10, null)).toBeNull();
  });
});

describe('readEncounter', () => {
  it('projects the thin half of a run', () => {
    const run = readEncounter({
      delveRun: {
        delveId: DELVE,
        tierId: 'hard',
        moduleIndex: 2,
        moduleCount: 5,
        completed: false,
        exitPortalOpen: false,
        bountiful: true,
        rite: { some: 'shape we do not publish' },
      },
      // Built, since a literal snake_case key trips useNamingConvention.
      delveClears: Object.fromEntries([[DELVE, 3]]),
    });

    expect(run?.run?.delveId).toBe(DELVE);
    expect(run?.run?.moduleIndex).toBe(2);
    expect(run?.run?.bountiful).toBe(true);
    expect(run?.clears.get(DELVE)).toBe(3);
  });

  it('answers a null run out in the world', () => {
    expect(readEncounter({ delveClears: {} })?.run).toBeNull();
  });
});

describe('readThreat', () => {
  it('sorts the table and measures the player against the top', () => {
    const table = readThreat(
      mobWith([
        [ME, 500],
        [TANK, 1000],
      ]),
      ME,
    );

    expect(table.rows.map((row) => row.entityId)).toEqual([TANK, ME]);
    expect(table.top).toBe(1000);
    expect(table.mine).toBe(500);
    expect(table.share).toBe(0.5);
  });

  it('reports a share of 1 for the entity holding the table', () => {
    expect(readThreat(mobWith([[ME, 900]]), ME).share).toBe(1);
  });

  // Off the table differs from last on it.
  it('answers null for a player who is not on the table at all', () => {
    const table = readThreat(mobWith([[TANK, 1000]]), ME);

    expect(table.mine).toBeNull();
    expect(table.share).toBeNull();
    expect(table.top).toBe(1000);
  });

  it('answers an empty reading for a mob that is not fighting', () => {
    expect(readThreat(mobWith([]), ME).rows).toEqual([]);
    expect(readThreat(null, ME).rows).toEqual([]);
  });

  // Only the comparison needs the player, so rows come back before world entry.
  it('reports the rows with no player id, and no comparison', () => {
    const table = readThreat(mobWith([[TANK, 1000]]), null);

    expect(table.rows).toHaveLength(1);
    expect(table.mine).toBeNull();
  });
});
