// A square timer: art with a radial sweep over it, a figure, and a count.
//
// The other shape of what kit/bar.ts draws. A bar is the linear form and suits a
// list of things you are waiting on, one per line with room for a name; a tile is
// the square form and suits a strip of them where the ART is the label, which is
// what an aura display and a cooldown row both are.
//
// ONE primitive, not two. This was designed as a cooldown sweep and an aura icon
// and they collapsed on contact: an aura is art with a duration and a stack count,
// a cooldown is art with a duration and a charge count, and the sweep, the tint and
// the two figures are the same parts in both. Two builders would have been the same
// element twice with the parts renamed, and the seam between them would have been
// which of two identical things an author was supposed to pick.
//
// The sweep is RADIAL and there is no linear option, because the linear form of this
// is `ui.bar`. A kit offering two ways to draw one thing is how two addons end up
// looking different for no reason anyone chose.
//
// Nothing here animates. `fraction` moves when the caller moves it, exactly as a
// bar's fill does: the loader would otherwise run a frame loop per tile to recompute
// a countdown the addon already has to compute to know the tile should exist. That
// is the project's standing pattern, subscribe for the change and animate from the
// read, and a kit that quietly broke it would make every addon pay for a loop it
// cannot see.

import type { Teardown } from '../../disposal.ts';
import type { ReadoutSchool, ReadoutTone } from './readout.ts';
import { applyVariants, buildArt, clampFraction, toneClass } from './readout.ts';

const FULL_PERCENT = 100;
const DECIMALS = 2;

/** What every one of this tile's variant classes starts with. */
const PREFIX = 'woc-tile';

/**
 * How big the square is, in pixels, which the sheet reads.
 *
 * A custom property rather than a width and a height, so one write sizes the art,
 * the sweep and the text together, and so the compact density can move the DEFAULT
 * without overriding an addon that asked for a size: an inline property beats a rule.
 */
const SIZE_PROPERTY = '--woc-tile-size';

/** How much of the square the dark wedge has given back. See `setFraction`. */
const SWEEP_PROPERTY = '--woc-tile-sweep';

type TileTone = ReadoutTone;

type TileSchool = ReadoutSchool;

/**
 * Point the sweep at how much time is LEFT, the same sense a bar's fill has.
 *
 * The sheet needs the opposite number. Its wedge is a conic gradient whose
 * transparent arc runs from the top clockwise to where the timer has got to, so what
 * it takes is the ELAPSED share, and a full tile is 0% rather than 100%. Converting
 * here is what keeps the public surface consistent with `ui.bar`: an addon that has
 * a remaining and a total should never have to work out which way round this one is.
 */
function setFraction(sweep: HTMLElement, fraction: unknown): void {
  const elapsed = 1 - clampFraction(fraction);
  sweep.style.setProperty(SWEEP_PROPERTY, `${(elapsed * FULL_PERCENT).toFixed(DECIMALS)}%`);
}

/**
 * A size in pixels, or nothing.
 *
 * Nothing leaves the sheet's own default in place, which is the game's tap-target
 * floor. Zero and NaN are refused rather than written: a zero-sized tile is invisible
 * and unhittable, and a NaN drops the declaration silently, so both would read as a
 * tile that was never created.
 */
function setSize(el: HTMLElement, size: unknown): void {
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
    el.style.setProperty(SIZE_PROPERTY, `${String(size)}px`);
  }
}

interface TileParts {
  el: HTMLElement;
  art: HTMLImageElement;
  sweep: HTMLElement;
  value: HTMLElement;
  count: HTMLElement;
}

function span(doc: Document, className: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = className;
  el.hidden = true;
  return el;
}

/**
 * The square: art, the wedge over it, and the two figures over that.
 *
 * The order is the stack. The sweep has to darken the art and not the figures, which
 * are what a player reads at a glance while the wedge is only the shape of the time
 * left, so DOM order does the layering and nothing here needs a z-index.
 */
function buildTile(doc: Document, opts: TileOpts): TileParts {
  const el = doc.createElement('div');
  el.className = `${PREFIX} ${toneClass(PREFIX, opts.tone)}`;
  if (opts.className !== undefined) {
    el.classList.add(opts.className);
  }
  setSize(el, opts.size);

  const art = buildArt(doc, 'woc-tile-art');
  art.hidden = true;

  const sweep = doc.createElement('div');
  sweep.className = 'woc-tile-sweep';

  const value = span(doc, 'woc-tile-value');
  const count = span(doc, 'woc-tile-count');

  el.append(art, sweep, value, count);
  return { el, art, sweep, value, count };
}

