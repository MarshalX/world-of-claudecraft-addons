// The combat records the socket carries, split from `events.ts` the way the published types split.
// A kind added here is unreachable until the map in `events.ts` names it.

import type { School } from '../world/game-types.ts';
import type { PersonalEvent } from './events.ts';

/**
 * `evade` is a mob refusing the hit while immune, always at amount 0. Two opposite causes: a
 * leashed mob has dropped its hate table, while one pinned inside an instance still holds it.
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
  /** Rarely present; read as optional. */
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
   * Healing lost to the missing-hp clamp, after absorb, absent rather than 0. PARTIAL ONLY: a fully
   * overhealed tick emits no record at all.
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
