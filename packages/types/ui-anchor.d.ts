import type { UnitToken } from './world.js';

/** A point in the world: x east-west, y height, z north-south, in yards. */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A unit to follow, resolved every frame. Since apiMinor 2.
 *
 * The same tokens `world.unit` takes, plus an entity id from `world.entities`. A
 * unit that dies, walks out of range or has its model culled hides the anchor.
 */
export interface UnitPoint {
  /** A unit token like 'target', or an entity id from `world.entities`. */
  unit: UnitToken | number;
  /**
   * Where on the unit. Defaults to 'head'.
   *
   * **'head'** is the point the game's own nameplate uses, above the rendered
   * MODEL (its height, mount lift and scale), which nothing on the wire lets you
   * compute yourself. It resolves to nothing for a unit the game is not drawing a
   * model for, roughly past 80 yards, so the anchor hides where the game would
   * draw no nameplate.
   *
   * **'body'** is the unit's own position, at its feet, and keeps working at any
   * distance. Use it for a ground marker under a unit.
   */
  over?: 'head' | 'body';
}

/**
 * A fixed point, a unit, or a function asked for one on every frame.
 *
 * The function form is for anything that MOVES: pass `() => entity.pos` and the
 * anchor follows it with no loop of your own. Returning null hides the anchor.
 */
export type PointSource = WorldPoint | UnitPoint | (() => WorldPoint | null);

export interface Anchor3dOpts {
  /** Added to the element, so you can style your own. */
  className?: string;
  /** Shifts the element from the point, in screen pixels. Down is positive. */
  offset?: { x?: number; y?: number };
  /**
   * How far off screen the point may be before the anchor hides. Defaults to 64.
   *
   * Not zero because your element is CENTRED on the point, so it is still half on
   * screen when the point has just left the edge.
   */
  margin?: number;
}

export interface Anchor3d {
  /** The element. Fill it; the loader owns only where it sits. */
  readonly el: HTMLElement;
  /** Whether it is on screen right now. */
  readonly visible: boolean;
  /** Point it somewhere else: a fixed point, a unit, or a function. */
  moveTo: (at: PointSource) => void;
  /** Removes it. Also done for you when your addon is disabled. */
  destroy: () => void;
}

/**
 * Where a world point lands on screen. Since apiMinor 2.
 *
 * Every field is meaningful, or you were handed null instead.
 */
export interface ScreenPoint {
  /** Pixels from the left of the viewport. */
  x: number;
  /** Pixels from the top of the viewport. */
  y: number;
  /**
   * Yards from the camera, along the direction it is looking.
   *
   * A real distance, so it sorts overlapping markers, fades far ones, and
   * compares against a range in yards.
   */
  depth: number;
}
