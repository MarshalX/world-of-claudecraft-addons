// What counts as a change, per world key.
//
// A signature deliberately leaves out anything that moves every tick. Aura
// remaining time and cooldown remaining are the clear cases: including them
// would make world.on('auras') fire at the frame rate and mean nothing. The
// question each signature answers is "is this a different set of things", not
// "has a number moved".

import { fieldArray, fieldNumber, fieldScalar, fieldString, fieldValue } from '../net/frames.ts';
import { abilityIndexSignature } from './abilities.ts';

const KEYS = [
  'player',
  'target',
  'entities',
  'party',
  'inventory',
  'equipment',
  'bags',
  'copper',
  'zone',
  'quests',
  'cooldowns',
  'auras',
  'casts',
  'targetAuras',
  'hazards',
  'markers',
  'abilities',
  'combat',
] as const;

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
const PLAYER_FIELDS = ['id', 'level', 'hp', 'maxHp', 'resource', 'maxResource', 'dead', 'targetId'];

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

function joinFields(source: unknown, fields: readonly string[]): string {
  return fields.map((field) => fieldScalar(source, field)).join(':');
}

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

function partySignature(party: unknown): string {
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
function equipmentSignature(equipment: unknown): string {
  if (equipment === null || typeof equipment !== 'object') {
    return '';
  }
  return Object.entries(equipment as Record<string, unknown>)
    .map(([slot, itemId]) => `${slot}=${String(itemId)}`)
    .sort(byCodePoint)
    .join(',');
}

function inventorySignature(inventory: unknown): string {
  return eachOf(inventory)
    .map((slot) => `${fieldString(slot, 'itemId') ?? ''}x${fieldNumber(slot, 'count') ?? 0}`)
    .join(',');
}

function questSignature(quests: unknown): string {
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
function cooldownSignature(cooldowns: unknown): string {
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
function auraSignature(auras: unknown): string {
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
function stackedAuraSignature(auras: unknown): string {
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
function castSignature(casts: unknown): string {
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
function hazardSignature(hazards: unknown): string {
  return eachOf(hazards)
    .map((hazard) => fieldString(hazard, 'id') ?? '')
    .sort(byCodePoint)
    .join(',');
}

/** Which entities are marked, and with what. Both halves are the change. */
function markerSignature(markers: unknown): string {
  if (!(markers instanceof Map)) {
    return '';
  }
  const marked: string[] = [];
  for (const [id, marker] of markers) {
    marked.push(`${String(id)}:${String(marker)}`);
  }
  return marked.sort(byCodePoint).join(',');
}

function entityIds(entities: unknown): Set<number> {
  const ids = new Set<number>();
  if (entities instanceof Map || entities instanceof Set) {
    for (const id of entities.keys()) {
      if (typeof id === 'number') {
        ids.add(id);
      }
    }
  }
  return ids;
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false;
    }
  }
  return true;
}

export type WorldKey = (typeof KEYS)[number];

export const WORLD_KEYS: readonly WorldKey[] = KEYS;

/** A string for every key but `entities`, where an exact id set is both cheaper and exact. */
export type Capture = string | ReadonlySet<number>;

export function isWorldKey(key: string): key is WorldKey {
  return (KEYS as readonly string[]).includes(key);
}

export function capture(key: WorldKey, value: unknown): Capture {
  switch (key) {
    case 'player':
      return joinFields(value, PLAYER_FIELDS);
    case 'target':
      return String(fieldNumber(value, 'id') ?? '');
    case 'entities':
      return entityIds(value);
    case 'party':
      return partySignature(value);
    case 'inventory':
      return inventorySignature(value);
    // Worn gear changes one slot at a time and the whole map is a dozen entries,
    // so the signature is the map itself rather than anything cleverer.
    case 'equipment':
      return equipmentSignature(value);
    case 'bags':
      return eachOf(value)
        .map((bag) => String(bag))
        .join(',');
    case 'copper':
    case 'zone':
      return String(value);
    case 'quests':
      return questSignature(value);
    case 'cooldowns':
      return cooldownSignature(value);
    case 'auras':
      return auraSignature(value);
    case 'casts':
      return castSignature(value);
    case 'targetAuras':
      return stackedAuraSignature(value);
    case 'hazards':
      return hazardSignature(value);
    case 'markers':
      return markerSignature(value);
    case 'abilities':
      return abilityIndexSignature(value);
    // The source is in the signature as well as the flag, so a fight that stays
    // active while the loader's confidence in it changes is reported. A meter
    // that trusts only the server's own answer needs to hear that moment; one
    // that does not can ignore it, which is cheaper than never being told.
    case 'combat':
      return `${String(fieldValue(value, 'active'))}:${fieldString(value, 'source') ?? ''}`;
    default:
      return '';
  }
}

export function sameCapture(a: Capture, b: Capture): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  return sameSet(a, b);
}
