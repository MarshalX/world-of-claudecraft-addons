// What counts as a change on the two worn-gear keys.
//
// They share a dispatcher because a slot's ITEM and what is ON it move for the
// same reasons and neither moves per tick. They are not one key because folding
// the payload into `equipment` would be a break for every addon already reading
// item ids out of it.
//
// The half that is easy to get wrong: `equipmentSignature` would answer the same
// string for every instance payload and would fire only when a slot appeared or
// vanished, which is exactly the wrong half. Enchanting a piece already worn does
// not move `equipment` at all.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { equipmentSignature } from './signature-world.ts';

const GEAR_KEYS = ['equipment', 'equipmentInstances'] as const;

type GearKey = (typeof GEAR_KEYS)[number];

const GEAR_SET: ReadonlySet<string> = new Set<string>(GEAR_KEYS);

/**
 * Takes a plain string rather than a `WorldKey`.
 *
 * `signature.ts` imports this module, so naming its key union here would be a
 * cycle for no gain.
 */
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
 * The stat block baked into one copy, flattened and sorted.
 *
 * This is the value every forge operation moves: the game rebuilds `rolled.stats`
 * from the base stats, the upgrade level, the rift enchant and the sockets on
 * every upgrade, enchant and socket, so a stat pair changing is the one reading
 * that covers all of them. Sorted for the same reason `equipmentSignature` sorts,
 * since the key order of a rebuilt record is not the game's promise to keep.
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
 * One worn payload flattened, so a change WITHIN a slot is visible.
 *
 * Eight readings, and each is something a gear pane repaints for: who signed the
 * copy, what is enchanted onto it, whether it is a masterwork proc, the stats it
 * carries, how far its rift record has been taken, and the two ends of the
 * Perfecting track (the finished bit, and the legendary name a promotion
 * stamps). None of them moves per tick, so the whole payload is affordable.
 *
 * The Perfecting pair earns its place by CHANGING ON A WORN PIECE, which is what
 * separates it from the four absent fields below: a rank walk completes and a
 * promotion is named without the piece ever leaving the slot, so without these a
 * gear watcher would be told nothing at the one moment it exists for. The
 * mid-track `perfecting` rank is deliberately not here, because it is owner-only
 * and this digest runs over the public projection too.
 *
 * The gem COUNT is here even though a socketed gem also rebuilds `rolled.stats`,
 * because that rebuild only recognises the gem ids the game's own table lists: a
 * gem added by a later content release would fill a socket and move nothing else,
 * and a socket filling is exactly what a gear pane is drawing.
 *
 * What is deliberately absent is `charges`, `boundTo`, `craftedRecipeId` and
 * `bindOnTrade`. All four are written when a payload is put ON, and putting one
 * on is an equip, which moves `equipment` and one of the five fields above
 * anyway. Nothing in the game decrements a charge on a piece while it is worn.
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
