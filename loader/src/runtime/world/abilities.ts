// The player's own spellbook, projected out of the game's resolved ability list.
//
// Like `derived.ts` and unlike `game-types.ts`, the shape here is the LOADER'S
// own: the claim is only about the fields it is computed from. Those live on
// `world.known`, an array of the game's ResolvedAbility, each carrying the
// content-table `def` plus the values talents actually resolved to.
//
// This exists because an ability's id and its DISPLAY NAME have diverged and
// nothing else bridges them. `arcane_shot` is shown everywhere in the game as
// "Fell Shot". Skill art is filed under the id; combat events carry the name. So
// an addon holding one could not get the other, which left the two shipped
// addons with half each: a meter could not draw ability art, and a cooldown
// display could only title-case an id and hope. `known` carries both, verified
// against a live client, and the join is exact in both directions.
//
// Two limits that belong in every consumer's head. It covers the player's OWN
// known kit, so a mob's ability name resolves to nothing. And `def.name` is the
// sim's string rather than a localized one, which is exactly why the join works:
// combat events carry that same string whatever locale the client renders in.

import { titleCase } from '../../shared/fmt.ts';
import { fieldNumber, fieldString, fieldValue } from '../net/frames.ts';
import { auraDurationOf, eachOf } from './ability-effects.ts';

function guessFromId(id: string): AbilityDescription {
  return { name: titleCase(id), school: null, known: false };
}

const EMPTY: AbilityIndex = Object.freeze({
  known: Object.freeze([]),
  byId: () => null,
  byName: () => null,
  // The derived path, which is what makes `describe` answer before world entry.
  describe: guessFromId,
});

/** A channel's authored length and tick count, or null when the ability is not one. */
function channelOf(channel: unknown): AbilityChannel | null {
  const duration = fieldNumber(channel, 'duration');
  const ticks = fieldNumber(channel, 'ticks');
  if (duration === null || ticks === null) {
    return null;
  }
  return { duration, ticks };
}

/**
 * The three optional fields read off the DEF rather than the resolved entry:
 * talent resolution touches none of them, so the entry carries no copy to prefer.
 */
function applyDefShape(info: AbilityInfo, def: unknown): void {
  const empowerStages = fieldNumber(def, 'empowerStages');
  if (empowerStages !== null) {
    info.empowerStages = empowerStages;
  }
  const channel = channelOf(fieldValue(def, 'channel'));
  if (channel !== null) {
    info.channel = channel;
  }
  if (fieldValue(def, 'offGcd') === true) {
    info.offGcd = true;
  }
}

/** A resolved entry, or null when it carries no usable id and name. */
function toAbility(entry: unknown): AbilityInfo | null {
  const def = fieldValue(entry, 'def');
  const id = fieldString(def, 'id');
  const name = fieldString(def, 'name');
  if (id === null || name === null) {
    return null;
  }
  const info: AbilityInfo = {
    id,
    name,
    school: fieldString(def, 'school') ?? 'physical',
    rank: fieldNumber(entry, 'rank') ?? 1,
    cost: fieldNumber(entry, 'cost') ?? fieldNumber(def, 'cost') ?? 0,
    castTime: fieldNumber(entry, 'castTime') ?? fieldNumber(def, 'castTime') ?? 0,
    cooldown: fieldNumber(entry, 'cooldown') ?? fieldNumber(def, 'cooldown') ?? 0,
    range: fieldNumber(def, 'range') ?? 0,
    requiresTarget: fieldValue(def, 'requiresTarget') === true,
  };
  const minRange = fieldNumber(def, 'minRange');
  if (minRange !== null) {
    info.minRange = minRange;
  }
  if (fieldValue(def, 'passive') === true) {
    info.passive = true;
  }
  // `charges` is the RESOLVED total and `bonusCharges` is deliberately NOT added to
  // it. The game keeps the talent-added figure as a separate field, which reads like
  // something to sum, and it is not: a live hunter carrying the charge talent showed
  // `charges: 2` with `bonusCharges: 1` and no `def.maxCharges`, which the game
  // documents as a base of one. So the base and the bonus are already folded in, and
  // adding the bonus again would publish three uses for a two-use pool.
  const charges = fieldNumber(entry, 'charges') ?? fieldNumber(def, 'maxCharges');
  if (charges !== null) {
    info.charges = charges;
  }
  const auraDuration = auraDurationOf(fieldValue(entry, 'effects'));
  if (auraDuration !== null) {
    info.auraDuration = auraDuration;
  }
  // Both optional and both absent rather than 0 when the ability has no modifier,
  // for the reason `auraDuration` is: absent and zero are different answers, and a
  // published 0 would read as "this ability generates no bonus threat" where the
  // truth is that nobody said.
  const threatFlat = fieldNumber(entry, 'threatFlat');
  if (threatFlat !== null) {
    info.threatFlat = threatFlat;
  }
  const threatMult = fieldNumber(entry, 'threatMult');
  if (threatMult !== null) {
    info.threatMult = threatMult;
  }
  applyDefShape(info, def);
  return info;
}

