// A live entity carrying every field the published world types promise.
//
// Shared rather than rebuilt per suite because the loader now CHECKS this shape:
// `world/shape.ts` walks the live player when the world goes live and reports
// anything missing. A suite that brought the world up on a half-built player
// would fill its own output with a drift report about its own fixture, and the
// next real drift report would read as more of the same noise.
//
// It is built from the shape table rather than written out, so a field added to
// the published entity is carried here the day it lands. `PLAYER_ENTITY` is
// spread over the top: that fixture is what a real client holds, so where the
// two overlap the observed value wins over a generated default.

import { ENTITY_SHAPE, type FieldSpec } from '../../loader/src/runtime/world/shape.ts';
import { PLAYER_ENTITY } from './frames.ts';

/** An inert value of the right kind, for a field no fixture has an opinion about. */
function defaultFor(spec: FieldSpec): unknown {
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

interface Drift {
  /** Fields the game stopped sending, e.g. after a rename. */
  omit?: readonly string[];
  /** Fields the game still sends, as something else. */
  set?: Record<string, unknown>;
}

/**
 * A complete live entity, optionally drifted.
 *
 * Both kinds of drift are built into the object rather than applied to it
 * afterwards, because an omission has to be an absent KEY and not a key holding
 * undefined, which is a distinction the checker makes.
 */
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
      built[field] = defaultFor(spec);
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
