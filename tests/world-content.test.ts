// The recipe and station tables. The source is the game's own array, which its crafting
// window renders from, so an addon must get a frozen copy, cached on the source array.

import { describe, expect, it } from 'vitest';

import { type Recipe, readRecipes, readStations } from '../loader/src/runtime/world/content.ts';

/** A recipe shaped the way the game authors one, with everything optional present. */
function recipe(id: string) {
  return {
    id,
    professionId: 'blacksmithing',
    resultItemId: 'iron_buckle',
    resultCount: 2,
    reagents: [{ itemId: 'iron_ore', count: 3 }],
    skillReq: 0,
    itemLevelBudget: 12,
    level: 14,
    stationType: 'forge',
    acquisition: ['trainer', 'drop'],
    comboRequirement: { craftA: 'blacksmithing', craftB: 'leatherworking', minTier: 2 },
  };
}

function station(id: string) {
  return {
    id,
    type: 'forge',
    zoneId: 'eastbrook',
    pos: { x: 12.5, z: -40 },
    masterNpcId: 'smith_hollis',
  };
}

describe('reading the recipe table', () => {
  it('reads every authored field off a recipe', () => {
    const [read] = readRecipes({ recipeList: [recipe('iron_buckle')] });

    expect(read).toEqual(recipe('iron_buckle'));
  });

  it('answers null for the two fields the game leaves off most recipes', () => {
    const source = { id: 'field_bandage', professionId: 'tailoring' };
    const [read] = readRecipes({ recipeList: [source] });

    expect(read?.stationType).toBeNull();
    expect(read?.comboRequirement).toBeNull();
  });

  // Empty means grandfathered, which differs from "not learned yet".
  it('answers an empty acquisition list', () => {
    const [read] = readRecipes({ recipeList: [{ id: 'coarse_thread' }] });

    expect(read?.acquisition).toEqual([]);
  });

  it('answers an empty table for a client carrying no recipe list', () => {
    expect(readRecipes({})).toEqual([]);
    expect(readRecipes(null)).toEqual([]);
  });
});

describe('reading the station table', () => {
  it('reads every authored field off a station', () => {
    const [read] = readStations({ stationPlacements: [station('eastbrook_forge')] });

    expect(read).toEqual(station('eastbrook_forge'));
  });

  it('answers an empty table for a client carrying no stations', () => {
    expect(readStations({})).toEqual([]);
  });
});

describe('what an addon cannot do to the game', () => {
  it('freezes the table, every entry, and the collections inside an entry', () => {
    const recipes = readRecipes({ recipeList: [recipe('iron_buckle')] });

    expect(Object.isFrozen(recipes)).toBe(true);
    expect(Object.isFrozen(recipes[0])).toBe(true);
    expect(Object.isFrozen(recipes[0]?.reagents)).toBe(true);
    expect(Object.isFrozen(recipes[0]?.acquisition)).toBe(true);
    expect(Object.isFrozen(recipes[0]?.comboRequirement)).toBe(true);
  });

  it('freezes a station and the position on it', () => {
    const stations = readStations({ stationPlacements: [station('eastbrook_forge')] });

    expect(Object.isFrozen(stations[0])).toBe(true);
    expect(Object.isFrozen(stations[0]?.pos)).toBe(true);
  });

  // An addon body runs in strict mode, so the write throws.
  it('leaves the game its own array when an addon writes to the copy', () => {
    const source = [recipe('iron_buckle')];
    const recipes = readRecipes({ recipeList: source });

    expect(() => (recipes as Recipe[]).push(recipe('added_by_an_addon'))).toThrow(TypeError);
    expect(source.map((one) => one.id)).toEqual(['iron_buckle']);
  });
});

describe('the cache, and what invalidates it', () => {
  // A getter read per frame by anything that draws.
  it('answers the same array instance for the same source', () => {
    const world = { recipeList: [recipe('iron_buckle')] };

    expect(readRecipes(world)).toBe(readRecipes(world));
  });

  it('re-reads when the source array is replaced', () => {
    const first = readRecipes({ recipeList: [recipe('iron_buckle')] });
    const second = readRecipes({ recipeList: [recipe('iron_buckle')] });

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('caches the station table the same way', () => {
    const world = { stationPlacements: [station('eastbrook_forge')] };

    expect(readStations(world)).toBe(readStations(world));
  });
});
