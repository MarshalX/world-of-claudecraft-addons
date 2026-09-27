// The woc.ui surface, mirroring packages/types/ui.d.ts. A per-addon binding over the one kit
// built in ui/mount.ts: per addon are only the disposal bag and the fqid that namespaces its ids.

import type { DisposalBag, Teardown } from '../disposal.ts';
import type { AlertOpts } from '../ui/kit/alert.ts';
import { openAlert } from '../ui/kit/alert.ts';
import type { Anchor3d, Anchor3dOpts, PointSource } from '../ui/kit/anchor3d.ts';
import type { BannerOpts } from '../ui/kit/banner.ts';
import type { Bar, BarOpts } from '../ui/kit/bar.ts';
import { createBar } from '../ui/kit/bar.ts';
import type { Field, FieldOpts, SelectOpts, SliderOpts, TextOpts } from '../ui/kit/field.ts';
import { createCheckbox, createSelect, createSlider, createText } from '../ui/kit/field.ts';
import type { AddonFrame } from '../ui/kit/frame.ts';
import { createAddonFrame } from '../ui/kit/frame.ts';
import type { FrameOpts } from '../ui/kit/frame-chrome.ts';
import { rostered } from '../ui/kit/frame-roster.ts';
import type { FrameStateStore } from '../ui/kit/frame-state.ts';
import type { FrameToggles } from '../ui/kit/frame-toggle.ts';
import type { IconUrls } from '../ui/kit/icons.ts';
import type { LineOpts, RowOpts, StackOpts } from '../ui/kit/layout.ts';
import type { Destroyable, List, ListOpts } from '../ui/kit/list.ts';
import { createList } from '../ui/kit/list.ts';
import type { MenuItem } from '../ui/kit/menu.ts';
import { moneyText } from '../ui/kit/money.ts';
import type { Tabs, TabsOpts } from '../ui/kit/tabs.ts';
import { createTabs } from '../ui/kit/tabs.ts';
import type { Tile, TileOpts } from '../ui/kit/tile.ts';
import { createTile } from '../ui/kit/tile.ts';
import type { ToastOpts } from '../ui/kit/toast.ts';
import type { TooltipInput } from '../ui/kit/tooltip-content.ts';
import type { UnitOpts } from '../ui/kit/units.ts';
import type { UiKit } from '../ui/mount.ts';
import type { UnitPoint, WorldPoint } from '../world/anchor-point.ts';
import type { ScreenPosition } from './ui-anchor.ts';
import { addonAnchor, projected } from './ui-anchor.ts';
import type { MenuEntryOpts, MicroButtonOpts } from './ui-injections.ts';
import { injectionSurface } from './ui-injections.ts';
import { layoutSurface } from './ui-layout.ts';

/** The controls a settings pane is made of, grouped like `ui.icon`'s builders. */
interface FieldBuilders {
  checkbox: (opts: FieldOpts<boolean>) => Field<boolean>;
  select: (opts: SelectOpts) => Field<string>;
  slider: (opts: SliderOpts) => Field<number>;
  text: (opts: TextOpts) => Field<string>;
}

