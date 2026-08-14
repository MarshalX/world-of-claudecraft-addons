// The four axes a readout can be coloured by, and nothing else.
//
// Split out of readout.ts, which now holds only the SLOTS: the elements a row or a
// square writes text, art and style into, each written only when it moved. These are
// the vocabularies, which are a different subject with a different reason to change.
// The slots move when the DOM a readout is made of moves; these move when the GAME
// adds a school, a tier or a class.
//
// Every one of them refuses an unrecognised value rather than guessing a colour, and
// each says why at its own normalizer. Which axis WINS where a caller sets two is not
// decided here: it is source order in the sheets, at equal specificity, and each sheet
// carries the note saying so.

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

/**
 * The game's item quality tiers, which a readout drawing an ITEM can colour itself by.
 *
 * The third axis of the same kind as the other two, and the one an item panel needs: a
 * player picks an item out of a grid by its tier before they read a word of it, and every
 * addon that draws items was otherwise carrying its own copy of six hexes.
 *
 * The palette is the GAME'S, and unlike the schools it is not a token: the game keeps two
 * tables of literals, `QUALITY_COLOR` in `src/ui/icons.ts` for a NAME and the `.q-*` rules
 * in its own stylesheet for a BORDER, which differ only in that common is white as a word
 * and a dimmer grey as an edge. `styles/quality.css` carries both, transcribed, for the
 * reason lorebind carries the item table: nothing serves either of them.
 */
const QUALITIES = Object.freeze([
  'poor',
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const);

/**
 * The game's nine classes, which a readout drawing a PERSON can colour itself by.
 *
 * The fourth axis, and the only one that is about who rather than what: a school is what
 * kind of damage a row is made of, a tier is what an item is worth, a tone is whether
 * something is about to matter, and a class is who is standing there. A player identifies
 * somebody by it before they read the name, which is why every client that has ever drawn a
 * health bar per class has drawn the bar itself rather than its label.
 *
 * The palette is the GAME'S and is not a token: `CLASSES[cls].color` is a number in its own
 * content table, written into a `--class-color` property wherever the game needs one, so
 * nothing serves it and `styles/unit-class.css` carries the transcription.
 */
const UNIT_CLASSES = Object.freeze([
  'warrior',
  'mage',
  'rogue',
  'paladin',
  'hunter',
  'priest',
  'shaman',
  'warlock',
  'druid',
] as const);

type ReadoutTone = (typeof TONES)[number];

type ReadoutSchool = (typeof SCHOOLS)[number];

type ReadoutQuality = (typeof QUALITIES)[number];

type ReadoutClass = (typeof UNIT_CLASSES)[number];

/** The four axes, as any update carrying them states them. */
interface ReadoutVariants {
  tone?: ReadoutTone;
  school?: ReadoutSchool | null;
  quality?: ReadoutQuality | null;
  unitClass?: ReadoutClass | null;
}

/**
 * Which variant classes are on an element right now.
 *
 * The normalized VALUES rather than the class names, so an update repeating the tone
 * a readout already carries costs one comparison and builds no string at all.
 */
interface VariantState {
  tone: ReadoutTone;
  school: ReadoutSchool | null;
  quality: ReadoutQuality | null;
  unitClass: ReadoutClass | null;
}

function isTone(value: unknown): value is ReadoutTone {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value);
}

function isSchool(value: unknown): value is ReadoutSchool {
  return typeof value === 'string' && (SCHOOLS as readonly string[]).includes(value);
}

function isQuality(value: unknown): value is ReadoutQuality {
  return typeof value === 'string' && (QUALITIES as readonly string[]).includes(value);
}

function isUnitClass(value: unknown): value is ReadoutClass {
  return typeof value === 'string' && (UNIT_CLASSES as readonly string[]).includes(value);
}

function normalizeTone(tone: unknown): ReadoutTone {
  if (isTone(tone)) {
    return tone;
  }
  return TONES[0];
}

/**
 * The school, or none for a school the game does not have.
 *
 * No fallback tint: an unrecognised school means the sheet has nothing true to say
 * about the readout, and inventing a colour would claim a damage type that is not the
 * one the event reported. The tone's own colour shows through instead.
 */
function normalizeSchool(school: unknown): ReadoutSchool | null {
  if (isSchool(school)) {
    return school;
  }
  return null;
}

