// The ground readings: what is lethal on it, and what died on it.
//
// Two of these are about a disclosure rather than about a shape. A corpse's
// whole contents reach every client in interest scope, personal slots included,
// so the projection is the only thing standing between an addon and a display
// that shows other players loot they cannot take. The `personalFor` case below
// is the assertion that matters most in this file.
//
// The death zone cases are about the two ways the reading can be wrong without
// raising: an aliased array, which is what the OFFLINE sim hands back and which
// the online path happens to avoid, and a method called off the wrong receiver,
// which the game's own implementation reads `this` in.

import { describe, expect, it } from 'vitest';

import { groundReads } from '../loader/src/runtime/world/backend-ground.ts';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import {
  corpsesOf,
  corpseViewOf,
  type DeathZone,
  deathZonesOf,
  type LootViewer,
  viewerOf,
} from '../loader/src/runtime/world/ground.ts';
import {
  corpsePositionSignature,
  corpseSignature,
  deathZoneSignature,
  groundCapture,
} from '../loader/src/runtime/world/signature-ground.ts';

const TAPPER = 7;
const ME = 12;
const STRANGER = 99;

/** An entity carrying only what these readings look at. */
function entity(over: Record<string, unknown>): Entity {
  return { lootable: false, loot: null, tappedById: null, ...over } as unknown as Entity;
}

/** A corpse the wire would carry: lootable, with a loot record on it. */
function corpse(over: Record<string, unknown>): Entity {
  return entity({ lootable: true, loot: { copper: 0, items: [] }, ...over });
}

function viewer(over: Partial<LootViewer> = {}): LootViewer {
  return { pid: ME, partyPids: [], ...over };
}

/**
 * A world whose reader reads `this`, the way the game's own does.
 *
 * The game's implementation walks `this.activeBossDeathZones`, so a loader that
 * pulled the method off the object and called it bare would throw on every read.
 */
function riftWorld(zones: unknown[]): { zones: unknown[]; riftBossDeathZones: () => unknown } {
  return {
    zones,
    riftBossDeathZones(): unknown {
      return this.zones;
    },
  };
}

function zone(x: number, z: number, radius: number, remaining: number): Record<string, number> {
  return { x, z, radius, remaining };
}

describe('deathZonesOf', () => {
  it('answers null when the game carries no reader, and empty when it answers empty', () => {
    expect(deathZonesOf({ player: { id: ME } })).toBeNull();
    expect(deathZonesOf(riftWorld([]))).toEqual([]);
  });

  it('answers null rather than throwing when the reader throws', () => {
    const world = {
      riftBossDeathZones(): unknown {
        throw new Error('riftBossDeathZones is gone');
      },
    };

    expect(deathZonesOf(world)).toBeNull();
  });

  it('copies every entry, so a caller cannot reach the sim through the answer', () => {
    // The OFFLINE sim returns `inst.bossDeathZones` by reference. Nothing in the
    // online path would show this, which is why it is asserted rather than
    // assumed.
    const source = [zone(10, 20, 6, 3)];
    const zones = deathZonesOf(riftWorld(source)) as DeathZone[];

    (zones[0] as DeathZone).x = 999;
    zones.push(zone(0, 0, 1, 1) as unknown as DeathZone);

    expect(source).toEqual([{ x: 10, z: 20, radius: 6, remaining: 3 }]);
  });

  it('drops an entry missing a coordinate rather than placing it at the origin', () => {
    const zones = deathZonesOf(riftWorld([{ z: 20, radius: 6, remaining: 3 }, zone(1, 2, 3, 4)]));

    expect(zones).toEqual([{ x: 1, z: 2, radius: 3, remaining: 4 }]);
  });
});

