import { describe, expect, it } from 'vitest';

import {
  capture,
  isWorldKey,
  sameCapture,
  WORLD_KEYS,
  type WorldKey,
} from '../loader/src/runtime/world/signature.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';

/** Whether the signature would report a change between two readings. */
function changed(key: WorldKey, before: unknown, after: unknown): boolean {
  return !sameCapture(capture(key, before), capture(key, after));
}

const entity = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...PLAYER_ENTITY,
  ...over,
});

describe('world keys', () => {
  it('pins the set an addon may subscribe to', () => {
    expect(WORLD_KEYS).toEqual([
      'player',
      'target',
      'entities',
      'party',
      'inventory',
      'equipment',
      'bags',
      'copper',
      'zone',
      'character',
      'talents',
      'professions',
      'group',
      'encounter',
      'quests',
      'cooldowns',
      'auras',
      'casts',
      'targetAuras',
      'hazards',
      'markers',
      'abilities',
      'combat',
    ]);
  });

  it('rejects a key it does not know', () => {
    expect(isWorldKey('player')).toBe(true);
    expect(isWorldKey('players')).toBe(false);
    expect(isWorldKey('__proto__')).toBe(false);
  });
});

describe('player', () => {
  it('is quiet while nothing meaningful moved', () => {
    expect(changed('player', entity(), entity())).toBe(false);
  });

  // These are the Entity's own names, not the terse wire names the snapshot used
  // to deliver it. Reading `mhp` or `res` here finds nothing and the field drops
  // out of the signature without failing.
  it.each([
    ['hp', 1300],
    ['maxHp', 1400],
    ['level', 21],
    ['resource', 60],
    ['maxResource', 120],
    ['targetId', 250],
    ['id', 999],
  ])('notices %s changing', (field, value) => {
    expect(changed('player', entity(), entity({ [field]: value }))).toBe(true);
  });

  // `dead` is a boolean. Read with a number-only reader it resolves to nothing,
  // and the signature silently stops watching it.
  //
  // `inCombat` was in this list and has been dropped from the watched fields:
  // it is not on the wire, so on a client it holds its constructed `false` for
  // the whole session. Watching it was worse than useless, because it told an
  // addon author the loader would report a transition it can never see.
  it('notices the boolean dead flipping', () => {
    expect(changed('player', entity({ dead: false }), entity({ dead: true }))).toBe(true);
  });

  it('does not confuse a false flag with a missing one', () => {
    const withFlag = entity({ dead: false });
    const withoutFlag = entity();
    Reflect.deleteProperty(withoutFlag, 'dead');

    expect(changed('player', withFlag, withoutFlag)).toBe(true);
  });

  // Position moves every tick. Including it would make world.on('player') fire
  // at the frame rate and mean nothing.
  it('ignores position', () => {
    expect(changed('player', entity({ pos: { x: 1 } }), entity({ pos: { x: 900 } }))).toBe(false);
  });

  it('treats an absent player as its own reading', () => {
    expect(changed('player', null, entity())).toBe(true);
  });
});

describe('target', () => {
  it('notices a different target', () => {
    expect(changed('target', entity({ id: 248 }), entity({ id: 250 }))).toBe(true);
  });

  it('notices clearing the target', () => {
    expect(changed('target', entity({ id: 248 }), null)).toBe(true);
  });

  // The target's own health moves constantly; that belongs to whoever reads the
  // entity, not to a change event about which target is selected.
  it('is quiet while the same target takes damage', () => {
    expect(changed('target', entity({ id: 248, hp: 900 }), entity({ id: 248, hp: 40 }))).toBe(
      false,
    );
  });
});

describe('entities', () => {
  const roster = (...ids: number[]): Map<number, unknown> => new Map(ids.map((id) => [id, { id }]));

  it('notices one entering interest scope', () => {
    expect(changed('entities', roster(1, 2), roster(1, 2, 3))).toBe(true);
  });

  it('notices one leaving', () => {
    expect(changed('entities', roster(1, 2, 3), roster(1, 2))).toBe(true);
  });

  // A checksum would miss this: removing 4 and adding 6 while removing 7 and
  // adding 5 leaves both the count and the sum untouched.
  it('notices a swap that leaves the count and the sum alone', () => {
    expect(changed('entities', roster(4, 7), roster(5, 6))).toBe(true);
  });

  it('is quiet while the same roster moves around', () => {
    const before = new Map<number, unknown>([[1, { hp: 100 }]]);
    const after = new Map<number, unknown>([[1, { hp: 3 }]]);

    expect(changed('entities', before, after)).toBe(false);
  });

  it('does not care what order the map iterates', () => {
    expect(changed('entities', roster(3, 1, 2), roster(1, 2, 3))).toBe(false);
  });
});

