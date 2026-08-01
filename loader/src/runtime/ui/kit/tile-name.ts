// What a tile is announced as.
//
// Split from `kit/tile.ts`, which owns the square's markup and its four visual
// slots. This is the one part of a tile that is DERIVED and stateful rather than
// drawn: there is nowhere to put a name on a square whose whole face is art, so the
// accessible name is composed from three parts that each move on their own schedule,
// and it has to be recomposed whenever any of them does.
//
// It is also the part with a per-frame cost, which is the other reason it is its own
// subject. A tile is animated from an addon's frame loop, so this runs per tile per
// frame and the answer is nearly always the string it was last time.

/**
 * What the tile currently says, and what was last written from it.
 *
 * `name` is not derivable from the three fields above it, which is exactly why it is
 * held: the name is recomposed on every update and is usually unchanged, so this is
 * what keeps a countdown from rewriting an identical `aria-label` sixty times a
 * second. It starts null to match the `aria-hidden` a freshly built tile carries.
 */
interface TileState {
  label: string | null;
  value: string;
  count: number | null;
  name: string | null;
}

/**
 * One accessible name for the whole tile, or none for a tile that should not have one.
 *
 * A tile is a graphic. The wedge carries the timing, the art carries the identity,
 * and both figures are drawn ON the art rather than beside it, so it is announced as
 * one image named for everything it says rather than as a box whose children are read
 * in whatever order they were appended.
 *
 * A tile with NO label is hidden from assistive technology outright. Art with a wedge
 * over it and no name is not something anyone can act on, and announcing a bare "4.2"
 * is worse than silence. That is also the nudge: the way to be announced is to say
 * what you are.
 */
function composeName(state: TileState): string | null {
  if (state.label === null) {
    return null;
  }
  const said = [state.label];
  if (state.value.length > 0) {
    said.push(state.value);
  }
  if (state.count !== null) {
    said.push(String(state.count));
  }
  return said.join(', ');
}

/**
 * Announce the tile as what it now says, and only when that moved.
 *
 * `role` and `aria-hidden` are written on the TRANSITION rather than beside the
 * label, because they only change when a tile gains or loses its name: rewriting
 * them alongside every countdown tick would put two more attribute mutations on the
 * element for a value that did not move, and an attribute write is not free just
 * because the value it writes is the same one.
 */
function applyName(el: HTMLElement, state: TileState): void {
  const name = composeName(state);
  if (name === state.name) {
    return;
  }
  const was = state.name;
  state.name = name;
  if (name === null) {
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.setAttribute('aria-hidden', 'true');
    return;
  }
  if (was === null) {
    el.removeAttribute('aria-hidden');
    el.setAttribute('role', 'img');
  }
  el.setAttribute('aria-label', name);
}

export type { TileState };
export { applyName, composeName };
