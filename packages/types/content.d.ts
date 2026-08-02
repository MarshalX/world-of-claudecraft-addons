// The two authored content tables the client carries: recipes and stations.
//
// These are COPIES. The game holds one recipe table and one station table for
// the life of the session and its own crafting window renders from them, so the
// loader copies and freezes rather than handing the originals over: a `.sort()`
// on the real array would reorder what the game draws, and a `.push()` would add
// a recipe it tries to render.
//
// Neither is a watch key, deliberately. Content cannot change during a session,
// so a subscription would compute a signature over the whole recipe table on
// every snapshot to report that nothing moved. What changes is on
// `world.professions`, which is a key already: your skills, your identity, and
// which recipes you have actually learned.
//
// Ids throughout. Nothing here resolves to a display name, the same limit
// `world.equipment` carries.

/** One authored recipe. */
export interface Recipe {
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
  /**
   * Where the recipe can be learned.
   *
   * Empty means grandfathered: known to everyone, and absent from
   * `world.professions.identity.knownRecipes` for that reason rather than
   * because it has not been learned.
   */
  acquisition: readonly string[];
  /** The adjacent-pair requirement, on the few combo recipes that carry one. */
  comboRequirement: { craftA: string; craftB: string; minTier: number } | null;
}

/** One authored crafting station, placed in a zone. */
export interface Station {
  id: string;
  type: string;
  zoneId: string;
  /** World coordinates. There is no y: the ground height is not authored here. */
  pos: { x: number; z: number };
  masterNpcId: string;
}
