// What counts as a change, per world key.
//
// Split from `signature.ts`, which owns the key registry and the dispatch. These
// are the per-key functions themselves, and every one of them deliberately
// leaves out anything that moves every tick: aura remaining time and cooldown
// remaining are the clear cases, since including either would fire a
// subscription at the frame rate and mean nothing. The question each answers is
// "is this a different set of things", not "has a number moved".

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
 * The ids on a party row's compact aura strip.
 *
 * Ids alone, not remaining time: a row's strip is redrawn constantly as its auras
 * tick, and what an addon acts on is one arriving or falling off. Order is the
 * game's own, which is stable per row, so this is not sorted.
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
 * Party rows arrive from the wire, so these are the terse names, not the Entity's.
 *
 * `hasAggro` and `connected` are here because raid-frame alerting is the point of
 * watching a party at all, and neither woke a subscriber before: a tank losing
 * threat and a member dropping link are both changes an addon has to paint. The
 * aura strip is handled separately, since it is a list rather than a scalar.
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
 * Entity fields worth waking an addon for.
 *
 * These are the Entity's own names, which are not the terse wire names: an
 * entity carries `maxHp` and `resource`, while the snapshot that delivered it
 * used `mhp` and `res`. Position is excluded because it moves constantly.
 *
 * `inCombat` was here and is not on the wire, so it read false for the whole
 * session and this signature never once changed because of it. Watching a field
 * the server does not send is not merely useless: it tells an addon author the
 * loader will report something it cannot.
 */
export const PLAYER_FIELDS = [
  'id',
  'level',
  'hp',
  'maxHp',
  'resource',
  'maxResource',
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
 * What one bag, bank or buyback row IS: the item, how many, and whether the
 * player has locked this copy.
 *
 * The lock is the only instance field read here, and the reason is that it is
 * the only one the PLAYER toggles. It moves neither the id nor the count, so
 * without it the one bag change a player makes deliberately is the one change
 * this reading cannot see. Everything else in the payload stays out for the
 * reason an aura's remaining time does: a signature answers "is this a different
 * set of things", and a deep compare of every payload at sample rate is not that
 * question. `locked` rides your own bags and your own bank only, so on a market
 * row or a letter this arm is reading a field the server's public projection
 * never sends, and answers absent for every one of them.
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
 * The same as `auraSignature`, plus the stack count.
 *
 * A ramping debuff is the case this exists for: a stack landing is the event a
 * boss mod warns on, and on the id and caster alone it is invisible, because a
 * stack is a refresh of the aura already there rather than a new one.
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
 * Who is casting what, never how far along it is.
 *
 * A cast bar moves every frame, so including the remaining time would fire this
 * at the frame rate. The ability is in the key because a boss that finishes one
 * mechanic and immediately starts another has to read as two casts, and the
 * entity id alone would report that as no change at all.
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

/** Which hazards are on the ground and where, but not how long they have left. */
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
