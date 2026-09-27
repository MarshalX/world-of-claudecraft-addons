// The two shapes a timer readout takes: a row and a square.
//
// A bar and a tile carry the same information in different shapes: both take
// `fraction` as how much is LEFT, the same `tone`, `school` and `quality`, and
// hand back `{ el, update, destroy }`. Only a tile has a `count` corner, and only a
// bar has `unitClass`.

import type { School } from './entity.js';

export type BarTone = 'default' | 'warn' | 'danger';

/**
 * A damage school to tint a bar's fill by. The same union `Aura.school` uses.
 *
 * A separate axis from `tone`, which is urgency. Where both are set, tone wins.
 *
 * The colours are the game's own debuff-border colours, so a row matches the
 * aura icon for the same school. There is no way to pass your own colour.
 */
export type BarSchool = School;

/**
 * An item quality tier to colour a readout by. The game's six, low to high.
 *
 * Independent of `tone`, so a row can carry both. A bar colours its LABEL and a
 * tile its BORDER, with the game's own palettes for an item name and an item icon.
 * There is no way to pass your own colour.
 *
 * Null, and anything not in the union, colours nothing: pass it for an unranked
 * item and for one whose tier you do not know.
 */
export type BarQuality = 'poor' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** An amount of the game's own money, for a readout's figure. */
export interface MoneyValue {
  /** Copper, which is what every amount the game sends is counted in. */
  copper: number;
  /**
   * A quiet word before the coins, e.g. `low` or `asking`.
   *
   * Drawn as part of the figure, for an amount that is not simply the price.
   */
  prefix?: string;
}

/**
 * A class to tint a bar's fill by. The game's nine, and the id `PartyMember.cls`
 * carries.
 *
 * The palette is the game's own; there is no way to pass your own colour.
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

/** Everything a bar can be told. All of it is optional on an update. */
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
   * Clamped, and anything that is not a finite number reads as 0, so dividing by
   * a total you do not have yet is safe.
   */
  fraction?: number;
  /**
   * The right-hand figure, usually a countdown. Drawn with tabular figures.
   *
   * A `MoneyValue` is drawn the way the game draws money (a coin per unit, empty
   * units left out) and announced as one amount in words, e.g.
   * `{ copper: 780, prefix: 'low' }`. `ui.money` gives the same as plain text,
   * for a tooltip line.
   */
  value?: string | MoneyValue;
  /**
   * Tint the fill by the game's own colour for a damage school.
   *
   * `damage` events carry `school`; `heal2` does not, so pass null there. Null and
   * an unrecognised value tint nothing.
   */
  school?: BarSchool | null;
  /**
   * Colour the LABEL by the game's own colour for an item quality tier.
   *
   * Nothing in the loader knows an item's quality, so this is a tier you got
   * elsewhere, such as a `LootRoll` or a record another addon published.
   */
  quality?: BarQuality | null;
  /**
   * Tint the fill by the game's own colour for a CLASS. Since apiMinor 6.
   *
   * `school` and `tone` both win over it on the fill.
   *
   * Null and anything outside the nine tint nothing. An entity's `templateId` is
   * as often a mob id (`'boss_wolf'`) as a class, so pass it for a player only.
   *
   * `woc-class-<id>` is also a CSS class you may put on anything you drew, like
   * `woc-quality-<tier>`.
   */
  unitClass?: BarClass | null;
  /**
   * A quieter second line under the head, e.g. a hit count and crit rate.
   *
   * The fill spans both lines. An empty string hides the line again.
   */
  detail?: string;
  tone?: BarTone;
  /**
   * How tall the row is, in pixels, art and text with it. Since apiMinor 6.
   *
   * For a column of rows sharing a resizable frame's height. Unset, or anything
   * not a positive finite number, leaves the natural height.
   *
   * The text scales with the row. Use this, never an inline font size, which
   * would opt the row out of the loader's touch tap-target floor.
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
   * A tile is announced as one image: the label, then the figure, then the count.
   * A tile with NO label is hidden from assistive technology.
   *
   * Pass `null` to put a reused tile BACK to unnamed. `null` is accepted since
   * apiMinor 2.
   */
  label?: string | null;
  /** An icon URL, from `ui.icon`, or null for none. The slot hides itself if it fails. */
  icon?: string | null;
  /**
   * 0 through 1 of the timer REMAINING, which is the sense `ui.bar` takes.
   *
   * The dark wedge covers what is left. Clamped like a bar's.
   */
  fraction?: number;
  /** The figure over the art, usually a countdown. An empty string hides it. */
  value?: string;
  /**
   * Stacks, or charges left, in the corner. Null hides it.
   *
   * A count of 1 is drawn; hide it yourself where it says nothing.
   */
  count?: number | null;
  /** Tint the border by the game's own colour for a damage school. */
  school?: TileSchool | null;
  /**
   * Colour the BORDER by the game's own colour for an item quality tier.
   *
   * Matches the game's own bag cell, glow on epic and legendary included. A tone
   * or a school wins the border where set.
   */
  quality?: TileQuality | null;
  tone?: TileTone;
  /**
   * The square's side in pixels.
   *
   * Defaults to 40, or 32 inside a compact frame. Accepted on update too, so a
   * strip can scale with its frame via `onMove`. Anything not a positive number
   * leaves the current size alone.
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
