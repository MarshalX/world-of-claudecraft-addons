// The character sheet projections.
//
// These read a game object the loader cannot compile against, so what is worth
// testing is the DEFENSIVE half: what each reader does when the game hands over
// nothing, something of the wrong kind, or a method that throws. A projection
// that passes on a complete fixture and dies on a partial one is the failure
// mode here, because the partial one is what a client looks like at login.

import { describe, expect, it } from 'vitest';
import type {
  CharacterInfo,
  ProfessionInfo,
  TalentInfo,
} from '../loader/src/runtime/world/character.ts';
import {
  readCharacter,
  readProfessions,
  readTalents,
} from '../loader/src/runtime/world/character.ts';

/**
 * A computed read, which is how a constant key into a Record is written here.
 *
 * Biome wants `counters.kills` and TypeScript forbids dotting into an index
 * signature; a helper satisfies both by having no literal key at the call site.
 * See STYLE.md.
 */
function counter(counters: Readonly<Record<string, number>>, key: string): number | undefined {
  return counters[key];
}

/** The projections answer null only before there is a world, which no case here is. */
function sheetOf(world: unknown): CharacterInfo {
  const sheet = readCharacter(world);
  if (sheet === null) {
    throw new Error('expected a character sheet');
  }
  return sheet;
}

function talentsOf(world: unknown): TalentInfo {
  const talents = readTalents(world);
  if (talents === null) {
    throw new Error('expected a talent reading');
  }
  return talents;
}

function professionsOf(world: unknown): ProfessionInfo {
  const professions = readProfessions(world);
  if (professions === null) {
    throw new Error('expected a professions reading');
  }
  return professions;
}

const SHEET = {
  xp: 1200,
  lifetimeXp: 98_000,
  restedXp: 350,
  prestigeRank: 1,
  honor: 40,
  lifetimeHonor: 900,
  renown: 12,
  activeTitle: 'prog_first_harvest',
  unlockedMilestones: ['m1', 'm2'],
  deedsEarned: new Map([['prog_first_harvest', '2026-08-01']]),
  deedStats: {
    counters: { kills: 7, deaths: 1 },
    itemsDiscovered: new Set(['sunpetal_herb']),
    visited: new Set(['fish:zone1']),
    dungeonClears: { thornpeak: 2, 'thornpeak:heroic': 1 },
  },
};

describe('readCharacter', () => {
  it('projects the sheet the game carries', () => {
    const sheet = sheetOf(SHEET);

    expect(sheet.xp).toBe(1200);
    expect(sheet.restedXp).toBe(350);
    expect(sheet.activeTitle).toBe('prog_first_harvest');
    expect(sheet.deeds.get('prog_first_harvest')).toBe('2026-08-01');
    expect(counter(sheet.deedStats.counters, 'kills')).toBe(7);
    expect(sheet.deedStats.visited.has('fish:zone1')).toBe(true);
    expect(counter(sheet.deedStats.dungeonClears, 'thornpeak:heroic')).toBe(1);
  });

  // What a client looks like before the first heavy self payload lands. Every
  // one of these fields is absent then, and an addon reading the sheet on its
  // first line must not get an exception for it.
  it('answers zeroes and empties for a world carrying none of it', () => {
    const sheet = sheetOf({});

    expect(sheet.xp).toBe(0);
    expect(sheet.activeTitle).toBeNull();
    expect(sheet.milestones).toEqual([]);
    expect(sheet.deeds.size).toBe(0);
    expect(sheet.deedStats.counters).toEqual({});
    expect(sheet.deedStats.itemsDiscovered.size).toBe(0);
  });

  it('answers null before there is a world at all', () => {
    expect(readCharacter(null)).toBeNull();
  });

  // The sets survive the wire as real Sets because the client rebuilds them, and
  // a game that ever handed over the raw arrays instead must not become a Set of
  // one array.
  it('does not mistake an array for a set', () => {
    const sheet = sheetOf({ deedStats: { itemsDiscovered: ['a', 'b'] } });

    expect(sheet.deedStats.itemsDiscovered.size).toBe(0);
  });
});

describe('readTalents', () => {
  const Talents = {
    talentSpec: 'marksmanship',
    talentRole: 'dps',
    talents: { spec: 'marksmanship', rows: { 5: 'steady_aim', 8: 'quickdraw' } },
    activeLoadout: 1,
    loadouts: [
      { name: 'pve', alloc: { spec: 'marksmanship', rows: { 5: 'steady_aim' } }, bar: ['a', null] },
    ],
  };

  it('projects the build, the loadouts and the points', () => {
    const talents = talentsOf(Talents);

    expect(talents.spec).toBe('marksmanship');
    expect(talents.role).toBe('dps');
    expect(talents.rows[5]).toBe('steady_aim');
    expect(talents.loadouts[0]?.bar).toEqual(['a', null]);
  });

  it('does not call anything on the game object', () => {
    const talents = talentsOf({
      ...Talents,
      talentPoints: () => {
        throw new Error('a read that called this would take the addon down');
      },
    });

    expect(talents.spec).toBe('marksmanship');
    expect(talents.rows[5]).toBe('steady_aim');
  });

  it('reports no active loadout as -1 rather than as index zero', () => {
    expect(talentsOf({}).activeLoadout).toBe(-1);
  });
});

describe('readProfessions', () => {
  it('projects both counter maps', () => {
    const skills = professionsOf({
      craftSkills: { blacksmithing: 30 },
      gatheringProficiency: { mining: 12 },
    });

    expect(counter(skills.craftSkills, 'blacksmithing')).toBe(30);
    expect(counter(skills.gathering, 'mining')).toBe(12);
  });

  it('answers empty maps rather than undefined before either exists', () => {
    expect(readProfessions({})).toEqual({ craftSkills: {}, gathering: {} });
  });
});
