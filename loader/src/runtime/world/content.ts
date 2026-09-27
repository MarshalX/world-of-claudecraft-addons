// The content tables the client hands over, deep-copied once and frozen. The sources are the
// game's own arrays, so an addon's `.sort()` or `.push()` would reach the game's windows.
//
// Content cannot change during a session, so these must NOT become world keys: a signature
// would walk every recipe each snapshot to report nothing. The live half of crafting is
// `professions`. The readers answer an empty array, never null.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

/** One authored recipe. Ids throughout: nothing here resolves to display text. */
interface Recipe {
  id: string;
  professionId: string;
  resultItemId: string;
  resultCount: number;
  reagents: readonly { itemId: string; count: number }[];
  /** The flat craft-skill floor. 0 for every free-floor recipe. */
  skillReq: number;
  /** The item-level budget the output is balanced against. Not an item level. */
  itemLevelBudget: number;
  /** The content level for the profession-xp curve, on the character scale. */
  level: number;
  /** Present only on a recipe that must be crafted at a station of this type. */
  stationType: string | null;
  /** Where the recipe can be learned. Empty means grandfathered: known to all. */
  acquisition: readonly string[];
  /** The adjacent-pair requirement, on the few combo recipes that carry one. */
  comboRequirement: { craftA: string; craftB: string; minTier: number } | null;
}

/**
 * One authored civic service point: a mailbox or a noticeboard. No zone and no id: the game's
 * list carries neither.
 */
interface CivicService {
  kind: string;
  x: number;
  z: number;
}

/** One authored crafting station, placed in a zone. */
interface Station {
  id: string;
  type: string;
  zoneId: string;
  pos: { x: number; z: number };
  masterNpcId: string;
}

const NO_RECIPES: readonly Recipe[] = Object.freeze([]);
const NO_STATIONS: readonly Station[] = Object.freeze([]);
const NO_CIVIC_SERVICES: readonly CivicService[] = Object.freeze([]);

/**
 * What has already been copied, keyed weakly on the SOURCE array, so a world swap re-reads and a
 * dropped world is not kept alive.
 */
const copies = new WeakMap<object, readonly unknown[]>();

/** The source array for a field, or null when the client carries no such table. */
function tableAt(world: unknown, field: string): readonly unknown[] | null {
  const value = fieldValue(world, field);
  if (Array.isArray(value)) {
    return value;
  }
  return null;
}

function reagentOf(reagent: unknown): { itemId: string; count: number } {
  return Object.freeze({
    itemId: fieldString(reagent, 'itemId') ?? '',
    count: fieldNumber(reagent, 'count') ?? 0,
  });
}

/** The combo requirement, or null on the recipes that carry none (most of them). */
function comboOf(recipe: unknown): Recipe['comboRequirement'] {
  const combo = fieldValue(recipe, 'comboRequirement');
  if (combo === null) {
    return null;
  }
  return Object.freeze({
    craftA: fieldString(combo, 'craftA') ?? '',
    craftB: fieldString(combo, 'craftB') ?? '',
    minTier: fieldNumber(combo, 'minTier') ?? 0,
  });
}

function recipeOf(recipe: unknown): Recipe {
  return Object.freeze({
    id: fieldString(recipe, 'id') ?? '',
    professionId: fieldString(recipe, 'professionId') ?? '',
    resultItemId: fieldString(recipe, 'resultItemId') ?? '',
    resultCount: fieldNumber(recipe, 'resultCount') ?? 0,
    reagents: Object.freeze(fieldArray(recipe, 'reagents').map(reagentOf)),
    skillReq: fieldNumber(recipe, 'skillReq') ?? 0,
    itemLevelBudget: fieldNumber(recipe, 'itemLevelBudget') ?? 0,
    level: fieldNumber(recipe, 'level') ?? 0,
    stationType: fieldString(recipe, 'stationType'),
    acquisition: Object.freeze(
      fieldArray(recipe, 'acquisition').filter((one): one is string => typeof one === 'string'),
    ),
    comboRequirement: comboOf(recipe),
  });
}

function civicServiceOf(service: unknown): CivicService {
  return Object.freeze({
    kind: fieldString(service, 'kind') ?? '',
    x: fieldNumber(service, 'x') ?? 0,
    z: fieldNumber(service, 'z') ?? 0,
  });
}

function stationOf(station: unknown): Station {
  const pos = fieldValue(station, 'pos');
  return Object.freeze({
    id: fieldString(station, 'id') ?? '',
    type: fieldString(station, 'type') ?? '',
    zoneId: fieldString(station, 'zoneId') ?? '',
    pos: Object.freeze({
      x: fieldNumber(pos, 'x') ?? 0,
      z: fieldNumber(pos, 'z') ?? 0,
    }),
    masterNpcId: fieldString(station, 'masterNpcId') ?? '',
  });
}

/** One copy per source array, so a read per frame does not rebuild the table. */
function copyOnce<T>(source: readonly unknown[], one: (entry: unknown) => T): readonly T[] {
  const had = copies.get(source);
  if (had !== undefined) {
    return had as readonly T[];
  }
  const made = Object.freeze(source.map(one));
  copies.set(source, made);
  return made;
}

/** The game's own recipe table, copied and frozen. */
function readRecipes(world: unknown): readonly Recipe[] {
  const source = tableAt(world, 'recipeList');
  if (source === null) {
    return NO_RECIPES;
  }
  return copyOnce(source, recipeOf);
}

/** The authored crafting stations, copied and frozen, exactly like `readRecipes`. */
function readStations(world: unknown): readonly Station[] {
  const source = tableAt(world, 'stationPlacements');
  if (source === null) {
    return NO_STATIONS;
  }
  return copyOnce(source, stationOf);
}

/**
 * The authored mailboxes and noticeboards, copied and frozen like the others: the source is the
 * array the game's own map window reads.
 */
function readCivicServices(world: unknown): readonly CivicService[] {
  const source = tableAt(world, 'civicServicePlacements');
  if (source === null) {
    return NO_CIVIC_SERVICES;
  }
  return copyOnce(source, civicServiceOf);
}

export type { CivicService, Recipe, Station };
export { readCivicServices, readRecipes, readStations };
