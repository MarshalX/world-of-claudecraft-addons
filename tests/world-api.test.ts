import { describe, expect, it, vi } from 'vitest';

import { createWorld, type WorldApi } from '../loader/src/runtime/api/world.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createWorldHub, type WorldHub } from '../loader/src/runtime/world/hub.ts';
import { at, PLAYER_ENTITY, setAt } from './fakes/frames.ts';

const NO_WORLD_MEMBER = /no world member/;
const UNKNOWN_KEY = /unknown key/;
const NAMES_PLAYER = /player/;

interface Harness {
  world: WorldApi;
  hub: WorldHub;
  bag: DisposalBag;
  enterWorld: () => void;
  live: Record<string, unknown>;
  frame: () => void;
}

function harness(game: Record<string, unknown> | null = null): Harness {
  const live: Record<string, unknown> = {
    player: { ...PLAYER_ENTITY },
    entities: new Map<number, unknown>([[661, { ...PLAYER_ENTITY }]]),
    partyInfo: null,
    inventory: [{ itemId: 'ore', count: 2 }],
    questLog: new Map(),
    questsDone: new Set<string>(),
  };
  let enter: (hook: unknown) => void = () => undefined;
  const pending = new Promise<unknown>((resolve) => {
    enter = resolve;
  });
  const scheduled = new Map<number, () => void>();
  let next = 1;

  const hub = createWorldHub({
    game: pending,
    schedule: (fn) => {
      const id = next;
      next += 1;
      scheduled.set(id, fn);
      return id;
    },
    cancel: (id) => {
      scheduled.delete(id);
    },
    lastDamageAt: () => null,
    now: () => 0,
    zoneName: () => null,
    simNow: () => null,
  });
  const bag = new DisposalBag();

  return {
    world: createWorld(hub, bag),
    hub,
    bag,
    live,
    enterWorld: () => enter(game ?? { world: live }),
    frame: () => {
      for (const run of [...scheduled.values()]) {
        scheduled.clear();
        run();
      }
    },
  };
}

// An addon holds woc.world from its first line, which may be minutes before the
// player enters the world. Every read has to answer rather than throw.
describe('before the game exists', () => {
  it('answers null for every state read', () => {
    const { world } = harness();

    expect(world.player).toBeNull();
    expect(world.target).toBeNull();
    expect(world.party).toBeNull();
    expect(world.inventory).toBeNull();
    expect(world.quests).toBeNull();
    expect(world.cooldowns).toBeNull();
    expect(world.auras).toBeNull();
    expect(world.targetAuras).toBeNull();
    expect(world.hazards).toBeNull();
    expect(world.markers).toBeNull();
    expect(world.raw).toBeNull();
    expect(world.game).toBeNull();
  });

  it('answers an empty roster rather than null, so iteration still works', () => {
    const { world } = harness();

    expect(world.entities.size).toBe(0);
    expect([...world.entities]).toEqual([]);
  });

  // Same reasoning as the roster: an addon that loops over the casts it can see
  // must not have to guard the read before world entry.
  it('answers an empty cast map rather than null', () => {
    const { world } = harness();

    expect(world.casts.size).toBe(0);
    expect([...world.casts]).toEqual([]);
  });

  // Found by running the dev-harness addon through the real loader. The empty
  // roster used to be a bare Map, so before world entry the published contract
  // ("set, delete, and clear throw") did not hold, and the surface changed shape
  // under an addon the moment the game arrived.
  it('refuses a write to the empty roster, exactly as the live one does', () => {
    const { world } = harness();
    const entities = world.entities as Map<number, unknown>;

    expect(() => entities.set(1, {})).toThrow(TypeError);
    expect(() => entities.delete(1)).toThrow(TypeError);
    expect(() => entities.clear()).toThrow(TypeError);
  });

  // The worse half of the same defect: the fallback was one module-level Map
  // shared by every addon, so a write from one before world entry would have
  // been visible to all of them.
  it('does not hand every addon the same roster object', () => {
    const first = harness().world.entities;
    const second = harness().world.entities;

    expect(Object.is(first, second)).toBe(false);
  });

  it('accepts a subscription that fires once the world arrives', async () => {
    const h = harness();
    const seen = vi.fn();
    h.world.on('player', seen);

    h.enterWorld();
    await h.world.ready;
    h.frame();

    expect(seen).toHaveBeenCalledOnce();
  });
});

