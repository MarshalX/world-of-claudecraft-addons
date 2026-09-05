// The combat records the game's socket carries, as the loader claims them.
//
// Split from `events.ts` for the reason `packages/types/events-combat.d.ts` is
// split from its own catalogue, and the two splits are deliberately the same
// shape: these are the records an author reaches for first, they carry the traps
// worth explaining, and keeping them together is what keeps either file under
// the size a module is allowed to be.
//
// The map from a kind to its record stays in `events.ts` and covers both files,
// so a kind added here is not reachable until it is named there.

import type { School } from '../world/game-types.ts';
import type { PersonalEvent } from './events.ts';

/**
 * `evade` is a wild mob refusing the hit while immune, and always lands at amount 0.
 *
 * TWO causes since game 0.41.4, and they say opposite things about the fight: a mob that
 * broke leash has dropped its hate table and is walking home, while one pinned in place
 * inside an instance still holds it and resumes the moment it can reach you again.
 */
type DamageKind = 'hit' | 'miss' | 'dodge' | 'parry' | 'block' | 'resist' | 'evade';

interface DamageEvent extends PersonalEvent {
  type: 'damage';
  sourceId: number;
  /** The source's owner at EMIT time, snapshotted so a despawn cannot lose it. */
  sourceOwnerId?: number;
  targetId: number;
  amount: number;
  crit: boolean;
  school: School;
  /** A display NAME, or null for an auto-attack. Never an ability id. */
  ability: string | null;
  /** A PLAYER ability's id, on the primary direct hit. Null on a mob, tick or echo. */
  abilityId?: string | null;
  kind: DamageKind;
  /** Not present on any of 205 records in the session this was written from. */
  absorbed?: number;
  attackAnimationStarted?: boolean;
}

interface Heal2Event extends PersonalEvent {
  type: 'heal2';
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  /** A display NAME. `abilityId` is the id. */
  ability: string;
  /** What a heal-absorb shield ate. Direct heals only, and absent rather than 0. */
  absorbed?: number;
  hot?: boolean;
  abilityId?: string;
  /** Carries no healing. Consumers skip on this flag, never on the amount. */
  cueOnly?: boolean;
  /**
   * Healing lost to the missing-hp clamp, absent rather than 0, and computed
   * after absorb so it never double-counts with `absorbed`.
   *
   * PARTIAL ONLY: every emit site still gates on `healed > 0`, so a tick that
   * fully overheals emits no record at all and cannot be reported here.
   */
  overheal?: number;
}

/**
 * An effect arriving or leaving. The four attribution fields ride the
 * `Sim.applyAura` path only, so every one of them is optional at the consumer.
 */
interface AuraEvent extends PersonalEvent {
  type: 'aura';
  targetId: number;
  name: string;
  gained: boolean;
  auraKind?: string;
  /** The caster's entity id. */
  sourceId?: number;
  /** The aura's own id, and the only route to a MOB ability's id at event time. */
  abilityId?: string;
  stacks?: number;
  /** A same-id same-name re-application, which emits no fade of its own. */
  refresh?: boolean;
}

interface DeathEvent extends PersonalEvent {
  type: 'death';
  entityId: number;
  killerId: number;
}

/** A player or pet cast, or an ACTIVITY sentinel. A mob never emits one. */
interface CastStartEvent extends PersonalEvent {
  type: 'castStart';
  entityId: number;
  /** An ID here, unlike the display name on a damage record, or a sentinel. */
  ability: string;
  time: number;
  gatherNodeType?: string;
}

interface CastStopEvent extends PersonalEvent {
  type: 'castStop';
  entityId: number;
  success: boolean;
}

interface SpellFxEvent extends PersonalEvent {
  type: 'spellfx';
  sourceId: number;
  targetId: number;
  school: School;
  fx: string;
  /** An ID, on the effects whose visual varies per ability. */
  ability?: string;
  duration?: number;
  range?: number;
  angle?: number;
  level?: number;
  attackAnimation?: 'ranged-shot';
  wand?: true;
}

interface SpellFxAtEvent extends PersonalEvent {
  type: 'spellfxAt';
  x: number;
  z: number;
  school: School;
  fx: string;
  /** An ID, on the ground casts that have authored art of their own. */
  ability?: string;
  radius?: number;
}

export type {
  AuraEvent,
  CastStartEvent,
  CastStopEvent,
  DamageEvent,
  DamageKind,
  DeathEvent,
  Heal2Event,
  SpellFxAtEvent,
  SpellFxEvent,
};
