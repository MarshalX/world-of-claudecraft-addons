/**
 * One ability you know.
 *
 * `cost`, `castTime` and `cooldown` are the RESOLVED values, after your talents,
 * rather than the ability's base figures. A hunter with the relevant point spent
 * reads a 5.4 second cooldown on `arcane_shot` where the base is 6, and the
 * resolved number is the one a cooldown display has to count down from.
 *
 * There is no `icon`, because art needs a per-class manifest and is fetched
 * asynchronously. Join it yourself, which is one line:
 *
 * ```js
 * const url = woc.ui.icon.ability(info.id, woc.world.player.templateId);
 * ```
 *
 * There is no `description` either: the authored text carries placeholders the
 * game substitutes when it renders, so it would reach you as a template rather
 * than as a sentence.
 */
export interface AbilityInfo {
  id: string;
  /**
   * The display name.
   *
   * This is the string combat events carry in their `ability` field, which is
   * what makes `byName` a reliable way back to an id. It is the game's own name
   * rather than a localized one, so it does not change with the client's
   * language, and neither does the event field it matches.
   */
  name: string;
  school: string;
  /** Which rank of it you have learned. */
  rank: number;
  /** Resolved after talents, not the base figure. */
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
}

/**
 * Your spellbook: the abilities you know, and two ways to look one up.
 *
 * This is the ONLY bridge between an ability's id and its display name, and you
 * need it because the two have diverged and nothing else connects them. Skill
 * art is filed under the id (`arcane_shot`), while combat events name the
 * ability (`Fell Shot`). So a meter reading events can find the icon, and a
 * cooldown display holding ids can find the label:
 *
 * ```js
 * // an event gave you a name; get the id, then the art
 * const info = woc.world.abilities.byName(event.ability);
 * const url = info && woc.ui.icon.ability(info.id, woc.world.player.templateId);
 *
 * // a cooldown map gave you an id; get something readable
 * const label = woc.world.abilities.byId(id)?.name ?? id;
 * ```
 *
 * TWO LIMITS WORTH KNOWING. It covers YOUR OWN known kit, so an ability a mob
 * casts is not in here and `byName` answers null for it. And it is empty until
 * the world is up, so a lookup on the landing page finds nothing rather than
 * throwing.
 *
 * The objects it hands out are frozen and are the loader's own, so one stays
 * valid to hold. The list itself is replaced whenever your spellbook genuinely
 * changes, which `woc.world.on('abilities', ...)` reports.
 */
export interface AbilityIndex {
  readonly known: readonly AbilityInfo[];
  /** Null for an ability you do not know. */
  byId: (id: string) => AbilityInfo | null;
  /** Null for a name that is not one of yours, which includes every mob ability. */
  byName: (name: string) => AbilityInfo | null;
}
