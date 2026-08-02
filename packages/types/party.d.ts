// The party and raid rows, which read differently from everything else here.
//
// These are the terse WIRE names rather than the entity's: a row carries `mhp`
// where an entity carries `maxHp`, and the flags are 0 or 1 rather than
// booleans. Party rows come straight off the socket, which is the whole reason
// they are their own subject.
//
// A row also exists for a member who is nowhere near you, which an entity does
// not. For a raid display read the rows, which are complete, and reach for an
// entity only when you need something a row does not carry.

import type { AuraKind, ResourceType } from './entity.js';

/** A compact aura summary for a party row. Not the full `Aura`. */
export interface PartyMemberAura {
  id: string;
  kind: AuraKind;
  /**
   * 1 when the effect's MAGNITUDE is negative. NOT "this is a debuff".
   *
   * The server sets it from `value < 0` and nothing else, so a damage over time,
   * a root, a stun and a silence all arrive without it: those are harmful by
   * KIND rather than by sign. Reading it as a debuff flag is how a dispel
   * display comes to drop most of what a healer would actually dispel.
   *
   * Pass the row to `world.harmful` instead, which puts both clauses together.
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

/**
 * The same over a party row's strip, which is a smaller shape.
 *
 * A row's auras carry an id, a kind, whole seconds, and a debuff flag. No
 * source, so there is no `mine` here rather than one that silently does nothing.
 */
export interface PartyAuraQuery {
  id?: string;
  kind?: string;
  /** True for debuffs only, false for buffs only, absent for both. */
  debuff?: boolean;
}
