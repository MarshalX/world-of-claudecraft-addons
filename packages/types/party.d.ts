// The party and raid rows. A row exists for a member who is nowhere near you,
// which an entity does not, so a raid display reads the rows and reaches for an
// entity only for something a row does not carry.

import type { AuraKind, ResourceType } from './entity.js';

/** A compact aura summary for a party row. Not the full `Aura`. */
export interface PartyMemberAura {
  id: string;
  kind: AuraKind;
  /**
   * 1 when the effect's MAGNITUDE is negative. NOT "this is a debuff".
   *
   * It is set from `value < 0` alone, so a damage over time, a root, a stun and a
   * silence arrive without it: those are harmful by KIND. Pass the row to
   * `world.harmful`, which checks both.
   */
  neg?: 1;
  /** Whole seconds. Absent on an older snapshot. */
  remaining?: number;
}

/**
 * One party or raid row.
 *
 * These are the terse WIRE names, straight off the socket: a row carries `mhp`
 * where an entity carries `maxHp`, and the flags are 0 or 1, not booleans.
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
 * A row's auras carry no source, so there is no `mine` filter.
 */
export interface PartyAuraQuery {
  id?: string;
  kind?: string;
  /** True for debuffs only, false for buffs only, absent for both. */
  debuff?: boolean;
}
