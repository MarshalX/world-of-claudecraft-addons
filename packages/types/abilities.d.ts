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
  /**
   * How long the effect this ability applies lasts, in seconds.
   *
   * The RANK-resolved base, not the figure a cast will produce. Talent duration
   * modifiers are applied at cast time and are deliberately not folded in,
   * because the use this exists for is a denominator: a diminishing-returns
   * ladder expresses an observed duration as a fraction of the undiminished
   * base, and a base that already moved is the wrong one to divide by.
   *
   * ABSENT rather than zero in three cases, and they are different questions
   * rather than one missing number. An ability that applies no timed effect has
   * no answer. An ability that applies several of different lengths (a stun and
   * a slow) has two, and picking one would be a guess about which you meant. And
   * a combo-point finisher's length is `base + perCombo * spent`, which has no
   * value at all until the cast that spends the points.
   *
   * The game's own ability tooltip does not show this figure, so there is no
   * on-screen number to check it against: it comes off the resolved effect the
   * ability applies.
   */
  auraDuration?: number;

  /**
   * Bonus threat this ability adds on a successful use, flat.
   *
   * Resolved per rank like `cost` and `cooldown`, and overridden per rank where
   * the ability says so. Absent, not 0, when the ability adds none: absent means
   * nobody said and 0 would read as a measurement.
   *
   * `world.threat` answers how close you are to pulling. This answers which of
   * your own abilities is doing it, which nothing in the game's own interface
   * shows. Added in API minor 2.
   */
  threatFlat?: number;

  /**
   * Multiplier on the threat this ability's damage generates.
   *
   * The classic tanking figure: an ability that deals ordinary damage and
   * generates more threat than it should carries it here. Absent rather than 1
   * when the ability is plain, so a caller can tell "no modifier" from "a
   * modifier that happens to be neutral". Added in API minor 2.
   */
  threatMult?: number;

  /**
   * How many charge stages a hold-to-charge ability has. Absent when it has none.
   *
   * THE COUNT, NOT THE LIVE STAGE. The stage is on no wire; the game derives it
   * from `castTotal` and `castRemaining`, which ride every entity record, in two
   * functions in its `combat/glacial_front.ts`. Keep both of their guards: progress
   * answers 1 when the total is not positive (the client zero-fills `castTotal`,
   * and a 0 total divides to a NaN that a style property drops silently), and the
   * stage answers 1 when the count is not above one.
   *
   * Nothing on the wire marks a cast as empowered, so a cast with no stage count
   * cannot be told from a plain cast. `AbilityIndex` is YOUR OWN spellbook, so a
   * hostile caster charging an ability you have not learned gives you a cast
   * clock and no divisor. `Aura.empowerAbilities` is the scope of a next-cast
   * empowerment buff, not a charge stage.
   *
   * Added in API minor 10.
   */
  empowerStages?: number;

  /**
   * The channel's length and tick count. Absent when the ability is not channelled;
   * presence is the flag, and `castTime` is 0 on a channel, so do not read that as
   * instant.
   *
   * DO NOT DRIVE A LIVE BAR FROM `duration`. It is PRE-HASTE: the haste-resolved
   * length is `castTotal` on the caster's entity record, counting down in
   * `castRemaining` with `channeling` true. Added in API minor 10.
   */
  channel?: AbilityChannel;

  /**
   * Usable without spending the global cooldown. ABSENT rather than false when
   * the ability is ordinary, so test for presence; a false never arrives, which
   * is what the `true` type says. Added in API minor 10.
   */
  offGcd?: true;
}

/**
 * How long a channel runs and how many times it ticks, as AUTHORED: haste
 * shortens the whole channel, and at least one ability fires more ticks than its
 * authored count under the right resource state. For anything live, read
 * `castTotal` and `castRemaining` off the caster. Added in API minor 10.
 */
export interface AbilityChannel {
  duration: number;
  ticks: number;
}

/**
 * What `describe` answers: a label for an ability id, and where it came from.
 *
 * `known: false` means the name was derived from the id and is very likely
 * wrong, because ids and display names have diverged. The guess mark is yours to
 * add: the same string also reaches an `aria-label` and a tooltip title, where a
 * glued-on `?` reads as part of the name. Added in API minor 4.
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
 * const label = woc.world.abilities.describe(id).name;
 * ```
 *
 * `describe` is the third of the three, and the one that always answers: `byId`
 * is null for an id that is not yours, where `describe` derives a name and marks
 * it as derived.
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
  /**
   * Something readable for any ability id, never null and never throwing.
   *
   * On the landing page every id comes back derived. Read `known` before you
   * present the name. Added in API minor 4.
   */
  describe: (id: string) => AbilityDescription;
}
