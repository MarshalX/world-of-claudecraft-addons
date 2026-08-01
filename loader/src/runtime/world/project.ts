// Turning a world point into a point on screen.
//
// The one read in this project that goes through the RENDERER rather than through
// the world model, and it is an assertion like every other read of the game: the
// method is looked up on an object this repository cannot compile against, called
// defensively, and its answer is checked before anything is written to a style.
//
// What it returns, from the game's own renderer: viewport pixels measured from the
// top left of the canvas, plus a flag for a point behind the camera. The canvas is
// `position: fixed` at the viewport origin and sized to the window, and the loader's
// root is `position: fixed; inset: 0`, so those pixels are already the coordinates
// an element in the root is positioned by.
//
// THE TRAP, which is the reason this file has a comment this long. The game's own
// floating combat text divides that point by its UI scale, because the HUD lives
// inside `#ui` and `#ui` is scaled by CSS `zoom`. Copying that divide would be
// wrong here: the loader's root is a SIBLING of `#ui` and is not scaled, so an
// anchor divided by the scale would drift further from its world point the further
// a player moved their UI scale from 1, and would look perfect on the machine of
// anyone who never changed it.
//
// A projection that fails is a null rather than a throw or a guess. Before world
// entry there is no renderer at all, and an anchor that cannot be placed has to be
// hidden rather than parked at the top left corner of the screen.

/** Where a world point lands, in the loader root's own coordinates. */
interface ScreenPoint {
  x: number;
  y: number;
  /** True when the point is behind the camera, where x and y are meaningless. */
  behind: boolean;
}

/** Projects a world point, or answers null when the game cannot be asked. */
type Projector = (x: number, y: number, z: number) => ScreenPoint | null;

/** The renderer's shape, as this project claims it to be. See world/game-types.ts. */
interface GameRenderer {
  worldToScreen?: (x: number, y: number, z: number) => unknown;
}

function rendererOf(game: unknown): GameRenderer | null {
  if (typeof game !== 'object' || game === null) {
    return null;
  }
  const { renderer } = game as { renderer?: unknown };
  if (typeof renderer !== 'object' || renderer === null) {
    return null;
  }
  return renderer as GameRenderer;
}

/**
 * The answer, if it is one.
 *
 * Checked rather than trusted, because a NaN reaching a style property drops the
 * declaration silently: an anchor would stop moving and read as one placed
 * somewhere odd rather than as one that failed.
 */
function asPoint(value: unknown): ScreenPoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { x, y, behind } = value as { x?: unknown; y?: unknown; behind?: unknown };
  if (!(Number.isFinite(x) && Number.isFinite(y))) {
    return null;
  }
  return { x: x as number, y: y as number, behind: behind === true };
}

/**
 * A projector over the live game object.
 *
 * The game is read on every call rather than captured: the loader starts at
 * document-start, `__game` is assigned at world entry, and an addon may hold an
 * anchor across a session that has not started yet.
 */
function createProjector(game: () => unknown): Projector {
  return (x, y, z) => {
    const renderer = rendererOf(game());
    if (typeof renderer?.worldToScreen !== 'function') {
      return null;
    }
    try {
      return asPoint(renderer.worldToScreen(x, y, z));
    } catch {
      // A future update can leave something callable in place that throws when
      // called. The cost of that has to be a hidden anchor, not a dead frame loop.
      return null;
    }
  };
}

export type { Projector, ScreenPoint };
export { createProjector };
