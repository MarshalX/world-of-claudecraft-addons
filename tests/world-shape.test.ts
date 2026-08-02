// The check that keeps the published world types honest.
//
// `game-types.ts` describes a repository this one does not depend on and cannot
// compile against, so `tests/types-parity.test.ts` proves only that the loader
// and the published package agree with EACH OTHER. Both could be wrong about the
// game together, and nothing at compile time would notice. `shape.ts` is what
// notices, at runtime, against a live player.
//
// So these tests are about the detector, not the game: that it reports a renamed
// field, a field whose kind changed, and every problem at once rather than the
// first. A detector that quietly passed would be worse than having none, because
// the diagnostic it does not print reads as confirmation.

import { describe, expect, it } from 'vitest';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import {
  checkEntityShape,
  checkShape,
  ENTITY_SHAPE,
  type FieldSpec,
} from '../loader/src/runtime/world/shape.ts';
import { liveEntity as livePlayer } from './fakes/entity.ts';

describe('the live player against the published shape', () => {
  it('passes a player carrying every declared field', () => {
    expect(checkEntityShape(livePlayer())).toEqual([]);
  });

  // The failure this whole module exists for: the game renames something and
  // every addon reading it gets undefined, forever, with no error anywhere.
  it('reports a field the game renamed', () => {
    const player = livePlayer({ omit: ['maxHp'] });

    expect(checkEntityShape(player)).toEqual(['maxHp is missing, expected number']);
  });

  // Subtler than a rename and just as silent: `dead` becoming the 0/1 the party
  // rows already use would leave `if (e.dead)` reading true for a living player.
  it('reports a field whose kind changed', () => {
    const player = livePlayer({ set: { dead: 0 } });

    expect(checkEntityShape(player)).toEqual(['dead is number, expected boolean']);
  });

  it('reports a Map that became a plain object', () => {
    // The game's ability ids are snake_case, so the map-turned-object is built
    // rather than written out: the naming rule does not bend for test data.
    const asObject = Object.fromEntries([['aimed_shot', 4]]);
    const player = livePlayer({ set: { cooldowns: asObject } });

    expect(checkEntityShape(player)).toEqual(['cooldowns is object, expected map']);
  });

  // Drift arrives as a batch when the game reworks something, and one field per
  // session would take as many sessions as there are fields to find the rest.
  it('reports every problem rather than the first', () => {
    const player = livePlayer({ omit: ['level'], set: { name: 42, pos: { x: 1, z: 3 } } });

    expect(checkEntityShape(player)).toEqual([
      'name is number, expected string',
      'level is missing, expected number',
      'pos is object, expected vec3',
    ]);
  });

  it('says so plainly when there is no player at all', () => {
    expect(checkEntityShape(null)).toEqual(['expected an object, got null']);
  });
});

describe('what is allowed to be absent', () => {
  it('accepts an optional field the game omits', () => {
    const player = livePlayer({ omit: ['title'] });

    expect(checkEntityShape(player)).toEqual([]);
  });

  it('accepts null where the shape says the game may answer null', () => {
    const nulls = { targetId: null, castingAbility: null, resourceType: null };
    const player = livePlayer({ set: nulls });

    expect(checkEntityShape(player)).toEqual([]);
  });

  // Nullable is per field, not a blanket allowance. `hp` is a number on every
  // entity the game has ever built, so a null there is drift and not an absence.
  it('rejects null on a field the shape does not allow it on', () => {
    const player = livePlayer({ set: { hp: null } });

    expect(checkEntityShape(player)).toEqual(['hp is null, expected number']);
  });
});

describe('the shape table', () => {
  // The table is Record<keyof Entity, FieldSpec>, so this cannot drift without a
  // compile error. It is asserted anyway because the compile-time guarantee is
  // invisible in a test run, and a future edit that loosened the type would take
  // the guarantee with it silently.
  it('covers every field the published entity declares', () => {
    const declared: Record<keyof Entity, true> = {
      id: true,
      kind: true,
      templateId: true,
      name: true,
      level: true,
      guild: true,
      title: true,
      pos: true,
      prevPos: true,
      facing: true,
      prevFacing: true,
      hp: true,
      maxHp: true,
      resource: true,
      maxResource: true,
      resourceType: true,
      dead: true,
      ghost: true,
      hostile: true,
      targetId: true,
      aggroTargetId: true,
      forcedTargetId: true,
      forcedTargetTimer: true,
      threat: true,
      ownerId: true,
      castingAbility: true,
      castRemaining: true,
      castTotal: true,
      channeling: true,
      auras: true,
      lootable: true,
      loot: true,
      tappedById: true,
      harvestClaimedBy: true,
      equippedItems: true,
      equippedInstances: true,
      mainhandItemId: true,
      offhandItemId: true,
      weaponSkinId: true,
      mountKey: true,
      cooldowns: true,
      gcdRemaining: true,
      autoAttack: true,
      attackPower: true,
      spellPower: true,
      spellHaste: true,
      critChance: true,
      dodgeChance: true,
      blockChance: true,
      swingTimer: true,
      comboPoints: true,
      stats: true,
      weapon: true,
      abilityCharges: true,
    };

    expect(Object.keys(ENTITY_SHAPE).sort()).toEqual(Object.keys(declared).sort());
  });
});

// A rename inside `stats` or `weapon` is the drift a top-level 'object' check
// cannot see, and it is the likelier kind: the client builds both with a full set
// of defaults before the server sends anything, so the field is there, is an
// object, and every member an addon reads off it is quietly gone.
describe('the objects the checker walks into', () => {
  it('reports a renamed member under the field it was found in', () => {
    // Written without `armor` rather than with it undefined: an absent KEY is what
    // a rename produces, and the checker draws that distinction on purpose.
    const renamed = { str: 12, agi: 8, sta: 20, int: 5, spi: 5, pvpOffense: 0, pvpDefense: 0 };
    const player = livePlayer({ set: { stats: renamed } });

    expect(checkEntityShape(player)).toEqual(['stats.armor is missing, expected number']);
  });

  it('reports a member whose kind changed', () => {
    const player = livePlayer({ set: { weapon: { min: 1, max: 2, speed: '2.0' } } });

    expect(checkEntityShape(player)).toEqual(['weapon.speed is string, expected number']);
  });

  it('accepts the optional member the game omits on most weapons', () => {
    const player = livePlayer({ set: { weapon: { min: 1, max: 2, speed: 2 } } });

    expect(checkEntityShape(player)).toEqual([]);
  });

  // A top-level problem hides the nested pass entirely. Walking into a field the
  // game has replaced wholesale would report every member of it as missing, which
  // buries the one line that says what actually happened.
  it('says nothing about members when the field itself is the wrong kind', () => {
    const player = livePlayer({ set: { stats: [] } });

    expect(checkEntityShape(player)).toEqual(['stats is array, expected object']);
  });
});

describe('checkShape on its own', () => {
  it('walks any shape, not just the entity', () => {
    const shape: Record<string, FieldSpec> = {
      itemId: { kind: 'string' },
      count: { kind: 'number' },
    };

    expect(checkShape(shape, { itemId: 'copper_ore', count: 5 })).toEqual([]);
    expect(checkShape(shape, { itemId: 'copper_ore' })).toEqual([
      'count is missing, expected number',
    ]);
  });
});
