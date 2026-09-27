// The player's own spellbook, projected out of `world.known` (the game's resolved abilities,
// each a content-table `def` plus the values talents resolved to). The shape is the loader's.
//
// It is the only exact join between an ability id (what skill art is filed under) and its
// display name (what combat events carry): `arcane_shot` is shown as "Fell Shot". It covers the
// player's OWN kit only, so a mob's ability name resolves to nothing. `def.name` is the sim's
// unlocalized string, which is why it matches combat events in any locale.

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
  // `charges` is the RESOLVED total: `bonusCharges` is already folded in, so adding it again
  // would publish three uses for a two-use pool.
  const charges = fieldNumber(entry, 'charges') ?? fieldNumber(def, 'maxCharges');
  if (charges !== null) {
    info.charges = charges;
  }
  const auraDuration = auraDurationOf(fieldValue(entry, 'effects'));
  if (auraDuration !== null) {
    info.auraDuration = auraDuration;
  }
  // Absent rather than 0 when the ability has no modifier: a 0 would claim something nobody said.
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
 * `cost`, `castTime` and `cooldown` are the RESOLVED values after talents, not the content
 * table's.
 *
 * No `icon`: art is async per-class, so join it yourself with
 * `ui.icon.ability(info.id, world.player.templateId)`. No `description`: the authored text is a
 * template with `$d` placeholders the game fills at render time.
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
   * Seconds the aura it applies lasts, rank-resolved and pre-talent. Absent when it applies
   * none, several of different lengths, or is a combo finisher.
   */
  auraDuration?: number;
  /** Bonus threat added on a successful use, flat. Absent when the ability adds none. */
  threatFlat?: number;
  /** Multiplier on the threat this ability's damage generates. Absent when it is plain. */
  threatMult?: number;
  /**
   * How many charge stages a hold-to-charge ability has. Absent when it has none.
   *
   * The live stage is not sent; the game derives it from the cast progress
   * `p = (castTotal - castRemaining) / castTotal` as `min(stages, floor(p * stages) + 1)`.
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
 * A label for an ability id, and whether it was looked up or guessed. Marking a guess is the
 * caller's job, since the name also reaches an `aria-label`.
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
 * What counts as a different spellbook: which abilities, at which ranks. A talent change moves
 * the rank set too, so the resolved numbers add nothing.
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
 * The same reading, taken from a built index (which the watch layer samples) rather than the
 * raw list; the id sits at `id` here and at `def.id` there.
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
 * A reader that rebuilds only when the spellbook actually changes. Keyed on the SIGNATURE, not
 * the array: the game hands back fresh arrays and entries on every snapshot.
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
 * The spellbook before the game exists: empty, with null lookups, so callers need no guard. A
 * shared singleton is safe only because everything in it is frozen.
 */
export function emptyAbilities(): AbilityIndex {
  return EMPTY;
}
