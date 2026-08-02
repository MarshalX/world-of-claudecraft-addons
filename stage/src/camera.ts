// The camera a stage scenario is photographed through.
//
// An addon that draws in the WORLD (a nameplate, a ground ring, a pin over a node)
// puts nothing in a frame, so without a camera there is nothing to photograph: the
// suites' shared fake resolves no unit at all and answers one constant screen point
// for every world point, which is deliberate there and useless here.
//
// It is a fake RENDERER rather than a pair of stub functions, and that is the whole
// design. `runtime/world/anchor-point.ts` and `runtime/world/project.ts` are the two
// modules that turn a unit into a place on screen, and both of them read the game's
// renderer: the per-entity view for the model height, the mount lift and the scale,
// and the camera matrix for the near-plane guard. Stubbing their ANSWERS would mean a
// picture of a stage that agrees with itself and nothing else, which is the same
// mistake as reimplementing a frame here. So the stage supplies what the game supplies
// and the loader's own arithmetic runs on top of it.
//
// The camera sits over the PLAYER's own shoulder, six yards back and three and a half
// up, looking straight down world -z. Over the player rather than at a fixed world
// point because a scenario states where its units are relative to the player it is
// about, and a fixed eye would put the whole picture off screen for any scenario that
// moved the player. It does not turn: nothing here is animated, and a preview that
// moved between captures would produce a diff on every `pnpm shots`.
//
// EVERY ENTITY HAS A VIEW, because the stage is drawing all of them. In a real session
// a missing view means the game is not drawing that unit, which is what makes a plate
// hide past about eighty yards; that state is reachable here by putting a unit out of
// the camera's reach rather than by leaving its view out, and the alternative (a view
// map a scenario has to remember to fill) would fail as an anchor that silently never
// appears.

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

/** Two, named, because a half of something is not a magic number. */
const HALF = 2;

/** A 4x4 identity, column-major, which is the layout three lays a matrix out in. */
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

/**
 * One field off a shapeless fake.
 *
 * A helper for the reason STYLE.md gives: Biome wants a literal key and TypeScript
 * forbids dotting into an index signature, so the read goes through a variable.
 */
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
 * Where a world point lands, in the shape the game's own renderer answers in.
 *
 * `depth` is not on this answer and must not be: the renderer does not report one,
 * and `world/project.ts` derives it from the camera matrix. Two sources for it here
 * would be two chances to disagree about how far away something is.
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

/**
 * Bring the view map in line with the entity map.
 *
 * Run on every read of the game rather than at mount, because a scenario adds units
 * after the addon is up and an anchor asks per frame. It is a handful of entities and
 * a Map write only when one arrives or leaves.
 */
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

/** The unit context the loader resolves a token through. Only entities matter here. */
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
    // The elements are read per projection rather than built once, because the eye
    // follows the player and a matrix captured at mount would answer for wherever
    // the player was standing before the scenario moved them.
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
