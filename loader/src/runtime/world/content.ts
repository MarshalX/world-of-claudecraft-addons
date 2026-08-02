// The two content tables the client hands over, copied once and frozen.
//
// `recipeList` and `stationPlacements` are plain fields on the client's world
// holding the game's OWN arrays by identity. Handing either to an addon
// unwrapped is what `world.entities` was before it got a read-only view, one
// level worse: a `.sort()` in an addon reorders the table the game's own
// crafting window renders from, and a `.push()` adds a recipe it will try to
// draw. So the read is a deep copy, frozen, cached on the identity of the
// source array.
//
// Content cannot change during a session, which is why these two are NOT world
// keys and must not become them. A signature over the recipe table would walk
// every recipe on every snapshot to report that nothing moved, which is the same
// call the dev watcher already makes when it polls bodies rather than the index.
// The live half of crafting rides `professions`, which is a key already.
//
// Neither reader ever returns null. An empty array is the honest answer for a
// client that has not carried the field, and a static content read has nothing
// to be "not ready yet" about.

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

/**
 * What has already been copied, keyed on the array it was copied FROM.
 *
 * Keyed on the source rather than on a boolean so a world swap re-reads instead
 * of serving the previous world's tables, and weak so a world the page has
 * dropped does not keep its content table alive through the loader.
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

/**
 * The game's own recipe table, copied and frozen.
 *
 * The copy is not optional and the cache is not an optimisation: the source is
 * the game's live array by identity, so the walk has to produce new frozen
 * entries, and it has to be keyed on the SOURCE rather than on a boolean so a
 * world swap re-reads instead of serving the previous world's tables.
 */
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

export type { Recipe, Station };
export { readRecipes, readStations };
