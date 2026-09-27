// A unit's world point: at its feet, or over its head.
//
// The head point is not a constant offset: like the game's nameplates it reads the RENDERER's
// view of the unit, `(height + mountLift) * scale` plus a yard of clearance. Model height is not
// on the wire, so a guessed offset is wrong per model.
//
// Anything unreadable is null, which hides the anchor; a NaN reaching a style is dropped
// silently. No view means no head point, as the game draws no plate for a unit it is not drawing.

import type { Entity } from './game-types.ts';
import type { UnitContext, UnitToken } from './units.ts';
import { resolveUnit } from './units.ts';

/** The clearance the game adds over every overhead anchor, in yards. */
const HEAD_CLEARANCE_YARDS = 1;

/** No lift when the field is absent: a dismounted unit carries none. */
const NO_LIFT = 0;

/** The scale the renderer applied, when it did not say. */
const UNSCALED = 1;

interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** A unit to anchor to, resolved every frame. */
interface UnitPoint {
  /** A unit token like 'target', or an entity id. */
  unit: UnitToken | number;
  /** Defaults to 'head', which is where the game puts its own nameplate. */
  over?: 'head' | 'body';
}

type UnitPointResolver = (at: UnitPoint) => WorldPoint | null;

interface UnitPointDeps {
  /** The live `__game`, read per call: it does not exist before world entry. */
  game: () => unknown;
  /** The same context `world.unit` resolves through. See world/unit-context.ts. */
  context: () => UnitContext;
}

/** The renderer's per-entity view, as this project claims it to be. */
interface GameView {
  height?: unknown;
  mountLift?: unknown;
  liveScale?: unknown;
  group?: { visible?: unknown; position?: unknown };
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

/**
 * A number, its default when the field is ABSENT, or null when it is present and nonsense. An
 * absent field must not hide every anchor after a game update.
 */
function optionalNumber(value: unknown, fallback: number): number | null {
  if (value === undefined) {
    return fallback;
  }
  return asNumber(value);
}

function asPoint(value: unknown): WorldPoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { x, y, z } = value as { x?: unknown; y?: unknown; z?: unknown };
  const px = asNumber(x);
  const py = asNumber(y);
  const pz = asNumber(z);
  if (px === null || py === null || pz === null) {
    return null;
  }
  return { x: px, y: py, z: pz };
}

/** One entity's view, or null when the game is not drawing it. */
function viewOf(game: unknown, id: number): GameView | null {
  if (typeof game !== 'object' || game === null) {
    return null;
  }
  const { renderer } = game as { renderer?: { views?: unknown } };
  const views = renderer?.views;
  if (!(views instanceof Map)) {
    return null;
  }
  try {
    const view: unknown = views.get(id);
    if (typeof view !== 'object' || view === null) {
      return null;
    }
    return view as GameView;
  } catch {
    // A game member can stay Map-shaped and throw; that must cost an anchor, not the frame.
    return null;
  }
}

/**
 * Where the rig is, falling back to the entity when the game is not drawing it. Past the draw
 * range a view's `group` stops updating, so check `group.visible` first, as the game does.
 */
function basePoint(view: GameView, entity: Entity): WorldPoint | null {
  if (view.group?.visible === true) {
    const placed = asPoint(view.group.position);
    if (placed !== null) {
      return placed;
    }
  }
  return asPoint(entity.pos);
}

/** The game's own formula: `y + (height + mountLift) * scale + 1`. */
function headPoint(view: GameView, entity: Entity): WorldPoint | null {
  const base = basePoint(view, entity);
  const height = asNumber(view.height);
  const lift = optionalNumber(view.mountLift, NO_LIFT);
  // The scale the renderer applied; the entity's own scale is not published.
  const scale = optionalNumber(view.liveScale, UNSCALED);
  if (base === null || height === null || lift === null || scale === null) {
    return null;
  }
  const y = base.y + (height + lift) * scale + HEAD_CLEARANCE_YARDS;
  if (!Number.isFinite(y)) {
    return null;
  }
  return { x: base.x, y, z: base.z };
}

/** A token through the shared resolver, or a bare entity id through the map. */
function entityOf(at: UnitPoint, ctx: UnitContext): Entity | null {
  if (typeof at.unit === 'number') {
    return ctx.entities.get(at.unit) ?? null;
  }
  return resolveUnit(at.unit, ctx);
}

function createUnitPoints(deps: UnitPointDeps): UnitPointResolver {
  return (at) => {
    const entity = entityOf(at, deps.context());
    if (entity === null) {
      return null;
    }
    if (at.over === 'body') {
      return asPoint(entity.pos);
    }
    const view = viewOf(deps.game(), entity.id);
    if (view === null) {
      return null;
    }
    return headPoint(view, entity);
  };
}

export type { UnitPoint, UnitPointDeps, UnitPointResolver, WorldPoint };
export { createUnitPoints, HEAD_CLEARANCE_YARDS };
