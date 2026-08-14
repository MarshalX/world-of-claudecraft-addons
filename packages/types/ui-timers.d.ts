// The two shapes a timer readout takes: a row and a square.
//
// Split from ui.d.ts because they are one subject with one rule holding them
// together, and because that file is the SURFACES the loader hands you (frames,
// toasts, modals, art) while these are things you assemble a screenful of. The
// loader's own kit is split along the same seam, at kit/readout.ts.
//
// The rule: a bar and a tile are the same information and differ only in shape.
// Both take `fraction` as how much is LEFT, both take the same `tone` and
// `school`, and both hand back `{ el, update, destroy }`. Anything true of one
// that is not true of the other is a difference somebody chose, and there are
// exactly three. A tile has a `count` corner and a `size`, because it has no room
// for a name and a bar has no room for a stack. And a bar has `unitClass`, because
// a class is what a WHOLE ROW is: it tints the fill, and a tile's only colourable
// edge is already carrying its school. A tile of a person would be a portrait, and
// there is no art for one.

import type { School } from './entity.js';

export type BarTone = 'default' | 'warn' | 'danger';

/**
 * A damage school to tint a bar's fill by. The same union `Aura.school` uses.
 *
 * A SEPARATE axis from `tone`, not more values on it. Tone is urgency, which is what
 * a cooldown row says as an ability comes back up; a school is what KIND of damage the
 * row is made of. Where both are set, tone wins.
 *
 * The colours are the GAME'S, taken from the custom properties it tints its own debuff
 * borders with, so a row you colour this way matches what the player already reads for
 * the same school on an aura icon. That is also why there is no way to pass a colour:
 * two addons colouring by school should look the same, which is the point of the kit.
 */
export type BarSchool = School;

/**
 * An item quality tier to colour a readout by. The game's six, low to high.
 *
 * A THIRD axis, and the one an item panel wants: a player picks an item out of a grid by its
 * tier before reading a word of it. Where the other two are about a timer, this is about what
 * the thing IS, so a row can carry a tier and a tone at once and be saying two true things.
 *
 * A bar colours its LABEL and a tile colours its BORDER, which is what the game does with an
 * item name and an item icon respectively, down to the two palettes it keeps for them. So
 * there is no way to pass a colour here either: two addons drawing an epic should draw the
 * same purple, and it should be the purple in the player's bags.
 *
 * Null, and anything not in the union, colours nothing. That is the answer for the items the
 * game ranks at no tier at all, of which there are 96, and for an id you have not looked up:
 * an addon that knows an item is unranked and one that has not asked both pass null.
 */
export type BarQuality = 'poor' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Everything a bar can be told. All of it is optional on an update. */
/** An amount of the game's own money, for a readout's figure. */
export interface MoneyValue {
  /** Copper, which is what every amount the game sends is counted in. */
  copper: number;
  /**
   * A quiet word before the coins, e.g. `low` or `asking`.
   *
   * Part of the figure rather than of your own label, because it belongs where the
   * number is: a bare amount at the end of a row reads as the price, and a row whose
   * figure is the cheapest ever seen rather than today's has to say so.
   */
  prefix?: string;
}

/**
 * A class to tint a bar's fill by. The game's nine, and the id `PartyMember.cls`
 * carries.
 *
 * The palette is the game's own and no addon may pass a colour, for the reason the
 * schools and the tiers refuse one: a nameplate, a party frame and a scoreboard
 * drawing three different blues for mage would be worse than none of them drawing
 * any.
 */
export type BarClass =
  | 'warrior'
  | 'mage'
  | 'rogue'
  | 'paladin'
  | 'hunter'
  | 'priest'
  | 'shaman'
  | 'warlock'
  | 'druid';

