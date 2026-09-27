// How large one square of item art is, transcribed from the game's own bag grid.
//
// The game draws every item grid at `repeat(auto-fill, minmax(42px, 1fr))` over `gap: 4px`
// (`.bag-grid`, `src/styles/components.css`), with no media query, so 42 is the desktop and
// touch figure alike. A by-hand transcription, like `styles/quality.css`.
//
// It also keeps a tile at or above the 40px touch target, which `ui/styles/touch.css` cannot
// enforce because a tile's size is an inline custom property.
//
// A NUMBER rather than a track: a `1fr` track would resize the cells as the frame is dragged.

/** The game's own bag cell. */
const ITEM_CELL_PX = 42;

export { ITEM_CELL_PX };
