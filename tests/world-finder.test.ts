// Dungeon Finder readings. A null `needed` means no composition is enforced, a null board
// means not yet synced, and a proposal's `remaining` is already counted down server-side.

import { describe, expect, it } from 'vitest';
import { readFinder, readFinderBoard } from '../loader/src/runtime/world/finder.ts';
import { boardSignature, finderSignature } from '../loader/src/runtime/world/signature-match.ts';

const LISTING = 41;
const APPLICANT = 12;

const PROPOSAL = {
  id: 5,
  activityId: 'thornpeak',
  role: 'healer',
  size: 5,
  accepted: 2,
  acceptedByRole: { tank: 1, healer: 1, dps: 0 },
  myResponse: 'pending',
  remaining: 23,
};

function infoWire(over: Record<string, unknown> = {}) {
  return {
    roles: ['healer', 'dps'],
    eligibleRoles: ['tank', 'healer', 'dps'],
    queue: { activities: ['thornpeak'], waited: 92 },
    cooldown: 0,
    proposal: null,
    myListing: null,
    myApplication: null,
    ...over,
  };
}

function readWith(over: Record<string, unknown> = {}) {
  return readFinder({ dungeonFinderInfo: infoWire(over) });
}

function rowWire(over: Record<string, unknown> = {}) {
  return {
    id: LISTING,
    activityId: 'thornpeak',
    leaderName: 'Lead',
    tags: ['first_run', 'learning'],
    size: 3,
    capacity: 5,
    needed: { tank: 1, healer: 0, dps: 1 },
    members: [{ cls: 'hunter', level: 20, role: 'dps' }],
    ...over,
  };
}

describe('readFinder', () => {
  it('reads the sticky selection, the queue and the eligible roles', () => {
    const finder = readWith();

    expect(finder?.roles).toEqual(['healer', 'dps']);
    expect(finder?.eligibleRoles).toEqual(['tank', 'healer', 'dps']);
    expect(finder?.queue).toEqual({ activities: ['thornpeak'], waited: 92 });
  });

  it('drops a role the matcher does not have', () => {
    expect(readWith({ roles: ['healer', 'bard'] })?.roles).toEqual(['healer']);
  });

  // `buildInfoFor` reports a queue for the live unit OR the one a proposal is holding.
  it('keeps a queue that a proposal is holding', () => {
    const held = readWith({
      queue: { activities: ['thornpeak'], waited: 140 },
      proposal: PROPOSAL,
    });

    expect(held?.queue?.waited).toBe(140);
    expect(held?.proposal?.id).toBe(5);
  });

  // Unlike the loot roll, this arrives already counted down.
  it('passes the proposal deadline through untouched', () => {
    expect(readWith({ proposal: PROPOSAL })?.proposal?.remaining).toBe(23);
    expect(readWith({ proposal: PROPOSAL })?.proposal?.acceptedByRole).toEqual({
      tank: 1,
      healer: 1,
      dps: 0,
    });
  });

  it('reads a response as accepted only when the server says so', () => {
    expect(readWith({ proposal: PROPOSAL })?.proposal?.response).toBe('pending');
    expect(
      readWith({ proposal: { ...PROPOSAL, myResponse: 'accepted' } })?.proposal?.response,
    ).toBe('accepted');
  });

  it('flattens the application to the listing id, and its absence to null', () => {
    expect(readWith({ myApplication: { listingId: LISTING } })?.appliedTo).toBe(LISTING);
    expect(readWith()?.appliedTo).toBeNull();
  });

  it('reads your own listing with its applicants in the order they applied', () => {
    const listing = readWith({
      myListing: {
        id: LISTING,
        activityId: 'thornpeak',
        tags: ['fast_run'],
        applicants: [
          { pid: APPLICANT, name: 'First', cls: 'mage', level: 19, roles: ['dps'] },
          { pid: 13, name: '', cls: 'warrior', level: 20, roles: ['tank', 'dps'] },
        ],
      },
    })?.listing;

    expect(listing?.applicants.map((a) => a.pid)).toEqual([APPLICANT, 13]);
    // An empty name is "the applicant left the world", not a nameless character.
    expect(listing?.applicants[1]?.name).toBe('');
  });

  it('answers null before the finder key has arrived', () => {
    expect(readFinder({})).toBeNull();
  });
});