describe('corpseViewOf', () => {
  // The game's own rule, added at 0.40.1 (src/game/corpse_loot_availability.ts):
  // once the loot window elapses nobody can open the corpse, whatever their
  // rights. The entity keeps its whole loot record and stays in the entity map,
  // so without this the loader goes on offering slots off a body the game has
  // already dropped from its own pickable view.
  it('offers nothing off a corpse whose loot window has elapsed, even to its tapper', () => {
    const slot = { itemId: 'iron_ore', count: 3 };
    const dead = corpse({
      tappedById: ME,
      dead: true,
      corpseTimer: 0,
      loot: { copper: 480, items: [slot] },
    });

    const view = corpseViewOf(dead, 41, viewer());

    expect(view?.decayed).toBe(true);
    expect(view?.sharedRights).toBe(true);
    expect(view?.mine).toEqual([]);
    expect(view?.copper).toBe(0);
    // `all` still says what the wire carried, which is what `all` is for.
    expect(view?.all).toEqual([slot]);
  });

  // The client builds every entity with `corpseTimer` at 0 and only the dynamic
  // decode ever writes it, so the timer alone says nothing: read without `dead`
  // it would call every living mob's body decayed.
  it('does not read a living mob as decayed on the timer alone', () => {
    const slot = { itemId: 'iron_ore', count: 3 };
    const alive = corpse({ tappedById: ME, corpseTimer: 0, loot: { copper: 480, items: [slot] } });

    const view = corpseViewOf(alive, 41, viewer());

    expect(view?.decayed).toBe(false);
    expect(view?.mine).toEqual([slot]);
  });

  // An unreadable timer is deliberately NOT the game's own default of 0. Guessing
  // decayed would blank a live corpse; guessing open leaves the reading as it was
  // before the rule existed.
  it('treats a corpse with no readable timer as still inside its window', () => {
    const slot = { itemId: 'iron_ore', count: 3 };
    const unread = corpse({ tappedById: ME, dead: true, loot: { copper: 0, items: [slot] } });

    expect(corpseViewOf(unread, 41, viewer())?.decayed).toBe(false);
  });

  it('shows a slot reserved for somebody else and does not offer it', () => {
    const slot = { itemId: 'sealed_missive', count: 1, personalFor: [STRANGER] };
    const view = corpseViewOf(corpse({ loot: { copper: 0, items: [slot] } }), 41, viewer());

    expect(view?.all).toEqual([slot]);
    expect(view?.mine).toEqual([]);
  });

  it('offers a personal slot to the player it names, whoever tapped the corpse', () => {
    const slot = { itemId: 'sealed_missive', count: 1, personalFor: [ME] };
    const view = corpseViewOf(
      corpse({ tappedById: TAPPER, loot: { copper: 0, items: [slot] } }),
      41,
      viewer(),
    );

    expect(view?.sharedRights).toBe(false);
    expect(view?.mine).toEqual([slot]);
  });

  it('gives a non-tapper the open slots and neither the copper nor the shared ones', () => {
    const open = { itemId: 'coarse_pelt', count: 2, openToAll: true };
    const shared = { itemId: 'iron_ore', count: 3 };
    const view = corpseViewOf(
      corpse({ tappedById: TAPPER, loot: { copper: 480, items: [open, shared] } }),
      41,
      viewer(),
    );

    expect(view?.mine).toEqual([open]);
    expect(view?.copper).toBe(0);
  });

  it('gives the tapper the shared pool and its copper', () => {
    const shared = { itemId: 'iron_ore', count: 3 };
    const view = corpseViewOf(
      corpse({ tappedById: ME, loot: { copper: 480, items: [shared] } }),
      41,
      viewer(),
    );

    expect(view?.sharedRights).toBe(true);
    expect(view?.mine).toEqual([shared]);
    expect(view?.copper).toBe(480);
  });

  it('grants shared rights through a roster holding the tapper, and not through one without', () => {
    const shared = { itemId: 'iron_ore', count: 3 };
    const dead = corpse({ tappedById: TAPPER, loot: { copper: 60, items: [shared] } });

    const grouped = corpseViewOf(dead, 41, viewer({ partyPids: [ME, TAPPER] }));
    const elsewhere = corpseViewOf(dead, 41, viewer({ partyPids: [ME, STRANGER] }));

    expect(grouped?.sharedRights).toBe(true);
    expect(elsewhere?.sharedRights).toBe(false);
    expect(elsewhere?.mine).toEqual([]);
  });

  it('opens the shared pool to anyone once the lock has lapsed', () => {
    const shared = { itemId: 'iron_ore', count: 3 };
    const view = corpseViewOf(
      corpse({ tappedById: TAPPER, lootFfaTimer: 0, loot: { copper: 60, items: [shared] } }),
      41,
      viewer(),
    );

    expect(view?.ffa).toBe(true);
    expect(view?.mine).toEqual([shared]);
    expect(view?.copper).toBe(60);
  });

  it('holds the lock when the corpse carries no countdown at all', () => {
    const view = corpseViewOf(
      corpse({ tappedById: TAPPER, loot: { copper: 60, items: [] } }),
      41,
      viewer(),
    );

    expect(view?.ffa).toBe(false);
    expect(view?.copper).toBe(0);
  });

  it('answers null for an entity with no loot record', () => {
    expect(corpseViewOf(entity({ lootable: true }), 41, viewer())).toBeNull();
    expect(corpseViewOf(null, 41, viewer())).toBeNull();
  });
});

describe('corpsesOf', () => {
  it('skips a lootable entity carrying no loot, which is every door and pickup', () => {
    const roster = new Map<number, Entity>([
      [41, corpse({ loot: { copper: 5, items: [] } })],
      [42, entity({ lootable: true })],
      [43, entity({})],
    ]);

    expect([...corpsesOf(roster, viewer()).keys()]).toEqual([41]);
  });
});

describe('viewerOf', () => {
  it('reads the player and the local roster, and answers nobody before the world exists', () => {
    const world = { player: { id: ME }, partyInfo: { members: [{ pid: ME }, { pid: TAPPER }] } };

    expect(viewerOf(world)).toEqual({ pid: ME, partyPids: [ME, TAPPER] });
    expect(viewerOf(null)).toEqual({ pid: null, partyPids: [] });
  });
});

