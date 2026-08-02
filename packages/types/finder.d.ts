// The Dungeon Finder: your own queue state, and the realm's premade board.
//
// Two readings rather than one because they have different scopes and different
// lifetimes. Your finder state rides your own payload; the board is realm-wide
// and shared by every session, so it is null until your client's mirror has
// synced rather than null because you are not queued.
//
// NOTHING HERE IS AN ACTION. `world.finder` cannot join a queue, answer a
// proposal, create a listing or accept an applicant, and the game's own facet is
// explicit that the finder never teleports anyone.

/** The three composition roles. Closed: the matcher has exactly three buckets. */
export type FinderRole = 'tank' | 'healer' | 'dps';

/** Open slots under an activity's composition. */
export interface RoleNeeds {
  tank: number;
  healer: number;
  dps: number;
}

/** Your automatic queue. Present while queued AND while held in a proposal. */
export interface FinderQueue {
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
export interface FinderProposal {
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
export interface FinderApplicant {
  pid: number;
  /** Empty when the applicant is no longer in the world. */
  name: string;
  cls: string;
  level: number;
  roles: readonly FinderRole[];
}

/** Your own published listing, present only for its leader. */
export interface FinderListing {
  id: number;
  activityId: string;
  /** Listing tags. Content, so open rather than a closed union. */
  tags: readonly string[];
  applicants: readonly FinderApplicant[];
}

/** Your finder state. Present for every character, so non-null says nothing about queueing. */
export interface FinderInfo {
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
export interface FinderListingRow {
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