describe('readFinderBoard', () => {
  it('answers null before the first sync and an array after it', () => {
    expect(readFinderBoard({})).toBeNull();
    expect(readFinderBoard({ dungeonFinderBoard: null })).toBeNull();
    expect(readFinderBoard({ dungeonFinderBoard: [] })).toEqual([]);
  });

  it('reads a row with its composition and its seated members', () => {
    const row = readFinderBoard({ dungeonFinderBoard: [rowWire()] })?.[0];

    expect(row?.needed).toEqual({ tank: 1, healer: 0, dps: 1 });
    expect(row?.capacity).toBe(5);
    expect(row?.members[0]?.role).toBe('dps');
  });

  it('keeps a null composition null', () => {
    expect(readFinderBoard({ dungeonFinderBoard: [rowWire({ needed: null })] })?.[0]?.needed).toBe(
      null,
    );
  });

  it('reads a member the matcher could not seat as having no role', () => {
    const unseated = rowWire({ members: [{ cls: 'mage', level: 12, role: null }] });

    expect(readFinderBoard({ dungeonFinderBoard: [unseated] })?.[0]?.members[0]?.role).toBeNull();
  });
});

describe('finderSignature', () => {
  it('ignores the seconds waited and the cooldown count', () => {
    const base = readWith();
    const waited = readWith({ queue: { activities: ['thornpeak'], waited: 400 } });
    const blocked = readWith({ cooldown: 90 });
    const nearlyClear = readWith({ cooldown: 1 });

    expect(finderSignature(waited)).toBe(finderSignature(base));
    expect(finderSignature(blocked)).toBe(finderSignature(nearlyClear));
    // The transition from blocked to clear IS what an addon acts on.
    expect(finderSignature(blocked)).not.toBe(finderSignature(base));
  });

  // Acceptance counts are in despite being numbers: each one is an event a player watches.
  it('reports an acceptance landing and ignores the proposal countdown', () => {
    const pending = readWith({ proposal: PROPOSAL });
    const ticking = readWith({ proposal: { ...PROPOSAL, remaining: 4 } });
    const accepted = readWith({
      proposal: { ...PROPOSAL, accepted: 3, acceptedByRole: { tank: 1, healer: 1, dps: 1 } },
    });

    expect(finderSignature(ticking)).toBe(finderSignature(pending));
    expect(finderSignature(accepted)).not.toBe(finderSignature(pending));
  });

  it('reports an applicant arriving on your own listing', () => {
    const empty = readWith({
      myListing: { id: LISTING, activityId: 'thornpeak', tags: [], applicants: [] },
    });
    const applied = readWith({
      myListing: {
        id: LISTING,
        activityId: 'thornpeak',
        tags: [],
        applicants: [{ pid: APPLICANT, name: 'A', cls: 'mage', level: 19, roles: ['dps'] }],
      },
    });

    expect(finderSignature(applied)).not.toBe(finderSignature(empty));
  });
});

describe('boardSignature', () => {
  it('reports a listing filling up and ignores who is in it', () => {
    const base = readFinderBoard({ dungeonFinderBoard: [rowWire()] });
    const bigger = readFinderBoard({ dungeonFinderBoard: [rowWire({ size: 4 })] });
    const swapped = readFinderBoard({
      dungeonFinderBoard: [rowWire({ members: [{ cls: 'priest', level: 20, role: 'healer' }] })],
    });

    expect(boardSignature(bigger)).not.toBe(boardSignature(base));
    expect(boardSignature(swapped)).toBe(boardSignature(base));
  });

  // Without the count both render as '', and an idle realm's first sync notifies nobody.
  it('separates a synced empty board from an unsynced one', () => {
    expect(boardSignature(readFinderBoard({ dungeonFinderBoard: [] }))).not.toBe(
      boardSignature(readFinderBoard({})),
    );
  });
});
