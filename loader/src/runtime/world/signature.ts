// What counts as a change, per world key.
//
// A signature deliberately leaves out anything that moves every tick. Aura
// remaining time and cooldown remaining are the clear cases: including them
// would make world.on('auras') fire at the frame rate and mean nothing. The
// question each signature answers is "is this a different set of things", not
// "has a number moved".

import { fieldArray, fieldNumber, fieldScalar, fieldString, fieldValue } from '../net/frames.ts';

const KEYS = [
  'player',
  'target',
  'entities',
  'party',
  'inventory',
  'quests',
  'cooldowns',
  'auras',
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

/** Party rows arrive from the wire, so these are the terse names, not the Entity's. */
const PARTY_MEMBER_FIELDS = ['pid', 'hp', 'mhp', 'dead', 'group'];

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

function partySignature(party: unknown): string {
  if (party === null) {
    return '';
  }
  const leader = fieldNumber(party, 'leader') ?? 0;
  const rows = fieldArray(party, 'members').map((row) => joinFields(row, PARTY_MEMBER_FIELDS));
  return `${leader}|${rows.join(',')}`;
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
    case 'quests':
      return questSignature(value);
    case 'cooldowns':
      return cooldownSignature(value);
    case 'auras':
      return auraSignature(value);
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
