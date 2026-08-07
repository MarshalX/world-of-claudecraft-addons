// Pure formatting, shared by the loader, the tools and the stage.
//
// Every figure rounds UP: a countdown that reads 0 while the thing is still
// running is the error a timer must not make.

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SINGLE = 1;

const SEPARATOR = '_';
const EMPTY = '';

/**
 * Counter-clockwise from straight ahead, which is the direction `facing`
 * increases in, so a clockwise bearing steps BACKWARDS through it.
 *
 * Do not rewrite the table clockwise and drop the negation in `compass`:
 * `Math.round` breaks ties toward +Infinity, so that flips the glyph on every
 * exact sector boundary.
 */
const FORWARD_ARROW = '↑';
const ARROWS = [FORWARD_ARROW, '↖', '←', '↙', '↓', '↘', '→', '↗'];
const FULL_TURN_DEGREES = 360;
const SECTOR_DEGREES = FULL_TURN_DEGREES / ARROWS.length;

type DurationStyle = 'timer' | 'coarse';

/** The minute branch tests the RAW value and ceils after, so 59.5 gives `60`. */
function timerForm(seconds: number): string {
  if (seconds >= SECONDS_PER_MINUTE) {
    return `${String(Math.ceil(seconds / SECONDS_PER_MINUTE))}m`;
  }
  return String(Math.ceil(seconds));
}

function coarseForm(whole: number): string {
  if (whole >= SECONDS_PER_DAY) {
    const hours = Math.floor((whole % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
    return `${String(Math.floor(whole / SECONDS_PER_DAY))}d ${String(hours)}h`;
  }
  if (whole >= SECONDS_PER_HOUR) {
    const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return `${String(Math.floor(whole / SECONDS_PER_HOUR))}h ${String(minutes)}m`;
  }
  if (whole >= SECONDS_PER_MINUTE) {
    const seconds = whole % SECONDS_PER_MINUTE;
    return `${String(Math.floor(whole / SECONDS_PER_MINUTE))}m ${String(seconds)}s`;
  }
  return `${String(whole)}s`;
}

/**
 * Whether there is a figure to format at all. Zero is one, so this cannot be a
 * falsy test.
 *
 * Null coerces to 0 through the arithmetic below, so without this a null
 * `bearingTo` draws as dead ahead and a null `LootRoll.remaining` as a roll
 * timer already at 0.
 */
function given(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function duration(seconds: number | null, style: DurationStyle = 'timer'): string {
  if (!given(seconds)) {
    return EMPTY;
  }
  if (style === 'coarse') {
    return coarseForm(Math.ceil(seconds));
  }
  return timerForm(seconds);
}

function nonEmpty(word: string): boolean {
  return word !== EMPTY;
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function titleCase(id: string): string {
  return id.split(SEPARATOR).filter(nonEmpty).map(capitalized).join(' ');
}

function count(n: number, singular: string, plural?: string): string {
  if (n === SINGLE) {
    return `${String(n)} ${singular}`;
  }
  return `${String(n)} ${plural ?? `${singular}s`}`;
}

function compass(degrees: number | null): string {
  if (!given(degrees)) {
    return EMPTY;
  }
  const sector = Math.round(-degrees / SECTOR_DEGREES);
  // Twice, so a negative sector and a bearing from outside [-180, 180) both land.
  const index = ((sector % ARROWS.length) + ARROWS.length) % ARROWS.length;
  // Unreachable; `noUncheckedIndexedAccess` cannot see that the modulo bounds it.
  return ARROWS[index] ?? FORWARD_ARROW;
}

export type { DurationStyle };
export { compass, count, duration, titleCase };
