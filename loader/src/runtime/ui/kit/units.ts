// How big one unit is when a box is divided between several of them.
//
// The arithmetic every addon that scales with its frame had written for itself, in
// five places that agreed about the hard parts and differed in the ways that are easy
// to get wrong. All five: take a fixed extra off the box (a caption band under a strip
// of squares), take the gaps off before dividing rather than after, floor the share,
// and hold the answer between a floor and a ceiling.
//
// Flooring is the half that has to be exactly right. A share rounded UP is a strip
// whose last row is a pixel or two past the bottom of the box, and a bare frame clips
// rather than scrolls, so the cost is the bottom row quietly missing.
//
// The floor is applied HERE as well as being stated on the frame, and that is not
// belt and braces: a box arrives from a restore and from a viewport clamp as well as
// from a drag, and a bound a frame states is about the BOX rather than about what the
// addon divides out of it.

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
  // The floor last, so it beats a ceiling under it. That is the order frame/geometry.ts
  // resolves the same contradiction in: a max below a min is one somebody has to break,
  // and only one of the two is about the display staying readable.
  return Math.max(Math.min(share, max), min);
}

export type { UnitOpts };
export { units };