describe('party', () => {
  const party = (members: unknown[], leader = 1): Record<string, unknown> => ({
    leader,
    raid: false,
    members,
  });

  it('notices a member joining', () => {
    expect(changed('party', party([{ pid: 1 }]), party([{ pid: 1 }, { pid: 2 }]))).toBe(true);
  });

  it('notices a member taking damage', () => {
    expect(changed('party', party([{ pid: 1, hp: 500 }]), party([{ pid: 1, hp: 100 }]))).toBe(true);
  });

  it('notices a member dying', () => {
    expect(changed('party', party([{ pid: 1, dead: 0 }]), party([{ pid: 1, dead: 1 }]))).toBe(true);
  });

  it('notices the leader changing', () => {
    expect(changed('party', party([{ pid: 1 }], 1), party([{ pid: 1 }], 2))).toBe(true);
  });

  // A tank losing threat is the raid-frame alert, and before this field was
  // watched the row's own hp was the only thing that could wake a subscriber.
  it('notices a member gaining aggro', () => {
    const before = party([{ pid: 1, hasAggro: 0 }]);
    const after = party([{ pid: 1, hasAggro: 1 }]);

    expect(changed('party', before, after)).toBe(true);
  });

  it('notices a member dropping link', () => {
    const before = party([{ pid: 1, connected: 1 }]);
    const after = party([{ pid: 1, connected: 0 }]);

    expect(changed('party', before, after)).toBe(true);
  });

  it('notices a shield soaking damage', () => {
    const before = party([{ pid: 1, absorb: 400 }]);
    const after = party([{ pid: 1, absorb: 120 }]);

    expect(changed('party', before, after)).toBe(true);
  });

  // A dispel alert is the reason to watch a party at all, and the strip a row
  // carries is the only place a member's debuffs are readable.
  it('notices a debuff landing on a member', () => {
    const before = party([{ pid: 1, auras: [] }]);
    const after = party([{ pid: 1, auras: [{ id: 'curse_of_agony', neg: 1 }] }]);

    expect(changed('party', before, after)).toBe(true);
  });

  it('notices one of two members being dispelled', () => {
    const before = party([{ pid: 1, auras: [{ id: 'poison' }] }, { pid: 2 }]);
    const after = party([{ pid: 1, auras: [] }, { pid: 2 }]);

    expect(changed('party', before, after)).toBe(true);
  });

  // A row's strip is redrawn as its auras tick. Watching the remaining time would
  // make every party in combat a per-frame wake-up.
  it('is quiet while a member aura ticks down', () => {
    const before = party([{ pid: 1, auras: [{ id: 'renew', remaining: 12 }] }]);
    const after = party([{ pid: 1, auras: [{ id: 'renew', remaining: 2 }] }]);

    expect(changed('party', before, after)).toBe(false);
  });

  // The separator matters: without it a member whose strip ran into the next
  // member's scalars could read the same either way.
  it('does not let one member absorb the next one', () => {
    const before = party([{ pid: 1, auras: [{ id: 'a' }] }, { pid: 2 }]);
    const after = party([{ pid: 1 }, { pid: 2, auras: [{ id: 'a' }] }]);

    expect(changed('party', before, after)).toBe(true);
  });

  it('notices leaving the party entirely', () => {
    expect(changed('party', party([{ pid: 1 }]), null)).toBe(true);
  });

  it('is quiet on an unchanged party', () => {
    expect(changed('party', party([{ pid: 1, hp: 5 }]), party([{ pid: 1, hp: 5 }]))).toBe(false);
  });
});

describe('inventory', () => {
  it('notices an item arriving', () => {
    const before = [{ itemId: 'ore', count: 1 }];
    const after = [...before, { itemId: 'gem', count: 1 }];

    expect(changed('inventory', before, after)).toBe(true);
  });

  it('notices a stack growing', () => {
    expect(changed('inventory', [{ itemId: 'ore', count: 1 }], [{ itemId: 'ore', count: 2 }])).toBe(
      true,
    );
  });

  it('notices two different items with the same count', () => {
    expect(changed('inventory', [{ itemId: 'ore', count: 1 }], [{ itemId: 'gem', count: 1 }])).toBe(
      true,
    );
  });

  it('is quiet on an unchanged bag', () => {
    const bag = [{ itemId: 'ore', count: 3 }];

    expect(changed('inventory', bag, [...bag])).toBe(false);
  });
});

