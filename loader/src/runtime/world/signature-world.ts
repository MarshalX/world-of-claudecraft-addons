// What counts as a change, per world key; `signature.ts` owns the registry and dispatch. Each
// answers "is this a different set of things", so anything that moves every tick (remaining
// times) is left out.

import { fieldArray, fieldNumber, fieldScalar, fieldString, fieldValue } from '../net/frames.ts';

function eachOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}
/** Any total order will do: the sort exists to make the signature order-independent. */
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
 * The ids on a party row's compact aura strip, not remaining time. Unsorted: the game's order is
 * stable per row.
 */
function rowAuras(row: unknown): string {
  return fieldArray(row, 'auras')
    .map((aura) => fieldString(aura, 'id') ?? '')
    .join('.');
}

/** The owner's lock as a mark, or nothing. Never a digit, so it cannot read as part of a count. */
function lockMark(slot: unknown): string {
  if (fieldValue(fieldValue(slot, 'instance'), 'locked') === true) {
    return 'L';
  }
  return '';
}

/**
 * Party rows arrive from the wire, so these are the terse names, not the Entity's. The aura strip
 * is signed separately, since it is a list.
 */
const PARTY_MEMBER_FIELDS = [
  'pid',
  'hp',
  'mhp',
  'dead',
  'group',
  'hasAggro',
  'connected',
  'role',
  'absorb',
  'incomingHeal',
];

export function joinFields(source: unknown, fields: readonly string[]): string {
  return fields.map((field) => fieldScalar(source, field)).join(':');
}

/**
 * Entity fields worth waking an addon for, by the Entity's names (`maxHp`, not the wire's
 * `mhp`). Position is excluded because it moves constantly. List only fields the server sends.
 */
export const PLAYER_FIELDS = [
  'id',
  'level',
  'hp',
  'maxHp',
  'resource',
  'maxResource',
  'resourceType',
  'savedMana',
  'dead',
  'targetId',
];

export function partySignature(party: unknown): string {
  if (party === null) {
    return '';
  }
  const leader = fieldNumber(party, 'leader') ?? 0;
  const rows = fieldArray(party, 'members').map(
    (row) => `${joinFields(row, PARTY_MEMBER_FIELDS)}/${rowAuras(row)}`,
  );
  return `${leader}|${rows.join(',')}`;
}

/** Slot to item id, sorted, so the order the game happens to serialize in cannot fire it. */
export function equipmentSignature(equipment: unknown): string {
  if (equipment === null || typeof equipment !== 'object') {
    return '';
  }
  return Object.entries(equipment as Record<string, unknown>)
    .map(([slot, itemId]) => `${slot}=${String(itemId)}`)
    .sort(byCodePoint)
    .join(',');
}

/**
 * What one bag, bank or buyback row IS: the item, how many, and whether the player has locked
 * this copy. The lock is the one instance field read, since the player toggles it without moving
 * the id or count. It is absent on market rows and letters, which the server trims.
 */
export function inventorySignature(inventory: unknown): string {
  return eachOf(inventory)
    .map(
      (slot) =>
        `${fieldString(slot, 'itemId') ?? ''}x${fieldNumber(slot, 'count') ?? 0}${lockMark(slot)}`,
    )
    .join(',');
}

export function questSignature(quests: unknown): string {
  const log = fieldValue(quests, 'log');
  const done = fieldValue(quests, 'done');
  const rows: string[] = [];
  if (log instanceof Map) {
    for (const [questId, progress] of log) {
      const counts = fieldArray(progress, 'counts').join('.');
      rows.push(`${String(questId)}:${fieldString(progress, 'state') ?? ''}:${counts}`);
    }
  }
  let finished = 0;
  if (done instanceof Set) {
    finished = done.size;
  }
  return `${finished}|${rows.join(',')}`;
}

/** Which abilities are on cooldown, not how much is left on each. */
export function cooldownSignature(cooldowns: unknown): string {
  if (!(cooldowns instanceof Map)) {
    return '';
  }
  const running: string[] = [];
  for (const [ability, remaining] of cooldowns) {
    if (typeof remaining === 'number' && remaining > 0) {
      running.push(String(ability));
    }
  }
  return running.sort(byCodePoint).join(',');
}

/** Which auras are on, keyed with the caster so two sources do not collapse into one. */
export function auraSignature(auras: unknown): string {
  return eachOf(auras)
    .map((aura) => `${fieldString(aura, 'id') ?? ''}@${fieldNumber(aura, 'sourceId') ?? 0}`)
    .sort(byCodePoint)
    .join(',');
}

/**
 * The same as `auraSignature`, plus the stack count, since a stack landing refreshes the existing
 * aura and is otherwise invisible.
 */
export function stackedAuraSignature(auras: unknown): string {
  return eachOf(auras)
    .map(
      (aura) =>
        `${fieldString(aura, 'id') ?? ''}@${fieldNumber(aura, 'sourceId') ?? 0}` +
        `x${fieldNumber(aura, 'stacks') ?? 1}`,
    )
    .sort(byCodePoint)
    .join(',');
}

/**
 * Who is casting what, never how far along it is. The ability is in the key so back-to-back
 * casts by one entity read as two.
 */
export function castSignature(casts: unknown): string {
  if (!(casts instanceof Map)) {
    return '';
  }
  const running: string[] = [];
  for (const [id, cast] of casts) {
    running.push(`${String(id)}:${fieldString(cast, 'ability') ?? ''}`);
  }
  return running.sort(byCodePoint).join(',');
}

/** Which hazards are on the ground, by id, not how long they have left. */
export function hazardSignature(hazards: unknown): string {
  return eachOf(hazards)
    .map((hazard) => fieldString(hazard, 'id') ?? '')
    .sort(byCodePoint)
    .join(',');
}

/** Which entities are marked, and with what. Both halves are the change. */
export function markerSignature(markers: unknown): string {
  if (!(markers instanceof Map)) {
    return '';
  }
  const marked: string[] = [];
  for (const [id, marker] of markers) {
    marked.push(`${String(id)}:${String(marker)}`);
  }
  return marked.sort(byCodePoint).join(',');
}

/** An array as strings, for a key whose members are ids or nulls. */
export function stringsOf(value: unknown): readonly string[] {
  return eachOf(value).map((one) => String(one));
}
