// A mob cast emits no `castStart`, so `castsOf` is the only way an addon sees a boss cast; the
// fixtures use the entity's names (`castingAbility`), never the wire's (`cast`). Only ground
// effects whose geometry rides the snapshot are readable as hazards.

import { describe, expect, it } from 'vitest';

import { castsOf, hazardsOf, markersOf } from '../loader/src/runtime/world/derived.ts';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';

/** An entity carrying only what these derivations read. */
function entity(over: Record<string, unknown>): Entity {
  return {
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    channeling: false,
    ...over,
  } as unknown as Entity;
}

function roster(entries: [number, Record<string, unknown>][]): ReadonlyMap<number, Entity> {
  return new Map(entries.map(([id, over]) => [id, entity(over)]));
}

describe('castsOf', () => {
  it('reports an entity that is casting', () => {
    const casts = castsOf(
      roster([[248, { castingAbility: 'deathless_rage', castRemaining: 6.5, castTotal: 10 }]]),
    );

    expect(casts.get(248)).toEqual({
      ability: 'deathless_rage',
      remaining: 6.5,
      total: 10,
      channeling: false,
    });
  });

  it('leaves out everything that is not casting', () => {
    const casts = castsOf(
      roster([
        [248, { castingAbility: 'soul_rend' }],
        [250, { castingAbility: null }],
        [661, {}],
      ]),
    );

    expect([...casts.keys()]).toEqual([248]);
  });

  // An entity built before the first snapshot carries the empty string.
  it('does not treat an empty ability id as a cast', () => {
    expect(castsOf(roster([[248, { castingAbility: '' }]])).size).toBe(0);
  });

  it('carries the channel flag', () => {
    const casts = castsOf(roster([[248, { castingAbility: 'inferno', channeling: true }]]));

    expect(casts.get(248)?.channeling).toBe(true);
  });

  it('reads the whole roster, not the player alone', () => {
    const casts = castsOf(
      roster([
        [248, { castingAbility: 'soul_rend' }],
        [661, { castingAbility: 'fireball' }],
      ]),
    );

    expect(casts.size).toBe(2);
  });

  // Cast fields are mutated in place, so a cached map would go stale undetectably.
  it('follows a cast that starts after the first read', () => {
    const live = new Map<number, Entity>([[248, entity({})]]);

    expect(castsOf(live).size).toBe(0);

    Reflect.set(live.get(248) as object, 'castingAbility', 'gravebreaker');

    expect(castsOf(live).get(248)?.ability).toBe('gravebreaker');
  });

  it('answers an empty map on an empty roster', () => {
    expect(castsOf(new Map()).size).toBe(0);
  });
});

describe('hazardsOf', () => {
  const ring = {
    id: 'ring-1',
    x: 12,
    z: -4,
    radius: 8,
    innerRadius: 3,
    duration: 12,
    remaining: 7.5,
  };
  const hourglass = { id: 'hg-1', x: 0, z: 0, radius: 6, duration: 20, remaining: 20 };

  it('reads both kinds as one list', () => {
    const hazards = hazardsOf({
      activeFrostRings: [ring],
      activeTemporalHourglasses: [hourglass],
    });

    expect(hazards?.map((hazard) => hazard.kind)).toEqual(['frostRing', 'temporalHourglass']);
  });

  it('carries the geometry the game validated on decode', () => {
    const hazards = hazardsOf({ activeFrostRings: [ring], activeTemporalHourglasses: [] });

    expect(hazards?.[0]).toEqual({ ...ring, kind: 'frostRing' });
  });

  it('gives a hazard with no hole an inner radius of zero', () => {
    const hazards = hazardsOf({ activeFrostRings: [], activeTemporalHourglasses: [hourglass] });

    expect(hazards?.[0]?.innerRadius).toBe(0);
  });

  it('drops an entry with no id or no radius', () => {
    const hazards = hazardsOf({
      activeFrostRings: [{ x: 1, z: 1, radius: 4, remaining: 3 }, ring],
      activeTemporalHourglasses: [{ id: 'no-radius', x: 0, z: 0, remaining: 3 }],
    });

    expect(hazards?.map((hazard) => hazard.id)).toEqual(['ring-1']);
  });

  // Null means "not readable here", which differs from clean ground.
  it('answers null when the game carries neither collection', () => {
    expect(hazardsOf({ entities: new Map() })).toBeNull();
    expect(hazardsOf(null)).toBeNull();
  });

  it('answers an empty list when the collections are there and empty', () => {
    expect(hazardsOf({ activeFrostRings: [], activeTemporalHourglasses: [] })).toEqual([]);
  });
});

