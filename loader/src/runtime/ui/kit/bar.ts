// A timer bar: an icon, a name, a fill behind both, and a figure on the right.
//
// This is in the kit because every addon that shows a timer had already written
// it. Cooldown Bars and Combat Meter each hand-rolled the same row out of about
// twenty inline style declarations, and the two had drifted apart in the ways that
// are easy to get wrong rather than in the ways that were deliberate: which part
// is allowed to shrink, whether the figure reserves its width before the name
// takes the rest, and whether the numbers are tabular. All three are the
// difference between a readable row and one that jitters as it counts down.
//
// The layout, stated once: the row is a flex line, the name is the ONLY part
// allowed to shrink, and `min-width: 0` on it is what actually lets it, because a
// flex item refuses to go below its content width without it. That single
// declaration is the difference between an ellipsis and an overlap, and it is why
// floating the figure instead does not work: a float leaves the figure in the
// name's inline flow, so a long name runs underneath it.
//
// The fill is a sibling positioned behind the content rather than a background on
// the row, so its width can be animated without touching the text, and so a
// partial fill does not tint the label.
//
// A `fraction` that is not a real number between 0 and 1 is clamped rather than
// passed through. A NaN reaching a style property drops the declaration silently,
// which reads as a bar stuck at its last width, and the arithmetic behind a timer
// fraction divides by a total an addon may not have yet.
//
// The tone and school vocabulary, that clamp, and the decorative art element live in
// kit/readout.ts, which is what this row and the square one in kit/tile.ts share.

import type { Teardown } from '../../disposal.ts';
import { type MoneyValue, writeValue } from './money.ts';
import type {
  ArtSlot,
  ReadoutSchool,
  ReadoutTone,
  StyleSlot,
  TextSlot,
  VariantState,
} from './readout.ts';
import {
  applyVariants,
  buildArt,
  clampFraction,
  styleSlot,
  textSlot,
  toneClass,
  variantState,
  writeArt,
  writeStyle,
  writeText,
  writeTextHiding,
} from './readout.ts';

const FULL_PERCENT = 100;
const DECIMALS = 2;

/** What every one of this row's variant classes starts with. */
const PREFIX = 'woc-bar';

type BarTone = ReadoutTone;

type BarSchool = ReadoutSchool;

function setFraction(fill: StyleSlot, fraction: unknown): void {
  writeStyle(fill, `${(clampFraction(fraction) * FULL_PERCENT).toFixed(DECIMALS)}%`);
}

/**
 * The row, as its own updates address it.
 *
 * Slots rather than elements, because a bar is animated from an addon's frame loop
 * and an update that repeats what is already on screen has to cost nothing. See the
 * note at the top of kit/readout.ts.
 */
interface BarParts {
  el: HTMLElement;
  fill: StyleSlot;
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
 * The row: a fill behind everything, a head line, and an optional second line.
 *
 * Two levels rather than one flat flex line, because the second line is what makes
 * this a shared primitive instead of a timer-only one. A cooldown row uses the head
 * alone; a meter row puts its hit count and crit rate underneath, and the fill spans
 * BOTH, which is what makes it read as that ability's share of the whole rather than
 * as a countdown on one line of it.
 *
 * The detail element exists whether or not it is used and is hidden while empty, so
 * a row that gains a second line later does not have to be rebuilt.
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
   * An icon URL, from `ui.icon`, or null for none.
   *
   * Re-shown on every change rather than only on the first: a bar whose icon
   * failed once and was hidden has to get its slot back when it is pointed at art
   * that does exist, which happens the moment a row is reused for another ability.
   */
  icon?: string | null;
  /** 0 through 1. Clamped, so a division by a total you do not have yet is safe. */
  fraction?: number;
  /**
   * The right-hand figure, usually a countdown.
   *
   * An amount of copper instead of a string draws it as the game draws money: a
   * coin per unit, empty units left out, announced as one figure in words. Its own
   * shape rather than a formatted string, because a row of coins should look the
   * same whichever addon drew it.
   */
  value?: string | MoneyValue;
  /**
   * Tint the fill by the game's own colour for a damage school.
   *
   * Independent of `tone`, and `tone` wins where both are set to something: urgency
   * is the more urgent thing to show. Null and an unrecognised value both tint nothing
   * rather than guessing, since a wrong school is a claim about the row that the event
   * did not make. Null is spelled out because a caller reading a school off an event
   * legitimately has none for a heal, and should not have to omit the property.
   */
  school?: BarSchool | null;
  /** A quieter second line under the head. An empty string hides it again. */
  detail?: string;
  tone?: BarTone;
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
    // Hidden rather than emptied, so a row whose detail was switched off does not
    // leave the gap the second line's own spacing would otherwise still take.
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
  };

  // The fraction is written even when the opts said nothing about it, so the row's
  // own markup states where the fill is rather than leaning on a stylesheet rule.
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

export type { Bar, BarOpts, BarSchool, BarTone, BarUpdate };
export { createBar };
