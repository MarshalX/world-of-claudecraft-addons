// The SIGN is the risk: a negated bearing draws a plausible arrow pointing at the
// wrong half of the world, so the cardinals are written out rather than derived.
//
// With `facing` at 0 the player looks along +z and their RIGHT hand is -x, since z
// cross y is -x. So a point at +x is on the LEFT and its bearing is negative.

import { describe, expect, it } from 'vitest';

import { createWorld, type WorldApi } from '../loader/src/runtime/api/world.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createWorldHub } from '../loader/src/runtime/world/hub.ts';
import { compass } from '../loader/src/shared/fmt.ts';
import { PLAYER_ENTITY, at as read, setAt } from './fakes/frames.ts';

/** Looking along +z, high above a point at y 0. */
const FACING_FORWARD = 0;
const QUARTER_TURN_LEFT = Math.PI / 2;
const PLAYER_HEIGHT = 100;

interface Harness {
  world: WorldApi;
  live: Record<string, unknown>;
  enter: () => Promise<void>;
}

function harness(): Harness {
  const live: Record<string, unknown> = {
    player: {
      ...PLAYER_ENTITY,
      pos: { x: 0, y: PLAYER_HEIGHT, z: 0 },
      facing: FACING_FORWARD,
    },
    entities: new Map<number, unknown>(),
    partyInfo: null,
    inventory: null,
    questLog: new Map(),
    questsDone: new Set<string>(),
  };
  let arrive: (hook: unknown) => void = () => undefined;
  const game = new Promise<unknown>((resolve) => {
    arrive = resolve;
  });
  const hub = createWorldHub({
    game,
    schedule: () => 1,
    cancel: () => undefined,
    lastDamageAt: () => null,
    now: () => 0,
    zoneName: () => null,
    simNow: () => null,
    realm: () => null,
  });
  const world = createWorld(hub, new DisposalBag());

  return {
    world,
    live,
    enter: async () => {
      arrive({ world: live });
      await hub.ready;
    },
  };
}

/** Turn on the spot, which is all a bearing is measured against. */
function face(live: Record<string, unknown>, radians: number): void {
  setAt(read(live, 'player'), 'facing', radians);
}

describe('distanceTo', () => {
  it('is null before the world is up, which is where an addon first line runs', () => {
    expect(harness().world.distanceTo({ x: 3, z: 4 })).toBeNull();
  });

  it('is null with a world and no player', async () => {
    const h = harness();
    await h.enter();
    setAt(h.live, 'player', null);

    expect(h.world.distanceTo({ x: 3, z: 4 })).toBeNull();
  });

  it('measures the flat distance from the player', async () => {
    const h = harness();
    await h.enter();

    expect(h.world.distanceTo({ x: 3, z: 4 })).toBe(5);
    expect(h.world.distanceTo({ x: 0, z: 0 })).toBe(0);
    expect(h.world.distanceTo({ x: -3, z: -4 })).toBe(5);
  });

  // The distance you would WALK: a node on a ledge overhead is not further away
  // for being overhead, and the game's own harvest gate measures the same axes.
  it('ignores height on both ends', async () => {
    const h = harness();
    await h.enter();
    const overhead = { x: 3, y: 900, z: 4 };

    expect(h.world.distanceTo(overhead)).toBe(5);

    setAt(read(h.live, 'player'), 'pos', { x: 0, y: -900, z: 0 });

    expect(h.world.distanceTo(overhead)).toBe(5);
    expect(h.world.distanceTo({ x: 3, z: 4 })).toBe(5);
  });
});

describe('bearingTo', () => {
  it('is null before the world is up, and null with no player', async () => {
    const before = harness();

    expect(before.world.bearingTo({ x: 0, z: 10 })).toBeNull();

    const h = harness();
    await h.enter();
    setAt(h.live, 'player', null);

    expect(h.world.bearingTo({ x: 0, z: 10 })).toBeNull();
  });

  // A real state rather than a defensive guard: an unplaced entity carries one.
  it('is null for a facing that is not a finite number', async () => {
    const h = harness();
    await h.enter();

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      face(h.live, bad);

      expect(h.world.bearingTo({ x: 0, z: 10 })).toBeNull();
    }
  });

  it('is 0 straight ahead', async () => {
    const h = harness();
    await h.enter();

    expect(h.world.bearingTo({ x: 0, z: 10 })).toBe(0);
  });

  // +x is the player's LEFT at facing 0, which an inverted sign would make look right.
  it('turns clockwise positive and counter-clockwise negative', async () => {
    const h = harness();
    await h.enter();

    expect(h.world.bearingTo({ x: 0, z: 10 })).toBe(0);
    expect(h.world.bearingTo({ x: -10, z: 0 })).toBe(90);
    expect(h.world.bearingTo({ x: 0, z: -10 })).toBe(-180);
    expect(h.world.bearingTo({ x: 10, z: 0 })).toBe(-90);
  });

  it('reports straight behind as -180 rather than 180', async () => {
    const h = harness();
    await h.enter();

    expect(h.world.bearingTo({ x: 0, z: -10 })).toBe(-180);
    expect(Object.is(h.world.bearingTo({ x: 0, z: -10 }), -180)).toBe(true);
  });

  it('is measured against the player facing rather than the world', async () => {
    const h = harness();
    await h.enter();
    face(h.live, QUARTER_TURN_LEFT);

    // Turning left by a quarter puts +x straight ahead and +z on the right.
    expect(h.world.bearingTo({ x: 10, z: 0 })).toBe(0);
    expect(h.world.bearingTo({ x: 0, z: 10 })).toBe(90);
  });

  it('stays in [-180, 180) however far the player has turned', async () => {
    const h = harness();
    await h.enter();
    const spun = [-4, -1, 1, 4];

    for (const turns of spun) {
      face(h.live, turns * Math.PI * 2);
      const bearing = h.world.bearingTo({ x: -10, z: 0 }) as number;

      expect(bearing).toBeGreaterThanOrEqual(-180);
      expect(bearing).toBeLessThan(180);
      expect(bearing).toBeCloseTo(90, 10);
    }
  });
});