describe('quests', () => {
  const quests = (log: [string, unknown][], done: string[] = []): Record<string, unknown> => ({
    log: new Map(log),
    done: new Set(done),
  });

  it('notices a quest being accepted', () => {
    expect(changed('quests', quests([]), quests([['q1', { state: 'active' }]]))).toBe(true);
  });

  // Objective counters are what a quest tracker addon exists to render.
  it('notices objective progress', () => {
    const before = quests([['q1', { state: 'active', counts: [0, 0] }]]);
    const after = quests([['q1', { state: 'active', counts: [1, 0] }]]);

    expect(changed('quests', before, after)).toBe(true);
  });

  it('notices a quest becoming ready to turn in', () => {
    const before = quests([['q1', { state: 'active', counts: [3] }]]);
    const after = quests([['q1', { state: 'ready', counts: [3] }]]);

    expect(changed('quests', before, after)).toBe(true);
  });

  it('notices a quest being completed', () => {
    expect(changed('quests', quests([], []), quests([], ['q1']))).toBe(true);
  });

  // The client replaces the map rather than mutating it, so equal content across
  // two different objects has to read as unchanged.
  it('is quiet when a replaced map carries the same content', () => {
    const before = quests([['q1', { state: 'active', counts: [1] }]], ['q0']);
    const after = quests([['q1', { state: 'active', counts: [1] }]], ['q0']);

    expect(changed('quests', before, after)).toBe(false);
  });
});

describe('cooldowns', () => {
  const cds = (entries: [string, number][]): Map<string, number> => new Map(entries);

  it('notices an ability going on cooldown', () => {
    expect(changed('cooldowns', cds([]), cds([['fireball', 8]]))).toBe(true);
  });

  it('notices one coming back up', () => {
    expect(changed('cooldowns', cds([['fireball', 1]]), cds([['fireball', 0]]))).toBe(true);
  });

  // Remaining time ticks down every frame. Watching the value would make this
  // fire constantly and tell an addon nothing it did not already know.
  it('is quiet while a cooldown counts down', () => {
    expect(changed('cooldowns', cds([['fireball', 8]]), cds([['fireball', 2]]))).toBe(false);
  });

  it('does not care which order the map iterates', () => {
    const before = cds([
      ['a', 1],
      ['b', 1],
    ]);
    const after = cds([
      ['b', 1],
      ['a', 1],
    ]);

    expect(changed('cooldowns', before, after)).toBe(false);
  });
});

describe('auras', () => {
  it('notices a buff being applied', () => {
    expect(changed('auras', [], [{ id: 'blessing', sourceId: 1 }])).toBe(true);
  });

  it('notices one falling off', () => {
    expect(changed('auras', [{ id: 'blessing', sourceId: 1 }], [])).toBe(true);
  });

  // Two casters can apply the same aura, and a tracker has to see both.
  it('separates the same aura from two sources', () => {
    const before = [{ id: 'renew', sourceId: 1 }];
    const after = [
      { id: 'renew', sourceId: 1 },
      { id: 'renew', sourceId: 2 },
    ];

    expect(changed('auras', before, after)).toBe(true);
  });

  // Remaining seconds move every frame; a refresh that keeps the same auras is
  // not a change worth waking anyone for.
  it('is quiet while an aura ticks down', () => {
    const before = [{ id: 'renew', sourceId: 1, remaining: 12 }];
    const after = [{ id: 'renew', sourceId: 1, remaining: 3 }];

    expect(changed('auras', before, after)).toBe(false);
  });
});