export interface BarUpdate {
  label?: string;
  /**
   * An icon URL, from `ui.icon`, or null for none.
   *
   * The slot is re-shown on every change, so a row reused for another ability
   * gets its icon back even if the previous URL had failed to load.
   */
  icon?: string | null;
  /**
   * 0 through 1.
   *
   * Clamped, and anything that is not a finite number reads as 0. That is
   * deliberate: a timer fraction divides by a total, and a NaN reaching a style
   * property drops the declaration silently, which looks like a stuck bar.
   */
  fraction?: number;
  /**
   * The right-hand figure, usually a countdown. Drawn with tabular figures.
   *
   * An amount of COPPER instead of a string is drawn the way the game draws money:
   * a coin per unit with its figure beside it, empty units left out, and the whole
   * thing announced as one amount in words. `prefix` puts a quiet word in front of
   * it, for a figure that needs saying what it is: `{ copper: 780, prefix: 'low' }`.
   *
   * Its own shape rather than a string you formatted, so that a price drawn by one
   * addon looks like a price drawn by another. `ui.money` is the same split as text,
   * for a tooltip line, which takes no markup.
   */
  value?: string | MoneyValue;
  /**
   * Tint the fill by the game's own colour for a damage school.
   *
   * `damage` events carry `school`, so a meter can colour a row by what kind of damage
   * it was. `heal2` does NOT carry one, which is why null is allowed: pass what the
   * event gave you rather than omitting the property on some rows and not others.
   * Null and an unrecognised value both tint nothing rather than guessing.
   */
  school?: BarSchool | null;
  /**
   * Colour the LABEL by the game's own colour for an item quality tier.
   *
   * For a row that is an item: a market listing, a bag entry, a loot roll. Nothing in the
   * loader knows an item's quality, so this is a tier you got from somewhere, which today is
   * either a `LootRoll` off `world.group` or a record another addon published on the bus.
   */
  quality?: BarQuality | null;
  /**
   * Tint the fill by the game's own colour for a CLASS. Since apiMinor 6.
   *
   * The one axis that is about WHO rather than what, and the reason it colours the fill
   * where a tier colours the label: a class is what the whole row is. A health bar per
   * class is how every client that has ever drawn one has drawn it, and a player reads
   * somebody's class off it before they read the name.
   *
   * Weakest of the three claims on the fill, so a `school` tint and a `tone` both win
   * over it: what a row is made of and whether it is about to matter are both louder than
   * who it belongs to.
   *
   * Null and anything outside the nine tint nothing. That is the answer for a MOB, and it
   * is worth knowing that the id you hold is a `templateId` as often as a class: an
   * entity's is `'boss_wolf'` as readily as `'mage'`, and a wolf is not a class. Pass it
   * for a player and pass null for everything else.
   *
   * `woc-class-<id>` is published as a class you may put on anything you drew yourself,
   * the way `woc-quality-<tier>` is, for a name in a roster or a chip in a scoreboard.
   */
  unitClass?: BarClass | null;
  /**
   * A quieter second line under the head, e.g. a hit count and crit rate.
   *
   * The fill spans both lines, so a share reads as the whole row's rather than as a
   * bar on one line of it. An empty string hides the line again.
   */
  detail?: string;
  tone?: BarTone;
  /**
   * How tall the row is, in pixels, art and text with it. Since apiMinor 6.
   *
   * For a strip whose height is the PLAYER's: a column of these divided between a
   * resizable frame's box. Left alone, a row is as tall as its own line box and its
   * text is the game's, which is what a bar has always been, and anything that is
   * not a positive finite number leaves it that way.
   *
   * The text scales WITH the row rather than to a figure in pixels, so a row at its
   * natural height reads at exactly the size the player's game is set to. Reach for
   * this rather than writing a font size onto the row yourself: an inline style
   * beats every rule in the loader's sheet, including the 40px tap-target floor it
   * restores under `@media (pointer: coarse)`, so hand-sizing a row is a decision
   * about somebody's phone that you did not mean to make.
   */
  size?: number;
}

export interface BarOpts extends BarUpdate {
  /** Added alongside the kit's own classes, so you can style your own rows. */
  className?: string;
}

export interface Bar {
  /** The row. Append it where you want it; the loader does not place it. */
  readonly el: HTMLElement;
  update: (next: BarUpdate) => void;
  /** Removes the row. Also done for you when your addon is disabled. */
  destroy: () => void;
}

/** The same two axes a bar has, with the same rule: where both are set, tone wins. */
export type TileTone = BarTone;

export type TileSchool = BarSchool;

export type TileQuality = BarQuality;

/** Everything a tile can be told. All of it is optional on an update. */
export interface TileUpdate {
  /**
   * What the tile is, for assistive technology. It is never drawn.
   *
   * A tile is announced as one image, named for everything it says: the label, then
   * the figure, then the count. There is nowhere to draw a name on a square whose
   * whole face is art, so this is how it gets one.
   *
   * A tile with NO label is hidden from assistive technology outright. Art with a
   * wedge over it and no name is not something anyone can act on, and announcing a
   * bare "4.2" is worse than silence.
   *
   * Pass `null` to put a tile BACK to unnamed, which is what one being reused for
   * something else needs. Since apiMinor 2: before it, a name could be set and never
   * unset, so a tile that had held something and now holds nothing went on
   * announcing what used to be in it.
   */
  label?: string | null;
  /** An icon URL, from `ui.icon`, or null for none. The slot hides itself if it fails. */
  icon?: string | null;
  /**
   * 0 through 1 of the timer REMAINING, which is the sense `ui.bar` takes.
   *
   * The dark wedge covers what is left and gives the art back clockwise as it runs
   * down. Clamped like a bar's, so dividing by a total you do not have yet is safe.
   */
  fraction?: number;
  /** The figure over the art, usually a countdown. An empty string hides it. */
  value?: string;
  /**
   * Stacks, or charges left, in the corner. Null hides it.
   *
   * Whether a count of 1 is worth drawing is yours: an aura at one stack usually is
   * not, and an ability with one charge left usually is.
   */
  count?: number | null;
  /** Tint the border by the game's own colour for a damage school. */
  school?: TileSchool | null;
  /**
   * Colour the BORDER by the game's own colour for an item quality tier.
   *
   * A square of art edged by its tier is the game's own bag cell, which is what makes a grid
   * of them readable at a glance. Epic and legendary carry the game's soft glow too.
   *
   * A tone or a school wins the border where you set both: urgency is about to matter and a
   * tier always did.
   */
  quality?: TileQuality | null;
  tone?: TileTone;
  /**
   * The square's side in pixels.
   *
   * Defaults to 40, the tap-target floor the game holds its own controls to. Going
   * below it is the same trade `density: 'compact'` makes, and inside a compact frame
   * the default is 32 already.
   *
   * On the update as well as at creation, so a strip can scale with the frame it
   * sits in: pair it with `ui.frame`'s `onMove` and every tile follows the drag.
   * Anything that is not a positive number leaves the current size alone.
   */
  size?: number;
}

export interface TileOpts extends TileUpdate {
  /** Added alongside the kit's own classes, so you can style your own tiles. */
  className?: string;
}

export interface Tile {
  /** The square. Append it where you want it; the loader does not place it. */
  readonly el: HTMLElement;
  update: (next: TileUpdate) => void;
  /** Removes the tile. Also done for you when your addon is disabled. */
  destroy: () => void;
}
