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

/** A shot as the manifest declares it. */
export interface Shot {
  readonly id: string;
  readonly file: string;
  readonly minWidth: number;
  readonly caption: string;
  readonly alt: string;
}

/** A file's real pixel size, read from disk by the caller. */
export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/** A shot plus what its file turned out to be. */
export interface Measured extends Shot, Dimensions {
  /** Device pixels the derivatives are rendered at: min(natural, minWidth). */
  readonly served: number;
  /** Taller than it is wide, so it is capped by height rather than by column. */
  readonly portrait: boolean;
  /** The cap in CSS pixels, so the figure never upscales past what is served. */
  readonly maxWidth: number;
  readonly undersize: boolean;
}
