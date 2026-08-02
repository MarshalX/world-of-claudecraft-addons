// The five shared surfaces that put an element on screen, and the band each goes in.
//
// Split out of ui/mount.ts because the band choice is one decision made five
// times and is the only thing these five have in common: what is left in mount.ts
// is the manager, the loader's own routes into it, and the registries, none of
// which draw anything and none of which have a band. See ui/root.ts for why there
// are two of those and what decides which one a thing belongs in.
//
// One of each for the whole loader, never one per addon. `api/ui.ts` is a
// per-addon binding over these, and what it adds is the disposal bag rather than
// a second copy: two toast stacks would be two columns of toasts, and two tooltip
// elements would leave one of them on screen whenever the other took over.

import type { FrameLoop } from '../frame-loop.ts';
import type { UnitPointResolver } from '../world/anchor-point.ts';
import type { Projector } from '../world/project.ts';
import { type Anchors, createAnchors } from './kit/anchor3d.ts';
import { type Banner, createBanner } from './kit/banner.ts';
import { createMenus, type Menus } from './kit/menu.ts';
import { createToaster, type Toaster } from './kit/toast.ts';
import { createTooltips, type Tooltips } from './kit/tooltip.ts';
import type { AddonRoot } from './root.ts';

interface Surfaces {
  toaster: Toaster;
  /** The one centre-screen warning slot. Shared for the reason toasts are. */
  banner: Banner;
  tooltips: Tooltips;
  /** The one open context menu. Shared for the reason the banner slot is. */
  menus: Menus;
  /**
   * Elements kept over world points. Shared because they share one frame loop:
   * ten anchors are one callback, not ten.
   */
  anchors: Anchors;
}

interface SurfaceDeps {
  doc: Document;
  viewport: () => { w: number; h: number };
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  frames: FrameLoop;
  project: Projector;
  unitPoint: UnitPointResolver;
}

function buildSurfaces(deps: SurfaceDeps, root: AddonRoot): Surfaces {
  const timers = { setTimer: deps.setTimer, clearTimer: deps.clearTimer };
  return {
    toaster: createToaster({ doc: deps.doc, root: root.overlay, ...timers }),
    banner: createBanner({ doc: deps.doc, root: root.overlay, ...timers }),
    // Two elements, deliberately: the tip is drawn in the overlay band so it is
    // over every frame, and the watcher covers the whole root, since the anchor it
    // is watching is an addon's own row, down in the hud band.
    tooltips: createTooltips({
      doc: deps.doc,
      root: root.el,
      layer: root.overlay,
      viewport: deps.viewport,
    }),
    menus: createMenus({ doc: deps.doc, root: root.overlay, viewport: deps.viewport }),
    // The hud band, because a world anchor is a label over a mob rather than
    // something the player opened: it belongs under the game's own windows for the
    // same reason an addon frame does.
    anchors: createAnchors({
      doc: deps.doc,
      root: root.hud,
      project: deps.project,
      unitPoint: deps.unitPoint,
      viewport: deps.viewport,
      frames: deps.frames,
    }),
  };
}

export type { SurfaceDeps, Surfaces };
export { buildSurfaces };
