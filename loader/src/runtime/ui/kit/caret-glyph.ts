// The one caret mark, one geometry for two renderers (plain DOM and the manager's preact),
// as in `close-glyph.ts`. A text arrow would inherit the game's serif and render thin and
// off-centre.

/** A chevron pointing down, on a 12 by 12 viewbox. */
const CARET_PATH = 'M3 5l3 3 3-3';
const CARET_BOX = '0 0 12 12';

/** The markup form, for the kit's own DOM builders. Authored here, never from a caller. */
function caretGlyphMarkup(): string {
  return `<svg viewBox="${CARET_BOX}" width="12" height="12" aria-hidden="true" focusable="false"><path d="${CARET_PATH}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export { CARET_BOX, CARET_PATH, caretGlyphMarkup };
