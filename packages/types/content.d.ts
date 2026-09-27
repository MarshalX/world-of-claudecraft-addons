// The authored content tables the client carries: recipes, crafting stations and
// civic service points.
//
// These are frozen COPIES of tables the game renders from, and none is a watch key:
// content cannot change during a session. What does change (your skills and which
// recipes you have learned) is on `world.professions`.
//
// Ids throughout. Nothing here resolves to a display name.

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
   * Empty means grandfathered: known to everyone, and for that reason absent from
   * `world.professions.identity.knownRecipes`.
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
 * No id and no zone: enough to draw a marker, not to name one, so a display
 * labels it from `kind` alone.
 *
 * The game ships `'mailbox'` and `'noticeboard'`. The type is an open string
 * because a release can add kinds before these types catch up, so match the
 * kinds you draw and let an unknown one fall through.
 */
export interface CivicService {
  kind: string;
  /** World coordinates. There is no y, as with a station. */
  x: number;
  z: number;
}
