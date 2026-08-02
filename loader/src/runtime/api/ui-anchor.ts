// The world-anchored half of woc.ui: an element kept over a point, and the same
// point with no element at all.
//
// Split out of api/ui.ts on the axis the published types split on, so the loader
// mirror and packages/types/ui-anchor.d.ts stay legible against each other. Both
// members here are the same read: `anchor3d` asks the loader to KEEP something
// over a point, `project` asks where a point is right now and leaves the drawing
// to the addon.

import type { Anchor3d, Anchor3dOpts, PointSource } from '../ui/kit/anchor3d.ts';
import type { UnitPoint, WorldPoint } from '../world/anchor-point.ts';
import type { UiDeps } from './ui.ts';

/** A screen position as an addon reads it. `depth` is yards from the camera. */
interface ScreenPosition {
  x: number;
  y: number;
  depth: number;
}

/** A unit through the same resolver `ui.anchor3d` uses, or the point as given. */
function worldPointOf(deps: UiDeps, at: WorldPoint | UnitPoint): WorldPoint | null {
  if ('unit' in at) {
    return deps.kit.unitPoint(at);
  }
  return at;
}

/**
 * Where a point is on screen, or null when it must not be drawn.
 *
 * The null is the whole safety of this call, and it is why the surface publishes
 * no `onScreen` flag: a flag is a thing an addon can forget to read, and
 * forgetting it is precisely the mistake. A point nearer than the camera's near
 * plane projects to coordinates that are finite and wrong by any amount, which is
 * what the game's own nameplates, chat bubbles and click picking all guard
 * against before trusting a projection. A null cannot be ignored without a type
 * error and a throw on the first line that reads `.x`.
 *
 * The VIEWPORT RECTANGLE is deliberately not tested. An off-screen point in front
 * of the camera still projects, which is what an arrow pointing off the edge of
 * the screen at an off-screen unit is built from; turning that into a null would
 * remove a feature to save an addon one comparison.
 */
function projected(deps: UiDeps, at: WorldPoint | UnitPoint): ScreenPosition | null {
  const world = worldPointOf(deps, at);
  if (world === null) {
    return null;
  }
  const point = deps.kit.project(world.x, world.y, world.z);
  if (point === null || point.behind) {
    return null;
  }
  return { x: point.x, y: point.y, depth: point.depth };
}

/**
 * An anchor whose removal is in the bag.
 *
 * The bag holds the removal rather than a listener: an anchor left behind would go
 * on being positioned by the shared frame loop, over a world its addon has stopped
 * reading. It is the one leak here that costs a frame callback for the session.
 */
function addonAnchor(deps: UiDeps, at: PointSource, opts: Anchor3dOpts | undefined): Anchor3d {
  const anchor = deps.kit.anchors.add(at, opts);
  deps.bag.add(anchor.destroy);
  return anchor;
}

export type { ScreenPosition };
export { addonAnchor, projected };
