// What counts as a change on the two worn-gear keys.
//
// Two keys, because folding the payload into `equipment` would break addons reading item ids
// out of it. `equipmentInstances` needs its own digest: enchanting a worn piece does not move
// `equipment` at all.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { equipmentSignature } from './signature-world.ts';

const GEAR_KEYS = ['equipment', 'equipmentInstances'] as const;

type GearKey = (typeof GEAR_KEYS)[number];

const GEAR_SET: ReadonlySet<string> = new Set<string>(GEAR_KEYS);

/** Takes a plain string: naming `WorldKey` would be an import cycle with `signature.ts`. */
function isGearKey(key: string): key is GearKey {
  return GEAR_SET.has(key);
}

/** Any total order will do: the sort exists to make the digest order-independent. */
function byCodePoint(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

/**
 * The stat block baked into one copy, flattened and sorted (a rebuilt record's key order is not
 * stable). Every forge upgrade, enchant and socket rebuilds it.
 */
function statPairs(rolled: unknown): string {
  const stats = fieldValue(rolled, 'stats');
  if (stats === null || typeof stats !== 'object') {
    return '';
  }
  return Object.entries(stats as Record<string, unknown>)
    .map(([stat, value]) => `${stat}=${String(value)}`)
    .sort(byCodePoint)
    .join('+');
}

/**
 * One worn payload flattened, so a change WITHIN a slot is visible. Only fields that change on a
 * worn piece are read.
 *
 * `perfected` and `name` change without the piece leaving the slot. The mid-track `perfecting`
 * rank is owner-only, and this also runs over the public projection. The gem count is in because
 * a gem id the game's table does not list fills a socket without moving `rolled.stats`.
 *
 * `charges`, `boundTo`, `craftedRecipeId` and `bindOnTrade` are written only on equip, which
 * moves `equipment` anyway.
 */
function instanceDigest(instance: unknown): string {
  const rolled = fieldValue(instance, 'rolled');
  const rift = fieldValue(instance, 'rift');
  return [
    fieldString(instance, 'signer') ?? '',
    fieldString(instance, 'enchant') ?? '',
    String(fieldValue(rolled, 'masterwork')),
    statPairs(rolled),
    String(fieldNumber(rift, 'upgradeLevel') ?? ''),
    String(fieldArray(rift, 'gems').length),
    String(fieldValue(instance, 'perfected')),
    fieldString(instance, 'name') ?? '',
  ].join('|');
}

/** Slot to its payload digest, sorted, like `equipmentSignature` one level up. */
function equipmentInstanceSignature(instances: unknown): string {
  if (instances === null || typeof instances !== 'object') {
    return '';
  }
  return Object.entries(instances as Record<string, unknown>)
    .map(([slot, instance]) => `${slot}=${instanceDigest(instance)}`)
    .sort(byCodePoint)
    .join(',');
}

/** The two worn-gear keys, dispatched by key. */
function gearCapture(key: GearKey, value: unknown): string {
  if (key === 'equipment') {
    return equipmentSignature(value);
  }
  return equipmentInstanceSignature(value);
}

export type { GearKey };
export { equipmentInstanceSignature, gearCapture, isGearKey };
