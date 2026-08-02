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
// exactly two: a tile has a `count` corner and a `size`, because it has no room
// for a name and a bar has no room for a stack.

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
   * A quieter second line under the head, e.g. a hit count and crit rate.
   *
   * The fill spans both lines, so a share reads as the whole row's rather than as a
   * bar on one line of it. An empty string hides the line again.
   */
  detail?: string;
  tone?: BarTone;
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