interface UiApi {
  /** A light, content-sized HUD frame: movable, no close button. */
  frame: (opts: FrameOpts) => AddonFrame;
  /** A panel window: movable, resizable, with a title bar and close button. */
  window: (opts: FrameOpts) => AddonFrame;
  toast: (text: string, opts?: ToastOpts) => Teardown;
  /** A centre-screen warning. One slot for the whole loader; a new one replaces it. */
  banner: (text: string, opts?: BannerOpts) => Teardown;
  /** A timer row: icon, label, fill, and a right-aligned figure. */
  bar: (opts?: BarOpts) => Bar;
  /** The square form of the same thing: art, a radial sweep, a figure and a count. */
  tile: (opts?: TileOpts) => Tile;
  /** A keyed list: rows created, updated, ordered and destroyed as the data moves. */
  list: <T, H extends Destroyable>(opts: ListOpts<T, H>) => List<T, H>;
  /** A flex column, spaced at the density it is drawn in. */
  column: (opts?: StackOpts) => HTMLElement;
  /** The same across: a strip of chips, figures or controls. */
  row: (opts?: RowOpts) => HTMLElement;
  /** A sentence the panel says on its own line. */
  line: (opts?: LineOpts) => HTMLElement;
  /** On screen or not, without an addon having to remember what display it had. */
  show: (el: Element, shown: boolean) => void;
  /** How big one unit is when a box is divided between several. See kit/units.ts. */
  units: (available: number, opts?: UnitOpts) => number;
  /** One square of item art, at the game's own bag grid. See kit/item-cell.ts. */
  itemCell: number;
  /** Where the game's own art lives, so no addon writes a path. */
  icon: IconUrls;
  /** Copper as text, `7s 80c`. A bar draws coins instead when given `{ copper }` as `value`. */
  money: (copper: number) => string;
  /** Labelled controls, drawn as the manager draws its own. */
  field: FieldBuilders;
  /** A tab strip. The panes it switches between are the addon's own. */
  tabs: (opts: TabsOpts) => Tabs;
  /** A context menu at an element or a point. Closes on select, Escape or a click away. */
  menu: (at: Element | { x: number; y: number }, items: readonly MenuItem[]) => Teardown;
  /** An element the loader keeps over a point in the world. */
  anchor3d: (at: PointSource, opts?: Anchor3dOpts) => Anchor3d;
  /** Where a world point or a unit is on screen, or null when it must not be drawn. */
  project: (at: WorldPoint | UnitPoint) => ScreenPosition | null;
  /** Resolves with the id of the button pressed, or null if dismissed. */
  alert: (opts: AlertOpts) => Promise<string | null>;
  /** A button on the game's own rail. Lands when the HUD does. */
  microButton: (opts: MicroButtonOpts) => Teardown;
  /** An entry in the game menu, below the loader's own "Addons". */
  menuEntry: (opts: MenuEntryOpts) => Teardown;
  /** A line of text, or a title, an icon and lines with a tone each. */
  tooltip: (el: Element, content: TooltipInput) => Teardown;
}

