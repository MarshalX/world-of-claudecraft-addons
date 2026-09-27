// What counts as a change on the character sheet.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

/** How many entries a Map carries, or 0 for anything that is not one. */
function mapSize(value: unknown): number {
  if (value instanceof Map) {
    return value.size;
  }
  return 0;
}

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

function joinFields(source: unknown, fields: readonly string[]): string {
  return fields.map((field) => String(fieldValue(source, field))).join(':');
}

/**
 * The slotted tool effects, as `profession:effect:charges` per row; the charge count moves on
 * every harvest. The other fields move only with one of these. Server-sorted, so not re-sorted.
 */
function toolSlotsSignature(professions: unknown): string {
  return fieldArray(professions, 'toolEffectSlots')
    .map(
      (slot) =>
        `${fieldString(slot, 'professionId') ?? ''}:${fieldString(slot, 'effectId') ?? ''}:${String(fieldNumber(slot, 'charges') ?? 0)}`,
    )
    .join(',');
}

/** Every scalar on the sheet, plus the SIZE of the two collections on it. */
export function characterSignature(character: unknown): string {
  if (character === null) {
    return '';
  }
  const scalars = [
    'xp',
    'lifetimeXp',
    'restedXp',
    'prestigeRank',
    'honor',
    'lifetimeHonor',
    'renown',
  ];
  const earned = mapSize(fieldValue(character, 'deeds'));
  return (
    `${joinFields(character, scalars)}:${fieldString(character, 'activeTitle') ?? ''}` +
    `:${String(earned)}:${fieldArray(character, 'milestones').length}` +
    `:${countsSignature(fieldValue(fieldValue(character, 'deedStats'), 'counters'))}`
  );
}

/** The build and which loadout is live, not the loadouts' contents. */
export function talentSignature(talents: unknown): string {
  if (talents === null) {
    return '';
  }
  const picked = countsSignature(fieldValue(talents, 'rows'));
  return (
    `${fieldString(talents, 'spec') ?? ''}:${fieldString(talents, 'role') ?? ''}` +
    `:${picked}:${String(fieldNumber(talents, 'activeLoadout') ?? -1)}` +
    `:${String(fieldArray(talents, 'loadouts').length)}`
  );
}

/** The identity's scalars plus its three id arrays, which are sorted and bounded. */
export function identitySignature(identity: unknown): string {
  if (identity === null) {
    return '';
  }
  const scalars = ['synced', 'switchCount', 'amendsProgress', 'amendsRequired'];
  const ids = ['archetype', 'pairedMajor', 'hobbyCraft'].map(
    (field) => fieldString(identity, field) ?? '',
  );
  return (
    `${joinFields(identity, scalars)}:${ids.join(':')}` +
    `:${fieldArray(identity, 'attunedPairs').join(',')}` +
    `:${fieldArray(identity, 'knownRecipes').join(',')}` +
    `:${fieldArray(identity, 'cadenceBlockedQuests').join(',')}`
  );
}

/**
 * The two counter maps, the identity, the placed mobile station, and the slots. The identity's id
 * arrays are joined, not counted: a work order swapping cooldowns is a same-length change.
 */
export function professionsSignature(professions: unknown): string {
  if (professions === null) {
    return '';
  }
  const crafts = countsSignature(fieldValue(professions, 'craftSkills'));
  const gathering = countsSignature(fieldValue(professions, 'gathering'));
  const identity = identitySignature(fieldValue(professions, 'identity'));
  const station = fieldString(professions, 'mobileStation') ?? '';
  return `${crafts}|${gathering}|${identity}|${station}|${toolSlotsSignature(professions)}`;
}

/** A counter map as one string, sorted so key order cannot fire a change. */
export function countsSignature(counters: unknown): string {
  if (counters === null || typeof counters !== 'object') {
    return '';
  }
  return Object.entries(counters as Record<string, unknown>)
    .map(([key, count]) => `${key}=${String(count)}`)
    .sort(byCodePoint)
    .join(',');
}
