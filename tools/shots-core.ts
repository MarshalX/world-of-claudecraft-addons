// What `pnpm shots` decides, separate from the browser that carries it out: a Vitest suite drives
// this arithmetic and manifest surgery directly, and `tools/shots.mjs` is the Playwright and sharp
// around it.

/**
 * The narrowest a preview may be, in DEVICE pixels.
 *
 * `PREVIEW_MIN_WIDTH` in `tools/site/build.ts`, the slot an addon's card reserves on the catalog
 * page. Repeated rather than imported because the site builder uses it to REPORT an undersize
 * shot, and this uses it to avoid producing one.
 */
const MIN_DEVICE_WIDTH = 700;

/**
 * How far past the slot a capture has to clear before the smaller scale is accepted, in device
 * pixels.
 *
 * Without it a width difference too small to be a layout change decides the resolution. 16
 * absorbs the 2 to 12 pixels measured between CoreText and FreeType over the same fonts and
 * between runs of one machine; past that a width change is content.
 */
const SLOT_MARGIN = 16;

/**
 * The scale factors a capture may use.
 *
 * Whole numbers only: a fractional one lands a 1px border on a half pixel and the browser blends
 * it across two. 2 is the floor because the manager shows the full picture in a 420px box; 4 is
 * the ceiling because past it the byte cap binds first.
 */
const SCALE_MIN = 2;
const SCALE_MID = 3;
const SCALE_MAX = 4;
const SCALES: readonly number[] = [SCALE_MIN, SCALE_MID, SCALE_MAX];

/**
 * Room around the frame, in CSS pixels.
 *
 * The panel's shadow is `0 2px 16px`, so it paints up to 18px past the element box and a crop at
 * the box shears it off.
 */
const CROP_MARGIN = 24;

/** Two panels, the case an addon with a layout setting produces. */
const PAIR = 2;

/** The manifest field this writes, named so no call site carries a literal key. */
const PREVIEW_KEY = 'preview';

/** What `pnpm validate` will accept, checked here so a run fails before writing. */
const MAX_BYTES = 524_288;

/** A rectangle as the page measured it, in CSS pixels. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The device scale to capture one frame at, chosen from its CSS width so the narrowest addon
 * still fills the card slot without making the large ones needlessly heavy.
 */
function scaleFor(cssWidth: number): number {
  const enough = SCALES.find((scale) => fillsSlot(cssWidth, scale));
  return enough ?? (SCALES.at(-1) as number);
}

/**
 * The next scale down, or null when there is none.
 *
 * A capture over the byte cap is retried smaller rather than quantised: a palette PNG bands the
 * panel's gradient.
 */
function smallerScale(scale: number): number | null {
  const at = SCALES.indexOf(scale);
  if (at <= 0) {
    return null;
  }
  return SCALES[at - 1] ?? null;
}

/**
 * The next scale up, or null when there is none.
 *
 * `scaleFor` predicts from a frame measured at 1x, and a frame sized by its content lays out a
 * pixel or two differently at another scale, so the width that came BACK is checked and stepped up
 * if it fell short.
 */
function largerScale(scale: number): number | null {
  const at = SCALES.indexOf(scale);
  // `indexOf` answers -1 for an unknown scale, and `SCALES[-1 + 1]` would read it as "step up to
  // the smallest scale".
  if (at === -1) {
    return null;
  }
  return SCALES[at + 1] ?? null;
}

/**
 * Whether a capture fills the card slot it will be shown in. The one place the rule is spelled,
 * so `scaleFor`'s prediction and the capture's acceptance cannot drift apart.
 */
function fillsSlot(cssWidth: number, scale: number): boolean {
  return cssWidth * scale >= MIN_DEVICE_WIDTH + SLOT_MARGIN;
}

/** Whether a capture is small enough for the manager to load it in game. */
function withinCap(bytes: number): boolean {
  return bytes <= MAX_BYTES;
}

/**
 * The crop, in CSS pixels, around the union of every frame drawn.
 *
 * Clamped at the origin because a browser rejects a negative crop rather than clamping it. The
 * margin is an argument because a SHEET's panes were each cropped with their own margin already,
 * and a second one would only pad the outside.
 */
function cropAround(rects: readonly Rect[], margin: number = CROP_MARGIN): Rect {
  if (rects.length === 0) {
    throw new Error('nothing to photograph: the scenario drew no frame');
  }
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const x = Math.max(0, left - margin);
  const y = Math.max(0, top - margin);
  return { x, y, width: right - x + margin, height: bottom - y + margin };
}

