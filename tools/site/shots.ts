// The screenshot manifest, and the rule that keeps an undersized one from looking
// broken.
//
// Validated with zod like every other JSON this repository reads, rather than by
// hand: the failure to catch is a caption or an alt string that was renamed on one
// side only, and a schema says which key and which shot in one message.
//
// zod is safe here. The guard in loader/build-runtime.mjs is about the RUNTIME
// bundle, and nothing under tools/ reaches it.

import { z } from 'zod';

/** Two device pixels per CSS pixel, which is what every target display is. */
const RETINA = 2;

const PNG_SUFFIX = /\.png$/;

/**
 * The CSS width a preview must be able to fill before it gets its own row.
 *
 * Half the content column plus a margin, which is where a picture stops being
 * something that fits beside a paragraph. See `fillsOwnRow`.
 */
const OWN_ROW_MIN_WIDTH = 700;

/**
 * How tall a portrait screenshot may stand in a two-column row, in CSS pixels.
 *
 * Roughly the height such a panel has in the game, which is also where its rows
 * are most legible: shown much larger, the Combat Meter reads as a blown-up
 * screenshot rather than as the panel it is.
 */
const PORTRAIT_MAX_HEIGHT = 470;

const ShotSchema = z.object({
  /** Relative to screenshots/. PNG is the file of record; derivatives are built. */
  file: z.string().min(1),
  /** The widest display box this shot appears in, times two for a retina display. */
  minWidth: z.int().positive(),
  caption: z.string().min(1),
  alt: z.string().min(1),
});

const ManifestSchema = z.object({
  $comment: z.string().optional(),
  shots: z.record(z.string().regex(/^[a-z0-9-]+$/), ShotSchema),
});

/** The column's width, or what a portrait shot's aspect gives at the height cap. */
function wantedWidth(slot: number, natural: Dimensions, portrait: boolean): number {
  if (!portrait) {
    return slot;
  }
  return Math.min(slot, (PORTRAIT_MAX_HEIGHT * natural.width) / natural.height);
}

/**
 * Whether a picture has earned a row of its own rather than a column beside the
 * text.
 *
 * The question is what the FILE can supply, not what the layout would like. A
 * two-panel sheet like Satchel or Ledgerline carries 1900 device pixels of
 * captured detail, and none of it can be read in the 500 CSS px half of a
 * two-column row; a single HUD panel like Combat Meter is 776 device pixels
 * wide, so a full-width row would draw it at 388 in the middle of 1072 and leave
 * it looking lost. Both are the same mistake, which is picking a placement
 * without asking how big the thing being placed is.
 *
 * The threshold is where a preview stops fitting in the side column at its own
 * resolution and starts being shrunk below it. Measured across the catalog it is
 * not a close call: every preview is either under 530 CSS px or over 950.
 */
export function fillsOwnRow(natural: Dimensions): boolean {
  return natural.width / RETINA >= OWN_ROW_MIN_WIDTH;
}

/**
 * Read and validate the manifest.
 *
 * `at` names the file in the error for the same reason the frontmatter parser
 * does it: the value of failing here is that the message says what to fix.
 */
export function parseShots(source: string, at: string): Map<string, Shot> {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (cause) {
    throw new Error(`${at}: not valid JSON`, { cause });
  }
  const result = ManifestSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`${at}: ${z.prettifyError(result.error)}`);
  }
  return new Map(Object.entries(result.data.shots).map(([id, shot]) => [id, { id, ...shot }]));
}

/**
 * What a figure needs to know about one file on disk.
 *
 * Three numbers come out of this. `served` is the device width the derivatives are
 * encoded at, so a shot is never sent larger than it will be shown. `maxWidth` is
 * the cap the figure carries inline, which is the whole no-upscale rule: a file too
 * small to fill its slot renders SMALLER AND SHARP rather than full-width and soft.
 * `undersize` says the file cannot supply what the layout wanted, which is reported
 * and never fatal.
 */
export function measure(shot: Shot, natural: Dimensions): Measured {
  const stem = shot.stem ?? shot.file.replace(PNG_SUFFIX, '');
  const portrait = natural.height > natural.width;
  // What the layout WANTS, in CSS pixels, computed without reference to how big
  // the file happens to be. A landscape shot wants the column it sits in. A
  // portrait one wants whatever width its aspect gives at the height cap, because
  // filling a 496px column with a tall narrow panel made a row twice the height of
  // the paragraph beside it. Keeping this independent of the file is what lets
  // `undersize` mean something: comparing the file against a number derived from
  // the file would always agree with itself.
  const wanted = wantedWidth(shot.minWidth / RETINA, natural, portrait);
  const needed = Math.ceil(wanted * RETINA);
  return {
    ...shot,
    stem,
    width: natural.width,
    height: natural.height,
    portrait,
    /** Device pixels the derivatives are rendered at. Never more than exists. */
    served: Math.min(natural.width, needed),
    /** CSS pixels: what the layout wants, or what the file can supply, whichever is less. */
    maxWidth: Math.floor(Math.min(wanted, natural.width / RETINA)),
    undersize: natural.width < needed,
  };
}

/**
 * One line per shot that is narrower than its slot.
 *
 * Reported, never fatal. A hard failure on a stale or small screenshot fires on
 * ordinary work and gets switched off within a week; a list printed at the end of
 * a build is a signal that survives.
 */
export function undersizeReport(measured: readonly Measured[]): string[] {
  return measured
    .filter((shot) => shot.undersize)
    .map(
      (shot) =>
        `${shot.id}: ${shot.width}px wide, wants ${shot.minWidth}px ` +
        `(renders at ${((shot.width / shot.minWidth) * RETINA).toFixed(2)}x, capped so it stays sharp)`,
    );
}

/**
 * A shot as the manifest declares it, or as the build synthesises one.
 *
 * `caption` is nullable here while the manifest schema above still requires it,
 * and the two are not in conflict: a shot in prose is a figure the reader meets
 * on its own and needs telling what it is, while an addon's preview sits inside a
 * card whose heading is already the addon's name, where a caption would say it
 * twice. Only the synthesised kind passes null.
 */
export interface Shot {
  readonly id: string;
  readonly file: string;
  /**
   * What the AVIF and WebP beside the PNG are named, when that is not the PNG's
   * own stem.
   *
   * One picture is encoded at more than one width: an addon's preview is shown
   * in a catalog cell and again, much larger, on that addon's own page, and a
   * file sized for the cell is a blur on the page while a file sized for the
   * page is four times the bytes the cell needed. The two variants share the PNG
   * of record, which is both the fallback and what the README links, and differ
   * only in what the derivatives are called.
   */
  readonly stem?: string;
  readonly minWidth: number;
  readonly caption: string | null;
  readonly alt: string;
}

/** A file's real pixel size, read from disk by the caller. */
export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/** A shot plus what its file turned out to be. */
export interface Measured extends Shot, Dimensions {
  /** Resolved: the declared stem, or the PNG's own. Never re-derived downstream. */
  readonly stem: string;
  /** Device pixels the derivatives are rendered at: min(natural, minWidth). */
  readonly served: number;
  /** Taller than it is wide, so it is capped by height rather than by column. */
  readonly portrait: boolean;
  /** The cap in CSS pixels, so the figure never upscales past what is served. */
  readonly maxWidth: number;
  readonly undersize: boolean;
}
