/**
 * One ability you know.
 *
 * `cost`, `castTime` and `cooldown` are RESOLVED after your talents, which is
 * what a cooldown display counts down from.
 *
 * There is no `icon`, because art is fetched asynchronously. Join it yourself:
 *
 * ```js
 * const url = woc.ui.icon.ability(info.id, woc.world.player.templateId);
 * ```
 *
 * There is no `description`: the authored text is a template the game fills in
 * when it renders.
 */
export interface AbilityInfo {
  id: string;
  /**
   * The display name.
   *
   * The string combat events carry in their `ability` field, so `byName` maps it
   * back to an id. Not localized: it does not change with the client's language.
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
  /**
   * How long the effect this ability applies lasts, in seconds.
   *
   * The RANK-resolved base, with no talent modifiers, so it is the right
   * denominator for a diminishing-returns ratio of observed to undiminished
   * duration. The game's own tooltip does not show it.
   *
   * ABSENT in three cases: the ability applies no timed effect; it applies
   * several of different lengths (a stun and a slow); or it is a combo-point
   * finisher, whose length depends on the points spent.
   */
  auraDuration?: number;

  /**
   * Bonus threat this ability adds on a successful use, flat.
   *
   * Resolved per rank. Absent, not 0, when the ability adds none. Added in API
   * minor 2.
   */
  threatFlat?: number;

  /**
   * Multiplier on the threat this ability's damage generates.
   *
   * Absent, not 1, when the ability has no modifier. Added in API minor 2.
   */
  threatMult?: number;

  /**
   * How many charge stages a hold-to-charge ability has. Absent when it has none.
   *
   * THE COUNT, NOT THE LIVE STAGE. The stage is on no wire: derive it from
   * `castTotal` and `castRemaining` on the caster's entity. Treat progress as 1
   * when `castTotal` is not positive (the client zero-fills it, and dividing by 0
   * gives NaN), and the stage as 1 when the count is not above one.
   *
   * Nothing on the wire marks a cast as empowered, and this is YOUR OWN
   * spellbook, so a hostile caster charging an ability you have not learned has no
   * divisor. `Aura.empowerAbilities` is a next-cast buff's scope, not a stage.
   *
   * Added in API minor 10.
   */
  empowerStages?: number;

  /**
   * The channel's length and tick count. Absent when the ability is not channelled.
   * `castTime` is 0 on a channel, which does not mean instant.
   *
   * DO NOT DRIVE A LIVE BAR FROM `duration`. It is PRE-HASTE: the haste-resolved
   * length is `castTotal` on the caster's entity record, counting down in
   * `castRemaining` with `channeling` true. Added in API minor 10.
   */
  channel?: AbilityChannel;

  /**
   * Usable without spending the global cooldown. ABSENT, never false, when the
   * ability is ordinary. Added in API minor 10.
   */
  offGcd?: true;
}

/**
 * How long a channel runs and how many times it ticks, as AUTHORED: haste
 * shortens it, and some abilities can fire extra ticks. For anything live, read
 * `castTotal` and `castRemaining` off the caster. Added in API minor 10.
 */
export interface AbilityChannel {
  duration: number;
  ticks: number;
}

/**
 * What `describe` answers: a label for an ability id, and where it came from.
 *
 * `known: false` means the name was derived from the id and is likely wrong,
 * since ids and display names diverge. Mark the guess yourself; the name carries
 * no marker. Added in API minor 4.
 */
export interface AbilityDescription {
  /** The game's own display name where you know the ability, derived from the id where you do not. */
  name: string;
  /** Null where you do not know the ability. */
  school: string | null;
  known: boolean;
}

/**
 * Your spellbook: the abilities you know, and three ways to look one up.
 *
 * The bridge between an ability's id and its display name, which diverge: skill
 * art is filed under the id (`arcane_shot`), while combat events carry the name
 * (`Fell Shot`).
 *
 * ```js
 * // an event gave you a name; get the id, then the art
 * const info = woc.world.abilities.byName(event.ability);
 * const url = info && woc.ui.icon.ability(info.id, woc.world.player.templateId);
 *
 * // a cooldown map gave you an id; get something readable
 * const label = woc.world.abilities.describe(id).name;
 * ```
 *
 * `describe` always answers: where `byId` is null, it derives a name and says so.
 *
 * It covers YOUR OWN kit only, so `byName` is null for a mob's ability. It is
 * empty until the world is up.
 *
 * The objects are frozen and safe to hold. The list is replaced when your
 * spellbook changes, which `woc.world.on('abilities', ...)` reports.
 */
export interface AbilityIndex {
  readonly known: readonly AbilityInfo[];
  /** Null for an ability you do not know. */
  byId: (id: string) => AbilityInfo | null;
  /** Null for a name that is not one of yours, which includes every mob ability. */
  byName: (name: string) => AbilityInfo | null;
  /**
   * Something readable for any ability id, never null and never throwing.
   *
   * On the landing page every id comes back derived. Read `known` before you
   * present the name. Added in API minor 4.
   */
  describe: (id: string) => AbilityDescription;
}
