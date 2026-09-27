// How big a frame opens, what it may be dragged to, and which of the two axes anything
// writes at all. Pure arithmetic over the options; kit/frame.ts owns the lifecycle.

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
 * The minimum falls back to the OPENING SIZE, so a frame opened 400 wide cannot be dragged
 * narrower. Do not lower the default to the structural floor: published addons would become
 * shrinkable to 72 by 28, past where their layouts work. `minWidth` is the opt-in.
 *
 * An unset maximum stays absent, which clampSize reads as the viewport.
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
 * Which axes the player may resize, and therefore which the box owns. A single axis suits a
 * list whose row count is a setting: an owned height could only clip rows or leave a gap.
 * Anything unrecognised falls back to NOT resizable, since owning a wrong axis clips content.
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
 * Write the WIDTH of a frame whose box does not own it (`frame/interactive.ts` handles the
 * rest). A shrink-to-fit width moves as content reflows, and a `max-width` alone does not stop
 * that, so it is written even when the addon named no width.
 *
 * No equivalent for the HEIGHT: a bounded frame clips silently rather than growing.
 */
function applyWidth(el: HTMLElement, size: Viewport, axes: SizeAxes): void {
  if (!axes.w) {
    el.style.width = `${String(size.w)}px`;
  }
}

export { applyWidth, DEFAULT_FRAME_WIDTH, defaultSize, resizeAxes, sizeBounds };