function describeOne(info: AbilityInfo | undefined, id: string): AbilityDescription {
  if (info === undefined) {
    return guessFromId(id);
  }
  return { name: info.name, school: info.school, known: true };
}

function buildIndex(entries: readonly unknown[]): AbilityIndex {
  const known: AbilityInfo[] = [];
  const ids = new Map<string, AbilityInfo>();
  const names = new Map<string, AbilityInfo>();
  for (const entry of entries) {
    const info = toAbility(entry);
    if (info !== null) {
      Object.freeze(info);
      known.push(info);
      ids.set(info.id, info);
      names.set(info.name, info);
    }
  }
  Object.freeze(known);
  return {
    known,
    byId: (id) => ids.get(id) ?? null,
    byName: (name) => names.get(name) ?? null,
    describe: (id) => describeOne(ids.get(id), id),
  };
}

/**
 * One ability the player knows.
 *
 * `cost`, `castTime` and `cooldown` are the RESOLVED values, not the content
 * table's: talents modify them, and a live hunter's `arcane_shot` reported a 5.4
 * second cooldown against the def's 6. Publishing the def's numbers would be
 * quietly wrong for anyone who has spent a talent point.
 *
 * There is no `icon`. Art needs a per-class manifest and is therefore async, and
 * resolving it here would couple the world surface to the ui one. Join the two
 * yourself: `ui.icon.ability(info.id, world.player.templateId)`.
 *
 * There is no `description` either. The authored text carries `$d` style
 * placeholders the game substitutes at render time, so it would arrive as a
 * template rather than as a sentence.
 */
export interface AbilityInfo {
  id: string;
  /** The display name, which is what combat events carry. */
  name: string;
  school: string;
  /** Which rank of it the player has learned. */
  rank: number;
  /** Resolved after talents, not the content table's figure. */
  cost: number;
  castTime: number;
  cooldown: number;
  /** Yards. 0 is melee range. */
  range: number;
  minRange?: number;
  requiresTarget: boolean;
  /** Known and shown, never castable. */
  passive?: boolean;
  /** Stored uses, for the few abilities that pool them. Absent when it is one. */
  charges?: number;
  /**
   * Seconds the aura it applies lasts, rank-resolved and pre-talent.
   *
   * Absent when it applies none, when it applies several of different lengths,
   * and for a combo finisher, whose length has no value until the cast.
   */
  auraDuration?: number;
  /** Bonus threat added on a successful use, flat. Absent when the ability adds none. */
  threatFlat?: number;
  /** Multiplier on the threat this ability's damage generates. Absent when it is plain. */
  threatMult?: number;
  /**
   * How many charge stages a hold-to-charge ability has. Absent when it has none.
   *
   * The count, not the live stage: the stage is on no wire, and the game derives
   * it as `min(stages, floor(progress * stages) + 1)` over
   * `(castTotal - castRemaining) / castTotal`, which ride every entity record.
   */
  empowerStages?: number;
  /** The channel's authored length and tick count. Absent when it is not a channel. */
  channel?: AbilityChannel;
  /** Usable without spending the global cooldown. Absent rather than false, so typed `true`. */
  offGcd?: true;
}

