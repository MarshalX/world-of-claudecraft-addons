// The three readings the loader computes rather than reads.
//
// `casts` carries the weight here. A mob's cast never emits a `castStart` event:
// the event fires for a player cast, a pet's cast and the game's timed activities,
// and the mob path assigns cast state directly instead. That state reaches the client only on
// the per-entity wire, so this derivation is the ONLY way an addon can see a boss
// cast at all, and the tests below are written against the fields the wire
// actually carries (`cast`, `castRem`, `castTot`, `chan`) as the client names them
// on the entity (`castingAbility`, `castRemaining`, `castTotal`, `channeling`).
//
// The two hazard readings are narrower than they sound and the tests say so: a
// frost ring and a temporal hourglass are the only ground effects whose geometry
// rides the snapshot, so anything else on the ground is invisible here by design.

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

  // The client clears the field to null, but an entity built before the first
  // snapshot carries the empty string, and an empty ability id is not a cast.
  it('does not treat an empty ability id as a cast', () => {
    expect(castsOf(roster([[248, { castingAbility: '' }]])).size).toBe(0);
  });

  // A channel drains rather than completes, so a mod warning on a hardcast and one
  // warning on a channel are different warnings.
  it('carries the channel flag', () => {
    const casts = castsOf(roster([[248, { castingAbility: 'inferno', channeling: true }]]));

    expect(casts.get(248)?.channeling).toBe(true);
  });

  it('reads the whole roster rather than the player alone', () => {
    const casts = castsOf(
      roster([
        [248, { castingAbility: 'soul_rend' }],
        [661, { castingAbility: 'fireball' }],
      ]),
    );

    expect(casts.size).toBe(2);
  });

  // Cast fields are mutated in place on an entity the game already owns, so there
  // is nothing to invalidate a cache against: a held map would answer with the
  // cast that was running when it was built.
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

  // An hourglass has no safe middle. Leaving the field absent would make every
  // consumer write the same `?? 0` to answer "am I inside it".
  it('gives a hazard with no hole an inner radius of zero', () => {
    const hazards = hazardsOf({ activeFrostRings: [], activeTemporalHourglasses: [hourglass] });

    expect(hazards?.[0]?.innerRadius).toBe(0);
  });

  it('drops an entry with no id or no radius rather than publishing a partial one', () => {
    const hazards = hazardsOf({
      activeFrostRings: [{ x: 1, z: 1, radius: 4, remaining: 3 }, ring],
      activeTemporalHourglasses: [{ id: 'no-radius', x: 0, z: 0, remaining: 3 }],
    });

    expect(hazards?.map((hazard) => hazard.id)).toEqual(['ring-1']);
  });

  // Null, not an empty list: an older game that carries neither member is a
  // different answer from a game standing on clean ground, and an addon drawing a
  // hazard overlay wants to know which it is looking at.
  it('answers null when the game carries neither collection', () => {
    expect(hazardsOf({ entities: new Map() })).toBeNull();
    expect(hazardsOf(null)).toBeNull();
  });

  it('answers an empty list when the collections are there and empty', () => {
    expect(hazardsOf({ activeFrostRings: [], activeTemporalHourglasses: [] })).toEqual([]);
  });
});

describe('markersOf', () => {
  it('reads the mirror the game keeps as a plain object', () => {
    const markers = markersOf({ markers: Object.fromEntries([[248, 1]]) });

    expect(markers?.get(248)).toBe(1);
  });

  // The keys are entity ids, and a plain object has string keys. An addon looking
  // one up holds a number, off an entity, so the map has to be keyed on numbers.
  it('keys on numbers rather than on the object"s strings', () => {
    const markers = markersOf({ markers: Object.fromEntries([['250', 4]]) });

    expect(markers?.has(250)).toBe(true);
  });

  it('drops an entry whose marker is not a number', () => {
    const markers = markersOf({ markers: Object.fromEntries([['248', 'skull']]) });

    expect(markers?.size).toBe(0);
  });

  // Solo the game sends nothing, so the mirror is an empty object rather than
  // absent, and this cannot be told apart from a group that has marked nothing.
  // That is why the read is documented as needing `world.party` beside it.
  it('answers an empty map for an ungrouped player', () => {
    expect(markersOf({ markers: {} })?.size).toBe(0);
  });

  it('answers null when the game carries no mirror at all', () => {
    expect(markersOf({})).toBeNull();
    expect(markersOf(null)).toBeNull();
  });
});