/**
 * The tier, or none for anything the game does not rank.
 *
 * No fallback colour, for the reason a school has none: the game declares no quality at all
 * for 96 of its items, and painting one would claim a tier nobody said. An addon that knows
 * an item is unranked and an addon that has not looked it up both pass null, and both get an
 * item drawn in the panel's own colours.
 */
function normalizeQuality(quality: unknown): ReadoutQuality | null {
  if (isQuality(quality)) {
    return quality;
  }
  return null;
}

/**
 * The class, or none for anything that is not one of the nine.
 *
 * No fallback colour, for the reason a school and a tier have none. The id an addon holds is
 * a mob's `templateId` as often as a player's, and a wolf is not a class: painting one would
 * claim a player where there is a beast. A caller that has not looked it up and a caller that
 * knows there is no class both pass null and both get the row's own colours.
 */
function normalizeUnitClass(unitClass: unknown): ReadoutClass | null {
  if (isUnitClass(unitClass)) {
    return unitClass;
  }
  return null;
}

function applyTone(el: HTMLElement, prefix: string, tone: unknown, state: VariantState): void {
  const next = normalizeTone(tone);
  if (next === state.tone) {
    return;
  }
  // One call rather than a remove and an add: a readout carries exactly one tone, so
  // there is nothing to accumulate and nothing left behind to sweep up.
  el.classList.replace(`${prefix}-${state.tone}`, `${prefix}-${next}`);
  state.tone = next;
}

function applySchool(el: HTMLElement, prefix: string, school: unknown, state: VariantState): void {
  const next = normalizeSchool(school);
  if (next === state.school) {
    return;
  }
  if (state.school !== null) {
    el.classList.remove(`${prefix}-school-${state.school}`);
  }
  if (next !== null) {
    el.classList.add(`${prefix}-school-${next}`);
  }
  state.school = next;
}

function applyQuality(
  el: HTMLElement,
  prefix: string,
  quality: unknown,
  state: VariantState,
): void {
  const next = normalizeQuality(quality);
  if (next === state.quality) {
    return;
  }
  if (state.quality !== null) {
    el.classList.remove(`${prefix}-quality-${state.quality}`);
  }
  if (next !== null) {
    el.classList.add(`${prefix}-quality-${next}`);
  }
  state.quality = next;
}

function applyUnitClass(
  el: HTMLElement,
  prefix: string,
  unitClass: unknown,
  state: VariantState,
): void {
  const next = normalizeUnitClass(unitClass);
  if (next === state.unitClass) {
    return;
  }
  if (state.unitClass !== null) {
    el.classList.remove(`${prefix}-class-${state.unitClass}`);
  }
  if (next !== null) {
    el.classList.add(`${prefix}-class-${next}`);
  }
  state.unitClass = next;
}

function toneClass(prefix: string, tone: unknown): string {
  return `${prefix}-${normalizeTone(tone)}`;
}

/**
 * Seeded from the tone the builder wrote into `className`.
 *
 * It has to match what is on the element, or the first update would try to replace a
 * class that is not there and leave the built one alongside the new one.
 */
function variantState(tone: unknown): VariantState {
  return { tone: normalizeTone(tone), school: null, quality: null, unitClass: null };
}

/**
 * Record the variants, each swapped rather than accumulated.
 *
 * A readout reused for another ability must not end up carrying two schools' classes,
 * or two tones', at once. Which of the two WINS is settled in each sheet by source
 * order at equal specificity, not here: this only records what the caller said.
 */
function applyVariants(
  el: HTMLElement,
  prefix: string,
  next: ReadoutVariants,
  state: VariantState,
): void {
  if (next.tone !== undefined) {
    applyTone(el, prefix, next.tone, state);
  }
  if (next.school !== undefined) {
    applySchool(el, prefix, next.school, state);
  }
  if (next.quality !== undefined) {
    applyQuality(el, prefix, next.quality, state);
  }
  if (next.unitClass !== undefined) {
    applyUnitClass(el, prefix, next.unitClass, state);
  }
}

export type {
  ReadoutClass,
  ReadoutQuality,
  ReadoutSchool,
  ReadoutTone,
  ReadoutVariants,
  VariantState,
};
export {
  applyVariants,
  QUALITIES as READOUT_QUALITIES,
  SCHOOLS as READOUT_SCHOOLS,
  TONES as READOUT_TONES,
  toneClass,
  UNIT_CLASSES as READOUT_CLASSES,
  variantState,
};
