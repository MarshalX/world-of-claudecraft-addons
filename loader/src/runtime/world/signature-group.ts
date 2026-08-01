// What counts as a change to the group's shared state and to an instanced run.
//
// Both leave their timers out, for the reason every signature here does. A loot
// roll's countdown moves every frame, so including it would fire a subscription
// at the frame rate to report that time is passing; what an addon acts on is a
// roll opening or closing. A lockout's countdown is measured in hours, so the
// same rule applies from the other end: what matters is which dungeons are
// locked, not that the deadline crept a second closer.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

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

/** The keys of a Map, sorted, or an empty string for anything that is not one. */
function mapKeys(value: unknown): string {
  if (!(value instanceof Map)) {
    return '';
  }
  return [...value.keys()]
    .map((key) => String(key))
    .sort(byCodePoint)
    .join(',');
}

/** Who is master looting, or nothing at all when the group is not using it. */
function looterOf(master: unknown): string {
  if (master === null) {
    return '';
  }
  return String(fieldNumber(master, 'looter') ?? 0);
}

/** Which rolls are open, who is master looting, and which dungeons are locked. */
export function groupSignature(group: unknown): string {
  if (group === null) {
    return '';
  }
  const rolls = fieldArray(group, 'rolls')
    .map((roll) => String(fieldNumber(roll, 'rollId') ?? 0))
    .sort(byCodePoint)
    .join(',');
  const looter = looterOf(fieldValue(group, 'masterLoot'));
  return `${rolls}|${looter}|${mapKeys(fieldValue(group, 'lockouts'))}`;
}

/** Which run is up and how far through it, plus how many clears are recorded. */
export function encounterSignature(encounter: unknown): string {
  if (encounter === null) {
    return '';
  }
  const run = fieldValue(encounter, 'run');
  if (run === null) {
    return `|${mapKeys(fieldValue(encounter, 'clears'))}`;
  }
  const at = String(fieldNumber(run, 'moduleIndex') ?? 0);
  const done = String(fieldValue(run, 'completed') === true);
  const open = String(fieldValue(run, 'exitPortalOpen') === true);
  return (
    `${fieldString(run, 'delveId') ?? ''}:${fieldString(run, 'tierId') ?? ''}:${at}:${done}:${open}` +
    `|${mapKeys(fieldValue(encounter, 'clears'))}`
  );
}
