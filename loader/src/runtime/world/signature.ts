// What counts as a change, per world key.
//
// A signature deliberately leaves out anything that moves every tick. Aura
// remaining time and cooldown remaining are the clear cases: including them
// would make world.on('auras') fire at the frame rate and mean nothing. The
// question each signature answers is "is this a different set of things", not
// "has a number moved".
//
// `capture` is a DISPATCHER over one group function per subject, and the shape
// is forced rather than chosen: one switch with a case per key is past the
// length a function body is allowed, and every key added to it would have to
// leave through the door rather than through the wall. Each group's predicate
// and its dispatcher live in that group's own module, so a lane fills in its
// signatures without touching this file.

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

/**
 * The keys about the player's own record and their group.
 *
 * They share nothing with the world keys around them: those describe what is
 * happening near the player, and these describe what the player and their group
 * have.
 */
function sheetCapture(key: SheetKey, value: unknown): string {
  if (key === 'character') {
    return characterSignature(value);
  }
  if (key === 'talents') {
    return talentSignature(value);
  }
  // Which rolls are open and which lockouts stand, never how long is left on
  // either: a roll's countdown moves every frame and a lockout's is hours.
  if (key === 'group') {
    return groupSignature(value);
  }
  if (key === 'encounter') {
    return encounterSignature(value);
  }
  // The two counter maps plus the crafting identity, because the identity's
  // `synced` flag going true is the moment an unsynced default becomes a real
  // reading, and nothing else on the key moves when it does. Watching only the
  // counters would leave a pane showing zeroes it had no reason to repaint.
  return professionsSignature(value);
}

/**
 * The keys the loader COMPUTES over what is near the player.
 *
 * They belong together for the same reason `sheetCapture`'s do: none of these is
 * a member of the game's own world object, so each is a reading the loader
 * assembled, and each signature is a statement about that assembly rather than
 * about a field the game happens to expose.
 */
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
  // The source is in the signature as well as the flag, so a fight that stays
  // active while the loader's confidence in it changes is reported. A meter
  // that trusts only the server's own answer needs to hear that moment; one
  // that does not can ignore it, which is cheaper than never being told.
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

/**
 * Every key that belongs to no lane group, which is where a new one starts.
 *
 * Its own function rather than the body of `capture`, so the dispatcher above it
 * stays short enough that adding a group is a three line change.
 */
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
