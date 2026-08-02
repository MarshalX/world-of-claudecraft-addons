// The group's view of an open loot roll, and the vote landing on it.
//
// Its own file rather than a section of `world-group.test.ts` because it is the
// first read on this API that is a CALL rather than a field, and three of the
// cases below exist only because of that. The client's mirror field is private
// and can be renamed by a game release without anything noticing; the accessor
// is the member the game's own parity suite pins, so the loader calls it and
// guards the call in all three ways it can fail.
//
// The fourth case is the semantic a display gets wrong silently: a candidate
// with no answer is what the group is WAITING ON, and is not someone who passed.

import { describe, expect, it } from 'vitest';
import { readGroup } from '../loader/src/runtime/world/group.ts';
import { groupSignature } from '../loader/src/runtime/world/signature-group.ts';

const ME = 1;
const MATE = 2;
const ROLL = 7;
const NOW = 100;

function statusRow(entries: unknown[], over: Record<string, unknown> = {}) {
  return {
    rollId: ROLL,
    itemId: 'redbrook_blade',
    itemName: 'Redbrook Blade',
    quality: 'rare',
    expiresAt: 130,
    entries,
    ...over,
  };
}

function worldWith(rows: unknown[]) {
  return { lootRollGroupStatus: () => rows };
}

const UNDECIDED = worldWith([
  statusRow([
    { pid: ME, name: 'Mine', choice: 'need' },
    { pid: MATE, name: 'Mate', choice: null },
  ]),
]);

describe('readGroup rollStatus', () => {
  it('turns the sim deadline into seconds remaining, as the prompt already does', () => {
    expect(readGroup(UNDECIDED, NOW)?.rollStatus[0]?.remaining).toBe(30);
    expect(readGroup(UNDECIDED, null)?.rollStatus[0]?.remaining).toBeNull();
  });

  it('carries every candidate on the roll with what they answered', () => {
    const votes = readGroup(UNDECIDED, NOW)?.rollStatus[0]?.votes;

    expect(votes).toEqual([
      { pid: ME, name: 'Mine', choice: 'need' },
      { pid: MATE, name: 'Mate', choice: null },
    ]);
  });

  // The one semantic a vote strip gets wrong silently: null is the group still
  // waiting on somebody, and a pass is an answer.
  it('reads an unanswered candidate as undecided rather than as a pass', () => {
    const passed = worldWith([statusRow([{ pid: MATE, name: 'Mate', choice: 'pass' }])]);

    expect(readGroup(UNDECIDED, NOW)?.rollStatus[0]?.votes[1]?.choice).toBeNull();
    expect(readGroup(passed, NOW)?.rollStatus[0]?.votes[0]?.choice).toBe('pass');
  });

  it('reads a choice the union does not have as undecided, never into the union', () => {
    const future = worldWith([statusRow([{ pid: MATE, name: 'Mate', choice: 'disenchant' }])]);

    expect(readGroup(future, NOW)?.rollStatus[0]?.votes[0]?.choice).toBeNull();
  });

  // The read is a CALL, and these two are why it is guarded rather than made.
  it('answers an empty list for a world that has no such member', () => {
    expect(readGroup({}, NOW)?.rollStatus).toEqual([]);
  });

  it('answers an empty list when the call itself throws', () => {
    const broken = {
      lootRollGroupStatus: () => {
        throw new Error('a game update left something callable that no longer works');
      },
    };

    expect(readGroup(broken, NOW)?.rollStatus).toEqual([]);
    expect(readGroup(broken, NOW)?.rolls).toEqual([]);
  });

  it('answers an empty list when the call returns something that is not a list', () => {
    expect(readGroup({ lootRollGroupStatus: () => null }, NOW)?.rollStatus).toEqual([]);
  });
});

describe('groupSignature over rollStatus', () => {
  // Without this the whole feature is invisible to `world.on('group')`: `rolls`
  // reports only that a roll opened.
  it('reports a vote landing', () => {
    const before = readGroup(UNDECIDED, NOW);
    const after = readGroup(
      worldWith([
        statusRow([
          { pid: ME, name: 'Mine', choice: 'need' },
          { pid: MATE, name: 'Mate', choice: 'greed' },
        ]),
      ]),
      NOW,
    );

    expect(groupSignature(after)).not.toBe(groupSignature(before));
  });

  // The existing contract, re-pinned now that a second timer rides this key.
  it('still ignores the seconds left on a roll', () => {
    expect(groupSignature(readGroup(UNDECIDED, NOW))).toBe(
      groupSignature(readGroup(UNDECIDED, NOW + 10)),
    );
  });

  it('reports a roll opening and closing', () => {
    expect(groupSignature(readGroup(UNDECIDED, NOW))).not.toBe(
      groupSignature(readGroup(worldWith([]), NOW)),
    );
  });
});
