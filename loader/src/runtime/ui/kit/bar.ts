// A timer bar: an icon, a name, a fill behind both, and a figure on the right.
//
// The row is a flex line and the name is the ONLY part allowed to shrink: `min-width: 0` on
// it gives an ellipsis instead of an overlap. Do not float the figure instead; a long name
// then runs underneath it. The figure uses tabular numbers so a countdown does not jitter.
//
// The fill is a sibling behind the content, so its width animates without touching the text.
// A `fraction` outside 0 to 1 (or NaN) is clamped, since a NaN style silently drops.
//
// The tone and school vocabulary, the clamp and the art element live in kit/readout.ts,
// shared with the square kit/tile.ts.

import type { Teardown } from '../../disposal.ts';
import { type MoneyValue, writeValue } from './money.ts';
import type { ArtSlot, StyleSlot, TextSlot } from './readout.ts';
import {
  buildArt,
  clampFraction,
  styleSlot,
  textSlot,
  writeArt,
  writeStyle,
  writeText,
  writeTextHiding,
} from './readout.ts';
import type {
  ReadoutClass,
  ReadoutQuality,
  ReadoutSchool,
  ReadoutTone,
  VariantState,
} from './variants.ts';
import { applyVariants, toneClass, variantState } from './variants.ts';

const FULL_PERCENT = 100;
const DECIMALS = 2;

/** What every one of this row's variant classes starts with. */
const PREFIX = 'woc-bar';

/**
 * How tall the row is, which the sheet turns into a height, a text size and an icon.
 * UNITLESS, unlike `--woc-tile-size`: the text is derived as an `em` (styles/bar.css), and
 * calc cannot divide a length by a length.
 */
const SIZE_PROPERTY = '--woc-bar-size';

/**
 * Marks a row whose height the caller decided. A class as well as the property, because CSS
 * cannot ask whether a custom property is set, and an unsized row must stay untouched.
 */
const SIZED_CLASS = 'woc-bar-sized';

/** The height the caller asked for, in pixels, or nothing. Zero and NaN are refused. */
function setSize(el: HTMLElement, size: StyleSlot, next: unknown): void {
  if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) {
    return;
  }
  el.classList.add(SIZED_CLASS);
  writeStyle(size, String(next));
}

type BarTone = ReadoutTone;

type BarSchool = ReadoutSchool;

type BarQuality = ReadoutQuality;

type BarClass = ReadoutClass;

function setFraction(fill: StyleSlot, fraction: unknown): void {
  writeStyle(fill, `${(clampFraction(fraction) * FULL_PERCENT).toFixed(DECIMALS)}%`);
}

/**
 * The row, as its own updates address it: slots, so a repeated update costs nothing
 * (kit/readout.ts).
 */
interface BarParts {
  el: HTMLElement;
  fill: StyleSlot;
  size: StyleSlot;
  icon: ArtSlot;
  label: TextSlot;
  value: TextSlot;
  detail: TextSlot;
  variants: VariantState;
}

function span(doc: Document, className: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = className;
  return el;
}

/**
 * The row: a fill behind everything, a head line, and an optional second line. The fill
 * spans both lines. The detail element always exists and is hidden while empty.
 */
function buildBar(doc: Document, opts: BarOpts): BarParts {
  const el = doc.createElement('div');
  el.className = `woc-bar ${toneClass(PREFIX, opts.tone)}`;
  if (opts.className !== undefined) {
    el.classList.add(opts.className);
  }

  const fill = doc.createElement('div');
  fill.className = 'woc-bar-fill';

  const icon = buildArt(doc, 'woc-bar-icon');

  const label = span(doc, 'woc-bar-label');
  const value = span(doc, 'woc-bar-value');

  const head = doc.createElement('div');
  head.className = 'woc-bar-head';
  head.append(icon.el, label, value);

  const detail = doc.createElement('div');
  detail.className = 'woc-bar-detail';
  detail.hidden = true;

  el.append(fill, head, detail);
  return {
    el,
    fill: styleSlot(fill, 'width'),
    size: styleSlot(el, SIZE_PROPERTY),
    icon,
    label: textSlot(label),
    value: textSlot(value),
    detail: textSlot(detail),
    variants: variantState(opts.tone),
  };
}

/** Everything a bar can be told, all of it optional on an update. */
interface BarUpdate {
  label?: string;
  /**
   * An icon URL, from `ui.icon`, or null. Re-shown on every change, so a reused row recovers from a
   * 404.
   */
  icon?: string | null;
  /** 0 through 1. Clamped, so a division by a total you do not have yet is safe. */
  fraction?: number;
  /**
   * The right-hand figure, usually a countdown. An amount of copper draws coins, as the game does.
   */
  value?: string | MoneyValue;
  /**
   * Tint the fill by the game's own colour for a damage school. `tone` wins where both are
   * set. Null (a heal has no school) and an unrecognised value tint nothing.
   */
  school?: BarSchool | null;
  /**
   * Colour it by the game's own colour for an item quality tier. Null and unknown colour nothing.
   */
  quality?: BarQuality | null;
  /**
   * Tint the fill by the game's own colour for a class. School and tone both win over it.
   * Null and anything that is not one of the nine classes (a mob's `templateId`) tint nothing.
   */
  unitClass?: BarClass | null;
  /** A quieter second line under the head. An empty string hides it again. */
  detail?: string;
  tone?: BarTone;
  /**
   * How tall the row is, in pixels, art and text with it. Left alone (or not a positive finite
   * number), the row is as tall as its line box. Set this rather than an inline font size,
   * which would beat every rule in the sheet, the touch tap-target floor included.
   */
  size?: number;
}

interface BarOpts extends BarUpdate {
  /** Added alongside the kit's own classes, so an addon can style its own rows. */
  className?: string;
}

interface Bar {
  /** The row. Append it wherever you want it; the kit does not place it. */
  readonly el: HTMLElement;
  update: (next: BarUpdate) => void;
  destroy: Teardown;
}

/** The three text slots. The detail hides itself when cleared. */
function applyText(parts: BarParts, next: BarUpdate): void {
  if (next.label !== undefined) {
    writeText(parts.label, next.label);
  }
  if (next.value !== undefined) {
    writeValue(parts.value, next.value);
  }
  if (next.detail !== undefined) {
    // Hidden, not just emptied, so the second line's spacing leaves no gap.
    writeTextHiding(parts.detail, next.detail);
  }
}

function createBar(doc: Document, opts: BarOpts = {}): Bar {
  const parts = buildBar(doc, opts);

  const update = (next: BarUpdate): void => {
    applyText(parts, next);
    applyVariants(parts.el, PREFIX, next, parts.variants);
    if (next.icon !== undefined) {
      writeArt(parts.icon, next.icon);
    }
    if (next.fraction !== undefined) {
      setFraction(parts.fill, next.fraction);
    }
    setSize(parts.el, parts.size, next.size);
  };

  // Always written, so the markup states the fill rather than leaning on a stylesheet default.
  setFraction(parts.fill, opts.fraction);
  update(opts);
  return {
    el: parts.el,
    update,
    destroy: () => {
      parts.el.remove();
    },
  };
}

export type { Bar, BarClass, BarOpts, BarQuality, BarSchool, BarTone, BarUpdate };
export { createBar };
