import { describe, expect, it } from 'vitest';

import { createGameBackend } from '../loader/src/runtime/world/backend.ts';
import { readonlyMapView } from '../loader/src/runtime/world/readonly-map.ts';
import { at, PLAYER_ENTITY, setAt } from './fakes/frames.ts';

/** __game.world, shaped as ClientWorld exposes it. */
function gameWorld(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    world: {
      player: { ...PLAYER_ENTITY },
      entities: new Map<number, unknown>([[661, { ...PLAYER_ENTITY }]]),
      partyInfo: null,
      inventory: [{ itemId: 'ore', count: 2 }],
      questLog: new Map(),
      questsDone: new Set<string>(),
      ...over,
    },
  };
}

/** No damage clock: these cases drive the state branches, not the fallback. */
const DEPS = { lastDamageAt: () => null, now: () => 0, zoneName: () => null };

const backendOf = (game: Record<string, unknown>) => {
  const backend = createGameBackend(game, DEPS);
  if (backend === null) {
    throw new Error('expected a backend');
  }
  return backend;
};

describe('createGameBackend', () => {
  it('refuses to build without a world, rather than answering nothing', () => {
    expect(createGameBackend({ renderer: {} }, DEPS)).toBeNull();
    expect(createGameBackend(null, DEPS)).toBeNull();
  });

  it('exposes the real IWorld as raw', () => {
    const game = gameWorld();

    expect(backendOf(game).raw).toBe(at(game, 'world'));
  });

  it('reads the player', () => {
    expect(backendOf(gameWorld()).player).toMatchObject({ name: 'Marshal', maxHp: 1375 });
  });

  // The game mutates these objects in place and swaps some of them wholesale, so
  // a value captured at construction goes stale within a tick.
  it('reads live rather than capturing at construction', () => {
    const game = gameWorld();
    const backend = backendOf(game);
    const world = at(game, 'world') as Record<string, unknown>;

    setAt(at(world, 'player'), 'hp', 12);

    expect(at(backend.player, 'hp')).toBe(12);
  });

  // The client replaces questLog and questsDone on arrival rather than mutating
  // them, so anything that held the original reads a map that is never updated.
  it('follows a map the client replaced', () => {
    const game = gameWorld();
    const backend = backendOf(game);
    const world = at(game, 'world') as Record<string, unknown>;

    setAt(world, 'questLog', new Map([['q1', { questId: 'q1' }]]));

    expect((backend.quests.log as Map<string, unknown>).size).toBe(1);
  });

  describe('target', () => {
    it('resolves the player"s targetId out of the roster', () => {
      const game = gameWorld({
        player: { ...PLAYER_ENTITY, targetId: 248 },
        entities: new Map<number, unknown>([[248, { id: 248, name: 'Thornpeak Ogre' }]]),
      });

      expect(backendOf(game).target).toMatchObject({ name: 'Thornpeak Ogre' });
    });

    it('is null with no target', () => {
      expect(backendOf(gameWorld()).target).toBeNull();
    });

    // Interest scope prunes entities the player can no longer see, and the id
    // can outlive the entity by a tick.
    it('is null when the target left interest scope', () => {
      const game = gameWorld({
        player: { ...PLAYER_ENTITY, targetId: 999 },
        entities: new Map<number, unknown>(),
      });

      expect(backendOf(game).target).toBeNull();
    });
  });

  describe('cooldowns and auras', () => {
    it('reads them off the player', () => {
      const game = gameWorld({
        player: {
          ...PLAYER_ENTITY,
          cooldowns: new Map([['fireball', 3]]),
          auras: [{ id: 'renew' }],
        },
      });
      const backend = backendOf(game);

      expect((backend.cooldowns as Map<string, number>).get('fireball')).toBe(3);
      expect(backend.auras).toHaveLength(1);
    });

    it('answers null when the player has none rather than throwing', () => {
      const backend = backendOf(gameWorld());

      expect(backend.cooldowns).toBeNull();
      expect(backend.auras).toBeNull();
    });
  });

  describe('entities', () => {
    it('reads the roster', () => {
      expect(backendOf(gameWorld()).entities.size).toBe(1);
    });

    // The watcher reads this every animation frame, and an addon may read it far
    // more often, so a fresh wrapper per access would allocate for nothing.
    it('hands back the same view across reads', () => {
      const backend = backendOf(gameWorld());

      expect(backend.entities).toBe(backend.entities);
    });

    it('rebuilds the view if the game swaps the map', () => {
      const game = gameWorld();
      const backend = backendOf(game);
      const first = backend.entities;

      setAt(at(game, 'world'), 'entities', new Map([[1, {}]]));

      expect(backend.entities).not.toBe(first);
      expect(backend.entities.size).toBe(1);
    });

    it('answers an empty roster when the world has no map', () => {
      expect(backendOf(gameWorld({ entities: undefined })).entities.size).toBe(0);
    });
  });
});

describe('readonlyMapView', () => {
  const source = new Map<number, { hp: number }>([
    [1, { hp: 10 }],
    [2, { hp: 20 }],
  ]);
  const view = readonlyMapView(source);

  it('answers every read the way the source does', () => {
    expect(view.size).toBe(2);
    expect(view.get(1)).toBe(source.get(1));
    expect(view.has(2)).toBe(true);
    expect(view.has(99)).toBe(false);
    expect([...view.keys()]).toEqual([1, 2]);
    expect([...view.values()]).toHaveLength(2);
    expect([...view.entries()]).toHaveLength(2);
    expect([...view]).toHaveLength(2);
  });

  it('follows the source as the game mutates it', () => {
    const live = new Map<number, unknown>();
    const liveView = readonlyMapView(live);

    live.set(7, { id: 7 });

    expect(liveView.size).toBe(1);
    expect(liveView.get(7)).toEqual({ id: 7 });
  });

  it('iterates with forEach, reporting itself as the map', () => {
    const seen: [number, unknown][] = [];
    view.forEach((value, key, map) => {
      seen.push([key, map]);
      expect(map).toBe(view);
      expect(value).toBe(source.get(key));
    });

    expect(seen).toHaveLength(2);
  });

  // Addon code written against a map reaches for this, and a plain object that
  // answers every read but fails the check is a surprise in somebody else's code.
  it('passes instanceof Map', () => {
    expect(view).toBeInstanceOf(Map);
  });

  // One accidental clear() on the game's live roster ends the session.
  it.each([
    ['set', () => (view as Map<number, { hp: number }>).set(3, { hp: 0 })],
    ['delete', () => (view as Map<number, { hp: number }>).delete(1)],
    ['clear', () => (view as Map<number, { hp: number }>).clear()],
  ])('throws on %s rather than reaching the game state', (_label, mutate) => {
    expect(mutate).toThrow(TypeError);
    expect(source.size).toBe(2);
  });
});
