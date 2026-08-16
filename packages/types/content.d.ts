// The authored content tables the client carries: recipes, crafting stations and
// civic service points.
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

/**
 * One authored civic service point: a mailbox or a noticeboard.
 *
 * Flatter than a `Station` because the game's own list is: no id, no zone, and
 * the position is not nested. That is enough to draw a marker and not enough to
 * name one, so a display has to say what it is from the `kind` alone.
 *
 * `'mailbox'` and `'noticeboard'` are what the game ships. The type is a plain
 * string rather than that pair, because the set is content and a release adds to
 * it before these types catch up, exactly as with a cue name. Match the kinds you
 * draw and let an unknown one fall through rather than assuming there are two.
 *
 * Added in game 0.38.0.
 */
export interface CivicService {
  kind: string;
  /** World coordinates. There is no y, as with a station. */
  x: number;
  z: number;
}