describe('casts', () => {
  const casting = (entries: [number, unknown][]): Map<number, unknown> => new Map(entries);

  it('notices a boss starting a cast', () => {
    const after = casting([[248, { ability: 'deathless_rage', remaining: 10, total: 10 }]]);

    expect(changed('casts', casting([]), after)).toBe(true);
  });

  it('notices a cast finishing', () => {
    const before = casting([[248, { ability: 'soul_rend' }]]);

    expect(changed('casts', before, casting([]))).toBe(true);
  });

  // The mechanic a boss chains into is the thing a mod warns on. Keying on the
  // entity alone would report the switch as no change and the warning would never
  // fire for the second cast.
  it('notices one cast being replaced by another on the same entity', () => {
    const before = casting([[248, { ability: 'soul_rend' }]]);
    const after = casting([[248, { ability: 'gravebreaker' }]]);

    expect(changed('casts', before, after)).toBe(true);
  });

  // A cast bar moves every frame. This is the whole reason the remaining time is
  // not in the signature.
  it('is quiet while a cast bar fills', () => {
    const before = casting([[248, { ability: 'soul_rend', remaining: 9.5, total: 10 }]]);
    const after = casting([[248, { ability: 'soul_rend', remaining: 0.2, total: 10 }]]);

    expect(changed('casts', before, after)).toBe(false);
  });

  it('separates the same ability cast by two entities', () => {
    const before = casting([[248, { ability: 'fireball' }]]);
    const after = casting([
      [248, { ability: 'fireball' }],
      [250, { ability: 'fireball' }],
    ]);

    expect(changed('casts', before, after)).toBe(true);
  });

  it('does not care which order the map iterates', () => {
    const before = casting([
      [1, { ability: 'a' }],
      [2, { ability: 'b' }],
    ]);
    const after = casting([
      [2, { ability: 'b' }],
      [1, { ability: 'a' }],
    ]);

    expect(changed('casts', before, after)).toBe(false);
  });
});

describe('targetAuras', () => {
  it('notices a debuff landing on the target', () => {
    expect(changed('targetAuras', [], [{ id: 'sunder', sourceId: 661 }])).toBe(true);
  });

  // A ramping debuff is the case this key exists for. Dread Curse stacks to ten,
  // and every stack is a refresh of the aura already there, so on the id and the
  // caster alone the whole ramp is invisible.
  it('notices a stack being added', () => {
    const before = [{ id: 'dread_curse', sourceId: 248, stacks: 4 }];
    const after = [{ id: 'dread_curse', sourceId: 248, stacks: 5 }];

    expect(changed('targetAuras', before, after)).toBe(true);
  });

  it('is quiet while a target debuff ticks down', () => {
    const before = [{ id: 'sunder', sourceId: 661, stacks: 3, remaining: 28 }];
    const after = [{ id: 'sunder', sourceId: 661, stacks: 3, remaining: 4 }];

    expect(changed('targetAuras', before, after)).toBe(false);
  });

  it('treats an unstacked aura and a one-stack aura as the same reading', () => {
    const before = [{ id: 'sunder', sourceId: 661 }];
    const after = [{ id: 'sunder', sourceId: 661, stacks: 1 }];

    expect(changed('targetAuras', before, after)).toBe(false);
  });
});

describe('hazards', () => {
  const ring = (id: string, remaining: number): Record<string, unknown> => ({
    id,
    kind: 'frostRing',
    radius: 8,
    remaining,
  });

  it('notices one appearing on the ground', () => {
    expect(changed('hazards', [], [ring('r1', 12)])).toBe(true);
  });

  it('notices one expiring', () => {
    expect(changed('hazards', [ring('r1', 1)], [])).toBe(true);
  });

  it('is quiet while one burns down', () => {
    expect(changed('hazards', [ring('r1', 12)], [ring('r1', 2)])).toBe(false);
  });

  it('treats a null reading as its own', () => {
    expect(changed('hazards', null, [])).toBe(false);
  });
});

describe('markers', () => {
  const marked = (entries: [number, number][]): Map<number, number> => new Map(entries);

  it('notices a marker being placed', () => {
    expect(changed('markers', marked([]), marked([[248, 1]]))).toBe(true);
  });

  // Both halves are the change: a raid leader moving the skull from one add to
  // another is the event, and the count is the same on either side of it.
  it('notices a marker moving to a different entity', () => {
    expect(changed('markers', marked([[248, 1]]), marked([[250, 1]]))).toBe(true);
  });

  it('notices the same entity being re-marked', () => {
    expect(changed('markers', marked([[248, 1]]), marked([[248, 4]]))).toBe(true);
  });

  it('is quiet on an unchanged assignment', () => {
    expect(changed('markers', marked([[248, 1]]), marked([[248, 1]]))).toBe(false);
  });
});

describe('sameCapture', () => {
  it('never treats a string and a set as equal', () => {
    expect(sameCapture('', new Set())).toBe(false);
  });
});
