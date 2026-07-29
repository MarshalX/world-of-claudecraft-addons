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
      'quests',
      'cooldowns',
      'auras',
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

describe('sameCapture', () => {
  it('never treats a string and a set as equal', () => {
    expect(sameCapture('', new Set())).toBe(false);
  });
});
