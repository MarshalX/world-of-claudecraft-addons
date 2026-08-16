// How large one square of item art is, transcribed from the game's own bag grid.
//
// The game draws every grid of items at `repeat(auto-fill, minmax(42px, 1fr))` over a
// `gap: 4px`, in `.bag-grid` (`src/styles/components.css`). Nothing serves that number
// and nothing ever will: it is a rule in a content-hashed stylesheet, so an addon
// either transcribes it or invents one, and two addons in the catalogue had invented
// two, 32px and 44px, for grids drawing the same art side by side. This is the one
// transcription, with the same standing as the quality palette in `styles/quality.css`
// and the theme the stage reads: a by-hand reading of a deployed game, correct until
// somebody checks it again.
//
// The reading passes the test this project asks of any number copied out of the game,
// which is what QUERY it was found in. `.bag-grid` sits in `@layer components` with no
// media wrapper, so 42 is the desktop figure as well as the touch one. That is the
// opposite of the tap-target floor, where 40px was lifted out of `@media (pointer:
// coarse)` and applied unconditionally, and every loader panel came out a third larger
// than the game window beside it.
//
// It also carries the touch floor for free, which is the half no stylesheet here can
// do. The game's own note on `.bag-item` says the 42px column keeps every cell at or
// above 40x40 for SC 2.5.8. `ui/styles/touch.css` cannot reach a tile to do the same,
// because a tile's size arrives as an inline custom property and an inline style
// outranks every selector a sheet can spell, so a grid built at 32px is under the tap
// target on a phone with nothing able to raise it.
//
// It is published as a NUMBER rather than as a track, because the game's `1fr` half is
// a decision an addon should keep making for itself: a stretched track stretches the
// square in it, and a bag cell that changes size as the player drags the frame is
// worse than a grid that stays put and centres. Both addons here pass it to
// `ui.tile({ size })` and repeat it as a fixed track.

/** The game's own bag cell. See the note above before changing it. */
const ITEM_CELL_PX = 42;

export { ITEM_CELL_PX };
