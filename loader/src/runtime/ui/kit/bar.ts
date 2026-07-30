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

import type { Teardown } from '../../disposal.ts';

const FULL_PERCENT = 100;
const DECIMALS = 2;

/** The tones the sheet draws. Anything else falls back to the first. */
const TONES = Object.freeze(['default', 'warn', 'danger'] as const);

/**
 * The game's own damage schools, which the sheet tints a fill by.
 *
 * A SEPARATE axis from tone, not more values on it. Tone is urgency, which is why
 * Cooldown Bars sets 'warn' as an ability comes back up; a school is what KIND of
 * damage a row is made of. Folding them into one enum would make `tone: 'frost'` and
 * `tone: 'danger'` look like alternatives when they answer different questions.
 *
 * The palette is not invented here: the game already publishes one as
 * `--color-debuff-*` custom properties for its own debuff borders, and the loader
 * inherits those like every other token. So a row tinted by school matches the colour
 * the player already reads on the aura icon for the same school.
 */
const SCHOOLS = Object.freeze([
  'physical',
  'fire',
  'frost',
  'arcane',
  'shadow',
  'holy',
  'nature',
] as const);

type BarTone = (typeof TONES)[number];

type BarSchool = (typeof SCHOOLS)[number];

function toneClass(tone: unknown): string {
  if (typeof tone === 'string' && (TONES as readonly string[]).includes(tone)) {
    return `woc-bar-${tone}`;
  }
  return `woc-bar-${TONES[0]}`;
}

/**
 * The school class, or none for a school the game does not have.
 *
 * No fallback tint: an unrecognised school means the sheet has nothing true to say
 * about the row, and inventing a colour would claim a damage type that is not the
 * one the event reported. The tone's own fill shows through instead.
 */
function schoolClass(school: unknown): string | null {
  if (typeof school === 'string' && (SCHOOLS as readonly string[]).includes(school)) {
    return `woc-bar-school-${school}`;
  }
  return null;
}

/** 0 through 1, with anything unusable read as empty rather than as a dropped rule. */
function clampFraction(fraction: unknown): number {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    return 0;
  }
  return Math.min(Math.max(fraction, 0), 1);
}

function setFraction(fill: HTMLElement, fraction: unknown): void {
  fill.style.width = `${(clampFraction(fraction) * FULL_PERCENT).toFixed(DECIMALS)}%`;
}

function buildIcon(doc: Document): HTMLImageElement {
  const icon = doc.createElement('img');
  icon.className = 'woc-bar-icon';
  // The art is decorative: the label beside it already names the ability, and an
  // alt repeating that would have a screen reader read every row twice.
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');
  // Not every ability ships painted art, so a URL that does not resolve is an
  // ordinary outcome rather than a fault. Hiding the slot collapses the row's gap
  // instead of leaving a broken-image glyph where the icon would be.
  icon.addEventListener('error', () => {
    icon.hidden = true;
  });
  return icon;
}

interface BarParts {
  el: HTMLElement;
  fill: HTMLElement;
  icon: HTMLImageElement;
  label: HTMLElement;
  value: HTMLElement;
  detail: HTMLElement;
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
  el.className = `woc-bar ${toneClass(opts.tone)}`;
  if (opts.className !== undefined) {
    el.classList.add(opts.className);
  }

  const fill = doc.createElement('div');
  fill.className = 'woc-bar-fill';

  const icon = buildIcon(doc);
  icon.hidden = true;

  const label = span(doc, 'woc-bar-label');
  const value = span(doc, 'woc-bar-value');

  const head = doc.createElement('div');
  head.className = 'woc-bar-head';
  head.append(icon, label, value);

  const detail = doc.createElement('div');
  detail.className = 'woc-bar-detail';
  detail.hidden = true;

  el.append(fill, head, detail);
  return { el, fill, icon, label, value, detail };
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
  /** The right-hand figure, usually a countdown. */
  value?: string;
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
    // textContent, never innerHTML: an ability name reaches this from the wire.
    parts.label.textContent = next.label;
  }
  if (next.value !== undefined) {
    parts.value.textContent = next.value;
  }
  if (next.detail !== undefined) {
    parts.detail.textContent = next.detail;
    // Hidden rather than emptied, so a row whose detail was switched off does not
    // leave the gap the second line's own spacing would otherwise still take.
    parts.detail.hidden = next.detail.length === 0;
  }
}

/**
 * The two variant axes, each swapped rather than accumulated.
 *
 * A row reused for another ability must not end up carrying two schools' classes, or
 * two tones', at once. Which of the two WINS is settled in the sheet by source order,
 * not here: this only records what the caller said.
 */
function applyVariants(el: HTMLElement, next: BarUpdate): void {
  if (next.tone !== undefined) {
    el.classList.remove(...TONES.map((tone) => `woc-bar-${tone}`));
    el.classList.add(toneClass(next.tone));
  }
  if (next.school !== undefined) {
    el.classList.remove(...SCHOOLS.map((school) => `woc-bar-school-${school}`));
    const applied = schoolClass(next.school);
    if (applied !== null) {
      el.classList.add(applied);
    }
  }
}

function applyIcon(icon: HTMLImageElement, next: BarUpdate): void {
  if (next.icon !== undefined) {
    icon.hidden = next.icon === null;
    icon.src = next.icon ?? '';
  }
}

function createBar(doc: Document, opts: BarOpts = {}): Bar {
  const parts = buildBar(doc, opts);

  const update = (next: BarUpdate): void => {
    applyText(parts, next);
    applyVariants(parts.el, next);
    applyIcon(parts.icon, next);
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
export { clampFraction, createBar, SCHOOLS as BAR_SCHOOLS, TONES as BAR_TONES };
