// What the two timer readouts share: the variant vocabulary, the fill arithmetic,
// and the decorative art element.
//
// `kit/bar.ts` and `kit/tile.ts` are the same information in two shapes, a row and
// a square, and they have to agree about three things. The school list is the one
// that matters: it is a claim about the game's own palette, and a second copy of it
// in the other module would be a second claim, free to drift from the first while
// both still looked right on their own.
//
// The class PREFIX is a parameter rather than the class names being written out
// here, because each surface tints a different part of itself (a bar's fill, a
// tile's border) and so needs its own rules in its own sheet. What is shared is
// which variants exist and that setting one SWAPS rather than accumulates.

/** The tones a sheet draws. Anything else falls back to the first. */
const TONES = Object.freeze(['default', 'warn', 'danger'] as const);

/**
 * The game's own damage schools, which a readout can tint itself by.
 *
 * A SEPARATE axis from tone, not more values on it. Tone is urgency, which is why
 * Cooldown Bars sets 'warn' as an ability comes back up; a school is what KIND of
 * damage a row is made of. Folding them into one enum would make `tone: 'frost'` and
 * `tone: 'danger'` look like alternatives when they answer different questions.
 *
 * The palette is not invented here: the game already publishes one as
 * `--color-debuff-*` custom properties for its own debuff borders, and the loader
 * inherits those like every other token. So a readout tinted by school matches the
 * colour the player already reads on the aura icon for the same school.
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

type ReadoutTone = (typeof TONES)[number];

type ReadoutSchool = (typeof SCHOOLS)[number];

/** The two axes, as any update carrying them states them. */
interface ReadoutVariants {
  tone?: ReadoutTone;
  school?: ReadoutSchool | null;
}

function toneClass(prefix: string, tone: unknown): string {
  if (typeof tone === 'string' && (TONES as readonly string[]).includes(tone)) {
    return `${prefix}-${tone}`;
  }
  return `${prefix}-${TONES[0]}`;
}

/**
 * The school class, or none for a school the game does not have.
 *
 * No fallback tint: an unrecognised school means the sheet has nothing true to say
 * about the readout, and inventing a colour would claim a damage type that is not the
 * one the event reported. The tone's own colour shows through instead.
 */
function schoolClass(prefix: string, school: unknown): string | null {
  if (typeof school === 'string' && (SCHOOLS as readonly string[]).includes(school)) {
    return `${prefix}-school-${school}`;
  }
  return null;
}

/**
 * Record the two variants, each swapped rather than accumulated.
 *
 * A readout reused for another ability must not end up carrying two schools' classes,
 * or two tones', at once. Which of the two WINS is settled in each sheet by source
 * order at equal specificity, not here: this only records what the caller said.
 */
function applyVariants(el: HTMLElement, prefix: string, next: ReadoutVariants): void {
  if (next.tone !== undefined) {
    el.classList.remove(...TONES.map((tone) => `${prefix}-${tone}`));
    el.classList.add(toneClass(prefix, next.tone));
  }
  if (next.school !== undefined) {
    el.classList.remove(...SCHOOLS.map((school) => `${prefix}-school-${school}`));
    const applied = schoolClass(prefix, next.school);
    if (applied !== null) {
      el.classList.add(applied);
    }
  }
}

/** 0 through 1, with anything unusable read as empty rather than as a dropped rule. */
function clampFraction(fraction: unknown): number {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    return 0;
  }
  return Math.min(Math.max(fraction, 0), 1);
}

/**
 * The art slot, which is decorative in both shapes.
 *
 * No alt text: a bar's label already names the ability beside it, and a tile carries
 * its name on the element as a whole, so an alt here would have a screen reader read
 * every readout twice.
 *
 * Not every ability ships painted art, so a URL that does not resolve is an ordinary
 * outcome rather than a fault. Hiding the slot collapses the layout around it instead
 * of leaving a broken-image glyph where the icon would be.
 */
function buildArt(doc: Document, className: string): HTMLImageElement {
  const art = doc.createElement('img');
  art.className = className;
  art.alt = '';
  art.setAttribute('aria-hidden', 'true');
  art.addEventListener('error', () => {
    art.hidden = true;
  });
  return art;
}

export type { ReadoutSchool, ReadoutTone, ReadoutVariants };
export {
  applyVariants,
  buildArt,
  clampFraction,
  SCHOOLS as READOUT_SCHOOLS,
  TONES as READOUT_TONES,
  toneClass,
};
