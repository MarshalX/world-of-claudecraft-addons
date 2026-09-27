// The screenshot manifest, and the rule that keeps an undersized shot from looking broken. zod is
// safe here: the runtime bundle guard does not reach tools/.

import { z } from 'zod';

/** Two device pixels per CSS pixel, which is what every target display is. */
const RETINA = 2;

const PNG_SUFFIX = /\.png$/;

/** The CSS width a preview must be able to fill before it gets its own row. See `fillsOwnRow`. */
const OWN_ROW_MIN_WIDTH = 700;

/**
 * How tall a portrait screenshot may stand in a two-column row, in CSS pixels: roughly the height
 * such a panel has in the game, past which it reads as a blown-up screenshot.
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
 * Whether a picture has earned a row of its own rather than a column beside the text, decided by
 * what the FILE can supply: a wide sheet is unreadable in a half column, and a single panel looks
 * lost in a full-width row.
 */
export function fillsOwnRow(natural: Dimensions): boolean {
  return natural.width / RETINA >= OWN_ROW_MIN_WIDTH;
}

/** Read and validate the manifest; `at` names the file in the error. */
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
 * `served` is the device width the derivatives are encoded at, so a shot is never sent larger than
 * it is shown. `maxWidth` is the no-upscale cap: a file too small for its slot renders SMALLER AND
 * SHARP rather than full-width and soft. `undersize` is reported and never fatal.
 */
export function measure(shot: Shot, natural: Dimensions): Measured {
  const stem = shot.stem ?? shot.file.replace(PNG_SUFFIX, '');
  const portrait = natural.height > natural.width;
  // What the layout WANTS, in CSS pixels, independent of the file's size, or `undersize` would
  // compare the file against itself. A portrait shot wants the width its aspect gives at the height
  // cap, or a tall panel stretches the row.
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
 * One line per shot that is narrower than its slot. Reported, never fatal: a hard failure here
 * fires on ordinary work and gets switched off.
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
 * A shot as the manifest declares it, or as the build synthesises one. `caption` is null only on
 * a synthesised addon preview, whose card heading already names it.
 */
export interface Shot {
  readonly id: string;
  readonly file: string;
  /**
   * What the AVIF and WebP beside the PNG are named, when that is not the PNG's own stem. One
   * picture is encoded at more than one width (a catalog cell and the addon's own page), and the
   * variants share the PNG of record.
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
