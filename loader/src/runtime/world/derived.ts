// Readings the game holds but does not hand over as one object.
//
// Everything in `game-types.ts` is a CLAIM about a shape the game already has.
// These three are different in kind: the loader computes them, so their shape is
// the loader's own and the only claim is about the fields they are computed FROM.
// They live together because each exists for the same reason, which is that the
// question an addon asks does not match the way the game happens to store it.
//
// `casts` is the important one. A mob's cast never emits a `castStart` event: the
// event fires for a player cast, a pet's cast and the game's timed activities, and
// every mob mechanic that shows a bar assigns its cast state directly instead. That state
// reaches the client on the per-entity wire (`cast`, `castRem`, `castTot`,
// `chan`) and nowhere else, so a boss mod subscribing to the event gets silence
// and cannot tell it from a boss that never casts. This is the read that closes
// that gap, and the diagnostics pane says so in as many words.

import { fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import type { Entity } from './game-types.ts';

/**
 * Every ground effect the wire carries a position for.
 *
 * The three raid warnings arrived with the Ignivar and Varkhul encounters at
 * game 0.41.0 and carry the same id/x/z/radius/duration/remaining shape the
 * first two do, which is why they cost a row each rather than a reader.
 *
 * TWO OF THAT RELEASE'S FAMILIES ARE DELIBERATELY ABSENT, and both would look
 * like omissions. `activeVarkhulCinderFires` carries no `remaining` at all,
 * because a cinder fire burns until the encounter clears it; `toHazard` refuses
 * an entry without one, so listing it would add a kind that can never produce a
 * row. Making `remaining` optional to fit it would change a published field's
 * shape for every hazard that has one. `activeVarkhulCinderOrbProjectiles` is a
 * MOVING orb with its own dirX/dirZ heading, so drawn as a static disc it marks
 * where the orb was when the snapshot left rather than where it is.
 */
const HAZARD_SOURCES = Object.freeze([
  ['frostRing', 'activeFrostRings'],
  ['temporalHourglass', 'activeTemporalHourglasses'],
  ['ignivarMeteor', 'activeIgnivarMeteors'],
  // biome-ignore lint/security/noSecrets: a member name copied from the game, which the entropy heuristic cannot tell from a token
  ['varkhulForgestorm', 'activeVarkhulForgestormWarnings'],
  // biome-ignore lint/security/noSecrets: a member name copied from the game, which the entropy heuristic cannot tell from a token
  ['varkhulAnvilMeteor', 'activeVarkhulAnvilMeteors'],
] as const);

/**
 * One ring or hourglass, or null when the entry does not carry a real one.
 *
 * The client already validates these field by field on decode and drops anything
 * that does not pass, so this is a narrowing rather than a second validation.
 * `innerRadius` is 0 for a hazard with no safe middle, which is what an hourglass
 * is: absent would make every consumer write the same `?? 0`.
 */
function toHazard(kind: HazardKind, entry: unknown): Hazard | null {
  const id = fieldString(entry, 'id');
  const radius = fieldNumber(entry, 'radius');
  const remaining = fieldNumber(entry, 'remaining');
  if (id === null || radius === null || remaining === null) {
    return null;
  }
  return {
    id,
    kind,
    x: fieldNumber(entry, 'x') ?? 0,
    z: fieldNumber(entry, 'z') ?? 0,
    radius,
    innerRadius: fieldNumber(entry, 'innerRadius') ?? 0,
    duration: fieldNumber(entry, 'duration') ?? remaining,
    remaining,
  };
}

/** What a cast bar on any entity says, self or not. */
export interface EntityCast {
  /** An ability id, or an activity sentinel. A sentinel is not an ability. */
  ability: string;
  /** Seconds left, against `total`. */
  remaining: number;
  total: number;
  /** Whether it is a channel, which drains rather than completes. */
  channeling: boolean;
}

export type HazardKind = (typeof HAZARD_SOURCES)[number][0];

/**
 * A ground effect with a position, a radius and a life.
 *
 * These are the only ground effects whose geometry rides the snapshot, and they
 * are interest-filtered around the player. Every other ground AoE announces
 * itself as a `spellfxAt` event and then exists only in the renderer, so an addon
 * that wants those has to track the events itself.
 */
export interface Hazard {
  id: string;
  kind: HazardKind;
  x: number;
  z: number;
  radius: number;
  /** The inner edge of a ring's safe middle. 0 when the whole disc is hot. */
  innerRadius: number;
  duration: number;
  remaining: number;
}

/**
 * Every entity in scope that is casting right now.
 *
 * Built per read rather than cached: an entity's cast fields are mutated in place
 * on the entity the game already owns, so there is nothing to invalidate against
 * and a cached map would answer with the cast that was running last frame. The
 * walk is over interest scope, which is the same set the game's own nameplate
 * pass covers every frame.
 */
export function castsOf(entities: ReadonlyMap<number, Entity>): ReadonlyMap<number, EntityCast> {
  const casting = new Map<number, EntityCast>();
  for (const [id, entity] of entities) {
    const ability = fieldString(entity, 'castingAbility');
    if (ability !== null && ability.length > 0) {
      casting.set(id, {
        ability,
        remaining: fieldNumber(entity, 'castRemaining') ?? 0,
        total: fieldNumber(entity, 'castTotal') ?? 0,
        channeling: fieldValue(entity, 'channeling') === true,
      });
    }
  }
  return casting;
}

/** Both hazard arrays as one list, or null when the game carries neither. */
export function hazardsOf(world: unknown): readonly Hazard[] | null {
  const hazards: Hazard[] = [];
  let found = false;
  for (const [kind, field] of HAZARD_SOURCES) {
    const source = fieldValue(world, field);
    if (Array.isArray(source)) {
      found = true;
      for (const entry of source as readonly unknown[]) {
        const hazard = toHazard(kind, entry);
        if (hazard !== null) {
          hazards.push(hazard);
        }
      }
    }
  }
  if (!found) {
    return null;
  }
  return hazards;
}

/**
 * Entity id to raid target marker, or null when there is nothing to read.
 *
 * The game mirrors this from a self-wire field that is sent only to a player in a
 * party, so solo it is empty rather than absent, and an addon cannot tell "no
 * markers" from "not grouped" out of this alone. Read `world.party` for that.
 */
export function markersOf(world: unknown): ReadonlyMap<number, number> | null {
  const source = fieldValue(world, 'markers');
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  const marked = new Map<number, number>();
  for (const [id, marker] of Object.entries(source as Record<string, unknown>)) {
    const entityId = Number(id);
    if (Number.isFinite(entityId) && typeof marker === 'number') {
      marked.set(entityId, marker);
    }
  }
  return marked;
}
