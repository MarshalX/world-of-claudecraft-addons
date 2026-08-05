// The one caret mark, in one place, rendered two ways.
//
// The same problem `close-glyph.ts` solves and the same answer. A text arrow inherits whatever
// font the surface is wearing, which here is the game's serif, and renders at whatever weight
// and optical size that font gives it: too thin, off-centre, and visibly not the mark the
// game's own dropdown draws. A path is a path everywhere.
//
// Two renderers because the loader has two: a picker built as plain DOM in the kit, which needs
// markup, and the manager's preact, which would otherwise need `dangerouslySetInnerHTML` for
// something that does not need it. One geometry, so the two cannot draw different arrows.

/** A chevron pointing down, on a 12 by 12 viewbox. */
const CARET_PATH = 'M3 5l3 3 3-3';
const CARET_BOX = '0 0 12 12';

/** The markup form, for the kit's own DOM builders. Authored here, never from a caller. */
function caretGlyphMarkup(): string {
  return `<svg viewBox="${CARET_BOX}" width="12" height="12" aria-hidden="true" focusable="false"><path d="${CARET_PATH}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export { CARET_BOX, CARET_PATH, caretGlyphMarkup };
