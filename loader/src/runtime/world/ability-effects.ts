// What an ability's own EFFECTS say, as opposed to what talents resolved.
// Everything here walks the effect array an ability applies; `abilities.ts` is
// the spellbook as an index.

import { fieldNumber, fieldString } from '../net/frames.ts';

/**
 * The effect types that apply a timed aura, each with the field carrying it. A table, since the
 * field is not uniform: an interrupt's length is its `lockout`.
 *
 * `finisherStun` and `finisherHaste` are deliberately absent: their length depends on the combo
 * points spent at cast time.
 */
const AURA_DURATION_FIELDS: ReadonlyMap<string, string> = new Map([
  ['selfBuff', 'duration'],
  ['buffTarget', 'duration'],
  ['applyDebuff', 'duration'],
  ['petBuff', 'duration'],
  ['dot', 'duration'],
  ['root', 'duration'],
  ['stun', 'duration'],
  ['incapacitate', 'duration'],
  ['polymorph', 'duration'],
  ['silence', 'duration'],
  ['aoeFear', 'duration'],
  ['interrupt', 'lockout'],
]);

function eachOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

/** The length one effect applies, or null when it applies no timed aura. */
function effectDuration(effect: unknown): number | null {
  const type = fieldString(effect, 'type');
  if (type === null) {
    return null;
  }
  const field = AURA_DURATION_FIELDS.get(type);
  if (field === undefined) {
    return null;
  }
  const seconds = fieldNumber(effect, field);
  if (seconds === null || seconds <= 0) {
    return null;
  }
  return seconds;
}

/**
 * The one aura length this ability applies, or null when there is not exactly one.
 *
 * Rank-resolved but pre-talent, deliberately: it is the undiminished base a diminishing-returns
 * display divides an observed duration by. Several matching effects answer null, since which one
 * the caller meant is unknowable.
 */
function auraDurationOf(effects: unknown): number | null {
  let found: number | null = null;
  for (const effect of eachOf(effects)) {
    const seconds = effectDuration(effect);
    if (seconds !== null) {
      if (found !== null) {
        return null;
      }
      found = seconds;
    }
  }
  return found;
}

export { auraDurationOf, eachOf };
