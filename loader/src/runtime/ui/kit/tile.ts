// A square timer: art with a radial sweep over it, a figure, and a count.
//
// The square form of kit/bar.ts, for a strip where the ART is the label. One primitive
// serves both auras (stacks) and cooldowns (charges). The sweep is RADIAL only; the linear
// form is `ui.bar`.
//
// Nothing here animates: `fraction` moves when the caller moves it, as a bar's fill does.

import type { Teardown } from '../../disposal.ts';
import type { ArtSlot, StyleSlot, TextSlot } from './readout.ts';
import {
  buildArt,
  clampFraction,
  styleSlot,
  textSlot,
  writeArt,
  writeStyle,
  writeTextHiding,
} from './readout.ts';
import type { TileState } from './tile-name.ts';
import { applyName } from './tile-name.ts';
import type { ReadoutQuality, ReadoutSchool, ReadoutTone, VariantState } from './variants.ts';
import { applyVariants, toneClass, variantState } from './variants.ts';

const FULL_PERCENT = 100;
const DECIMALS = 2;

/** What every one of this tile's variant classes starts with. */
const PREFIX = 'woc-tile';

/**
 * How big the square is, in pixels. A custom property, so one write sizes art, sweep and text
 * together, and the compact density can move the default without overriding an explicit size.
 */
const SIZE_PROPERTY = '--woc-tile-size';

/** How much of the square the dark wedge has given back. See `setFraction`. */
const SWEEP_PROPERTY = '--woc-tile-sweep';

type TileTone = ReadoutTone;

type TileSchool = ReadoutSchool;

type TileQuality = ReadoutQuality;

/**
 * Point the sweep at how much time is LEFT, as a bar's fill does. The sheet's conic wedge
 * takes the ELAPSED share, so it is converted here.
 */
function setFraction(sweep: StyleSlot, fraction: unknown): void {
  const elapsed = 1 - clampFraction(fraction);
  writeStyle(sweep, `${(elapsed * FULL_PERCENT).toFixed(DECIMALS)}%`);
}

/**
 * A size in pixels, or nothing, which leaves the sheet's 40px default. Zero and NaN are refused.
 */
function setSize(size: StyleSlot, next: unknown): void {
  if (typeof next === 'number' && Number.isFinite(next) && next > 0) {
    writeStyle(size, `${String(next)}px`);
  }
}

/**
 * The square, as its own updates address it: slots, so a repeated update costs nothing
 * (kit/readout.ts).
 */
interface TileParts {
  el: HTMLElement;
  art: ArtSlot;
  sweep: StyleSlot;
  value: TextSlot;
  count: TextSlot;
  size: StyleSlot;
  variants: VariantState;
}

function span(doc: Document, className: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = className;
  el.hidden = true;
  return el;
}

/** The square: art, the wedge over it, and the two figures over that. DOM order is the stacking. */
function buildTile(doc: Document, opts: TileOpts): TileParts {
  const el = doc.createElement('div');
  el.className = `${PREFIX} ${toneClass(PREFIX, opts.tone)}`;
  if (opts.className !== undefined) {
    el.classList.add(opts.className);
  }
  // Starts unnamed and therefore hidden, which `applyName`'s record relies on.
  el.setAttribute('aria-hidden', 'true');
  const size = styleSlot(el, SIZE_PROPERTY);
  setSize(size, opts.size);

  const art = buildArt(doc, 'woc-tile-art');

  const sweep = doc.createElement('div');
  sweep.className = 'woc-tile-sweep';

  const value = span(doc, 'woc-tile-value');
  const count = span(doc, 'woc-tile-count');

  el.append(art.el, sweep, value, count);
  return {
    el,
    art,
    sweep: styleSlot(sweep, SWEEP_PROPERTY),
    value: textSlot(value),
    count: textSlot(count),
    size,
    variants: variantState(opts.tone),
  };
}

/** Everything a tile can be told, all of it optional on an update. */
interface TileUpdate {
  /**
   * The tile's accessible name as a whole, recomposed with the figures; never drawn. `null`
   * puts it back to unnamed, which a reused tile needs so it stops announcing its old content.
   */
  label?: string | null;
  /** An icon URL, from `ui.icon`, or null for none. */
  icon?: string | null;
  /** 0 through 1 of the timer REMAINING, as `ui.bar` takes. Clamped. */
  fraction?: number;
  /** The figure over the art, usually a countdown. An empty string hides it. */
  value?: string;
  /** Stacks, or charges left. Null hides it; the caller decides whether 1 is worth showing. */
  count?: number | null;
  /** Tint the border by the game's own colour for a damage school. */
  school?: TileSchool | null;
  /**
   * Colour it by the game's own colour for an item quality tier. Null and unknown colour nothing.
   */
  quality?: TileQuality | null;
  tone?: TileTone;
  /**
   * The square's side in pixels. Defaults to 40. Accepted on update, so a strip can scale with
   * its frame without rebuilding tiles. Anything not a positive finite number is ignored.
   */
  size?: number;
}

interface TileOpts extends TileUpdate {
  /** Added alongside the kit's own classes, so an addon can style its own tiles. */
  className?: string;
}

interface Tile {
  /** The square. Append it wherever you want it; the kit does not place it. */
  readonly el: HTMLElement;
  update: (next: TileUpdate) => void;
  destroy: Teardown;
}

/** A count worth drawing, or null. Anything unusable reads as no count at all. */
function readCount(count: unknown): number | null {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return null;
  }
  return count;
}

function countText(count: number | null): string {
  if (count === null) {
    return '';
  }
  return String(count);
}

/** The two figures, each hidden (not just emptied) while it has nothing to say. */
function applyText(parts: TileParts, state: TileState, next: TileUpdate): void {
  if (next.value !== undefined) {
    state.value = next.value;
    writeTextHiding(parts.value, next.value);
  }
  if (next.count !== undefined) {
    state.count = readCount(next.count);
    writeTextHiding(parts.count, countText(state.count));
  }
}

function createTile(doc: Document, opts: TileOpts = {}): Tile {
  const parts = buildTile(doc, opts);
  const state: TileState = { label: null, value: '', count: null, name: null };

  const update = (next: TileUpdate): void => {
    if (next.label !== undefined) {
      state.label = next.label;
    }
    setSize(parts.size, next.size);
    applyText(parts, state, next);
    applyVariants(parts.el, PREFIX, next, parts.variants);
    if (next.icon !== undefined) {
      writeArt(parts.art, next.icon);
    }
    if (next.fraction !== undefined) {
      setFraction(parts.sweep, next.fraction);
    }
    applyName(parts.el, state);
  };

  // Always written, so the markup states the sweep rather than leaning on the sheet's fallback.
  setFraction(parts.sweep, opts.fraction);
  update(opts);
  return {
    el: parts.el,
    update,
    destroy: () => {
      parts.el.remove();
    },
  };
}

export type { Tile, TileOpts, TileQuality, TileSchool, TileTone, TileUpdate };
export { createTile };
