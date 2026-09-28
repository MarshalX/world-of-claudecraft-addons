// The combat records. The map from a kind to its record lives in `events.d.ts`.

import type { School } from './entity.js';
import type { PersonalEvent } from './events.js';

/**
 * How an attack landed.
 *
 * `evade` is a mob refusing a DIRECT hit while immune, always at `amount: 0`. It
 * has two causes the record does not separate: a mob that broke leash and is
 * walking home, and a mob pinned in a dungeon or raid room because it cannot reach
 * you, which keeps its hate table and swings again when it can. Never read an
 * evade as the pull ending.
 */
export type DamageKind = 'hit' | 'miss' | 'dodge' | 'parry' | 'block' | 'resist' | 'evade';

export interface DamageEvent extends PersonalEvent {
  type: 'damage';
  sourceId: number;
  /**
   * Who owned the source when the record was emitted, for a pet or guardian.
   *
   * Taken at emit, so it survives the pet despawning when its owner dies, which
   * `world.entities.get(sourceId)?.ownerId` does not. Read this first and fall
   * back to that lookup.
   *
   * Absent means "nobody owned this" (a player's or a mob's own record). Compare
   * it AGAINST your own id: a stranger's pet carries an owner id too.
   */
  sourceOwnerId?: number;
  targetId: number;
  amount: number;
  crit: boolean;
  school: School;
  /**
   * The ability's DISPLAY NAME, or null for an auto-attack swing.
   *
   * Not an id: ids and names diverge. `world.abilities.byName` converts it for an
   * ability you know; a mob's or pet's ability resolves to null there.
   */
  ability: string | null;
  /**
   * The ability's stable content ID, on a PLAYER's primary direct hit, and on the
   * few other hits the game names: a player pet's ranged bolt, a guardian's
   * strike, some named procs, and sourceless environmental hazards. A pet bolt's
   * id is the pet's own and has no icon art.
   *
   * NULL, not absent, on everything else (auto-attacks, periodic ticks, echoed or
   * fanned-out copies, a pet's melee, every mob record), so test the value, not
   * the key, and fall back to `school`. Absent only from a server predating the
   * field.
   */
  abilityId?: string | null;
  kind: DamageKind;
  /**
   * Absorbed by a shield. Absent when nothing absorbed any of it, and never 0.
   *
   * A fully absorbed hit is a `hit` at `amount: 0`; a swing that never connected
   * has another `kind`.
   */
  absorbed?: number;
  /** Set when a ranged shot's animation already began at projectile launch. */
  attackAnimationStarted?: boolean;
}

/**
 * A heal, and the ONLY heal record that can be attributed.
 *
 * The plain `heal` kind carries no source, so a meter crediting healers reads
 * `heal2`.
 */
export interface Heal2Event extends PersonalEvent {
  type: 'heal2';
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  /** A DISPLAY NAME, like `DamageEvent.ability`. Use `abilityId` for the id. */
  ability: string;
  /**
   * How much of this heal a heal-absorb shield ate before it could land.
   * Absent when nothing absorbed any of it, and never 0.
   *
   * It separates the two meanings of `amount: 0`: with `absorbed`, a shield ate
   * the heal (a low target not being healed); without it, the target was full.
   *
   * A direct heal, a heal-over-time tick and a damage-over-time leech report it.
   * A channel's self-heal tick never touches a shield.
   *
   * TWO REDIRECT PATHS drain a shield without reporting it: Chronomancy's Temporal
   * Echo and the paladin's Beacon of Light transfer emit `overheal` and no
   * `absorbed`, and no record at all when the shield eats the whole heal.
   *
   * ABSENT, never null (unlike `DamageEvent.abilityId`): test against undefined.
   */
  absorbed?: number;
  /** Set on a periodic tick of a heal over time, never on the cast itself. */
  hot?: boolean;
  /** The applying aura's ability id, on both the tick and the application. */
  abilityId?: string;
  /**
   * How much of this heal was lost to the target's missing-health clamp.
   * Absent when none of it was, and never 0.
   *
   * Computed AFTER absorb consumption, so `absorbed` and `overheal` never overlap.
   *
   * A DIRECT HEAL always emits, so one into a full target carries the whole cast
   * here. A PERIODIC TICK emits only when some healing landed or a shield was
   * drained, and DERIVED HEALING (a beacon transfer, a cascade, a channel's
   * self-heal) emits nothing when nothing landed, so those wastes are invisible.
   * An overheal percentage therefore reads LOW; label it "on landed heals", or
   * restrict it to direct heals, where it is exact.
   */
  overheal?: number;
  /**
   * This record carries NO healing and exists only to drive a sound.
   *
   * Skip it ON THIS FLAG, never on `amount === 0`: a genuine direct heal also
   * lands at 0 on a full-health target.
   */
  cueOnly?: boolean;
}

