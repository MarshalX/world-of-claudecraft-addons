// Whether the running game still looks like what `game-types.ts` declares: one pass over the
// live player when the world goes live, reporting every field missing or of the wrong kind.
//
// It cannot catch a field the server never sends: the client default-fills it, so it passes.
// That is checked upstream, by publishing only fields found on the wire.
//
// `SHAPE` is a `Record<keyof Entity, ...>`, so a published field without a spec fails to compile.

import { fieldValue } from '../net/frames.ts';
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
  pledgeGuild: { kind: 'string' },
  guildTier: { kind: 'number' },
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
  ghost: { kind: 'boolean' },

  hostile: { kind: 'boolean' },
  targetId: { kind: 'number', nullable: true },
  aggroTargetId: { kind: 'number', nullable: true },
  // Not optional: the client initialises both on every entity, so absence is drift.
  forcedTargetId: { kind: 'number', nullable: true },
  forcedTargetTimer: { kind: 'number' },
  threat: { kind: 'map' },
  ownerId: { kind: 'number', nullable: true },
  castingAbility: { kind: 'string', nullable: true },
  castRemaining: { kind: 'number' },
  castTotal: { kind: 'number' },
  castTargetId: { kind: 'number', nullable: true },
  channeling: { kind: 'boolean' },
  auras: { kind: 'array' },

  lootable: { kind: 'boolean' },
  loot: { kind: 'object', nullable: true },
  tappedById: { kind: 'number', nullable: true },
  harvestClaimedBy: { kind: 'number', nullable: true },

  // The worn set is sparse, so a slot-key rename cannot be caught. Do not add a NESTED_SHAPES
  // entry of twelve optional slots: it would assert nothing while looking like coverage.
  equippedItems: { kind: 'object' },
  equippedInstances: { kind: 'object' },
  mainhandItemId: { kind: 'string', nullable: true },
  offhandItemId: { kind: 'string', nullable: true },
  weaponSkinId: { kind: 'string', nullable: true },
  mountSkinId: { kind: 'string', nullable: true },
  mountKey: { kind: 'string' },
  // Optional: the client never default-fills it, so it is absent when the server does not send it.
  inCombat: { kind: 'boolean', optional: true },
  helmHidden: { kind: 'boolean' },
  afk: { kind: 'boolean' },
  sitting: { kind: 'boolean' },
  overheadEmoteId: { kind: 'string', nullable: true },
  overheadEmoteSeq: { kind: 'number' },
  aiAccount: { kind: 'boolean' },
  cheaterMark: { kind: 'boolean' },
  rangedPower: { kind: 'number' },
  autoAttack: { kind: 'boolean' },
  swingTimer: { kind: 'number' },

  cooldowns: { kind: 'map' },
  gcdRemaining: { kind: 'number' },
  attackPower: { kind: 'number' },
  spellPower: { kind: 'number' },
  healPower: { kind: 'number' },
  spellHaste: { kind: 'number' },
  critChance: { kind: 'number' },
  dodgeChance: { kind: 'number' },
  blockChance: { kind: 'number' },
  offhandSwingTimer: { kind: 'number' },
  comboPoints: { kind: 'number' },
  savedMana: { kind: 'number' },
  stats: { kind: 'object' },
  weapon: { kind: 'object' },
  offhandWeapon: { kind: 'object', nullable: true },
  // Created on the first snapshot carrying a charge pool, so absence is ordinary.
  abilityCharges: { kind: 'object', optional: true },
};

/**
 * The two object fields with a fixed member list, walked because 'object' alone would pass a
 * renamed member that reads as a permanently zero stat.
 */
const NESTED_SHAPES: Record<string, Record<string, FieldSpec>> = {
  stats: {
    str: { kind: 'number' },
    agi: { kind: 'number' },
    sta: { kind: 'number' },
    int: { kind: 'number' },
    spi: { kind: 'number' },
    armor: { kind: 'number' },
    pvpOffense: { kind: 'number' },
    pvpDefense: { kind: 'number' },
  },
  weapon: {
    min: { kind: 'number' },
    max: { kind: 'number' },
    speed: { kind: 'number' },
    dagger: { kind: 'boolean', optional: true },
  },
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
 * Every way the value disagrees with the shape, or an empty list. All of them, since drift
 * arrives in batches.
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

/** Every nested problem, prefixed with its parent field (`stats.armor is missing`). */
function checkNested(value: unknown): readonly string[] {
  const problems: string[] = [];
  for (const [field, shape] of Object.entries(NESTED_SHAPES)) {
    const nested = fieldValue(value, field);
    if (nested !== null) {
      problems.push(...checkShape(shape, nested).map((problem) => `${field}.${problem}`));
    }
  }
  return problems;
}

/** The published entity shape against a live one, nested objects included. */
function checkEntityShape(value: unknown): readonly string[] {
  const problems = checkShape(SHAPE, value);
  if (problems.length > 0) {
    return problems;
  }
  return checkNested(value);
}

export type { FieldKind, FieldSpec };
export {
  checkEntityShape,
  checkShape,
  NESTED_SHAPES as ENTITY_NESTED_SHAPES,
  SHAPE as ENTITY_SHAPE,
};
