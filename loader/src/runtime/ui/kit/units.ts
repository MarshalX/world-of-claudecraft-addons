// How big one unit is when a box is divided between several of them.
//
// Take a fixed extra off the box, take the gaps off BEFORE dividing, FLOOR the share, and
// hold it between a floor and a ceiling. A share rounded up puts the last row past the bottom
// of a box that clips rather than scrolls.
//
// The minimum is applied here as well as on the frame: a frame's bounds are about the box,
// not about the units divided out of it.

/** What the caller is dividing between. Everything but the count has a sane default. */
interface UnitOpts {
  /** How many units share the box. Below one there is nothing to divide. */
  count?: number;
  /** The space between two of them, which is paid before the division. */
  gap?: number;
  /** Fixed space the units never get: a caption band, a footer, a header row. */
  extra?: number;
  /** How small a unit may be. Also the answer when the box cannot be divided at all. */
  min?: number;
  /** How large a unit may be. Defaults to no ceiling. */
  max?: number;
}

function units(available: number, opts: UnitOpts = {}): number {
  const count = Math.floor(opts.count ?? 1);
  const min = opts.min ?? 0;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(available) || count < 1) {
    return min;
  }
  const gaps = (count - 1) * (opts.gap ?? 0);
  const share = Math.floor((available - (opts.extra ?? 0) - gaps) / count);
  // The floor last, so it beats a ceiling under it, as in frame/geometry.ts.
  return Math.max(Math.min(share, max), min);
}

export type { UnitOpts };
export { units };
