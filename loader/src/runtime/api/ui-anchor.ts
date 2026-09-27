// The world-anchored half of woc.ui, mirroring packages/types/ui-anchor.d.ts: `anchor3d` keeps an
// element over a point, `project` says where a point is and leaves the drawing to the addon.

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
 * Null when the point must not be drawn: a point behind the camera projects to finite, wrong
 * coordinates. A null, not an `onScreen` flag, because a flag can be forgotten.
 *
 * The viewport rectangle is deliberately NOT tested: an off-screen point still projects, which is
 * what an edge arrow is built from.
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

/** Bagged, or a leftover anchor keeps costing the shared frame loop for the session. */
function addonAnchor(deps: UiDeps, at: PointSource, opts: Anchor3dOpts | undefined): Anchor3d {
  const anchor = deps.kit.anchors.add(at, opts);
  deps.bag.add(anchor.destroy);
  return anchor;
}

export type { ScreenPosition };
export { addonAnchor, projected };
