// Unit token resolution.
//
// The case worth the whole module is `targettarget` against a mob: the field an
// addon would reach for is present on every mob and written on none, so a
// resolver that reads it passes every test written with a player fixture and is
// blank in the game. Both kinds are asserted here for that reason.

import { describe, expect, it } from 'vitest';
import type { Entity, PartyInfo } from '../loader/src/runtime/world/game-types.ts';
import { resolveUnit, type UnitContext } from '../loader/src/runtime/world/units.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';

const ME = 1;
const BOSS = 2;
const TANK = 3;
const PET = 4;

function entity(id: number, over: Partial<Entity> = {}): Entity {
  return {
    ...(PLAYER_ENTITY as unknown as Entity),
    id,
    targetId: null,
    aggroTargetId: null,
    ownerId: null,
    threat: new Map<number, number>(),
    ...over,
  };
}

function roster(...ids: number[]): PartyInfo {
  return {
    leader: ME,
    raid: false,
    members: ids.map((pid) => ({
      pid,
      name: `p${pid}`,
      cls: 'hunter',
      level: 10,
      hp: 1,
      mhp: 1,
      res: 0,
      mres: 0,
      rtype: null,
      x: 0,
      z: 0,
      dead: 0,
      inCombat: 0,
      group: 1 as const,
    })),
  };
}

function context(entities: Entity[], over: Partial<UnitContext> = {}): UnitContext {
  const map = new Map(entities.map((one) => [one.id, one]));
  return {
    player: map.get(ME) ?? null,
    target: null,
    entities: map,
    party: null,
    ...over,
  };
}

describe('resolveUnit', () => {
  it('resolves the player and the target', () => {
    const me = entity(ME);
    const boss = entity(BOSS, { kind: 'mob' });
    const ctx = context([me, boss], { target: boss });

    expect(resolveUnit('player', ctx)).toBe(me);
    expect(resolveUnit('target', ctx)).toBe(boss);
  });

  // The trap. A mob tracks what it is fighting on aggroTargetId, and its
  // targetId is null forever, so reading the obvious field finds nothing.
  it("reads a mob target's victim from its aggro field, not from targetId", () => {
    const tank = entity(TANK);
    const boss = entity(BOSS, { kind: 'mob', aggroTargetId: TANK, targetId: null });
    const ctx = context([entity(ME), boss, tank], { target: boss });

    expect(resolveUnit('targettarget', ctx)).toBe(tank);
  });

  it("reads a player target's victim from targetId, which is where a player carries it", () => {
    const boss = entity(BOSS, { kind: 'mob' });
    const enemy = entity(TANK, { kind: 'player', targetId: BOSS });
    const ctx = context([entity(ME), enemy, boss], { target: enemy });

    expect(resolveUnit('targettarget', ctx)).toBe(boss);
  });

  it('answers null for the target of a target that is fighting nobody', () => {
    const boss = entity(BOSS, { kind: 'mob' });

    expect(resolveUnit('targettarget', context([entity(ME), boss], { target: boss }))).toBeNull();
  });

  it('finds the pet by ownership, since nothing else marks one', () => {
    const pet = entity(PET, { kind: 'mob', ownerId: ME });
    const wild = entity(BOSS, { kind: 'mob', ownerId: null });

    expect(resolveUnit('pet', context([entity(ME), wild, pet]))).toBe(pet);
    expect(resolveUnit('pet', context([entity(ME), wild]))).toBeNull();
  });

  // party counts the others and raid counts everyone, so the same member has a
  // different index under each form. Getting this backwards puts the player in
  // their own party frame.
  it('counts party tokens past yourself and raid tokens from the top', () => {
    const ctx = context([entity(ME), entity(BOSS), entity(TANK)], {
      party: roster(ME, BOSS, TANK),
    });

    expect(resolveUnit('party1', ctx)?.id).toBe(BOSS);
    expect(resolveUnit('party2', ctx)?.id).toBe(TANK);
    expect(resolveUnit('raid1', ctx)?.id).toBe(ME);
    expect(resolveUnit('raid2', ctx)?.id).toBe(BOSS);
  });

  // A row can name someone the entity map has never heard of, and that is the
  // ordinary case in a raid rather than an error.
  it('answers null for a member who is too far away to have an entity', () => {
    const ctx = context([entity(ME)], { party: roster(ME, BOSS) });

    expect(resolveUnit('party1', ctx)).toBeNull();
  });

  it('answers null for a group token with no group behind it', () => {
    expect(resolveUnit('party1', context([entity(ME)]))).toBeNull();
    expect(resolveUnit('raid1', context([entity(ME)]))).toBeNull();
  });

  it('answers null for a token that is not one, rather than throwing', () => {
    const ctx = context([entity(ME)]);

    expect(resolveUnit('party0', ctx)).toBeNull();
    expect(resolveUnit('partyone', ctx)).toBeNull();
    expect(resolveUnit('boss1', ctx)).toBeNull();
    expect(resolveUnit('', ctx)).toBeNull();
  });
});
