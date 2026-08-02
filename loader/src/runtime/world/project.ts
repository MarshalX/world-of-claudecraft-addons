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
//
// THE SECOND TRAP, and the reason `behind` is not the renderer's flag any more.
// `worldToScreen` reports only the far half of the depth test, so a point BETWEEN
// the camera and the near plane comes back with `behind: false` and finite
// coordinates that are wrong by any amount. The game does not trust the flag
// either: its nameplates, its chat bubbles and its click picking all run
// `isProjectedNameplateAnchorVisible` first, which is a camera-space z test, and
// the loader reproduces it here. The reproducing case is a first-person or close
// mount camera putting your own head behind the near plane, which is where the
// anchor kit used to place an element in the middle of the screen.

import type { WorldPoint } from './anchor-point.ts';

/** A 4x4 matrix, as three lays it out: COLUMN-MAJOR, so (row, column) is `column * 4 + row`. */
const MATRIX_SIDE = 4;
const MATRIX_LENGTH = MATRIX_SIDE * MATRIX_SIDE;

/** The rows of the view matrix this file reads: camera-space z, and the divisor. */
const Z_ROW = 2;
const W_ROW = 3;

/** Which column an axis is in, so a row's dot product reads as one. */
const COLUMN_X = 0;
const COLUMN_Y = 1;
const COLUMN_Z = 2;
const COLUMN_TRANSLATION = 3;

/**
 * The near plane assumed when the camera does not carry one.
 *
 * Zero degrades the guard to "in front of the camera at all", which is still the
 * half of the test the raw flag reports, rather than refusing to project.
 */
const NO_NEAR_PLANE = 0;

/** Where a world point lands, in the loader root's own coordinates. */
interface ScreenPoint {
  x: number;
  y: number;
  /** Yards from the camera, along the direction it is looking. */
  depth: number;
  /**
   * True when x and y are MEANINGLESS: behind the camera, or nearer than the
   * near plane.
   *
   * The second case is the one the raw projection does not report and the game
   * itself guards against. `isProjectedNameplateAnchorVisible` is what its
   * nameplates, its chat bubbles and its click picking all consult before
   * trusting a projection, because a point between the camera and the near plane
   * projects to finite coordinates that are wrong by any amount. The game's own
   * comment about the click pick says it plainly: such a point "could steal an
   * unrelated click", and the reproducing case is a close or first-person camera
   * putting your own head behind the near plane.
   */
  behind: boolean;
}

/** Projects a world point, or answers null when the game cannot be asked. */
type Projector = (x: number, y: number, z: number) => ScreenPoint | null;

/** The renderer's shape, as this project claims it to be. See world/game-types.ts. */
interface GameRenderer {
  worldToScreen?: (x: number, y: number, z: number) => unknown;
  camera?: { near?: unknown; matrixWorldInverse?: { elements?: unknown } };
}

/**
 * One row of the matrix applied to a point, as `Vector3.applyMatrix4` does it.
 *
 * A missing element is a NaN rather than an assertion: the LENGTH was checked, but
 * the array is the game's and a hole in it would otherwise be something the
 * compiler believes. It propagates into the finite check below, which is where
 * every other unreadable answer in this file ends up too.
 */
function rowDot(m: ArrayLike<number>, row: number, p: WorldPoint): number {
  const el = (column: number): number => m[column * MATRIX_SIDE + row] ?? Number.NaN;
  return el(COLUMN_X) * p.x + el(COLUMN_Y) * p.y + el(COLUMN_Z) * p.z + el(COLUMN_TRANSLATION);
}

/** The camera's matrix, if it is sixteen numbers. */
function matrixOf(renderer: GameRenderer): ArrayLike<number> | null {
  const elements = renderer.camera?.matrixWorldInverse?.elements;
  if (!(ArrayBuffer.isView(elements) || Array.isArray(elements))) {
    return null;
  }
  const matrix = elements as unknown as ArrayLike<number>;
  if (matrix.length < MATRIX_LENGTH) {
    return null;
  }
  return matrix;
}

/**
 * How far in front of the camera a point is, or null when it cannot be read.
 *
 * The game's own near-plane guard, in arithmetic rather than in three: three is
 * not a loader dependency and never will be, so there is no Vector3 here to apply
 * a matrix with. Divided by w rather than assuming an affine matrix, so this is
 * what `Vector3.applyMatrix4` DOES rather than a simplification of it that a
 * future camera could invalidate. The camera looks down its own -z, so a point in
 * front of it has a negative z there and the distance is that magnitude.
 */
function cameraDepth(renderer: GameRenderer, p: WorldPoint): number | null {
  const m = matrixOf(renderer);
  if (m === null) {
    return null;
  }
  const w = rowDot(m, W_ROW, p);
  if (w === 0) {
    return null;
  }
  const cameraSpaceZ = rowDot(m, Z_ROW, p) / w;
  if (!Number.isFinite(cameraSpaceZ)) {
    return null;
  }
  return -cameraSpaceZ;
}

/** The near plane, or zero when the camera did not say. */
function nearOf(renderer: GameRenderer): number {
  const near = renderer.camera?.near;
  if (typeof near !== 'number' || !Number.isFinite(near)) {
    return NO_NEAR_PLANE;
  }
  return near;
}

/**
 * The projected point with the near-plane guard applied, or the point as it is.
 *
 * A camera the loader cannot read falls back to the raw flag, which is what this
 * file did before the guard existed. A guard that turned every anchor off because
 * the camera moved on a game update would be worse than a slightly over-trusting
 * one.
 */
function guarded(renderer: GameRenderer, point: ScreenPoint, p: WorldPoint): ScreenPoint {
  const depth = cameraDepth(renderer, p);
  if (depth === null) {
    return point;
  }
  return { ...point, depth, behind: point.behind || depth <= nearOf(renderer) };
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
  // `depth` is not on the renderer's answer at all: it is the guard's, and
  // `guarded` fills it in. Zero here rather than optional, so the shape is
  // complete at every return and no consumer has to test for a missing field.
  return { x: x as number, y: y as number, depth: 0, behind: behind === true };
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
      const point = asPoint(renderer.worldToScreen(x, y, z));
      if (point === null) {
        return null;
      }
      return guarded(renderer, point, { x, y, z });
    } catch {
      // A future update can leave something callable in place that throws when
      // called. The cost of that has to be a hidden anchor, not a dead frame loop.
      return null;
    }
  };
}

export type { Projector, ScreenPoint };
export { createProjector };
