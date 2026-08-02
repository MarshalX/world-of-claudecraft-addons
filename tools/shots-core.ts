// What `pnpm shots` decides, separate from the browser that carries it out.
//
// The same split serve-core.ts and theme-core.ts make: a Vitest suite drives
// these directly, and `tools/shots.mjs` is the Playwright and sharp around them.
// Everything here is arithmetic and manifest surgery, which is where the answers
// that can be wrong live; a screenshot either happens or it does not.

/**
 * The narrowest a preview may be, in DEVICE pixels.
 *
 * `PREVIEW_MIN_WIDTH` in `tools/site/build.ts`, which is the slot an addon's card
 * reserves on the catalog page. Repeated rather than imported because the site
 * builder is a different program with a different reason for the number: it uses
 * it to REPORT an undersize shot, and this uses it to avoid producing one.
 *
 * That report currently carves previews out entirely, on the grounds that an
 * addon's preview is a picture of its own fixed-size panel and "cannot be
 * captured wider without zooming the whole game". On the stage it can: the zoom
 * is a device scale factor, and nothing about the game is involved. Once every
 * preview is captured this way the carve-out is worth revisiting.
 */
const MIN_DEVICE_WIDTH = 700;

/**
 * The scale factors a capture may use.
 *
 * Whole numbers only. A fractional one lands a 1px border on a half pixel and the
 * browser resolves that by blending it across two, which on a 2px panel border is
 * visibly softer than the game draws it. 2 is the floor because the manager
 * reserves a 420px box for the full picture and a 1x shot of a 340px panel is
 * blurry inside it; 4 is the ceiling because past it the byte cap binds first.
 */
const SCALE_MIN = 2;
const SCALE_MID = 3;
const SCALE_MAX = 4;
const SCALES: readonly number[] = [SCALE_MIN, SCALE_MID, SCALE_MAX];

/**
 * Room around the frame, in CSS pixels.
 *
 * The panel's own shadow is `0 2px 16px`, so it paints up to 18px past the
 * element box and a crop taken at the box alone shears it off on three sides,
 * which reads as a hard edge the game does not have. 24 leaves a little air
 * beyond that, which the letterboxing in every consumer would add anyway.
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
 * The device scale to capture one frame at.
 *
 * Chosen from the frame's CSS width so the narrowest addon still fills the card
 * slot: a 220px-wide strip needs 4x to clear 700 device pixels, and a 340px panel
 * needs 3x. Capturing every addon at one fixed factor would either leave the
 * small ones short or make the large ones needlessly heavy, and the byte cap is
 * real.
 */
function scaleFor(cssWidth: number): number {
  const enough = SCALES.find((scale) => cssWidth * scale >= MIN_DEVICE_WIDTH);
  return enough ?? (SCALES.at(-1) as number);
}

/**
 * The next scale down, or null when there is none.
 *
 * A capture that lands over the byte cap is retried smaller rather than
 * quantised: a palette PNG bands the panel's own gradient, which is the one part
 * of the picture the loader did not draw and cannot be blamed for.
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
 * `scaleFor` is a PREDICTION, made from a frame measured at 1x, and a prediction
 * is not good enough on its own: a frame sized by its own content lays out a
 * pixel or two differently at another scale factor, and `cooldown-bars` measured
 * 245 CSS px at 1x and captured 228 at 3x, which is 684 device pixels against a
 * 700 slot. So the width is checked against what came BACK and stepped up if it
 * fell short, rather than trusted from what went in.
 */
function largerScale(scale: number): number | null {
  const at = SCALES.indexOf(scale);
  // The miss has to be caught here and cannot fall through to the read below:
  // `indexOf` answers -1, and `SCALES[-1 + 1]` is the SMALLEST scale, so an
  // unrecognised one would read as "step up to 2x" rather than as "no such step".
  // Running off the top needs no such guard, since the read is already checked.
  if (at === -1) {
    return null;
  }
  return SCALES[at + 1] ?? null;
}

/** Whether a capture fills the card slot it will be shown in. */
function fillsSlot(cssWidth: number, scale: number): boolean {
  return cssWidth * scale >= MIN_DEVICE_WIDTH;
}

/** Whether a capture is small enough for the manager to load it in game. */
function withinCap(bytes: number): boolean {
  return bytes <= MAX_BYTES;
}

/**
 * The crop, in CSS pixels, around what was drawn.
 *
 * The union rather than the first, because an addon may legitimately put up more
 * than one: `cooldown-bars` has two frame ids and a future addon could show both
 * at once. Clamped at the origin so a frame pushed against the top left does not
 * ask for a negative crop, which a browser rejects rather than clamps.
 *
 * The margin is an argument because a SHEET has already had one applied. Each of
 * its panes was cropped to its own frames, in the browser, with room left for the
 * shadow; adding it again out here would put a second margin around the outside
 * only, which is why the first sheet came out with the panels adrift in it.
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
 * Where one panel sits, said the way a description should say it.
 *
 * Positional, because that is what the reader of an alt sentence needs from a
 * composite: "on the left" locates a panel in a picture they cannot see, and
 * "the first one" does not. Two is the case that has to read well, since an
 * addon with a layout SETTING has two of them; past that the honest phrasing is
 * a count, because nothing in English usefully names the third of four.
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

/**
 * One sentence describing the whole picture, out of one per panel.
 *
 * A single panel keeps its own alt untouched, which is what every preview was
 * before sheets existed. Several are joined with their position and their
 * caption, so the description walks the image in the order somebody looking at
 * it would.
 *
 * Composed rather than written once per sheet because the alt lives on the
 * SCENARIO, beside the fixture that produces that panel, so the two are edited
 * together. The cost is that each panel's sentence has to read as a clause
 * rather than as a paragraph, which is why the shipped ones start lowercase.
 */
/**
 * What comes before one panel's own sentence.
 *
 * The comma after the position is there whether or not a caption follows it: "On
 * the left one." runs the position into the description and reads as a sentence
 * that lost a word.
 */
function leadOf(place: string, caption: string | undefined): string {
  if (caption === undefined) {
    return `${place},`;
  }
  return `${place}, ${caption},`;
}

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
 * Rebuilt key by key rather than spread, because `JSON.stringify` writes
 * insertion order and a spread would drop `preview` at the END of every manifest
 * that did not already have one. Every shipped manifest carries it directly after
 * `entry`, and a tool that reformats the file it is editing turns a one-line diff
 * into a whole-file one.
 *
 * It takes the RAW parsed object rather than the validated manifest, and that is
 * not a convenience. A schema applies defaults, so writing back what validation
 * returned would silently add every optional field the manifest had chosen to
 * leave out, on an addon somebody only asked to have photographed. Validation
 * still runs first, to fail before anything is written.
 */
function withPreview(
  source: Record<string, unknown>,
  alt: string,
  file: string,
): Record<string, unknown> {
  // Computed rather than dotted: Biome wants `source.preview` and TypeScript
  // forbids dotting into an index signature. See STYLE.md, which names this pair
  // as the place the two tools want opposite things.
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

export type { Panel, Rect };
export {
  CROP_MARGIN,
  cropAround,
  fillsSlot,
  largerScale,
  MAX_BYTES,
  MIN_DEVICE_WIDTH,
  previewAlt,
  renderManifest,
  SCALES,
  scaleFor,
  smallerScale,
  withinCap,
  withPreview,
};
