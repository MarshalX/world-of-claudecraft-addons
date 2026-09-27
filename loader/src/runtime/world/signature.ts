// The world key registry, and `capture`, which dispatches each key to its subject group's
// signature (see `signature-world.ts` for what a signature leaves out). Each group's predicate
// and dispatcher live in its own module.

import { fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { abilityIndexSignature } from './abilities.ts';
import { economyCapture, isEconomyKey } from './signature-economy.ts';
import { gearCapture, isGearKey } from './signature-gear.ts';
import { groundCapture, isGroundKey } from './signature-ground.ts';
import { encounterSignature, groupSignature } from './signature-group.ts';
import { isSocialKey, socialCapture } from './signature-match.ts';
import { characterSignature, professionsSignature, talentSignature } from './signature-sheet.ts';
import {
  auraSignature,
  castSignature,
  cooldownSignature,
  hazardSignature,
  inventorySignature,
  joinFields,
  markerSignature,
  PLAYER_FIELDS,
  partySignature,
  questSignature,
  stackedAuraSignature,
  stringsOf,
} from './signature-world.ts';

const KEYS = [
  'player',
  'target',
  'entities',
  'party',
  'inventory',
  'equipment',
  'equipmentInstances',
  'bags',
  'copper',
  'zone',
  'characterKey',
  'character',
  'talents',
  'professions',
  'group',
  'encounter',
  'match',
  'arena',
  'battleground',
  'finder',
  'finderBoard',
  'quests',
  'cooldowns',
  'auras',
  'casts',
  'targetAuras',
  'hazards',
  'markers',
  'deathZones',
  'corpses',
  'nodeCooldowns',
  'corpse',
  'abilities',
  'combat',
  'market',
  'marketCollectPending',
  'mail',
  'mailUnread',
  'bank',
  'vault',
  'craftVaultStock',
  'buyback',
] as const;

const SHEET_KEYS = ['character', 'talents', 'professions', 'group', 'encounter'] as const;

type SheetKey = (typeof SHEET_KEYS)[number];

const SHEET_SET: ReadonlySet<string> = new Set<string>(SHEET_KEYS);

function isSheetKey(key: string): key is SheetKey {
  return SHEET_SET.has(key);
}

/** The keys about the player's own record and their group. */
function sheetCapture(key: SheetKey, value: unknown): string {
  if (key === 'character') {
    return characterSignature(value);
  }
  if (key === 'talents') {
    return talentSignature(value);
  }
  // Which rolls are open and which lockouts stand, never how long is left on either.
  if (key === 'group') {
    return groupSignature(value);
  }
  if (key === 'encounter') {
    return encounterSignature(value);
  }
  // The identity is in because `synced` going true can move nothing else on the key.
  return professionsSignature(value);
}

/** The keys the loader COMPUTES over what is near the player. */
function derivedCapture(
  key: 'casts' | 'targetAuras' | 'hazards' | 'markers' | 'combat',
  value: unknown,
): string {
  if (key === 'casts') {
    return castSignature(value);
  }
  if (key === 'targetAuras') {
    return stackedAuraSignature(value);
  }
  if (key === 'hazards') {
    return hazardSignature(value);
  }
  if (key === 'markers') {
    return markerSignature(value);
  }
  // The source is signed too, so a change in which branch answered is reported.
  return `${String(fieldValue(value, 'active'))}:${fieldString(value, 'source') ?? ''}`;
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

type WorldKey = (typeof KEYS)[number];

/** A string for every key but `entities`, where an exact id set is both cheaper and exact. */
type Capture = string | ReadonlySet<number>;

/** Every key that belongs to no subject group. */
function worldCapture(key: WorldKey, value: unknown): Capture {
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
    case 'bags':
      return stringsOf(value).join(',');
    case 'copper':
    case 'zone':
    case 'characterKey':
      return String(value);
    case 'quests':
      return questSignature(value);
    case 'cooldowns':
      return cooldownSignature(value);
    case 'auras':
      return auraSignature(value);
    case 'abilities':
      return abilityIndexSignature(value);
    case 'casts':
    case 'targetAuras':
    case 'hazards':
    case 'markers':
    case 'combat':
      return derivedCapture(key, value);
    default:
      return '';
  }
}

const WORLD_KEYS: readonly WorldKey[] = KEYS;

function isWorldKey(key: string): key is WorldKey {
  return (KEYS as readonly string[]).includes(key);
}

function capture(key: WorldKey, value: unknown): Capture {
  if (isSheetKey(key)) {
    return sheetCapture(key, value);
  }
  if (isSocialKey(key)) {
    return socialCapture(key, value);
  }
  if (isEconomyKey(key)) {
    return economyCapture(key, value);
  }
  if (isGroundKey(key)) {
    return groundCapture(key, value);
  }
  if (isGearKey(key)) {
    return gearCapture(key, value);
  }
  return worldCapture(key, value);
}

function sameCapture(a: Capture, b: Capture): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  return sameSet(a, b);
}

export type { Capture, WorldKey };
export { capture, isWorldKey, sameCapture, WORLD_KEYS };
