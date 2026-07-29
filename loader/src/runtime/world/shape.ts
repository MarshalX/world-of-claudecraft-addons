// Whether the running game still looks like what `game-types.ts` declares.
//
// `game-types.ts` describes a repository this one does not depend on and cannot
// compile against, so its declarations are asserted at the backend boundary
// rather than proven. That assertion is only honest if something checks it, and
// this is that check: one pass over the live player when the world goes live,
// reporting every field that is missing or of the wrong kind.
//
// It runs ONCE per session, not per read. The cost of being wrong here is an
// addon written against a field the game renamed, which is a slow, confusing
// failure at the author's end; the cost of the check is one walk over the
// published fields, once, at a moment nothing is rendering yet.
//
// What it CANNOT catch, stated because it has already cost a bug: a field the
// server never sends. The client builds every entity with defaults, so such a
// field is present and of the right kind and holds that default forever. This
// check passes it. `inCombat` is the worked example, and the answer is upstream
// of here: a field is published only if it was found on the wire.
//
// The table is exhaustive BY TYPE: it is a `Record<keyof Entity, ...>`, so
// adding a field to the published entity without saying how to recognise it is
// a compile error rather than an untested promise.

import type { Entity, Vec3 } from './game-types.ts';

/** What a field should look like at runtime. `vec3` is the game's position shape. */
type FieldKind = 'number' | 'string' | 'boolean' | 'vec3' | 'array' | 'map' | 'object';

interface FieldSpec {
  kind: FieldKind;
  /** The game may answer null, and that is not drift. */
  nullable?: true;
  /** The game may omit it entirely. */
  optional?: true;
}

/** How to recognise every field the published `Entity` promises. */
const SHAPE: Record<keyof Entity, FieldSpec> = {
  id: { kind: 'number' },
  kind: { kind: 'string' },
  templateId: { kind: 'string' },
  name: { kind: 'string' },
  level: { kind: 'number' },
  guild: { kind: 'string' },
  title: { kind: 'string', nullable: true, optional: true },

  pos: { kind: 'vec3' },
  prevPos: { kind: 'vec3' },
  facing: { kind: 'number' },
  prevFacing: { kind: 'number' },

  hp: { kind: 'number' },
  maxHp: { kind: 'number' },
  resource: { kind: 'number' },
  maxResource: { kind: 'number' },
  resourceType: { kind: 'string', nullable: true },
  dead: { kind: 'boolean' },

  hostile: { kind: 'boolean' },
  targetId: { kind: 'number', nullable: true },
  castingAbility: { kind: 'string', nullable: true },
  castRemaining: { kind: 'number' },
  castTotal: { kind: 'number' },
  channeling: { kind: 'boolean' },
  auras: { kind: 'array' },

  cooldowns: { kind: 'map' },
  gcdRemaining: { kind: 'number' },
  autoAttack: { kind: 'boolean' },
  attackPower: { kind: 'number' },
  spellPower: { kind: 'number' },
  spellHaste: { kind: 'number' },
  critChance: { kind: 'number' },
  dodgeChance: { kind: 'number' },
  blockChance: { kind: 'number' },
};

function isVec3(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const point = value as Partial<Vec3>;
  return typeof point.x === 'number' && typeof point.y === 'number' && typeof point.z === 'number';
}

function matches(kind: FieldKind, value: unknown): boolean {
  if (kind === 'vec3') {
    return isVec3(value);
  }
  if (kind === 'array') {
    return Array.isArray(value);
  }
  if (kind === 'map') {
    return value instanceof Map;
  }
  if (kind === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === kind;
}

/** What the field actually was, for a report someone has to act on. */
function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value instanceof Map) {
    return 'Map';
  }
  return typeof value;
}

function checkField(
  source: Record<string, unknown>,
  field: string,
  spec: FieldSpec,
): string | null {
  const has = field in source;
  if (!has) {
    if (spec.optional === true) {
      return null;
    }
    return `${field} is missing, expected ${spec.kind}`;
  }
  const value = source[field];
  if (value === null && spec.nullable === true) {
    return null;
  }
  if (value === undefined && spec.optional === true) {
    return null;
  }
  if (matches(spec.kind, value)) {
    return null;
  }
  return `${field} is ${describe(value)}, expected ${spec.kind}`;
}

/**
 * Every way the value disagrees with the shape, or an empty list.
 *
 * Reports all of them rather than the first. Drift arrives as a batch when the
 * game renames or reworks something, and one field at a time would need one
 * session each to find the rest.
 */
function checkShape(shape: Record<string, FieldSpec>, value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return [`expected an object, got ${describe(value)}`];
  }
  const source = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const [field, spec] of Object.entries(shape)) {
    const problem = checkField(source, field, spec);
    if (problem !== null) {
      problems.push(problem);
    }
  }
  return problems;
}

/** The published entity shape against a live one. */
function checkEntityShape(value: unknown): readonly string[] {
  return checkShape(SHAPE, value);
}

export type { FieldKind, FieldSpec };
export { checkEntityShape, checkShape, SHAPE as ENTITY_SHAPE };
