// How big a frame opens, what it may be dragged to, and which of the two axes
// anything writes at all.
//
// Split out of kit/frame.ts on the same seam frame-chrome.ts was: that file owns
// the frame's LIFECYCLE, which is the visibility, the saved box, the subscriptions
// and the teardown, and this one answers size questions from options and never
// touches the document twice. The prompt was the file limit and the seam is real,
// because every rule here is pure arithmetic over what the addon asked for.

import type { SizeAxes, SizeBounds, Viewport } from '../frame/geometry.ts';
import type { FrameChrome, FrameOpts } from './frame-chrome.ts';

/** What a frame with no width of its own opens at. */
const DEFAULT_FRAME_WIDTH = 240;
const DEFAULT_FRAME_HEIGHT = 120;
const DEFAULT_WINDOW_WIDTH = 480;
const DEFAULT_WINDOW_HEIGHT = 320;

function defaultSize(chrome: FrameChrome, opts: FrameOpts): Viewport {
  if (chrome === 'window') {
    return { w: opts.width ?? DEFAULT_WINDOW_WIDTH, h: opts.height ?? DEFAULT_WINDOW_HEIGHT };
  }
  return { w: opts.width ?? DEFAULT_FRAME_WIDTH, h: opts.height ?? DEFAULT_FRAME_HEIGHT };
}

/**
 * What the addon said the frame may be sized between.
 *
 * The minimum falls back to the OPENING SIZE, which is the behaviour every frame
 * had before there was an option, and it is worth naming because it surprises
 * people: a frame created at 400 wide could not then be dragged narrower than
 * 400. The alternative fallback is the structural floor, and it was rejected as a
 * default rather than as an idea. Changing it would silently let the player shrink
 * every frame of every already-published addon down to 72 by 28, including the
 * ones whose layout stops making sense well before that, and an addon that wants
 * the floor can now say so. So the surprise stays, and `minWidth` is the way out
 * of it rather than a new default nobody asked for.
 *
 * Both are absent rather than undefined when unset: exactOptionalPropertyTypes,
 * and clampSize reads an absent maximum as the viewport.
 */
function sizeBounds(opts: FrameOpts, size: Viewport): SizeBounds {
  const bounds: SizeBounds = {
    min: { w: opts.minWidth ?? size.w, h: opts.minHeight ?? size.h },
  };
  if (opts.maxWidth !== undefined || opts.maxHeight !== undefined) {
    bounds.max = {
      w: opts.maxWidth ?? Number.POSITIVE_INFINITY,
      h: opts.maxHeight ?? Number.POSITIVE_INFINITY,
    };
  }
  return bounds;
}

/**
 * Which axes the player may resize, and therefore which the box owns.
 *
 * `true` and `false` mean what they always did. A single axis is for the shape a HUD
 * list actually has: the row count is a setting, so an owned height could only clip
 * the rows or leave a gap under them, while the width is a column of names and
 * figures the player may well want wider.
 *
 * Anything unrecognised falls back to NOT resizable rather than to both. That is the
 * same direction the density and pointer fallbacks take, and here it is the cheaper
 * failure: a frame that owns an axis it should not clips its own content, where one
 * that owns neither is the frame every addon had before it asked.
 */
function resizeAxes(opts: FrameOpts, chrome: FrameChrome): SizeAxes {
  const asked = opts.resizable ?? chrome === 'window';
  if (asked === 'width') {
    return { w: true, h: false };
  }
  if (asked === 'height') {
    return { w: false, h: true };
  }
  return { w: asked === true, h: asked === true };
}

/**
 * Write the WIDTH of a frame whose box does not own it. One that does is given its box by
 * `frame/interactive.ts` and never arrives here.
 *
 * Shrink-to-fit sizes an element by its content in both directions, and both are wrong: with
 * no ceiling the panel is as wide as its longest unbreakable line, and without a floor the
 * width MOVES as the content changes, stepping the panel in and out while it is being read.
 * Written whether or not the addon named a width, since an addon that never considered its
 * width is exactly the one whose panel would otherwise move.
 *
 * No equivalent for the HEIGHT, deliberately: a bounded frame clips rather than grows, and
 * nothing on screen says a row is below the fold. Ask to be resizable and state bounds instead.
 */
function applyWidth(el: HTMLElement, size: Viewport, axes: SizeAxes): void {
  if (!axes.w) {
    el.style.width = `${String(size.w)}px`;
  }
}

export { applyWidth, DEFAULT_FRAME_WIDTH, defaultSize, resizeAxes, sizeBounds };