// Fixtures are the client's decoded rows (src/net/ground_telegraph_wire.ts); the wire's
// `r`/`dur`/`rem` are renamed on decode, so fixtures using them would match nothing.
describe('hazardsOf over the Nythraxis families', () => {
  const eruption = {
    id: '248:ge:3:0',
    x: 4,
    z: 92,
    radius: 6,
    duration: 5,
    remaining: 3.25,
    warningLead: 1,
  };
  const flame = {
    id: '248:gf:7',
    sourceId: 248,
    kind: 'grave',
    x: 4,
    z: 92,
    radius: 6,
    duration: 20,
    remaining: 18,
  };
  const sigil = {
    id: '248:sig:3',
    sourceId: 248,
    x: 18,
    z: 96,
    radius: 4,
    duration: 15,
    remaining: 15,
  };

  it('reads each family as its own hazard kind', () => {
    const hazards = hazardsOf({
      activeNythraxisGraveEruptions: [eruption],
      activeNythraxisGraveFlames: [flame],
      activeNythraxisBindingSigils: [sigil],
    });

    expect(hazards?.map((hazard) => hazard.kind)).toEqual([
      'nythraxisGraveEruption',
      'nythraxisGraveFlame',
      'nythraxisBindingSigil',
    ]);
  });

  // An eruption counts down to the burst. `warningLead` has no published field and is dropped
  // instead of being folded into one that means something else.
  it('carries the eruption countdown and drops the reveal delay', () => {
    const hazards = hazardsOf({ activeNythraxisGraveEruptions: [eruption] });

    expect(hazards?.[0]).toEqual({
      id: '248:ge:3:0',
      kind: 'nythraxisGraveEruption',
      x: 4,
      z: 92,
      radius: 6,
      innerRadius: 0,
      duration: 5,
      remaining: 3.25,
    });
  });

  // The game still declares the `'soul'` flame kind but never produces it.
  it('publishes a soul flame under the grave-flame kind', () => {
    const hazards = hazardsOf({
      activeNythraxisGraveFlames: [{ ...flame, id: '248:gf:8', kind: 'soul' }],
    });

    expect(hazards?.[0]?.kind).toBe('nythraxisGraveFlame');
  });

  // A Gravefire is a travelling line with no radius, so it is refused, and null reports that no
  // hazard list was read, not clean ground.
  it('refuses the travelling gravefire line outright', () => {
    expect(
      hazardsOf({
        activeNythraxisGravefires: [
          {
            id: '248:gfl:2',
            sourceId: 248,
            x: 0,
            z: 96,
            dirX: 1,
            dirZ: 0,
            tail: 0,
            head: 12,
            halfWidth: 2,
            remaining: 8,
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('markersOf', () => {
  it('reads the mirror the game keeps as a plain object', () => {
    const markers = markersOf({ markers: Object.fromEntries([[248, 1]]) });

    expect(markers?.get(248)).toBe(1);
  });

  // An addon looks a marker up by a numeric entity id.
  it("keys on numbers, not the object's strings", () => {
    const markers = markersOf({ markers: Object.fromEntries([['250', 4]]) });

    expect(markers?.has(250)).toBe(true);
  });

  it('drops an entry whose marker is not a number', () => {
    const markers = markersOf({ markers: Object.fromEntries([['248', 'skull']]) });

    expect(markers?.size).toBe(0);
  });

  // Solo is indistinguishable from a group that marked nothing, hence `world.party` beside it.
  it('answers an empty map for an ungrouped player', () => {
    expect(markersOf({ markers: {} })?.size).toBe(0);
  });

  it('answers null when the game carries no mirror at all', () => {
    expect(markersOf({})).toBeNull();
    expect(markersOf(null)).toBeNull();
  });
});
