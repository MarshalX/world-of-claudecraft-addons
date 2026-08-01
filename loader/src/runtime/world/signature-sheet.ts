// What counts as a change on the character sheet.
//
// Split from `signature.ts` because it shares nothing with the keys there: those
// describe what is happening near the player, these describe the player's own
// record, and the two move on completely different clocks.

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
