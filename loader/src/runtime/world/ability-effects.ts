// What an ability's own EFFECTS say, as opposed to what talents resolved.
// Everything here walks the effect array an ability applies; `abilities.ts` is
// the spellbook as an index.

import { fieldNumber, fieldString } from '../net/frames.ts';

/**
 * The effect types that apply a timed aura, each with the field carrying it.
 *
 * A table rather than a probe for a `duration` property, because the field name
 * is NOT uniform across the effect union: an interrupt's length is its `lockout`,
 * so probing would quietly answer nothing for the one a silence tracker wants.
 *
 * `finisherStun` and `finisherHaste` are deliberately ABSENT rather than missing:
 * both are `base + perCombo * spent`, so they have no length until the cast that
 * spends the points, and the base alone is right at one combo count only.
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
 * Read off the RANK-RESOLVED effect array, the same standard `cost` and
 * `castTime` meet: the game replaces `def.effects` with the highest learned
 * rank's before this ever sees it. Talent duration modifiers are applied at cast
 * time and are deliberately not folded in, because the use this exists for is a
 * DENOMINATOR: a diminishing-returns ladder expresses an observed duration as a
 * fraction of the undiminished base, and a base that moved is the wrong divisor.
 *
 * Several matching effects answer null rather than the longest. A stun AND a slow
 * is two right answers, this cannot know which the caller meant, and a wrong
 * denominator on a ladder is a display that is confidently off by a factor.
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
