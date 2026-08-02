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
 * The same tokens `world.unit` takes, plus a bare entity id out of
 * `world.entities`. Resolution happens per frame, so a unit that dies, walks out
 * of range or has its model culled hides the anchor with no code of yours.
 */
export interface UnitPoint {
  /** A unit token like 'target', or an entity id from `world.entities`. */
  unit: UnitToken | number;
  /**
   * Where on the unit. Defaults to 'head'.
   *
   * **'head'** is the point the game's own nameplate uses, and it is above the
   * MODEL rather than a fixed distance above the feet: the loader reads that
   * unit's model height, its mount lift and the scale the renderer actually
   * applied, so a plate over a boar and a plate over a dragon each clear the model
   * instead of sitting inside one of them. Nothing on the wire carries a model
   * height, so this is not a number you can work out yourself.
   *
   * It resolves to nothing for a unit the game is not currently drawing a model
   * for, which is anything past about 80 yards, and the anchor hides exactly where
   * the game would draw no nameplate.
   *
   * **'body'** is the unit's own position, at its feet, and keeps working at any
   * distance. Reach for it for a ground marker under a unit.
   */
  over?: 'head' | 'body';
}

/**
 * A fixed point, a unit, or a function asked for one on every frame.
 *
 * The function form is what anything that MOVES needs: pass `() => entity.pos` and
 * the anchor follows it without your addon running a loop of its own. Returning
 * null hides the anchor, which is the honest answer for a unit that has gone.
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
   * Not zero, because your element is CENTRED on the point: one whose point has
   * just left the edge is still half on screen, and hiding it there makes a
   * nameplate blink out while the unit wearing it is still visible.
   */
  margin?: number;
}

export interface Anchor3d {
  /** The element. Fill it; the loader owns only where it sits. */
  readonly el: HTMLElement;
  /** Whether it is on screen right now, which is worth checking before drawing. */
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
   * Sort by this to decide which of two overlapping markers draws on top, and to
   * fade one that is far away. It is a real distance, so comparing it against a
   * range in yards is meaningful.
   */
  depth: number;
}
