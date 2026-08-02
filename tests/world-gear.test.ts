import { describe, expect, it, vi } from 'vitest';

import { createWorld, type WorldApi } from '../loader/src/runtime/api/world.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createGameBackend } from '../loader/src/runtime/world/backend.ts';
import { createWorldHub, type WorldHub } from '../loader/src/runtime/world/hub.ts';
import { capture, sameCapture, type WorldKey } from '../loader/src/runtime/world/signature.ts';
import { at, PLAYER_ENTITY, setAt } from './fakes/frames.ts';

/** Whether the signature would report a change between two readings. */
function changed(key: WorldKey, before: unknown, after: unknown): boolean {
  return !sameCapture(capture(key, before), capture(key, after));
}

/**
 * One worn piece as the server sends it, which is the three-field public trim.
 *
 * Written out rather than taken from a fixture builder because the trim is the
 * subject: a helper that filled in the other five payload fields would be
 * asserting against a shape no inspecting client is ever sent.
 */
const worn = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  signer: 'Marshal',
  rolled: { stats: { sta: 4 } },
  ...over,
});

describe('equipmentInstances', () => {
  // The reason this key exists at all. An enchant is applied to the piece that
  // is already worn, so the slot still holds the same item id and `equipment`
  // cannot report it: a signature that rendered the payload as an object would
  // answer the same string on both sides and the pane would never repaint.
  it('notices an enchant landing on a piece that is already worn', () => {
    const before = { chest: worn() };
    const after = { chest: worn({ enchant: 'enchant_chest_stamina' }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
    expect(changed('equipment', { chest: 'vestments' }, { chest: 'vestments' })).toBe(false);
  });

  it('notices a stat being baked into a worn piece', () => {
    const before = { chest: worn({ rolled: { stats: { sta: 4 } } }) };
    const after = { chest: worn({ rolled: { stats: { sta: 4, int: 2 } } }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
  });

  it('notices a stat that was already there moving', () => {
    const before = { chest: worn({ rolled: { stats: { sta: 4 } } }) };
    const after = { chest: worn({ rolled: { stats: { sta: 9 } } }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
  });

  it('notices a masterwork proc, which carries no stat of its own', () => {
    const before = { chest: worn({ rolled: { stats: { sta: 4 } } }) };
    const after = { chest: worn({ rolled: { stats: { sta: 4 }, masterwork: true } }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
  });

  // Two copies of the same item, one signed by somebody else. The item id in
  // `equipment` is identical across the swap, so this is the only reading that
  // can tell them apart.
  it('notices a different copy of the same item', () => {
    const before = { chest: worn({ signer: 'Marshal' }) };
    const after = { chest: worn({ signer: 'Thornpeak' }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
  });

  it('notices a rift piece being upgraded', () => {
    const rift = { sourceEventId: 'e1', tier: 'B', upgradeLevel: 2, gemSlots: 2, gems: [] };
    const before = { ring1: worn({ rift }) };
    const after = { ring1: worn({ rift: { ...rift, upgradeLevel: 3 } }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
  });

  // The game rebuilds `rolled.stats` on every socket, but only for the gem ids
  // its own table lists, so a gem from a later content release would fill a
  // socket and move nothing else. Filling a socket is what a gear pane draws.
  it('notices a gem the stat table does not recognise filling a socket', () => {
    const rift = { sourceEventId: 'e1', tier: 'B', upgradeLevel: 2, gemSlots: 2, gems: [] };
    const before = { ring1: worn({ rift }) };
    const after = { ring1: worn({ rift: { ...rift, gems: ['rift_gem_unknown'] } }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
  });

  it('separates two slots rather than letting one absorb the other', () => {
    const before = { chest: worn({ enchant: 'e1' }), legs: worn() };
    const after = { chest: worn(), legs: worn({ enchant: 'e1' }) };

    expect(changed('equipmentInstances', before, after)).toBe(true);
  });

  // The client rebuilds this record from the wire rather than mutating it, and
  // key order is nobody's promise, so an unsorted digest would fire on a
  // reserialization that changed nothing.
  it('does not care what order the slots serialize in', () => {
    const before = { chest: worn(), legs: worn({ enchant: 'e1' }) };
    const after = { legs: worn({ enchant: 'e1' }), chest: worn() };

    expect(changed('equipmentInstances', before, after)).toBe(false);
  });

  it('does not care what order a stat block serializes in', () => {
    const before = { chest: worn({ rolled: { stats: { sta: 4, int: 2 } } }) };
    const after = { chest: worn({ rolled: { stats: { int: 2, sta: 4 } } }) };

    expect(changed('equipmentInstances', before, after)).toBe(false);
  });

  it('is quiet on a record the client replaced with an equal one', () => {
    expect(changed('equipmentInstances', { chest: worn() }, { chest: worn() })).toBe(false);
  });

  // The trim is what makes this sparse: the server keys a slot only while at
  // least one of the signer, the enchant and the roll survives, so a plain worn
  // set is empty rather than a map of empty payloads. An `einst` that carries no
  // slot RESETS the mirror, and a pane holding the old one has to be told.
  it('notices the last instanced piece coming off', () => {
    expect(changed('equipmentInstances', { chest: worn() }, {})).toBe(true);
  });

  it('notices the first instanced piece going on', () => {
    expect(changed('equipmentInstances', {}, { chest: worn() })).toBe(true);
  });

  // An absent record and an empty one are ONE reading, the same collapse
  // `equipment` makes, and it is safe for the same reason: the watcher's first
  // sample is delivered to every subscriber whether or not the signature moved,
  // so nobody learns about the payload from a transition out of null. What the
  // collapse buys is that a game release which stops seeding the member is not
  // reported as a player taking all their instanced gear off.
  it('reads an absent record and an empty one as the same nothing', () => {
    expect(changed('equipmentInstances', null, {})).toBe(false);
  });

  it('treats a record of the wrong kind as absent rather than throwing', () => {
    expect(() => capture('equipmentInstances', 'nonsense')).not.toThrow();
    expect(changed('equipmentInstances', 'nonsense', null)).toBe(false);
  });
});

describe('entities', () => {
  // Worn gear rides a full entity record, which the server re-emits on the tick
  // after any equip. Folding it into this signature would wake every
  // `world.on('entities')` subscriber at equip rate to report a roster that did
  // not move, and there is deliberately no watch key for another player's gear.
  it('is quiet when a nearby player changes what they are wearing', () => {
    const before = new Map<number, unknown>([[661, { id: 661, equippedItems: { chest: 'a' } }]]);
    const after = new Map<number, unknown>([[661, { id: 661, equippedItems: { chest: 'b' } }]]);

    expect(changed('entities', before, after)).toBe(false);
  });
});

/** No damage clock: these cases drive the gear read, not the combat fallback. */
const DEPS = {
  lastDamageAt: () => null,
  now: () => 0,
  zoneName: () => null,
  simNow: () => null,
  realm: () => null,
};

describe('the backend read', () => {
  const gameWorld = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    world: {
      player: { ...PLAYER_ENTITY },
      entities: new Map<number, unknown>(),
      partyInfo: null,
      inventory: [],
      questLog: new Map(),
      questsDone: new Set<string>(),
      ...over,
    },
  });

  const backendOf = (game: Record<string, unknown>) => {
    const backend = createGameBackend(game, DEPS);
    if (backend === null) {
      throw new Error('expected a backend');
    }
    return backend;
  };

  it('reads the untrimmed self payload off the world object', () => {
    const game = gameWorld({ equipmentInstances: { chest: { boundTo: 12, charges: { zap: 3 } } } });

    expect(backendOf(game).equipmentInstances).toMatchObject({ chest: { boundTo: 12 } });
  });

  // The client assigns a whole new record on every `einst` delta rather than
  // mutating the one it holds, so a value captured when the backend was built
  // goes stale the first time anything is enchanted.
  it('follows the record the client replaced rather than capturing one', () => {
    const game = gameWorld({ equipmentInstances: {} });
    const backend = backendOf(game);

    setAt(at(game, 'world'), 'equipmentInstances', { chest: { enchant: 'e1' } });

    expect(backend.equipmentInstances).toMatchObject({ chest: { enchant: 'e1' } });
  });

  it('answers null on a game that carries no such member', () => {
    expect(backendOf(gameWorld()).equipmentInstances).toBeNull();
  });
});

interface Harness {
  world: WorldApi;
  hub: WorldHub;
  bag: DisposalBag;
  live: Record<string, unknown>;
  enterWorld: () => void;
  frame: () => void;
}

function harness(): Harness {
  const live: Record<string, unknown> = {
    player: { ...PLAYER_ENTITY },
    entities: new Map<number, unknown>(),
    partyInfo: null,
    inventory: [],
    questLog: new Map(),
    questsDone: new Set<string>(),
    equipment: { chest: 'eastbrook_ritual_vestments' },
    equipmentInstances: { chest: { signer: 'Marshal' } },
  };
  let enter: (game: unknown) => void = () => undefined;
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
    ...DEPS,
  });
  const bag = new DisposalBag();

  return {
    world: createWorld(hub, bag),
    hub,
    bag,
    live,
    enterWorld: () => enter({ world: live }),
    frame: () => {
      for (const run of [...scheduled.values()]) {
        scheduled.clear();
        run();
      }
    },
  };
}

// End to end, because the three halves of this key are wired in three different
// modules: the published key list, the capture dispatch, and the backend read.
// Every unit above passes with any one of them missing.
describe('world.equipmentInstances', () => {
  it('answers null before the player has a self record', () => {
    expect(harness().world.equipmentInstances).toBeNull();
  });

  it('reads through to the live record once the world arrives', async () => {
    const h = harness();
    h.enterWorld();
    await h.world.ready;

    expect(h.world.equipmentInstances).toBe(at(h.live, 'equipmentInstances'));
  });

  // An addon subscribes on its first line, minutes before the player enters the
  // world, and the signature reads null and empty as one nothing. This delivery
  // is what makes that collapse safe: the first sample reaches a subscriber
  // whether or not the signature moved, so the payload is never missed.
  it('delivers the first record to a subscriber that was there before world entry', async () => {
    const h = harness();
    const seen = vi.fn();
    h.world.on('equipmentInstances', seen);

    h.enterWorld();
    await h.world.ready;
    h.frame();

    expect(seen).toHaveBeenCalledOnce();
  });

  it('registers a subscription in the disposal bag', () => {
    const h = harness();
    h.world.on('equipmentInstances', vi.fn());

    expect(h.bag.size).toBe(1);
  });

  it('wakes a subscriber when an enchant lands on a worn piece', async () => {
    const h = harness();
    const seen = vi.fn();
    h.world.on('equipmentInstances', seen);
    h.enterWorld();
    await h.world.ready;
    h.frame();
    seen.mockClear();

    setAt(h.live, 'equipmentInstances', { chest: { signer: 'Marshal', enchant: 'e1' } });
    h.hub.watcher.poll();

    expect(seen).toHaveBeenCalledOnce();
  });

  // The pair is the point: `equipment` says which piece and this says what is on
  // it, so a swap that keeps the item id has to wake this one and not that one.
  it('leaves the equipment subscriber alone when only the payload moved', async () => {
    const h = harness();
    const gear = vi.fn();
    h.world.on('equipment', gear);
    h.enterWorld();
    await h.world.ready;
    h.frame();
    gear.mockClear();

    setAt(h.live, 'equipmentInstances', { chest: { signer: 'Thornpeak' } });
    h.hub.watcher.poll();

    expect(gear).not.toHaveBeenCalled();
  });
});