/**
 * Where one panel sits, for an alt sentence: positional for a pair, since a reader who cannot see
 * the picture needs "on the left", and a count past that.
 */
function sideOf(index: number): string {
  if (index === 0) {
    return 'On the left';
  }
  return 'On the right';
}

function panelPlace(index: number, total: number): string {
  if (total === 1) {
    return '';
  }
  if (total === PAIR) {
    return sideOf(index);
  }
  return `Panel ${String(index + 1)} of ${String(total)}`;
}

/** One panel of a preview, as its scenario declared it. */
interface Panel {
  caption?: string | undefined;
  alt: string;
}

/** What comes before one panel's own sentence; the comma after the position is always there. */
function leadOf(place: string, caption: string | undefined): string {
  if (caption === undefined) {
    return `${place},`;
  }
  return `${place}, ${caption},`;
}

/**
 * One sentence describing the whole picture, out of one per panel.
 *
 * A single panel keeps its own alt untouched; several are joined with their position and
 * caption. Each alt lives on its scenario beside the fixture it describes, so a panel's sentence
 * has to read as a clause, which is why they start lowercase.
 */
function previewAlt(panels: readonly Panel[]): string {
  const [only] = panels;
  if (panels.length === 1 && only !== undefined) {
    return only.alt;
  }
  return panels
    .map((panel, index) => {
      const lead = leadOf(panelPlace(index, panels.length), panel.caption);
      return `${lead} ${panel.alt}`.trim();
    })
    .join(' ');
}

/**
 * The manifest with its preview declared, keys in their original order.
 *
 * Rebuilt key by key rather than spread, because a spread puts a new `preview` at the END and
 * every shipped manifest carries it directly after `entry`. It takes the RAW parsed object rather
 * than the validated manifest, because writing back what the schema returned would add every
 * defaulted optional field.
 */
function withPreview(
  source: Record<string, unknown>,
  alt: string,
  file: string,
): Record<string, unknown> {
  // Computed rather than dotted: Biome wants `source.preview` and TypeScript forbids dotting into
  // an index signature (see STYLE.md).
  const has = (record: Record<string, unknown>, name: string): unknown => record[name];
  const preview = { file, alt };
  const built: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === PREVIEW_KEY) {
      built[key] = preview;
    } else {
      built[key] = value;
      if (key === 'entry' && has(source, 'preview') === undefined) {
        built[PREVIEW_KEY] = preview;
      }
    }
  }
  return built;
}

/** The manifest as it is written back: two-space JSON with a trailing newline. */
function renderManifest(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The game a preview is a picture OF: LIVE, not the stage's pbe default, because a preview is a
 * committed picture of what a player on live reads in Browse. The channels diverge in both
 * directions, so capturing from pbe can add or drop art the alt text describes.
 */
const DEFAULT_HOST = 'https://worldofclaudecraft.com';

/** A trailing slash on --host, so the proxied URL never doubles it. */
const TRAILING_SLASH = /\/$/;

/** Which game the stage proxies to for a capture, from the whole argv. */
function hostFor(argv: readonly string[]): string {
  const at = argv.indexOf('--host');
  if (at === -1) {
    return DEFAULT_HOST;
  }
  const given = argv[at + 1];
  if (given === undefined) {
    throw new Error('--host needs a value, e.g. --host https://pbe.worldofclaudecraft.com');
  }
  return given.replace(TRAILING_SLASH, '');
}

/**
 * The addon ids to narrow to, with the `--host` VALUE removed: a URL would otherwise read as an
 * addon id, match no directory, and narrow the run to nothing.
 */
function onlyFor(argv: readonly string[]): string[] {
  const valueAt = argv.indexOf('--host') + 1;
  return argv.slice(2).filter((arg, index) => !arg.startsWith('-') && index + 2 !== valueAt);
}

export type { Panel, Rect };
export {
  CROP_MARGIN,
  cropAround,
  DEFAULT_HOST,
  fillsSlot,
  hostFor,
  largerScale,
  MAX_BYTES,
  MIN_DEVICE_WIDTH,
  onlyFor,
  previewAlt,
  renderManifest,
  SCALES,
  SLOT_MARGIN,
  scaleFor,
  smallerScale,
  withinCap,
  withPreview,
};
