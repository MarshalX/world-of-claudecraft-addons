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

/**
 * The slotted tool effects, as `profession:effect:charges` per row.
 *
 * The CHARGE COUNT is in it, which is the whole reason this contributes at all: a
 * slot's effect and profession move once when it is installed, and the counter is
 * what moves on every harvest that spends one. A panel showing how many swings
 * are left would otherwise repaint only when some other part of the sheet did.
 *
 * `maxCharges`, `confirmMode` and `selfCrafted` are left out. They move only on a
 * re-slot or a recharge, and both of those move `effectId` or the count with them,
 * so including them would lengthen the string without ever being the thing that
 * changed it. The rows are server-sorted, so this is stable without a sort here.
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
 * The two counter maps, the identity, the placed mobile station, and the slots.
 *
 * The counters are the signature of themselves: a skill only moves when the player
 * did something worth repainting for. The identity joins both id ARRAYS rather than
 * taking their lengths, unlike the milestone count on the character sheet, because a
 * work order coming off cooldown as another goes on is a same-length swap and that is
 * exactly the transition a crafting panel exists to show. Both arrays are
 * server-sorted and bounded by the recipes in content.
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
