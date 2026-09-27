// Turning a world point into a point on screen, through the game's RENDERER.
//
// `worldToScreen` answers viewport pixels from the canvas's top left, which are already the
// loader root's coordinates. Do NOT divide by the UI scale as the game's combat text does: that
// text lives inside the zoomed `#ui`, and the loader's root is an unscaled sibling of it.
//
// A failed projection is null, so the anchor is hidden rather than parked at the corner.
//
// The renderer's `behind` flag misses a point between the camera and the near plane, which
// projects to finite, wrong coordinates (a close or first-person camera and your own head). The
// game guards with `isProjectedNameplateAnchorVisible`, a camera-space z test, reproduced here.

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
 * The near plane assumed when the camera does not carry one: the guard degrades to "in front of
 * the camera at all" rather than refusing to project.
 */
const NO_NEAR_PLANE = 0;

/** Where a world point lands, in the loader root's own coordinates. */
interface ScreenPoint {
  x: number;
  y: number;
  /** Yards from the camera, along the direction it is looking. */
  depth: number;
  /** True when x and y are MEANINGLESS: behind the camera, or nearer than the near plane. */
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
 * One row of the matrix applied to a point, as `Vector3.applyMatrix4` does it. A missing element
 * is NaN, which the finite check in `cameraDepth` catches.
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
 * How far in front of the camera a point is, or null when it cannot be read. Plain arithmetic,
 * since three is not a dependency; divided by w rather than assuming an affine matrix. The
 * camera looks down -z, so the distance is the negated camera-space z.
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
 * The projected point with the near-plane guard applied. An unreadable camera falls back to the
 * raw flag, rather than hiding every anchor after a game update.
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
 * The answer, if it is one. Checked because a NaN reaching a style property is dropped silently.
 */
function asPoint(value: unknown): ScreenPoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { x, y, behind } = value as { x?: unknown; y?: unknown; behind?: unknown };
  if (!(Number.isFinite(x) && Number.isFinite(y))) {
    return null;
  }
  // The renderer does not answer `depth`; `guarded` fills it in when it can read the camera.
  return { x: x as number, y: y as number, depth: 0, behind: behind === true };
}

/**
 * A projector over the live game object, read on every call: `__game` is assigned only at world
 * entry.
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
      // A game member can stay callable and throw; that must cost an anchor, not the frame loop.
      return null;
    }
  };
}

export type { Projector, ScreenPoint };
export { createProjector };
