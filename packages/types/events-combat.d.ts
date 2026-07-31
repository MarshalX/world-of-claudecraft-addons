// The combat records, split from the rest of the catalogue in `events.d.ts`.
//
// Not an arbitrary split to fit a file: these are the records an author reaches
// for first, they are the ones carrying the traps described below, and they are
// the only ones with a shape subtle enough to need explaining at length. The map
// from a kind to its record lives in `events.d.ts` and covers both files.

import type { School } from './entity.js';
import type { PersonalEvent } from './events.js';

/** How an attack landed. */
export type DamageKind = 'hit' | 'miss' | 'dodge' | 'parry' | 'block' | 'resist';

export interface DamageEvent extends PersonalEvent {
  type: 'damage';
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  school: School;
  /**
   * The ability's DISPLAY NAME, or null for an auto-attack swing.
   *
   * Not an id, and the difference is not cosmetic: one recorded session showed
   * the same character casting `measured_shot` and dealing damage attributed to
   * "Fell Shot". `world.abilities.byName` converts it, for an ability you know;
   * a mob's ability is not in your spellbook and resolves to null there.
   */
  ability: string | null;
  kind: DamageKind;
  /** Absorbed by a shield. Absent when nothing absorbed any of it. */
  absorbed?: number;
  /** Set when a ranged shot's animation already began at projectile launch. */
  attackAnimationStarted?: boolean;
}

/**
 * A heal, and the ONLY heal record that can be attributed.
 *
 * The kind is `heal2` rather than `heal`, and the difference matters: the plain
 * `heal` kind carries a target and an amount with nothing to credit it to, so a
 * meter built on that one can show incoming healing and can never show who did it.
 */
export interface Heal2Event extends PersonalEvent {
  type: 'heal2';
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  /** A DISPLAY NAME, like `DamageEvent.ability`. Use `abilityId` for the id. */
  ability: string;
  /** Set on a periodic tick of a heal over time, never on the cast itself. */
  hot?: boolean;
  /** The applying aura's ability id, on both the tick and the application. */
  abilityId?: string;
  /**
   * This record carries NO healing and exists only to drive a sound.
   *
   * Ignore it in anything that counts, and do so ON THIS FLAG: `amount` is
   * always 0 here, and a genuine direct heal also lands at 0 on a full-health
   * target, so an amount test throws away real casts along with these.
   */
  cueOnly?: boolean;
}

/**
 * An effect arriving on or leaving an entity.
 *
 * It NAMES the effect and cannot identify it: there is no id on this record at
 * all, and 101 of them in a recorded session carried no kind either. The name is
 * a display name, the same string a damage record carries. To know which aura,
 * read the entity's own aura list, which carries ids, stacks and durations.
 */
export interface AuraEvent extends PersonalEvent {
  type: 'aura';
  targetId: number;
  name: string;
  gained: boolean;
  /** What the effect does. Not present in any observed record. */
  auraKind?: string;
}

export interface DeathEvent extends PersonalEvent {
  type: 'death';
  entityId: number;
  killerId: number;
}

/**
 * A cast beginning. NOT emitted for a mob.
 *
 * It fires for a player cast, a pet, gathering and fishing, and for nothing
 * else: a mob's mechanic sets its cast state directly, so a boss warning built
 * on this receives silence and cannot tell that from a boss that never casts.
 * Watch `world.casts` for anything but your own casting.
 */
export interface CastStartEvent extends PersonalEvent {
  type: 'castStart';
  entityId: number;
  /** An ability ID here, unlike the display name a damage record carries. */
  ability: string;
  /** Cast length in seconds. */
  time: number;
  /** Set only on a gathering cast, naming the node type. */
  gatherNodeType?: string;
}

export interface CastStopEvent extends PersonalEvent {
  type: 'castStop';
  entityId: number;
  success: boolean;
}

/**
 * A visual cue for the renderer, and one of the few places a mob's ability id
 * appears at all.
 *
 * Emitted for presentation, so it says nothing about damage. Correlating one
 * with the damage that follows is guesswork, and a mispairing draws the wrong
 * ability's art, which is worse than drawing none.
 */
export interface SpellFxEvent extends PersonalEvent {
  type: 'spellfx';
  sourceId: number;
  targetId: number;
  school: School;
  fx: string;
  /** An ability ID, carried only by effects whose visual varies per ability. */
  ability?: string;
  duration?: number;
  range?: number;
  angle?: number;
  level?: number;
  attackAnimation?: 'ranged-shot';
  /** Set for a wand swing, so it is not mistaken for a real cast. */
  wand?: true;
}

/** A ground-anchored visual, at a world point rather than on an entity. */
export interface SpellFxAtEvent extends PersonalEvent {
  type: 'spellfxAt';
  x: number;
  z: number;
  school: School;
  fx: string;
  /** Blast radius in yards, when the effect has one. */
  radius?: number;
}
