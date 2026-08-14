// The party and raid rows, split out of `game-types.ts`.
//
// A CLAIM ABOUT ANOTHER REPOSITORY like everything in that file, under all the
// same rules: asserted at the backend boundary rather than derived, and narrower
// than what the game carries.
//
// Its own module because `game-types.ts` outgrew the file limit, and this is the
// seam the PUBLISHED package already draws: `party.d.ts` sits beside
// `entity.d.ts` there for the reason it does here. A party row is not a small
// entity, it is a different shape read off a different part of the wire, which
// is what the terse names below are evidence of.

import type { AuraKind, ResourceType } from './game-types.ts';

/** A compact aura summary for a party row. Not the full `Aura`. */
export interface PartyMemberAura {
  id: string;
  kind: AuraKind;
  /**
   * 1 when the effect's MAGNITUDE is negative. Not "this is a debuff".
   *
   * The game sets it from `aura.value < 0` and nothing else, so a damage over
   * time, a root, a stun and a silence all arrive without it: they are harmful
   * by KIND rather than by sign. Reading it as a debuff flag is how a dispel
   * display comes to drop most of what a healer would dispel.
   *
   * `world.harmful` is the answer, and it puts both clauses back together.
   */
  neg?: 1;
  /** Whole seconds. Absent on an older snapshot. */
  remaining?: number;
}

/**
 * One party or raid row.
 *
 * These are the terse wire names, not the entity's: a row carries `mhp` where an
 * entity carries `maxHp`, and the flags are 0 or 1 rather than booleans. Party
 * rows come straight off the socket, which is why they read differently from
 * everything else here.
 */
export interface PartyMember {
  pid: number;
  name: string;
  /** The class id, e.g. 'hunter'. */
  cls: string;
  level: number;
  hp: number;
  mhp: number;
  res: number;
  mres: number;
  rtype: ResourceType | null;
  x: number;
  z: number;
  dead: number;
  inCombat: number;
  /** Raid subgroup. */
  group: 1 | 2;
  /** Remaining absorb total. Absent on an older snapshot. */
  absorb?: number;
  role?: 'tank' | 'healer' | 'dps';
  /** 0 only when the realm reports this member disconnected. */
  connected?: number;
  /** 1 while a living hostile is targeting this member. */
  hasAggro?: number;
  incomingHeal?: number;
  /** Absent on an older snapshot, which decodes as "no auras". */
  auras?: PartyMemberAura[];
}

export interface PartyInfo {
  /** The leader's pid. */
  leader: number;
  raid: boolean;
  members: PartyMember[];
}