/**
 * How long a channel runs and how many times it ticks, PRE-HASTE: the game divides
 * the duration by spell haste at cast time, and `castTime` is 0 on a channel.
 */
export interface AbilityChannel {
  duration: number;
  ticks: number;
}

/**
 * A label for an ability id, and whether it was looked up or guessed.
 *
 * The guess mark stays the caller's: the same string reaches an `aria-label` and
 * a tooltip title, where a glued-on `?` reads as part of the name.
 */
export interface AbilityDescription {
  name: string;
  /** Null for an ability the player does not know. */
  school: string | null;
  known: boolean;
}

/** What `byId`, `byName` and `describe` answer from, rebuilt only when the set really changes. */
export interface AbilityIndex {
  readonly known: readonly AbilityInfo[];
  byId: (id: string) => AbilityInfo | null;
  byName: (name: string) => AbilityInfo | null;
  describe: (id: string) => AbilityDescription;
}

/**
 * What counts as a different spellbook: which abilities, at which ranks.
 *
 * Deliberately not the resolved numbers. A talent change moves cost and cooldown
 * and also moves the rank set, so the ranks are enough to catch it, while a
 * signature over every figure would be longer to build for no extra sensitivity.
 */
export function abilitySignature(known: unknown): string {
  const rows: string[] = [];
  for (const entry of eachOf(known)) {
    const id = fieldString(fieldValue(entry, 'def'), 'id');
    if (id !== null) {
      rows.push(`${id}#${fieldNumber(entry, 'rank') ?? 1}`);
    }
  }
  return rows.join(',');
}

/**
 * The same reading, taken from a built index rather than from the raw list.
 *
 * The watch layer samples the PUBLISHED value, which is the index, while the
 * reader below signs the game's own array on the way in. Two entry points rather
 * than one because the id sits at a different depth on each side (`def.id` on a
 * resolved entry, `id` on a projected one), and collapsing them would mean a
 * path-walking helper that is longer than both.
 *
 * Recomputed per sample rather than cached on the index, which would mean
 * publishing a `signature` field addons have no use for. It is a join over about
 * twenty entries, the same order of work every other capture here does.
 */
export function abilityIndexSignature(index: unknown): string {
  const rows: string[] = [];
  for (const info of eachOf(fieldValue(index, 'known'))) {
    const id = fieldString(info, 'id');
    if (id !== null) {
      rows.push(`${id}#${fieldNumber(info, 'rank') ?? 1}`);
    }
  }
  return rows.join(',');
}

/**
 * A reader that rebuilds only when the spellbook actually changes.
 *
 * The memo is keyed on the SIGNATURE and not on the array, which is the whole
 * reason this is not a plain function. Measured against a live client, the game
 * hands back a fresh array AND fresh entry objects on every snapshot, twenty
 * times a second, so an identity check would rebuild constantly and an addon
 * that held what it was given would be holding something already replaced. The
 * objects published here are the loader's own and frozen, so a cached
 * `AbilityInfo` stays valid until the set genuinely moves.
 */
export function createAbilityReader(): (world: unknown) => AbilityIndex {
  let signature: string | null = null;
  let index: AbilityIndex = EMPTY;
  return (world) => {
    const known = fieldValue(world, 'known');
    if (!Array.isArray(known)) {
      return EMPTY;
    }
    const next = abilitySignature(known);
    if (next !== signature) {
      signature = next;
      index = buildIndex(known);
    }
    return index;
  };
}

/**
 * The spellbook before the game exists.
 *
 * A shared frozen singleton, which is safe here and would not be for `entities`:
 * everything it holds is immutable, so one addon cannot reach another through
 * it. Reading it answers an empty list and null lookups rather than null itself,
 * so `world.abilities.byName(...)` needs no guard on the landing page.
 */
export function emptyAbilities(): AbilityIndex {
  return EMPTY;
}
