// What counts as a change, per world key.
//
// A signature deliberately leaves out anything that moves every tick. Aura
// remaining time and cooldown remaining are the clear cases: including them
// would make world.on('auras') fire at the frame rate and mean nothing. The
// question each signature answers is "is this a different set of things", not
// "has a number moved".

import { fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { abilityIndexSignature } from './abilities.ts';
import { characterSignature, countsSignature, talentSignature } from './signature-sheet.ts';
import {
  auraSignature,
  castSignature,
  cooldownSignature,
  equipmentSignature,
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
  'bags',
  'copper',
  'zone',
  'character',
  'talents',
  'professions',
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
 * The three character-sheet keys, split out to keep the switch below readable.
 *
 * They share nothing with the world keys around them: those describe what is
 * happening near the player, and these describe the player's own record.
 */
function sheetCapture(key: 'character' | 'talents' | 'professions', value: unknown): string {
  if (key === 'character') {
    return characterSignature(value);
  }
  if (key === 'talents') {
    return talentSignature(value);
  }
  // Two counter maps, so the signature is the counters themselves: a skill only
  // moves when the player did something worth repainting for.
  const crafts = countsSignature(fieldValue(value, 'craftSkills'));
  return `${crafts}|${countsSignature(fieldValue(value, 'gathering'))}`;
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
      return stringsOf(value).join(',');
    case 'copper':
    case 'zone':
      return String(value);
    case 'character':
    case 'talents':
    case 'professions':
      return sheetCapture(key, value);
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
