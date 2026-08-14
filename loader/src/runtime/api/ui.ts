// The woc.ui surface handed to addons. Mirrors packages/types/ui.d.ts.
//
// A thin per-addon binding over the ONE kit built in ui/mount.ts: one toast
// stack, one tooltip element, one HUD watcher. What is per-addon is the
// disposal bag, so everything an addon creates here is released when it is
// disabled, and the fqid, which namespaces the ids it puts in the game's DOM.
//
// Every addon element lands under #woc-addons, a sibling of the game's #ui, so a
// HUD re-render cannot take it away. The two surfaces that go INSIDE game DOM,
// micro buttons and menu entries, are the exception by definition and are
// re-attached by the shared watcher rather than by the addon.

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

/**
 * The controls a settings pane is made of, grouped like `ui.icon`'s builders.
 *
 * One family answering one question, so it is one member rather than four leaves
 * burying `frame`, `bar` and `tile` among them.
 */
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
  /** Where the game's own art lives, so no addon writes a path. */
  icon: IconUrls;
  /**
   * Copper as the game writes it: `7s 80c`, empty units left out.
   *
   * For text, which is most of a tooltip. A readout draws it properly instead: pass
   * `{ copper }` as a bar's `value` and it is drawn with the game's own coins.
   */
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

/**
 * A tooltip's content function, wrapped so a throw cannot break the hover.
 *
 * The function form is called inside the loader's own pointer handling, which is
 * the same position `onMove` runs in and carries the same rule. An addon reading
 * a tally that is not there yet must cost an empty tooltip and a logged warning,
 * not a pointer that stops showing anything for the rest of the session.
 */
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

/**
 * The addon's own `onMove`, wrapped so a throw cannot break the gesture.
 *
 * This runs inside the loader's pointer handling, mid-drag, exactly as a socket
 * tap runs inside the game's own send. The rule is the same one: addon code the
 * loader calls into is guarded, and the cost of a mistake is a logged warning
 * rather than a window that stops following the pointer with no way to let go.
 */
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
    // The hud band: an addon frame is HUD furniture and belongs under the game's
    // own windows, which is the whole of why there are two bands. See ui/root.ts.
    root: deps.kit.hud,
    fqid: deps.fqid,
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

/**
 * A bar whose removal is in the bag.
 *
 * The bag holds the removal rather than only a listener: a bar is DOM the addon
 * appended somewhere of its own, and disable is hot with no page reload, so a row
 * left behind would sit in a frame the loader has already taken down, with nothing
 * left running to update it.
 */
function addonBar(deps: UiDeps, opts: BarOpts | undefined): Bar {
  const bar = createBar(deps.doc, opts);
  deps.bag.add(bar.destroy);
  return bar;
}

/**
 * A field whose removal is in the bag, like a bar's and a tile's.
 *
 * Generic over the value so the four builders share one line each rather than one
 * wrapper each: what the bag needs is identical for all of them.
 */
function addonField<T, O>(deps: UiDeps, build: (doc: Document, opts: O) => Field<T>, opts: O) {
  const field = build(deps.doc, opts);
  deps.bag.add(field.destroy);
  return field;
}

/**
 * A list whose teardown is in the bag, the way a bar's and a tile's removal are.
 *
 * The bag holds the LIST rather than each row: rows come and go on every sync, so a
 * registration per row would grow the bag for the life of the addon with a teardown
 * per row that ever existed. The list already destroys everything it holds.
 */
function addonList<T, H extends Destroyable>(deps: UiDeps, opts: ListOpts<T, H>): List<T, H> {
  const list = createList(opts);
  deps.bag.add(list.destroy);
  return list;
}

/** The same, for the square form: a tile is DOM in someone else's frame too. */
function addonTile(deps: UiDeps, opts: TileOpts | undefined): Tile {
  const tile = createTile(deps.doc, opts);
  deps.bag.add(tile.destroy);
  return tile;
}

/** The four builders, each bagged the same way. See `addonField`. */
function fieldSurface(deps: UiDeps): FieldBuilders {
  return {
    checkbox: (opts) => addonField(deps, createCheckbox, opts),
    // The one field that needs a service rather than only a document: its popup IS the
    // loader's menu, so it is handed the same opener `ui.menu` is.
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

    // Tracked rather than bagged raw: an addon disabled with a menu open must not
    // leave it on screen, and closing it by hand must also drop it from the bag.
    menu: (at, items) => tracked(bag, kit.menus.open(at, items)),

    anchor3d: (at, opts) => addonAnchor(deps, at, opts),

    project: (at) => projected(deps, at),

    alert: (opts) => {
      const modal = openAlert({ doc: deps.doc, root: kit.overlay }, opts);
      // The bag closes it if the addon is disabled mid-question, which resolves
      // the promise rather than leaving the addon's await hanging.
      const drop = bag.add(modal.close);
      return modal.answer.finally(drop);
    },

    tooltip: (el, content) => tracked(bag, kit.tooltips.attach(el, guardedTooltip(deps, content))),
  };
}

export type { UiApi, UiDeps };
export { createUi };
