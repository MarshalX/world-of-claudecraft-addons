// A live entity carrying every field the published world types promise, since `world/shape.ts`
// reports anything missing. Generated from the shape table, with the observed `PLAYER_ENTITY`
// spread over it so a real value wins over a generated default.

import {
  ENTITY_NESTED_SHAPES,
  ENTITY_SHAPE,
  type FieldSpec,
} from '../../loader/src/runtime/world/shape.ts';
import { PLAYER_ENTITY } from './frames.ts';

/**
 * An inert value of the right kind. A nullable field defaults to null, never 0: a nullable number
 * means "nobody", and 0 would read as a real entity id (`ownerId`, `tappedById`).
 */
function defaultFor(spec: FieldSpec): unknown {
  if (spec.nullable === true) {
    return null;
  }
  if (spec.kind === 'number') {
    return 0;
  }
  if (spec.kind === 'string') {
    return '';
  }
  if (spec.kind === 'boolean') {
    return false;
  }
  if (spec.kind === 'vec3') {
    return { x: 0, y: 0, z: 0 };
  }
  if (spec.kind === 'array') {
    return [];
  }
  if (spec.kind === 'map') {
    return new Map();
  }
  return {};
}

/** An inert value for a field the shape checker walks into member by member, where `{}` fails. */
function nestedFor(field: string): Record<string, unknown> | null {
  const shape = ENTITY_NESTED_SHAPES[field];
  if (shape === undefined) {
    return null;
  }
  const built: Record<string, unknown> = {};
  for (const [member, spec] of Object.entries(shape)) {
    if (spec.optional !== true) {
      built[member] = defaultFor(spec);
    }
  }
  return built;
}

interface Drift {
  /** Fields the game stopped sending, e.g. after a rename. */
  omit?: readonly string[];
  /** Fields the game still sends, as something else. */
  set?: Record<string, unknown>;
}

/** A complete live entity, optionally drifted. An omission is an absent key, never `undefined`. */
function liveEntity(drift: Drift = {}): Record<string, unknown> {
  const omit = drift.omit ?? [];
  const built: Record<string, unknown> = {
    pos: { x: 1, y: 2, z: 3 },
    prevPos: { x: 0, y: 2, z: 3 },
    cooldowns: new Map<string, number>([['aimed_shot', 4]]),
    auras: [],
    ...PLAYER_ENTITY,
  };
  for (const [field, spec] of Object.entries(ENTITY_SHAPE)) {
    if (!(field in built) && spec.optional !== true) {
      built[field] = nestedFor(field) ?? defaultFor(spec);
    }
  }

  const entity: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(built)) {
    if (!omit.includes(field)) {
      entity[field] = value;
    }
  }
  return { ...entity, ...drift.set };
}

export type { Drift };
export { liveEntity };
