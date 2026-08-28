// What counts as a change on the four ground keys.
//
// `nodeCooldowns` reuses `cooldownSignature` unchanged, which is the whole point
// of that function existing: a node's remaining seconds move on every snapshot,
// so which nodes are cooling is the change worth waking anyone for. Same
// reasoning, same function, as the ability cooldowns it was written for.
//
// The other three leave their countdowns out for the same reason: a death zone's
// fuse and a corpse's remaining lock both move every sample, and a subscription
// that fired on either would be reporting that time is passing.

import { fieldNumber, fieldValue, isRecord } from '../net/frames.ts';
import { cooldownSignature } from './signature-world.ts';

const GROUND_KEYS = ['deathZones', 'corpses', 'nodeCooldowns', 'corpse'] as const;

type GroundKey = (typeof GROUND_KEYS)[number];

const GROUND_SET: ReadonlySet<string> = new Set<string>(GROUND_KEYS);

/** Any total order will do: the sort exists to make a signature order-independent. */
function byCodePoint(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

/** How many entries a list carried, or 0 for anything that is not a list. */
function countOf(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return 0;
}

/**
 * Takes a plain string rather than a `WorldKey`.
 *
 * `signature.ts` imports this module, so naming its key union here would be a
 * cycle for no gain.
 */
function isGroundKey(key: string): key is GroundKey {
  return GROUND_SET.has(key);
}

/**
 * Which zones are down and where, never how long is left on one.
 *
 * The count leads because a zone carries no id and two can share a position: the
 * S-rank barrage places one under every living member, so two members standing
 * together produce two identical entries, and a reading that collapsed them
 * would report the second ring as no change at all.
 */
function deathZoneSignature(zones: unknown): string {
  if (!Array.isArray(zones)) {
    return '';
  }
  const rings = (zones as readonly unknown[])
    .map(
      (zone) =>
        `${String(fieldNumber(zone, 'x') ?? 0)}:${String(fieldNumber(zone, 'z') ?? 0)}` +
        `:${String(fieldNumber(zone, 'radius') ?? 0)}`,
    )
    .sort(byCodePoint);
  return `${String(rings.length)}|${rings.join(',')}`;
}

/**
 * Which corpses are lootable, what each holds, whether the lock has lapsed, and
 * whether the loot window has.
 *
 * `mine` is deliberately left out. It is derived from what is already here plus
 * the party roster, so including it would fire this key on every party change,
 * and an addon watching corpses is watching the ground rather than the group.
 *
 * `decayed` has to be in, and it is the one field here that cannot be inferred
 * from the rest. Decay empties `mine` and zeroes `copper`, and `mine` is out for
 * the reason above while `copper` was already 0 for anybody without shared
 * rights, so on a corpse somebody else tapped this reading was byte-identical
 * either side of the moment the game stopped letting anyone open it.
 */
function corpseSignature(corpses: unknown): string {
  if (!(corpses instanceof Map)) {
    return '';
  }
  const rows: string[] = [];
  for (const [id, view] of corpses) {
    rows.push(
      `${String(id)}:${String(countOf(fieldValue(view, 'all')))}` +
        `:${String(fieldNumber(view, 'copper') ?? 0)}` +
        `:${String(fieldValue(view, 'ffa'))}:${String(fieldValue(view, 'decayed'))}` +
        `:${String(fieldValue(view, 'harvestClaimedBy'))}`,
    );
  }
  return rows.sort(byCodePoint).join(',');
}

/**
 * Where your own body is, or nothing.
 *
 * The whole coordinate, unlike every other signature here: a corpse does not
 * move, so this changes at most twice per death and there is no countdown in it
 * to fire at the sample rate. Empty for no corpse, which is what keeps "released
 * with a body at the world origin" from reading as "no body at all".
 */
function corpsePositionSignature(corpse: unknown): string {
  if (!isRecord(corpse)) {
    return '';
  }
  return `${String(fieldNumber(corpse, 'x') ?? 0)}:${String(fieldNumber(corpse, 'y') ?? 0)}:${String(
    fieldNumber(corpse, 'z') ?? 0,
  )}`;
}

/** The four ground keys, dispatched by key. */
function groundCapture(key: GroundKey, value: unknown): string {
  if (key === 'deathZones') {
    return deathZoneSignature(value);
  }
  if (key === 'corpses') {
    return corpseSignature(value);
  }
  if (key === 'nodeCooldowns') {
    return cooldownSignature(value);
  }
  return corpsePositionSignature(value);
}

export type { GroundKey };
export { corpsePositionSignature, corpseSignature, deathZoneSignature, groundCapture, isGroundKey };
