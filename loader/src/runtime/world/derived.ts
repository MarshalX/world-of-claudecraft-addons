// Readings the loader computes because the game does not store them the way an addon asks. The
// shapes are the loader's own; the only claim is about the fields they are computed FROM.
//
// `casts` matters most: a mob's cast never emits `castStart`, so it is visible only on the
// per-entity wire fields, and a boss mod subscribing to the event gets silence.

import { fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import type { Entity } from './game-types.ts';

/**
 * Every ground effect the wire carries a position for, each with the
 * id/x/z/radius/duration/remaining shape. These lists are resent whole every frame, so an absent
 * key means none are visible.
 *
 * Deliberately absent, since `toHazard` would refuse every entry: `activeVarkhulCinderFires`
 * has no `remaining` (it burns until the encounter clears it), and
 * `activeVarkhulCinderOrbProjectiles` and `activeNythraxisGravefires` move and have no fixed
 * disc. `activeNythraxisGraveFlames` carries a `k` discriminant whose `'soul'` kind is retired,
 * so it is published as one kind.
 */
const HAZARD_SOURCES = Object.freeze([
  ['frostRing', 'activeFrostRings'],
  ['temporalHourglass', 'activeTemporalHourglasses'],
  ['ignivarMeteor', 'activeIgnivarMeteors'],
  // biome-ignore lint/security/noSecrets: a member name copied from the game, which the entropy heuristic cannot tell from a token
  ['varkhulForgestorm', 'activeVarkhulForgestormWarnings'],
  // biome-ignore lint/security/noSecrets: a member name copied from the game, which the entropy heuristic cannot tell from a token
  ['varkhulAnvilMeteor', 'activeVarkhulAnvilMeteors'],
  // biome-ignore lint/security/noSecrets: a member name copied from the game, which the entropy heuristic cannot tell from a token
  ['nythraxisGraveEruption', 'activeNythraxisGraveEruptions'],
  ['nythraxisGraveFlame', 'activeNythraxisGraveFlames'],
  ['nythraxisBindingSigil', 'activeNythraxisBindingSigils'],
] as const);

/**
 * One hazard, or null when the entry does not carry a real one. A narrowing only: the client
 * validates on decode. `innerRadius` is 0 for a hazard with no safe middle.
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
 * A ground effect with a position, a radius and a life, interest-filtered around the player.
 * Every other ground AoE exists only as a `spellfxAt` event an addon has to track itself.
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
 * Every entity in scope that is casting right now. Built per read: the game mutates cast fields
 * in place, so there is nothing to invalidate a cache against.
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

/** Every hazard list as one, or null when the game carries none of them. */
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
 * Entity id to raid target marker, or null when there is nothing to read. Empty when solo, so
 * read `world.party` to tell "no markers" from "not grouped".
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
