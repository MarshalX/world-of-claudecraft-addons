// The group's view of an open loot roll. The read is a call on the game's accessor, since the
// mirror field is private, so the loader guards each way the call can fail.

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
  it('turns the sim deadline into seconds remaining', () => {
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

  // Null is the group still waiting on somebody; a pass is an answer.
  it('reads an unanswered candidate as undecided, not as a pass', () => {
    const passed = worldWith([statusRow([{ pid: MATE, name: 'Mate', choice: 'pass' }])]);

    expect(readGroup(UNDECIDED, NOW)?.rollStatus[0]?.votes[1]?.choice).toBeNull();
    expect(readGroup(passed, NOW)?.rollStatus[0]?.votes[0]?.choice).toBe('pass');
  });

  it('reads a choice outside the union as undecided', () => {
    const future = worldWith([statusRow([{ pid: MATE, name: 'Mate', choice: 'disenchant' }])]);

    expect(readGroup(future, NOW)?.rollStatus[0]?.votes[0]?.choice).toBeNull();
  });

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
  // `rolls` reports only that a roll opened.
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

  it('ignores the seconds left on a roll', () => {
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
