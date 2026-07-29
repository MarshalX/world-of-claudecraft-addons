// The one close mark, and the only place its geometry is written.
//
// The frame builder is plain DOM and needs markup as
// a string; the manager is preact and renders JSX, and handing preact raw markup
// would mean `dangerouslySetInnerHTML` for something that does not need it. So
// both read the same `d`, `viewBox` and stroke width from here, and what cannot
// drift is the part that would be visible if it did.
//
// `currentColor` rather than a fixed fill: the existing hover and focus rules on
// `.woc-close` set `color`, so the mark takes the gold with the button and stays
// correct under the game's theme picker.

/** Two strokes crossing, inset from the box so it is not corner to corner. */
const CLOSE_PATH = 'M4 4 L12 12 M12 4 L4 12';
const CLOSE_VIEWBOX = '0 0 16 16';
const CLOSE_SIZE = 12;
const CLOSE_STROKE_WIDTH = 1.75;

/**
 * The mark as markup, for the non-preact caller.
 *
 * `aria-hidden` because the button carries the accessible name: a path cannot be
 * read aloud, and a screen reader announcing the SVG as well would say it twice.
 */
function closeGlyphMarkup(): string {
  return (
    `<svg viewBox="${CLOSE_VIEWBOX}" width="${String(CLOSE_SIZE)}" ` +
    `height="${String(CLOSE_SIZE)}" aria-hidden="true" focusable="false">` +
    `<path d="${CLOSE_PATH}" stroke="currentColor" ` +
    `stroke-width="${String(CLOSE_STROKE_WIDTH)}" stroke-linecap="round" fill="none"/></svg>`
  );
}

export { CLOSE_PATH, CLOSE_SIZE, CLOSE_STROKE_WIDTH, CLOSE_VIEWBOX, closeGlyphMarkup };
