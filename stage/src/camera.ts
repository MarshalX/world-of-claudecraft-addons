// The camera a stage scenario is photographed through, for addons that draw in the
// WORLD (a nameplate, a ground ring, a pin) and so put nothing in a frame.
//
// It fakes the game's RENDERER, not the answers: `runtime/world/anchor-point.ts` and
// `runtime/world/project.ts` run their own arithmetic on top of it. Stubbing their
// answers would photograph a stage that agrees only with itself.
//
// The eye sits over the player's shoulder, six yards back and three and a half up,
// looking down world -z, so it follows a scenario that moves the player. It never
// turns, so repeated captures stay identical.
//
// EVERY ENTITY HAS A VIEW. To hide a plate, put the unit out of the camera's reach;
// a view map a scenario had to fill would fail as an anchor that silently never shows.

import {
  createUnitPoints,
  type UnitPointResolver,
} from '../../loader/src/runtime/world/anchor-point.ts';
import type { Entity } from '../../loader/src/runtime/world/game-types.ts';
import { createProjector, type Projector } from '../../loader/src/runtime/world/project.ts';
import type { UnitContext } from '../../loader/src/runtime/world/units.ts';

/** Where the camera stands relative to the player, in yards. */
const CAMERA_UP = 3.5;
const CAMERA_BACK = 6;

/** The near plane, in yards. The game's own is a fraction of a yard. */
const NEAR = 0.1;

/** A 60 degree vertical field of view, as the tangent of its half. */
const SIXTH_TURN = 6;
const HALF_FOV_TAN = Math.tan(Math.PI / SIXTH_TURN);

const HALF = 2;

/** The rotation columns of a 4x4 identity, column-major as three lays it out. */
const IDENTITY_COLUMNS = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

/** How tall the game is drawing a unit whose scenario did not say, in yards. */
const DEFAULT_HEIGHT = 2;
const NO_LIFT = 0;
const UNSCALED = 1;

/** Fields with no declared shape, exactly as `stage.ts` writes them. */
type Fake = Record<string, unknown>;

/** What the renderer says about one unit it is drawing. See world/anchor-point.ts. */
interface ModelView {
  height: number;
  mountLift: number;
  liveScale: number;
  group: { visible: boolean; position: unknown };
}

/** How the game is drawing one unit, as a scenario states it. */
interface ModelSpec {
  /** The model's own height in yards. A plate clears this. */
  height?: number;
  /** What a mount adds under it. */
  mountLift?: number;
  /** The scale the renderer applied. */
  scale?: number;
}

interface CameraDeps {
  entities: Map<number, Fake>;
  player: Fake;
  /** The screen the picture is taken on, so the centre of the view is the centre. */
  viewport: () => { w: number; h: number };
}

interface StageCamera {
  /** The `renderer` half of the fake `__game`, for the loader to read. */
  renderer: unknown;
  project: Projector;
  unitPoint: UnitPointResolver;
  /** State how the game is drawing one unit. Anything unstated keeps its default. */
  model: (id: number, spec: ModelSpec) => void;
}

/** Reads through a variable: Biome wants a literal key, TypeScript forbids the dot. */
function field(target: Fake, name: string): unknown {
  return target[name];
}

/** One axis the scenario wrote, or zero when it wrote something unreadable. */
function axisOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

/** A point the scenario wrote, or the origin when it wrote something unreadable. */
function pointOf(value: unknown): { x: number; y: number; z: number } {
  const { x, y, z } = (value ?? {}) as { x?: unknown; y?: unknown; z?: unknown };
  return { x: axisOf(x), y: axisOf(y), z: axisOf(z) };
}

/** Where the eye is right now: over the player's shoulder, read per projection. */
function eye(deps: CameraDeps): { x: number; y: number; z: number } {
  const at = pointOf(field(deps.player, 'pos'));
  return { x: at.x, y: at.y + CAMERA_UP, z: at.z + CAMERA_BACK };
}

/** The view matrix: no rotation, so camera space is world space moved to the eye. */
function viewMatrix(deps: CameraDeps): number[] {
  const at = eye(deps);
  return [...IDENTITY_COLUMNS, -at.x, -at.y, -at.z, 1];
}

/**
 * Where a world point lands, in the shape the game's renderer answers in. No
 * `depth`: the renderer reports none, and `world/project.ts` derives it from the
 * camera matrix.
 */
function screenPoint(deps: CameraDeps, x: number, y: number, z: number): unknown {
  const at = eye(deps);
  const depth = at.z - z;
  if (depth <= NEAR) {
    return { x: 0, y: 0, behind: true };
  }
  const view = deps.viewport();
  const focal = view.h / HALF / HALF_FOV_TAN;
  return {
    x: view.w / HALF + ((x - at.x) * focal) / depth,
    y: view.h / HALF - ((y - at.y) * focal) / depth,
    behind: false,
  };
}

function viewFor(entity: Fake, spec: ModelSpec | undefined): ModelView {
  return {
    height: spec?.height ?? DEFAULT_HEIGHT,
    mountLift: spec?.mountLift ?? NO_LIFT,
    liveScale: spec?.scale ?? UNSCALED,
    // The entity's own position object rather than a copy, so a unit a scenario
    // walks somewhere takes its plate with it.
    group: { visible: true, position: field(entity, 'pos') },
  };
}

/** Runs on every read of the game, since a scenario adds units after mount. */
function syncViews(
  deps: CameraDeps,
  views: Map<number, ModelView>,
  specs: Map<number, ModelSpec>,
): void {
  for (const [id, entity] of deps.entities) {
    const held = views.get(id);
    if (held === undefined) {
      views.set(id, viewFor(entity, specs.get(id)));
    }
  }
  for (const id of [...views.keys()]) {
    if (!deps.entities.has(id)) {
      views.delete(id);
    }
  }
}

/** Whatever the player has selected, which a unit token may be resolved through. */
function targetOf(deps: CameraDeps, entities: ReadonlyMap<number, Entity>): Entity | null {
  const targetId = field(deps.player, 'targetId');
  if (typeof targetId !== 'number') {
    return null;
  }
  return entities.get(targetId) ?? null;
}

/** The unit context the loader resolves a token through. */
function contextOf(deps: CameraDeps): UnitContext {
  const entities = deps.entities as unknown as ReadonlyMap<number, Entity>;
  return {
    player: deps.player as unknown as Entity,
    target: targetOf(deps, entities),
    entities,
    party: null,
  };
}

function createStageCamera(deps: CameraDeps): StageCamera {
  const views = new Map<number, ModelView>();
  const specs = new Map<number, ModelSpec>();
  const renderer = {
    views,
    worldToScreen: (x: number, y: number, z: number): unknown => screenPoint(deps, x, y, z),
    // A getter, because the eye follows the player after a scenario moves them.
    camera: {
      near: NEAR,
      matrixWorldInverse: {
        get elements(): number[] {
          return viewMatrix(deps);
        },
      },
    },
  };
  const game = (): unknown => {
    syncViews(deps, views, specs);
    return { renderer };
  };

  return {
    renderer,
    project: createProjector(game),
    unitPoint: createUnitPoints({ game, context: () => contextOf(deps) }),
    model: (id, spec) => {
      specs.set(id, spec);
      views.delete(id);
    },
  };
}

export type { ModelSpec, StageCamera };
export { createStageCamera };
