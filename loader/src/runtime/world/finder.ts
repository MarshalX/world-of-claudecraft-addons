// The Dungeon Finder: your own queue state, and the realm's premade board.
//
// Two readings rather than one because they have different scopes and different
// lifetimes. Your finder state rides your self payload; the board is realm-wide
// and viewer-independent, serialized once per tick and shared by every session,
// so it is null until the client's mirror has synced rather than null because
// you are not queued.
//
// NOTHING HERE IS AN ACTION. This cannot join a queue, answer a proposal, create
// a listing or accept an applicant, and the game's own facet is explicit that
// the finder never teleports anyone.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

/** The three composition roles. Closed: the matcher has exactly three buckets. */
type FinderRole = 'tank' | 'healer' | 'dps';

/** Open slots under an activity's composition. */
interface RoleNeeds {
  tank: number;
  healer: number;
  dps: number;
}

/** Your automatic queue. Present while queued AND while held in a proposal. */
interface FinderQueue {
  /** The activity ids you picked, in catalogue order. */
  activities: readonly string[];
  /** Whole seconds since the ORIGINAL join, preserved across a failed proposal. */
  waited: number;
}

/**
 * A live availability proposal.
 *
 * COUNTS AND NO NAMES, deliberately: participants stay anonymous until the group
 * forms, so there is nobody to look up. `remaining` is whole seconds and comes
 * off the wire already counted down, unlike a loot roll's deadline.
 */
interface FinderProposal {
  id: number;
  activityId: string;
  /** The role you were slotted into. */
  role: FinderRole;
  size: number;
  accepted: number;
  acceptedByRole: RoleNeeds;
  response: 'pending' | 'accepted';
  remaining: number;
}

/** One applicant to your own listing. */
interface FinderApplicant {
  pid: number;
  /** Empty when the applicant is no longer in the world. */
  name: string;
  cls: string;
  level: number;
  roles: readonly FinderRole[];
}

/** Your own published listing, present only for its leader. */
interface FinderListing {
  id: number;
  activityId: string;
  /** Listing tags. Content, so open rather than a closed union. */
  tags: readonly string[];
  applicants: readonly FinderApplicant[];
}

/** Your finder state. Present for every character, so non-null says nothing about queueing. */
interface FinderInfo {
  /** Your sticky selection, already filtered to what you may currently fill. */
  roles: readonly FinderRole[];
  eligibleRoles: readonly FinderRole[];
  queue: FinderQueue | null;
  /** Whole seconds until you may queue again. 0 is clear. */
  cooldown: number;
  proposal: FinderProposal | null;
  listing: FinderListing | null;
  /** The listing id you have applied to, or null. */
  appliedTo: number | null;
}

/** One row of the public premade board. */
interface FinderListingRow {
  id: number;
  activityId: string;
  leaderName: string;
  tags: readonly string[];
  size: number;
  capacity: number;
  /** Null when the activity enforces no composition, which is not the same as zero needs. */
  needed: RoleNeeds | null;
  /** `role` is null for a member the composition matcher could not seat. */
  members: readonly { cls: string; level: number; role: FinderRole | null }[];
}

const ROLES: readonly FinderRole[] = ['tank', 'healer', 'dps'];

/** Activity ids and listing tags are both game content, so both are open strings. */
function stringsOf(values: readonly unknown[]): readonly string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

function roleOf(role: unknown): FinderRole | null {
  return ROLES.find((known) => known === role) ?? null;
}

/** Only the three the matcher has. An unrecognised role is dropped, never guessed. */
function rolesOf(values: readonly unknown[]): readonly FinderRole[] {
  const out: FinderRole[] = [];
  for (const value of values) {
    const role = roleOf(value);
    if (role !== null) {
      out.push(role);
    }
  }
  return out;
}

function needsOf(source: unknown): RoleNeeds {
  return {
    tank: fieldNumber(source, 'tank') ?? 0,
    healer: fieldNumber(source, 'healer') ?? 0,
    dps: fieldNumber(source, 'dps') ?? 0,
  };
}

/**
 * Open slots, or null for an activity that enforces no composition.
 *
 * NULL IS NOT ZERO. Zeroing it would tell a player that a listing with no
 * composition at all needs nobody, when the question does not apply to it.
 */
function neededOf(source: unknown): RoleNeeds | null {
  if (source === null) {
    return null;
  }
  return needsOf(source);
}

/**
 * Your queue, which the server also reports while a proposal holds you.
 *
 * Passed through as sent for that reason: a reader that decided for itself
 * whether a queue is live would drop the player out of the display at exactly
 * the moment their proposal is on screen.
 */