/** Everything a tile can be told, all of it optional on an update. */
interface TileUpdate {
  /**
   * What the tile is, for assistive technology. It is never drawn.
   *
   * There is nowhere to put a name on a square whose whole face is the art, so this
   * is the accessible name of the tile as a WHOLE, recomposed with the figures
   * whenever one of them moves. See `applyName` for what a tile without one does.
   */
  label?: string;
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
  tone?: TileTone;
  /**
   * The square's side in pixels. Defaults to the game's tap-target floor.
   *
   * On the update rather than only at creation, because a strip that scales with
   * the frame it sits in has to move the tiles that are already on screen. The
   * alternative is destroying and rebuilding every tile on every pointer move of a
   * resize, which throws away the art the browser has decoded.
   *
   * Anything that is not a positive finite number leaves the current size alone. A
   * zero-sized tile is invisible and unhittable, and a NaN drops the declaration,
   * so both would read as a tile that had gone missing.
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

/** What the tile currently says, held so the accessible name can be recomposed. */
interface TileState {
  label: string | null;
  value: string;
  count: number | null;
}

/**
 * One accessible name for the whole tile, rebuilt whenever a part of it moves.
 *
 * A tile is a graphic. The wedge carries the timing, the art carries the identity,
 * and both figures are drawn ON the art rather than beside it, so it is announced as
 * one image named for everything it says rather than as a box whose children are read
 * in whatever order they were appended.
 *
 * A tile with NO label is hidden from assistive technology outright. Art with a wedge
 * over it and no name is not something anyone can act on, and announcing a bare "4.2"
 * is worse than silence. That is also the nudge: the way to be announced is to say
 * what you are.
 */
function applyName(el: HTMLElement, state: TileState): void {
  if (state.label === null) {
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.setAttribute('aria-hidden', 'true');
    return;
  }
  el.removeAttribute('aria-hidden');
  el.setAttribute('role', 'img');
  const said = [state.label];
  if (state.value.length > 0) {
    said.push(state.value);
  }
  if (state.count !== null) {
    said.push(String(state.count));
  }
  el.setAttribute('aria-label', said.join(', '));
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

/**
 * The two figures, each hidden while it has nothing to say.
 *
 * Hidden rather than emptied, so an empty slot cannot take a shadow or a background
 * with it, and so a tile that is only art is only art.
 */
function applyText(parts: TileParts, state: TileState, next: TileUpdate): void {
  if (next.value !== undefined) {
    state.value = next.value;
    parts.value.textContent = next.value;
    parts.value.hidden = next.value.length === 0;
  }
  if (next.count !== undefined) {
    state.count = readCount(next.count);
    parts.count.textContent = countText(state.count);
    parts.count.hidden = state.count === null;
  }
}

/**
 * The art slot, re-shown on every change rather than only on the first.
 *
 * A tile whose art failed once and was hidden has to get its face back when it is
 * pointed at a file that does exist, which happens the moment a strip of tiles is
 * reused for another set of auras.
 */
function applyArt(art: HTMLImageElement, next: TileUpdate): void {
  if (next.icon !== undefined) {
    art.hidden = next.icon === null;
    art.src = next.icon ?? '';
  }
}

function createTile(doc: Document, opts: TileOpts = {}): Tile {
  const parts = buildTile(doc, opts);
  const state: TileState = { label: null, value: '', count: null };

  const update = (next: TileUpdate): void => {
    if (next.label !== undefined) {
      state.label = next.label;
    }
    setSize(parts.el, next.size);
    applyText(parts, state, next);
    applyVariants(parts.el, PREFIX, next);
    applyArt(parts.art, next);
    if (next.fraction !== undefined) {
      setFraction(parts.sweep, next.fraction);
    }
    applyName(parts.el, state);
  };

  // Written even when the opts said nothing about it, so the tile's own markup
  // states where the sweep is rather than leaning on the sheet's fallback.
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

export type { Tile, TileOpts, TileSchool, TileTone, TileUpdate };
export { createTile };
