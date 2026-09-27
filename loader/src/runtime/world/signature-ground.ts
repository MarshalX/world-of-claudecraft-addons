// What counts as a change on the four ground keys.
//
// Every countdown is left out (node cooldowns, a death zone's fuse, a corpse's lock), since each
// moves every sample. `nodeCooldowns` reuses `cooldownSignature`: which nodes are cooling.

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

/** Takes a plain string: naming `WorldKey` would be an import cycle with `signature.ts`. */
function isGroundKey(key: string): key is GroundKey {
  return GROUND_SET.has(key);
}

/**
 * Which zones are down and where, never how long is left on one. The count leads because zones
 * have no id and two can be identical (one under each of two members standing together).
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
 * Which corpses are lootable, what each holds, whether the lock has lapsed, and whether the loot
 * window has.
 *
 * `mine` is left out: it follows the party roster and would fire on every party change.
 * `decayed` must be in, since on a corpse someone else tapped nothing else here moves at decay.
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
 * Where your own body is: the whole coordinate, since a corpse does not move. Empty for no
 * corpse, so a body at the world origin still differs from none.
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
