// A unit's world point, at its feet or over its head.
//
// The head point is a read of the RENDERER's view of a unit, which is a claim
// about a repository this one cannot compile against, so what matters here is the
// two halves of that claim. The ARITHMETIC has to be the game's own, because a
// plate half a model too low reads as a loader that cannot place things rather
// than as a formula that dropped a term. And every hostile shape has to be a null
// rather than a NaN: a NaN reaching a style property drops the declaration
// silently, so the anchor stops where it was and reads as misplaced instead of
// as failed.

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
  // The game's own overhead anchor, in three places that agree to the character:
  // `y + (height + mountLift) * scale + 1`. Pinned so a future edit cannot quietly
  // drop the mount lift or the clearance.
  it('is the game own formula', () => {
    const point = resolve(DRAWN, { unit: 'player' });

    expect(point).toEqual({ x: 1, y: 10 + (2 + 0.5) * 2 + HEAD_CLEARANCE_YARDS, z: 3 });
  });

  it('is the default, so an addon that says nothing gets a nameplate position', () => {
    expect(resolve(DRAWN, { unit: 'player' })).toEqual(
      resolve(DRAWN, { unit: 'player', over: 'head' }),
    );
  });

  // Past the draw range the rig stops being updated while the view survives, which
  // is why the game's own anchors check `group.visible` first. Without this a plate
  // hangs over the terrain a unit stood on 80 yards ago.
  it('falls back to the entity when the game is not drawing the rig', () => {
    const stale = { ...DRAWN, group: { visible: false, position: { x: 99, y: 99, z: 99 } } };

    expect(resolve(stale, { unit: 'player' })?.x).toBe(PLAYER.pos.x);
  });

  it('uses the scale the renderer applied, not one the wire carries', () => {
    const unscaled = { ...DRAWN, liveScale: 1 };

    expect(resolve(unscaled, { unit: 'player' })?.y).toBe(10 + 2.5 + HEAD_CLEARANCE_YARDS);
  });

  // An older or newer renderer without the field is a unit that is simply unlifted
  // and unscaled. Hiding every anchor over that would be a loader that goes blank.
  it('treats an absent lift and scale as none and one', () => {
    const plain = { height: 2, group: { visible: true, position: { x: 0, y: 0, z: 0 } } };

    expect(resolve(plain, { unit: 'player' })?.y).toBe(2 + HEAD_CLEARANCE_YARDS);
  });

  // The same answer the game gives: its nameplate loop iterates the view map, so a
  // unit it is not drawing gets no plate. A guessed height is the defect this
  // module exists to remove.
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

  // It is the form that keeps working at any distance, which is what a ground
  // marker under a unit needs.
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

  // Resolved through the same table `world.unit` uses, so an anchor pinned to
  // 'target' and a readout describing 'target' cannot mean different units.
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

  // The same fallback a culled rig takes: a rig position that cannot be read is a
  // rig position the loader does not have, and the entity is where the game looks
  // in that case too.
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
