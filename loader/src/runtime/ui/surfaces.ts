// The five shared surfaces that put an element on screen, and the band each goes in (see
// ui/root.ts). One of each for the whole loader; `api/ui.ts` wraps them per addon in a
// disposal bag, never a second copy.

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
  /** The one centre-screen warning slot. */
  banner: Banner;
  tooltips: Tooltips;
  /** The one open context menu. */
  menus: Menus;
  /** Elements kept over world points, all on one frame-loop callback. */
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
    // The tip draws in the overlay band; the watcher covers the whole root, since anchors are
    // addon rows in the hud band.
    tooltips: createTooltips({
      doc: deps.doc,
      root: root.el,
      layer: root.overlay,
      viewport: deps.viewport,
    }),
    menus: createMenus({ doc: deps.doc, root: root.overlay, viewport: deps.viewport }),
    // The hud band: a label over a mob is HUD furniture, not something the player opened.
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