interface UiDeps {
  doc: Document;
  kit: UiKit;
  fqid: string;
  /** The manifest name, for the arrange-mode chip only. */
  addonName: string;
  bag: DisposalBag;
  /** Report a throw from addon code the loader called. See `guarded`. */
  onError: (where: string, err: unknown) => void;
  /** Null when the addon's storage is unreachable; frames then never persist. */
  frameStore: FrameStateStore | null;
  /** What a frame's `toggleKey` is bound through. See ui/kit/frame-toggle.ts. */
  toggles: FrameToggles;
  viewport: () => { w: number; h: number };
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/** Register a teardown so an explicit call also unregisters it from the bag. */
function tracked(bag: DisposalBag, teardown: Teardown): Teardown {
  const drop = bag.add(teardown);
  return () => {
    drop();
    teardown();
  };
}

/** A frame only reaches the store when the addon asked for persistence. */
function storeFor(deps: UiDeps, opts: FrameOpts): FrameStateStore | null {
  if (opts.save === true) {
    return deps.frameStore;
  }
  return null;
}

/** Guarded like `onMove`: a throw costs an empty tooltip, not a dead hover for the session. */
function guardedTooltip(deps: UiDeps, content: TooltipInput): TooltipInput {
  if (typeof content !== 'function') {
    return content;
  }
  return () => {
    try {
      return content();
    } catch (err) {
      deps.onError('a tooltip content function', err);
      return '';
    }
  };
}

/** Runs mid-drag inside the loader's pointer handling, so a throw must not break the gesture. */
function guarded(deps: UiDeps, opts: FrameOpts): FrameOpts {
  const { onMove } = opts;
  if (onMove === undefined) {
    return opts;
  }
  return {
    ...opts,
    onMove: (box) => {
      try {
        onMove(box);
      } catch (err) {
        deps.onError(`the onMove handler of frame '${opts.id}'`, err);
      }
    },
  };
}

function addonFrame(deps: UiDeps, opts: FrameOpts, chrome: 'frame' | 'window'): AddonFrame {
  const frame = createAddonFrame({
    doc: deps.doc,
    // HUD furniture goes under the game's own windows. See ui/root.ts.
    root: deps.kit.hud,
    fqid: deps.fqid,
    addonName: deps.addonName,
    chrome,
    opts: guarded(deps, opts),
    store: storeFor(deps, opts),
    toggles: deps.toggles,
    viewport: deps.viewport,
    window: deps.window,
    raise: deps.kit.stacking.raise,
    arrange: { unlock: deps.kit.unlock, hint: deps.kit.arrangeHint.note },
  });
  const forget = rostered(
    deps.kit.roster,
    { fqid: deps.fqid, frameId: opts.id, title: opts.title ?? opts.id },
    frame,
  );
  deps.bag.add(() => {
    forget();
    frame.destroy();
  });
  return frame;
}

/** The bag holds the DOM removal: disable is hot, so a leftover row would outlive its addon. */
function addonBar(deps: UiDeps, opts: BarOpts | undefined): Bar {
  const bar = createBar(deps.doc, opts);
  deps.bag.add(bar.destroy);
  return bar;
}

/** A field whose removal is in the bag, like a bar's. */
function addonField<T, O>(deps: UiDeps, build: (doc: Document, opts: O) => Field<T>, opts: O) {
  const field = build(deps.doc, opts);
  deps.bag.add(field.destroy);
  return field;
}

/** The bag holds the list, not each row, or it would grow by a teardown per row ever synced. */
function addonList<T, H extends Destroyable>(deps: UiDeps, opts: ListOpts<T, H>): List<T, H> {
  const list = createList(opts);
  deps.bag.add(list.destroy);
  return list;
}

/** The same, for a tile. */
function addonTile(deps: UiDeps, opts: TileOpts | undefined): Tile {
  const tile = createTile(deps.doc, opts);
  deps.bag.add(tile.destroy);
  return tile;
}

function fieldSurface(deps: UiDeps): FieldBuilders {
  return {
    checkbox: (opts) => addonField(deps, createCheckbox, opts),
    // Its popup is the loader's menu, so it takes the opener `ui.menu` uses.
    select: (opts) =>
      addonField(deps, (doc, one) => createSelect(doc, one, deps.kit.menus.open), opts),
    slider: (opts) => addonField(deps, createSlider, opts),
    text: (opts) => addonField(deps, createText, opts),
  };
}

function createUi(deps: UiDeps): UiApi {
  const { kit, bag } = deps;

  return {
    ...injectionSurface(deps, (off) => tracked(bag, off)),
    ...layoutSurface(deps),

    frame: (opts) => addonFrame(deps, opts, 'frame'),
    window: (opts) => addonFrame(deps, opts, 'window'),

    toast: (text, opts) => tracked(bag, kit.toaster.show(text, opts)),

    banner: (text, opts) => tracked(bag, kit.banner.show(text, opts)),

    bar: (opts) => addonBar(deps, opts),

    tile: (opts) => addonTile(deps, opts),

    list: (opts) => addonList(deps, opts),

    icon: kit.icons,

    money: moneyText,

    field: fieldSurface(deps),

    tabs: (opts) => {
      const strip = createTabs(deps.doc, opts);
      bag.add(strip.destroy);
      return strip;
    },

    // Tracked, so a manual close also drops it from the bag.
    menu: (at, items) => tracked(bag, kit.menus.open(at, items)),

    anchor3d: (at, opts) => addonAnchor(deps, at, opts),

    project: (at) => projected(deps, at),

    alert: (opts) => {
      const modal = openAlert({ doc: deps.doc, root: kit.overlay }, opts);
      // Disable mid-question closes it, which resolves the promise rather than hanging it.
      const drop = bag.add(modal.close);
      return modal.answer.finally(drop);
    },

    tooltip: (el, content) => tracked(bag, kit.tooltips.attach(el, guardedTooltip(deps, content))),
  };
}

export type { UiApi, UiDeps };
export { createUi };
