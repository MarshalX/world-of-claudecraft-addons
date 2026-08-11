// The combat records, split from the rest of the catalogue in `events.d.ts`.
//
// Not an arbitrary split to fit a file: these are the records an author reaches
// for first, they are the ones carrying the traps described below, and they are
// the only ones with a shape subtle enough to need explaining at length. The map
// from a kind to its record lives in `events.d.ts` and covers both files.

import type { School } from './entity.js';
import type { PersonalEvent } from './events.js';

/** How an attack landed. */
export type DamageKind = 'hit' | 'miss' | 'dodge' | 'parry' | 'block' | 'resist' | 'evade';

export interface DamageEvent extends PersonalEvent {
  type: 'damage';
  sourceId: number;
  /**
   * Who owned the source when the record was emitted, for a pet or guardian.
   *
   * The one thing `world.entities.get(sourceId)?.ownerId` cannot answer. A pet
   * despawns when its owner dies, so the killing blow's source is gone from the
   * snapshot by the time an addon reads it, and a meter resolving the owner from
   * the snapshot drops exactly the damage around a death. This is snapshotted at
   * emit, so it survives that.
   *
   * Absent for anything with no owner, which is every player's own record and
   * every mob's, so absence means "nobody owned this" rather than "not known".
   * Still ask the question AGAINST your own id: an owner id is an owner id, and
   * a stranger's pet carries one too.
   *
   * Added in game 0.36.0, so a server older than that sends nothing and the
   * snapshot lookup stays the fallback.
   */
  sourceOwnerId?: number;
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
  /**
   * The ability's stable content ID, on a PLAYER's primary direct hit only.
   */
  abilityId?: string | null;
  kind: DamageKind;
  /**
   * Absorbed by a shield. Absent when nothing absorbed any of it, and never 0.
   *
   * The damage side needs none of the disambiguation `Heal2Event.absorbed`
   * carries, because `kind` already draws the distinction: a fully absorbed hit
   * is a `hit` landing at `amount: 0`, where a swing that never connected says
   * `miss`, `dodge`, `parry`, `resist` or `evade` instead.
   */
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
  /**
   * How much of this heal a heal-absorb shield ate before it could land.
   * Absent when nothing absorbed any of it, and never 0.
   *
   * This is the other half of the `cueOnly` warning below, and the two are one
   * story rather than two rules. `amount: 0` on a heal is ambiguous on its own:
   * it means EITHER the target was already at full health OR a shield devoured
   * the whole thing, and those deserve opposite feedback, since the first is a
   * wasted cast and the second is a target sitting at low health who is not
   * being healed at all. This field is what separates them. An `amount: 0`
   * carrying `absorbed` was eaten; an `amount: 0` with no `absorbed` was
   * overhealing.
   *
   * Absent does NOT mean nothing was absorbed anywhere, only that this record is
   * not reporting any. The direct heal path is the one that fills it: a heal over
   * time's periodic tick bypasses absorb shields entirely, and one redirect path
   * (Chronomancy's Temporal Echo) consumes the shield without reporting it and
   * emits no record at all when the shield eats the whole heal.
   *
   * Genuinely ABSENT rather than null, which is worth saying because the adjacent
   * `DamageEvent.abilityId` is the opposite: that one rides every record and is
   * null when it has nothing to say, while this key is simply not written. Test
   * it against undefined, never against null.
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
   * This is the number the `absorbed` note above reasons around without having:
   * an `amount: 0` carrying no `absorbed` was overhealing, and this says how
   * much. It is computed AFTER absorb consumption, so `absorbed` and `overheal`
   * describe different lost healing and adding them double-counts nothing.
   *
   * IT REPORTS PARTIAL OVERHEALING ONLY, and a total built on it is wrong.
   * Every emit site still fires only when some healing actually landed, so a
   * tick that overheals COMPLETELY emits no record at all: there is nothing to
   * carry the field, and the healing it wasted is invisible. An "overheal
   * percentage" summed from this field therefore counts the partial waste
   * against a total that excludes the full waste, and reads lower than the
   * truth by an amount that grows the longer the target sits at full health.
   * Present it as "overhealing seen on landed heals", not as a percentage.
   */
  overheal?: number;
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
 * `name` is a DISPLAY NAME, the same string a damage record carries. The four
 * attribution fields below can identify the effect instead, but only on some
 * records: test each one for presence rather than assuming it. To know which
 * aura is on an entity right now, read that entity's own aura list, which
 * carries ids, stacks and durations on every entry.
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
   */
  abilityId?: string;
  /** Stack count at application. Absent on the bare emits, not 0. */
  stacks?: number;
  /**
   * This gain DISPLACED a same-id same-name aura already on the target: a
   * re-application rather than a fresh one.
   *
   * No fade is emitted for the aura it replaced, so a duration tracker counting
   * gains against fades needs this to avoid double-counting. Nothing on the
   * record could previously distinguish the two.
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
 * It fires for a player's cast, a pet's cast, and for the timed ACTIVITIES the
 * game runs through the same cast machinery. A mob's mechanic sets its cast
 * state directly instead, so a boss warning built on this receives silence and
 * cannot tell that from a boss that never casts. Watch `world.casts` for
 * anything but your own casting.
 */
export interface CastStartEvent extends PersonalEvent {
  type: 'castStart';
  entityId: number;
  /**
   * An ability ID, unlike the display name a damage record carries, OR an
   * activity sentinel.
   *
   * The sentinel is a fixed marker naming the activity rather than any ability:
   * gathering and fishing were the first two, and the crafting family
   * (crafting, disenchanting, enchanting, salvaging, tool recharge) followed.
   * THE SET GROWS WITH THE GAME, so match the ones you care about by name and
   * let an unrecognised value fall through as an ability id rather than
   * enumerating the sentinels and assuming the list is complete. A sentinel
   * never resolves in `world.abilities` and never has icon art.
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
  /**
   * An ability ID, carried only where the ground cast has authored art of its
   * own. Absent leaves you the school and nothing else.
   *
   * An ID, not the display name a `damage` or `heal2` record carries, so this is
   * the field to build an icon URL from and never the one to match a meter row
   * against.
   */
  ability?: string;
  /** Blast radius in yards, when the effect has one. */
  radius?: number;
}