describe('once the game exists', () => {
  it('reads through to the live world', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    expect(h.world.player).toMatchObject({ name: 'Marshal' });
    expect(h.world.entities.size).toBe(1);
    expect(h.world.inventory).toHaveLength(1);
  });

  it('exposes the real IWorld and the real hook as the escape hatches', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    expect(h.world.raw).toBe(h.live);
    expect(at(h.world.game, 'world')).toBe(h.live);
  });

  it('reads live rather than caching', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    setAt(at(h.live, 'player'), 'hp', 3);

    expect(at(h.world.player, 'hp')).toBe(3);
  });

  it('splits quests into the log and the finished set', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    expect(h.world.quests).toMatchObject({
      log: at(h.live, 'questLog'),
      done: at(h.live, 'questsDone'),
    });
  });

  // The reason this surface exists: no event announces a mob's cast, so a boss
  // mod can only see one by reading it off the roster.
  it('derives casts from the live roster', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    setAt(h.live, 'entities', new Map([[248, { castingAbility: 'soul_rend', castTotal: 3 }]]));

    expect(h.world.casts.get(248)).toMatchObject({ ability: 'soul_rend', total: 3 });
  });

  // `world.on('target')` reports the SELECTION changing and nothing else, so
  // without this read a debuff on a boss is unreachable.
  it('reads the auras off whatever is targeted', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    setAt(at(h.live, 'player'), 'targetId', 248);
    setAt(h.live, 'entities', new Map([[248, { id: 248, auras: [{ id: 'sunder' }] }]]));

    expect(h.world.targetAuras).toEqual([{ id: 'sunder' }]);
  });

  it('answers null for target auras with nothing targeted', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    expect(h.world.targetAuras).toBeNull();
  });

  it('reads hazards and markers off the world', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    setAt(h.live, 'activeFrostRings', [{ id: 'r1', x: 0, z: 0, radius: 8, remaining: 4 }]);
    setAt(h.live, 'activeTemporalHourglasses', []);
    setAt(h.live, 'markers', Object.fromEntries([[248, 1]]));

    expect(h.world.hazards).toHaveLength(1);
    expect(h.world.markers?.get(248)).toBe(1);
  });
});

describe('world.ready', () => {
  it('resolves once the backend is live', async () => {
    const h = harness();
    h.enterWorld();

    await expect(h.world.ready).resolves.toBeUndefined();
  });

  // A hook with no world member cannot back the API, and saying so is better
  // than answering null forever and looking like an empty world.
  it('rejects when __game carries no world', async () => {
    const h = harness({ renderer: {} });
    h.enterWorld();

    await expect(h.world.ready).rejects.toThrow(NO_WORLD_MEMBER);
  });

  it('is the same promise however often it is read', () => {
    const { world } = harness();

    expect(world.ready).toBe(world.ready);
  });
});

describe('world.on', () => {
  // The key is typed now, so an author compiling against @woc-addons/types is
  // told at their desk. The runtime check is still the one that matters:
  // addons are plain JavaScript evaluated as a function body, with no build
  // step, so nothing else stands between a typo and a subscription that would
  // silently never fire. The cast is how the test reaches that path.
  const unknownKey = 'healthbar' as 'player';

  it('rejects a key it does not know, naming the ones it does', () => {
    const { world } = harness();

    expect(() => world.on(unknownKey, vi.fn())).toThrow(UNKNOWN_KEY);
    expect(() => world.on(unknownKey, vi.fn())).toThrow(NAMES_PLAYER);
  });

  it('registers in the disposal bag', () => {
    const h = harness();
    h.world.on('player', vi.fn());

    expect(h.bag.size).toBe(1);
  });

  it('releases every subscription when the addon is disabled', async () => {
    const h = harness();
    const seen = vi.fn();
    h.world.on('player', seen);
    h.enterWorld();
    await h.world.ready;

    h.bag.dispose();
    setAt(at(h.live, 'player'), 'hp', 3);
    h.hub.watcher.poll();

    expect(seen).not.toHaveBeenCalled();
  });

  it('does not leave a dead bag entry when the addon unsubscribes itself', () => {
    const h = harness();
    const off = h.world.on('player', vi.fn());

    off();

    expect(h.bag.size).toBe(0);
  });

  it('shares one watcher across addons', async () => {
    const h = harness();
    const second = new DisposalBag();
    const a = vi.fn();
    const b = vi.fn();
    h.world.on('player', a);
    createWorld(h.hub, second).on('player', b);
    h.enterWorld();
    await h.world.ready;

    setAt(at(h.live, 'player'), 'hp', 3);
    h.hub.watcher.poll();

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});

describe('hub.dispose', () => {
  it('stops the watcher', async () => {
    const h = harness();
    const seen = vi.fn();
    h.world.on('player', seen);
    h.enterWorld();
    await h.world.ready;

    h.hub.dispose();
    setAt(at(h.live, 'player'), 'hp', 3);
    h.hub.watcher.poll();

    expect(seen).not.toHaveBeenCalled();
  });
});