// What an addon writes on the next line, against the arrow tables two addons ship.
describe('composed with fmt.compass', () => {
  /** The glyph the two arrow addons draw, from their own arithmetic. */
  const Arrows = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
  const SectorRadians = (Math.PI * 2) / Arrows.length;
  const FullTurn = 360;
  const HalfTurn = 180;
  /** Half a degree at a time, so the sweep lands on the seams rather than around them. */
  const Steps = 720;
  const Range = 37;
  const Facings = [0, 0.4, 1.7, -2.9, Math.PI, -0.75];
  /** How close to an exact half counts as sitting on the seam. */
  const Tie = 1e-9;
  /** How many swept directions land on one, which the sweep checks it met. */
  const Seams = 16;

  function shippedArrow(
    me: { pos: { x: number; z: number }; facing: number },
    at: { x: number; z: number },
  ): string {
    const toward = Math.atan2(at.x - me.pos.x, at.z - me.pos.z);
    const sector = Math.round((toward - me.facing) / SectorRadians);
    return Arrows[((sector % Arrows.length) + Arrows.length) % Arrows.length] as string;
  }

  /** The same table off the same quantity in DEGREES, which isolates the tie. */
  function shippedArrowFromDegrees(relative: number): string {
    const sector = Math.round(relative / (FullTurn / Arrows.length));
    return Arrows[((sector % Arrows.length) + Arrows.length) % Arrows.length] as string;
  }

  /** How far the raw sector reading sits from a seam. */
  function offSeam(
    me: { pos: { x: number; z: number }; facing: number },
    at: { x: number; z: number },
  ): number {
    const raw = (Math.atan2(at.x - me.pos.x, at.z - me.pos.z) - me.facing) / SectorRadians;
    return Math.abs(Math.abs(raw - Math.trunc(raw)) - 0.5);
  }

  function arrow(world: WorldApi, at: { x: number; z: number }): string {
    const turn = world.bearingTo(at);
    if (turn === null) {
      return '';
    }
    return compass(turn);
  }

  /** A full turn, landing ON all eight seams as well as between them. */
  function sweep(): { x: number; z: number }[] {
    const points: { x: number; z: number }[] = [];
    for (let step = 0; step < Steps; step += 1) {
      const angle = (step * (FullTurn / Steps) * Math.PI) / HalfTurn;
      points.push({ x: Math.sin(angle) * Range, z: Math.cos(angle) * Range });
    }
    return points;
  }

  it('draws the glyph for each cardinal direction', async () => {
    const h = harness();
    await h.enter();

    expect(arrow(h.world, { x: 0, z: 10 })).toBe('↑');
    expect(arrow(h.world, { x: -10, z: 0 })).toBe('→');
    expect(arrow(h.world, { x: 0, z: -10 })).toBe('↓');
    expect(arrow(h.world, { x: 10, z: 0 })).toBe('←');
  });

  // Half-degree steps because a table written the other way round agrees at every
  // sector CENTRE and disagrees at the seams: `Math.round` breaks a tie toward
  // +infinity, so negating before rounding sends a tie the other way.
  //
  // BOTH shipped forms are compared. The arrow addons divide radians by a radian
  // sector and this pair divides degrees by 45, so the radian one alone cannot tell
  // a wrong convention from a unit conversion landing the other side of an ulp.
  it('agrees with the shipped arrow arithmetic at half-degree steps, seams included', async () => {
    const h = harness();
    await h.enter();
    let seams = 0;

    for (const facing of Facings) {
      face(h.live, facing);
      const me = { pos: { x: 0, z: 0 }, facing };

      for (const point of sweep()) {
        const toward = Math.atan2(point.x - me.pos.x, point.z - me.pos.z);
        const relative = ((toward - facing) * HalfTurn) / Math.PI;
        if (offSeam(me, point) < Tie) {
          seams += 1;
        }

        expect(arrow(h.world, point)).toBe(shippedArrow(me, point));
        expect(arrow(h.world, point)).toBe(shippedArrowFromDegrees(relative));
      }
    }

    // A sweep that stopped hitting the seams would pass every assertion above.
    expect(seams).toBe(Seams);
  });

  it('draws nothing rather than an arrow when the facing cannot be read', async () => {
    const h = harness();
    await h.enter();
    face(h.live, Number.NaN);

    expect(arrow(h.world, { x: 0, z: 10 })).toBe('');
  });
});
