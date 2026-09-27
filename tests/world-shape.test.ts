// The runtime detector for drift between the declared world types and the live game. A detector
// that quietly passes reads as confirmation, so these pin that it reports.

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

  it('reports a field the game renamed', () => {
    const player = livePlayer({ omit: ['maxHp'] });

    expect(checkEntityShape(player)).toEqual(['maxHp is missing, expected number']);
  });

  // `dead` becoming 0/1 would leave `if (e.dead)` true for a living player.
  it('reports a field whose kind changed', () => {
    const player = livePlayer({ set: { dead: 0 } });

    expect(checkEntityShape(player)).toEqual(['dead is number, expected boolean']);
  });

  it('reports a Map that became a plain object', () => {
    // Built rather than written out, so snake_case keys pass the naming rule.
    const asObject = Object.fromEntries([['aimed_shot', 4]]);
    const player = livePlayer({ set: { cooldowns: asObject } });

    expect(checkEntityShape(player)).toEqual(['cooldowns is object, expected map']);
  });

  // Drift arrives in batches.
  it('reports every problem, not only the first', () => {
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

  // Nullable is per field.
  it('rejects null on a field the shape does not allow it on', () => {
    const player = livePlayer({ set: { hp: null } });

    expect(checkEntityShape(player)).toEqual(['hp is null, expected number']);
  });
});

describe('the shape table', () => {
  // The table's type already guarantees this; the assertion survives a loosened type.
  it('covers every field the published entity declares', () => {
    const declared: Record<keyof Entity, true> = {
      id: true,
      kind: true,
      templateId: true,
      name: true,
      level: true,
      guild: true,
      pledgeGuild: true,
      guildTier: true,
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
      castTargetId: true,
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
      mountSkinId: true,
      mountKey: true,
      inCombat: true,
      helmHidden: true,
      afk: true,
      sitting: true,
      overheadEmoteId: true,
      overheadEmoteSeq: true,
      aiAccount: true,
      cheaterMark: true,
      rangedPower: true,
      cooldowns: true,
      gcdRemaining: true,
      autoAttack: true,
      attackPower: true,
      spellPower: true,
      healPower: true,
      spellHaste: true,
      critChance: true,
      dodgeChance: true,
      blockChance: true,
      swingTimer: true,
      offhandSwingTimer: true,
      comboPoints: true,
      savedMana: true,
      stats: true,
      weapon: true,
      offhandWeapon: true,
      abilityCharges: true,
    };

    expect(Object.keys(ENTITY_SHAPE).sort()).toEqual(Object.keys(declared).sort());
  });
});

// The client builds `stats` and `weapon` with defaults, so a rename inside them passes a
// top-level 'object' check.
describe('the objects the checker walks into', () => {
  it('reports a renamed member under the field it was found in', () => {
    // An absent key, not an undefined value, is what a rename produces.
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

  // A top-level problem skips the nested pass, so one line says what happened.
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