/**
 * An effect arriving on or leaving an entity.
 *
 * `name` is a DISPLAY NAME. The four optional fields below appear only on some
 * records, so test each for presence. For what is on an entity now, read its own
 * aura list, which carries ids on every entry.
 */
export interface AuraEvent extends PersonalEvent {
  type: 'aura';
  targetId: number;
  name: string;
  gained: boolean;
  /** What the effect does. Not present in any observed record. */
  auraKind?: string;
  /**
   * Who applied it.
   *
   * Present on the same records as `abilityId` and absent on the same ones, so
   * the note there describes this field too.
   */
  sourceId?: number;
  /**
   * The aura's stable content ID, and the ONLY route to a mob ability's id.
   *
   * Present on a gain, a refresh, and the fade of an aura displaced by
   * re-application; absent on most fades (expiry, dispel), and on any ability
   * that applies no aura. On a stack bump it is the CASTING ability's id, which
   * differs where two abilities share an aura kind. Keep the `name` path working.
   */
  abilityId?: string;
  /** Stack count at application. Absent on the bare emits, not 0. */
  stacks?: number;
  /**
   * This gain DISPLACED a same-id same-name aura already on the target: a
   * re-application rather than a fresh one.
   *
   * No fade is emitted for the aura it replaced, so a tracker counting gains
   * against fades needs this to avoid double-counting.
   */
  refresh?: boolean;
}

export interface DeathEvent extends PersonalEvent {
  type: 'death';
  entityId: number;
  killerId: number;
}

/**
 * A cast beginning. NOT emitted for a mob.
 *
 * It fires for a player's cast, a pet's cast, and the game's timed ACTIVITIES.
 * A mob's cast reaches you only through `world.casts`, which is what to watch
 * for anything but your own casting.
 */
export interface CastStartEvent extends PersonalEvent {
  type: 'castStart';
  entityId: number;
  /**
   * An ability ID, unlike the display name a damage record carries, OR an
   * activity sentinel.
   *
   * The sentinel is a fixed marker naming the activity rather than any ability.
   * MATCH THE LITERAL: `'enchanting'` and `'tool recharge'` never fire.
   *
   * ```js
   * const ACTIVITIES = new Set([
   *   'fishing',
   *   'gathering',
   *   'crafting',
   *   'disenchanting',
   *   'enchanting_apply',
   *   'salvaging',
   *   'sundering',
   *   'tool_recharge',
   *   'corpse_harvest',
   *   'demon_heal',
   *   'allied_hearthstone',
   * ]);
   * ```
   *
   * THE SET CHANGES WITH THE GAME in both directions, so match the ones you care
   * about and let an unrecognised value fall through as an ability id. A sentinel
   * never resolves in `world.abilities` and has no icon art.
   *
   * `demon_heal` is the warlock's demon-healing channel. It has no ability
   * definition, so handle it as a sentinel.
   */
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
 * It says nothing about damage. Pairing one with the damage that follows is
 * guesswork, and a mispairing draws the wrong ability's art.
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
  /**
   * An ability ID, carried only where the ground cast has authored art of its
   * own. Absent leaves you the school and nothing else.
   *
   * An ID, not a display name: build an icon URL from it, never match a meter row
   * against it.
   */
  ability?: string;
  /** Blast radius in yards, when the effect has one. */
  radius?: number;
}
