// The four axes a readout can be coloured by, and nothing else.
//
// These change when the GAME adds a school, a tier or a class. Each refuses an unrecognised
// value rather than guessing a colour. Which axis WINS where two are set is source order in
// the sheets, at equal specificity, not anything here.

/** The tones a sheet draws. Anything else falls back to the first. */
const TONES = Object.freeze(['default', 'warn', 'danger'] as const);

/**
 * The game's own damage schools, a SEPARATE axis from tone (urgency). The palette is the
 * game's `--color-debuff-*` tokens, so a tint matches the aura icon for the same school.
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
 * The game's item quality tiers. The palette is not a token: the game keeps two literal
 * tables (`QUALITY_COLOR` for a name, `.q-*` for a border), which differ only at common.
 * `styles/quality.css` transcribes both, since nothing serves them.
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
 * The game's nine classes, for a readout drawing a PERSON. The palette is the game's
 * `CLASSES[cls].color` content table, which nothing serves; `styles/unit-class.css`
 * transcribes it.
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
 * Which variants are on an element right now, as normalized values so a repeat builds no string.
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

/** The school, or none: a guessed tint would claim a damage type the event did not report. */
function normalizeSchool(school: unknown): ReadoutSchool | null {
  if (isSchool(school)) {
    return school;
  }
  return null;
}

/** The tier, or none for anything the game does not rank (many items have no quality). */
function normalizeQuality(quality: unknown): ReadoutQuality | null {
  if (isQuality(quality)) {
    return quality;
  }
  return null;
}

/** The class, or none for anything that is not one of the nine (a mob's `templateId`, say). */
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

/** Seeded from the tone the builder wrote into `className`, so the first swap removes it. */
function variantState(tone: unknown): VariantState {
  return { tone: normalizeTone(tone), school: null, quality: null, unitClass: null };
}

/**
 * Record the variants, each swapped rather than accumulated, so a reused readout never carries two.
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