function queueOf(queue: unknown): FinderQueue | null {
  if (queue === null) {
    return null;
  }
  return {
    activities: stringsOf(fieldArray(queue, 'activities')),
    waited: fieldNumber(queue, 'waited') ?? 0,
  };
}

/** Two values only: a declining member leaves the proposal rather than being marked. */
function responseOf(response: string | null): FinderProposal['response'] {
  if (response === 'accepted') {
    return response;
  }
  return 'pending';
}

/**
 * The live proposal.
 *
 * `remaining` is passed through untouched: the server has already counted it
 * down against its own clock, unlike a loot roll's deadline, and running it
 * through the sim-clock conversion would subtract a clock from a duration.
 */
function proposalOf(proposal: unknown): FinderProposal | null {
  if (proposal === null) {
    return null;
  }
  return {
    id: fieldNumber(proposal, 'id') ?? 0,
    activityId: fieldString(proposal, 'activityId') ?? '',
    // The server's own fallback for a member it cannot seat.
    role: roleOf(fieldString(proposal, 'role')) ?? 'dps',
    size: fieldNumber(proposal, 'size') ?? 0,
    accepted: fieldNumber(proposal, 'accepted') ?? 0,
    acceptedByRole: needsOf(fieldValue(proposal, 'acceptedByRole')),
    response: responseOf(fieldString(proposal, 'myResponse')),
    remaining: fieldNumber(proposal, 'remaining') ?? 0,
  };
}

function applicantsOf(rows: readonly unknown[]): readonly FinderApplicant[] {
  return rows.map((row) => ({
    pid: fieldNumber(row, 'pid') ?? 0,
    name: fieldString(row, 'name') ?? '',
    cls: fieldString(row, 'cls') ?? '',
    level: fieldNumber(row, 'level') ?? 0,
    roles: rolesOf(fieldArray(row, 'roles')),
  }));
}

function listingOf(listing: unknown): FinderListing | null {
  if (listing === null) {
    return null;
  }
  return {
    id: fieldNumber(listing, 'id') ?? 0,
    activityId: fieldString(listing, 'activityId') ?? '',
    tags: stringsOf(fieldArray(listing, 'tags')),
    applicants: applicantsOf(fieldArray(listing, 'applicants')),
  };
}

/** Your finder state, or null before the finder key has arrived. */
function readFinder(world: unknown): FinderInfo | null {
  const info = fieldValue(world, 'dungeonFinderInfo');
  if (info === null) {
    return null;
  }
  return {
    roles: rolesOf(fieldArray(info, 'roles')),
    eligibleRoles: rolesOf(fieldArray(info, 'eligibleRoles')),
    queue: queueOf(fieldValue(info, 'queue')),
    cooldown: fieldNumber(info, 'cooldown') ?? 0,
    proposal: proposalOf(fieldValue(info, 'proposal')),
    listing: listingOf(fieldValue(info, 'myListing')),
    // Flattened: the wire wraps one number in a one-field object.
    appliedTo: fieldNumber(fieldValue(info, 'myApplication'), 'listingId'),
  };
}

function membersOf(rows: readonly unknown[]): FinderListingRow['members'] {
  return rows.map((row) => ({
    cls: fieldString(row, 'cls') ?? '',
    level: fieldNumber(row, 'level') ?? 0,
    role: roleOf(fieldString(row, 'role')),
  }));
}

function rowOf(row: unknown): FinderListingRow {
  return {
    id: fieldNumber(row, 'id') ?? 0,
    activityId: fieldString(row, 'activityId') ?? '',
    leaderName: fieldString(row, 'leaderName') ?? '',
    tags: stringsOf(fieldArray(row, 'tags')),
    size: fieldNumber(row, 'size') ?? 0,
    capacity: fieldNumber(row, 'capacity') ?? 0,
    needed: neededOf(fieldValue(row, 'needed')),
    members: membersOf(fieldArray(row, 'members')),
  };
}

/**
 * The realm's open listings, or null before the first sync.
 *
 * The two absences are DIFFERENT and both reach a display: null is "the mirror
 * has not synced yet" and an empty array is "nobody is listing". So the array
 * has to be tested for rather than the key's presence.
 */
function readFinderBoard(world: unknown): readonly FinderListingRow[] | null {
  const board = fieldValue(world, 'dungeonFinderBoard');
  if (!Array.isArray(board)) {
    return null;
  }
  return (board as readonly unknown[]).map((row) => rowOf(row));
}

export type {
  FinderApplicant,
  FinderInfo,
  FinderListing,
  FinderListingRow,
  FinderProposal,
  FinderQueue,
  FinderRole,
  RoleNeeds,
};
export { readFinder, readFinderBoard };
