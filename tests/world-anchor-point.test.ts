// A unit's world point, at its feet or over its head. The head arithmetic must match the game's,
// and a hostile shape must answer null: a NaN in a style property is dropped silently.

import { describe, expect, it } from 'vitest';
import type { UnitPoint } from '../loader/src/runtime/world/anchor-point.ts';
import {
  createUnitPoints,
  HEAD_CLEARANCE_YARDS,
} from '../loader/src/runtime/world/anchor-point.ts';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import type { UnitContext } from '../loader/src/runtime/world/units.ts';

/** Only the fields the resolver reads. The rest of an entity is not its business. */
function entity(id: number, at: { x: number; y: number; z: number }): Entity {
  return { id, pos: at } as unknown as Entity;
}

const PLAYER = entity(7, { x: 1, y: 10, z: 3 });

function context(over: Partial<UnitContext> = {}): UnitContext {
  return {
    player: PLAYER,
    target: null,
    entities: new Map([[PLAYER.id, PLAYER]]),
    party: null,
    ...over,
  };
}

/** A renderer whose view map holds whatever a case wants to hand the resolver. */
function game(view: unknown, id = PLAYER.id): unknown {
  return { renderer: { views: new Map([[id, view]]) } };
}

function resolve(view: unknown, at: UnitPoint) {
  return createUnitPoints({ game: () => game(view), context })(at);
}

const DRAWN = {
  height: 2,
  mountLift: 0.5,
  liveScale: 2,
  group: { visible: true, position: { x: 1, y: 10, z: 3 } },
};

describe('the head point', () => {
  // The game's overhead anchor: `y + (height + mountLift) * scale + 1`.
  it('is the game own formula', () => {
    const point = resolve(DRAWN, { unit: 'player' });

    expect(point).toEqual({ x: 1, y: 10 + (2 + 0.5) * 2 + HEAD_CLEARANCE_YARDS, z: 3 });
  });

  it('is the default', () => {
    expect(resolve(DRAWN, { unit: 'player' })).toEqual(
      resolve(DRAWN, { unit: 'player', over: 'head' }),
    );
  });

  // Past draw range the view survives but the rig stops updating, so `group.visible` gates it.
  it('falls back to the entity when the game is not drawing the rig', () => {
    const stale = { ...DRAWN, group: { visible: false, position: { x: 99, y: 99, z: 99 } } };

    expect(resolve(stale, { unit: 'player' })?.x).toBe(PLAYER.pos.x);
  });

  it('uses the scale the renderer applied, not one the wire carries', () => {
    const unscaled = { ...DRAWN, liveScale: 1 };

    expect(resolve(unscaled, { unit: 'player' })?.y).toBe(10 + 2.5 + HEAD_CLEARANCE_YARDS);
  });

  // A renderer without the fields must not hide every anchor.
  it('treats an absent lift and scale as none and one', () => {
    const plain = { height: 2, group: { visible: true, position: { x: 0, y: 0, z: 0 } } };

    expect(resolve(plain, { unit: 'player' })?.y).toBe(2 + HEAD_CLEARANCE_YARDS);
  });

  // The game's nameplate loop iterates the view map too, so an undrawn unit gets no plate.
  it('is nothing for a unit the game has no view for', () => {
    const points = createUnitPoints({ game: () => ({ renderer: { views: new Map() } }), context });

    expect(points({ unit: 'player' })).toBeNull();
  });

  it('is nothing before world entry, when there is no game at all', () => {
    const points = createUnitPoints({ game: () => null, context });

    expect(points({ unit: 'player' })).toBeNull();
  });
});

describe('the body point', () => {
  it('is the entity own position', () => {
    expect(resolve(DRAWN, { unit: 'player', over: 'body' })).toEqual({ x: 1, y: 10, z: 3 });
  });

  // The body point works at any distance, which a ground marker needs.
  it('needs no view at all', () => {
    const points = createUnitPoints({ game: () => null, context });

    expect(points({ unit: 'player', over: 'body' })).toEqual({ x: 1, y: 10, z: 3 });
  });
});

describe('which unit', () => {
  it('takes a bare entity id out of the world map', () => {
    expect(resolve(DRAWN, { unit: PLAYER.id, over: 'body' })).toEqual({ x: 1, y: 10, z: 3 });
  });

  it('is nothing for an id nothing answers to', () => {
    expect(resolve(DRAWN, { unit: 404, over: 'body' })).toBeNull();
  });

  // Resolved through the same table `world.unit` uses.
  it('is nothing for a token that resolves to nothing', () => {
    expect(resolve(DRAWN, { unit: 'target' })).toBeNull();
  });
});

describe('a shape the loader cannot read', () => {
  it.each([
    ['a view map that is not a Map', { renderer: { views: {} } }],
    ['a renderer with no views', { renderer: {} }],
    ['a game that is not an object', 'nonsense'],
  ])('answers null for %s', (_case, handle) => {
    const points = createUnitPoints({ game: () => handle, context });

    expect(points({ unit: 'player' })).toBeNull();
  });

  it('answers null when the view map throws on read', () => {
    const views = {
      get: () => {
        throw new Error('renderer moved on');
      },
    };
    Object.setPrototypeOf(views, Map.prototype);
    const points = createUnitPoints({ game: () => ({ renderer: { views } }), context });

    expect(points({ unit: 'player' })).toBeNull();
  });

  it.each([
    ['a height that is a string', { ...DRAWN, height: 'tall' }],
    ['a height that is missing', { ...DRAWN, height: undefined }],
    ['a scale that is a NaN', { ...DRAWN, liveScale: Number.NaN }],
    ['a lift that is a NaN', { ...DRAWN, mountLift: Number.NaN }],
    ['a view that is not an object', 'nonsense'],
  ])('answers null for %s', (_case, view) => {
    expect(resolve(view, { unit: 'player' })).toBeNull();
  });

  it('falls back to the entity when the rig position is unreadable', () => {
    const broken = { ...DRAWN, group: { visible: true, position: {} } };

    expect(resolve(broken, { unit: 'player' })?.x).toBe(PLAYER.pos.x);
  });

  it('answers null for an entity whose own position is unreadable', () => {
    const broken = { id: 3, pos: { x: 1, y: Number.NaN, z: 3 } } as unknown as Entity;
    const points = createUnitPoints({
      game: () => null,
      context: () => context({ player: broken }),
    });

    expect(points({ unit: 'player', over: 'body' })).toBeNull();
  });
});