describe('deathZoneSignature', () => {
  it('reports two zones at one position as different from one', () => {
    // The S-rank barrage places a zone under every living member, so two members
    // standing together produce two identical entries.
    const one = deathZoneSignature([zone(10, 20, 6, 4)]);
    const two = deathZoneSignature([zone(10, 20, 6, 4), zone(10, 20, 6, 4)]);

    expect(two).not.toBe(one);
  });

  it('does not move as a fuse burns down', () => {
    expect(deathZoneSignature([zone(10, 20, 6, 4)])).toBe(deathZoneSignature([zone(10, 20, 6, 1)]));
  });
});

describe('corpseSignature', () => {
  function view(over: Record<string, unknown>): ReadonlyMap<number, unknown> {
    return new Map([
      [
        41,
        { entityId: 41, all: [], mine: [], copper: 0, ffa: false, harvestClaimedBy: null, ...over },
      ],
    ]);
  }

  it('moves when a corpse is emptied', () => {
    const before = corpseSignature(view({ all: [{ itemId: 'iron_ore', count: 3 }] }));

    expect(corpseSignature(view({ all: [] }))).not.toBe(before);
  });

  it('does not move when only the rights of whoever is looking changed', () => {
    // A party change can flip `sharedRights` and with it `mine`. The corpse is
    // the same corpse, and an addon watching the ground should not be woken by
    // somebody joining the group.
    const slot = { itemId: 'iron_ore', count: 3 };
    const locked = view({ all: [slot], mine: [], sharedRights: false });
    const opened = view({ all: [slot], mine: [slot], sharedRights: true });

    expect(corpseSignature(opened)).toBe(corpseSignature(locked));
  });

  it('moves when the harvest is claimed', () => {
    const before = corpseSignature(view({}));

    expect(corpseSignature(view({ harvestClaimedBy: STRANGER }))).not.toBe(before);
  });

  // The corpse decaying is the one change here that can move NOTHING else. It
  // empties `mine` and `copper`, and `mine` is deliberately not in the signature
  // while `copper` was already 0 for a viewer with no rights, so on a corpse
  // somebody else tapped the whole reading is byte-identical across the moment
  // the game stops letting anyone open it. That is a published field arriving
  // correctly and never firing its `world.on`, which is why it is asserted on a
  // corpse with nothing takeable rather than on a full one.
  it('moves when the loot window elapses on a corpse holding nothing takeable', () => {
    const slot = { itemId: 'iron_ore', count: 3 };
    const before = corpseSignature(view({ all: [slot], copper: 0, decayed: false }));

    expect(corpseSignature(view({ all: [slot], copper: 0, decayed: true }))).not.toBe(before);
  });
});

describe('corpsePositionSignature', () => {
  it('tells a body at the world origin from no body at all', () => {
    expect(corpsePositionSignature(null)).toBe('');
    expect(corpsePositionSignature({ x: 0, y: 0, z: 0 })).not.toBe('');
  });

  it('is stable across reads of one corpse', () => {
    expect(corpsePositionSignature({ x: 4, y: 1, z: -9 })).toBe(
      corpsePositionSignature({ x: 4, y: 1, z: -9 }),
    );
  });
});

describe('groundCapture', () => {
  it('reports which nodes are cooling and not how long is left on one', () => {
    const early = new Map([['ore_ridge_3', 118]]);
    const late = new Map([['ore_ridge_3', 2]]);
    const other = new Map([['herb_glade_1', 118]]);

    expect(groundCapture('nodeCooldowns', late)).toBe(groundCapture('nodeCooldowns', early));
    expect(groundCapture('nodeCooldowns', other)).not.toBe(groundCapture('nodeCooldowns', early));
  });
});

describe('groundReads', () => {
  const noEntities = (): ReadonlyMap<number, Entity> => new Map<number, Entity>();

  it('answers null for node cooldowns when the game carries no such member', () => {
    // The map is a TypeScript-private field with no parity test behind it, so a
    // rename removes it silently. Null is the reading that says so; an empty map
    // would read as "nothing is cooling", which is a false all-clear.
    expect(groundReads({ player: { id: ME } }, noEntities).nodeCooldowns).toBeNull();
  });

  it('hands back the live node cooldown map the game holds', () => {
    const cooling = new Map([['ore_ridge_3', 118]]);

    expect(groundReads({ nodeCooldowns: cooling }, noEntities).nodeCooldowns).toBe(cooling);
  });

  it('reads the corpse position off the player, where the self payload puts it', () => {
    const at = { x: 4, y: 1, z: -9 };

    expect(groundReads({ player: { id: ME, corpsePos: at } }, noEntities).corpse).toBe(at);
    expect(groundReads({ player: { id: ME } }, noEntities).corpse).toBeNull();
  });
});
