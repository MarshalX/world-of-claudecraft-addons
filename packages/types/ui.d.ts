import type { Unsubscribe } from './addon.js';
import type { KnownSkillIcon, SkillIconClass } from './icons.generated.js';
import type { KnownItemIcon } from './items.generated.js';
import type {
  Anchor3d,
  Anchor3dOpts,
  PointSource,
  ScreenPoint,
  UnitPoint,
  WorldPoint,
} from './ui-anchor.js';
import type { FieldBuilders, MenuItem, Tabs, TabsOpts, TooltipInput } from './ui-controls.js';
import type { Frame, FrameOpts } from './ui-frame.js';
import type { LineOpts, RowOpts, StackOpts } from './ui-layout.js';
import type { Destroyable, List, ListOpts } from './ui-list.js';
import type { Bar, BarOpts, Tile, TileOpts } from './ui-timers.js';

export interface ToastOpts {
  /** Milliseconds on screen. Zero keeps it up until dismissed. */
  timeout?: number;
  kind?: 'info' | 'warn' | 'error';
}

export type BannerKind = 'info' | 'warn' | 'danger';

/**
 * How loud a banner is. `large` is the "you are about to die" step.
 *
 * It moves size and weight together, for both lines, so there is no separate
 * weight option.
 */
export type BannerSize = 'normal' | 'large';

export interface BannerOpts {
  /** Milliseconds on screen. Zero keeps it up until dismissed or replaced. */
  timeout?: number;
  /** Defaults to 'warn', which is what a banner is nearly always for. */
  kind?: BannerKind;
  /**
   * Defaults to 'normal', which is already sized to be read across a fight.
   *
   * Use 'large' only when missing the warning ends the pull.
   */
  size?: BannerSize;
  /** A quieter second line, e.g. who the mechanic is on. Set in the UI face. */
  detail?: string;
}

export interface AlertButton {
  id: string;
  label: string;
  /** Drawn as the affirmative action, and focused when the modal opens. */
  primary?: boolean;
  /** What Escape and a backdrop click resolve to. At most one. */
  cancel?: boolean;
}

export interface AlertOpts {
  title?: string;
  message: string;
  /** Defaults to a single dismissing "OK". */
  buttons?: readonly AlertButton[];
}

/**
 * An ability id that ships a painted icon file, or any other string.
 *
 * Open because a game release adds art before these types catch up. The known
 * half is generated from the live manifests, so it autocompletes ids that have a
 * file, not every ability the game has.
 */
export type AbilityIconId = KnownSkillIcon | (string & Record<never, never>);

/**
 * An item id that ships a painted icon file, or any other string.
 *
 * Open because a game release adds art before these types catch up. The known
 * half is generated from the live manifest.
 */
export type ItemIconId = KnownItemIcon | (string & Record<never, never>);

/**
 * A class the game files skill art under, or any other string.
 *
 * Open because the value you pass is normally `world.player.templateId`, a plain
 * string.
 */
export type IconClass = SkillIconClass | (string & Record<never, never>);

/**
 * Where the game's own art lives.
 *
 * Use these rather than writing a path, which breaks silently when the game moves
 * it. Every builder answers null for an id it cannot make a file name from.
 */
export interface IconUrls {
  /**
   * A class ability's icon.
   *
   * `cls` is the class the ability belongs to. For anything you cast that is
   * `world.player.templateId`, which is the class id for a player entity.
   *
   * Not every ability ships painted art; the game draws the rest on a canvas, with
   * no URL to point at.
   *
   * Null once the loader KNOWS there is no file. Until the class manifest has been
   * read the answer is optimistic and the image load decides; `ui.bar` and
   * `ui.tile` hide a failed icon themselves. See `preload`.
   */
  ability: (abilityId: AbilityIconId, cls: IconClass) => string | null;
  /** A mob or npc portrait, by the `templateId` on its entity. */
  mob: (templateId: string) => string | null;
  /**
   * An item's icon, or null when there is none to point at.
   *
   * Null once the loader KNOWS there is no file. Until the manifest has been read
   * the answer is optimistic and the image load decides. See `preloadItems`.
   *
   * Write the null branch even if every item has art today: an item can ship
   * before its picture. A heroic weapon VARIANT answers with its base weapon's
   * painting, as the game draws it.
   */
  item: (itemId: ItemIconId) => string | null;
  /**
   * The name the item's ART was filed under, or null.
   *
   * NOT the item's name: it is provenance for the icon file, and nothing in the
   * game keeps it in step with the display name when content is renamed.
   *
   * Only curated entries carry one (a few dozen reagents and bags); null for
   * everything else and while the manifest has not been read.
   *
   * Use it only as a labelled fallback. Nothing on this API gives an item's name.
   */
  itemArtName: (itemId: ItemIconId) => string | null;
  /**
   * An aura's painted icon, or null when there is none to point at.
   *
   * Covers the auras NO ability names: a mob's aura, an encounter mechanic, a
   * battleground rune, a set bonus. An aura applied by an ability carries that
   * ability's id, which `ability()` answers; try that first, as the game does.
   *
   * NULL UNTIL THE MANIFEST IS READ, unlike `ability` and `item`, because most
   * ids have no file here. Await `preloadAuras` when the first row needs its icon.
   */
  aura: (auraId: string) => string | null;
  /**
   * Read a class's art manifest, so `ability` is exact from its first call.
   *
   * Optional, and it never rejects: the manifest is fetched in the background the
   * first time you ask for an ability in that class either way. Await it when a
   * blank slot on the first row you draw would be worse than a frame's delay.
   */
  preload: (cls: IconClass) => Promise<void>;
  /**
   * Read the item art manifest, so `item` is exact from its first call.
   *
   * Optional and never rejects, like `preload`. One request covers every item.
   */
  preloadItems: () => Promise<void>;
  /**
   * Read the aura art manifest, so `aura` can answer at all.
   *
   * Never rejects. `aura` answers null for everything until this has landed.
   */
  preloadAuras: () => Promise<void>;
}

export interface MicroButtonOpts {
  /** Unique within your addon. The loader namespaces it before it reaches the page. */
  id: string;
  label: string;
  onClick: () => void;
  /** Inline SVG markup. Defaults to the loader's own glyph. */
  glyph?: string;
}

export interface MenuEntryOpts {
  id: string;
  label: string;
  onClick: () => void;
}

/** What a box is being divided between. See `UiApi.units`. */
export interface UnitOpts {
  /** How many units share the box. Below one there is nothing to divide. */
  count?: number;
  /** The space between two of them, which is paid before the division. */
  gap?: number;
  /** Fixed space the units never get: a caption band, a footer, a header row. */
  extra?: number;
  /** How small a unit may be. Also the answer when the box cannot be divided at all. */
  min?: number;
  /** How large a unit may be. Defaults to no ceiling. */
  max?: number;
}

export interface UiApi {
  /** A light, content-sized HUD frame: movable, with no close button. */
  frame: (opts: FrameOpts) => Frame;
  /** A panel window: movable, resizable, with a title bar and close button. */
  window: (opts: FrameOpts) => Frame;
  /** Returns a dismiss function. */
  toast: (text: string, opts?: ToastOpts) => Unsubscribe;
  /**
   * A centre-screen warning, for the one thing a player must read immediately.
   *
   * Announced assertively, interrupting a screen reader: use it for a mechanic
   * about to land, not for information.
   *
   * There is ONE slot for the whole loader, and a new banner replaces whatever is
   * up, another addon's included.
   */
  banner: (text: string, opts?: BannerOpts) => Unsubscribe;
  /**
   * A timer row: an icon, a name, a fill behind both, and a figure on the right.
   *
   * Append `bar.el` wherever you want it and call `bar.update()` as the numbers
   * move. `world.on` fires when a SET changes, so which bars exist comes from the
   * subscription and how full each is comes from a frame loop.
   *
   * Inside a `density: 'compact'` frame the row is drawn compact too.
   */
  bar: (opts?: BarOpts) => Bar;
  /**
   * The square form of the same thing: art, a radial sweep over it, a countdown
   * and a stack count.
   *
   * For where the ART is the label, such as an aura strip. Use `ui.bar` where each
   * timer needs a name. It does not animate itself: move `fraction` from a frame
   * loop.
   */
  tile: (opts?: TileOpts) => Tile;
  /**
   * A keyed list of rows: created, updated, ordered and destroyed as your data
   * moves. Added in API minor 4.
   *
   * `sync([...])` destroys what left, builds what arrived, paints everything and
   * orders the elements, writing nothing where nothing moved, so it is safe to call
   * every frame.
   *
   * ```js
   * const rows = woc.ui.list({
   *   parent: panel,
   *   key: (timer) => timer.abilityId,
   *   create: () => woc.ui.bar(),
   *   update: (bar, timer) => bar.update({ fraction: timer.left / timer.total }),
   * });
   * rows.sync(running);
   * ```
   *
   * Without a `parent` the list is the lifecycle alone, which suits world pins
   * placed by their own `ui.anchor3d`.
   */
  list: <T, H extends Destroyable>(opts: ListOpts<T, H>) => List<T, H>;
  /**
   * A flex column: a pane, and most of what goes inside one. Added in API minor 4.
   *
   * ```js
   * const pane = woc.ui.column({ parent: frame.body, gap: 4 });
   * ```
   *
   * `column`, `row` and `line` write a CLASS, not a style attribute: an inline
   * style would opt the panel out of the loader's rules, the touch tap-target
   * floor among them. They do not shrink, so an overfull frame scrolls instead of
   * squeezing its rows.
   */
  column: (opts?: StackOpts) => HTMLElement;
  /**
   * The same across: the strip of chips, figures or controls a panel puts under
   * its title or over its list. Added in API minor 4.
   *
   * ```js
   * const strip = woc.ui.row({ parent: pane, wrap: true, align: 'baseline' });
   * ```
   */
  row: (opts?: RowOpts) => HTMLElement;
  /**
   * A sentence the panel says on its own line. Added in API minor 4.
   *
   * `tone: 'muted'` is the smaller, dimmer note under a figure, in the game's own
   * caption style.
   */
  line: (opts?: LineOpts) => HTMLElement;
  /**
   * On screen or not. Added in API minor 4.
   *
   * Use this rather than `hidden` or a `display` write: the `hidden` attribute
   * alone does NOT hide a kit element (the loader's sheet outranks it), and writing
   * `display` back can restore the wrong value. It sets both the attribute and an
   * `!important` class, so it beats your own inline `display` too, though not an
   * inline `!important`.
   *
   * Works on anything: a column, a row, a line, `bar.el`, `tile.el`, or an element
   * of your own.
   */
  show: (el: Element, shown: boolean) => void;
  /**
   * How big one unit is when a box is divided between several of them. Since apiMinor 6.
   *
   * For a display that scales with its frame. The GAPS come out before the
   * division, and the share is FLOORED so the last unit never overhangs the box.
   *
   * ```js
   * // Eight rows and their gaps, out of the height the player dragged.
   * const row = woc.ui.units(frame.box().h, { count: 8, gap: 3, min: 23, max: 69 });
   * ```
   *
   * `min` is also the answer when there is nothing to divide, so an unmeasured box
   * gives a usable number, never NaN.
   */
  units: (available: number, opts?: UnitOpts) => number;
  /**
   * One square of item art, at the size the game draws its own bags. Since apiMinor 7.
   *
   * The game lays item grids out at `minmax(42px, 1fr)` over a 4px gap. Use this as
   * the tile's `size` and as the grid's track:
   *
   * ```js
   * const cell = woc.ui.itemCell;
   * grid.style.gridTemplateColumns = `repeat(auto-fill, ${cell}px)`;
   * grid.style.gap = '4px';
   * const square = woc.ui.tile({ size: cell });
   * ```
   *
   * Use a fixed track, not `1fr`, so cells do not resize as the frame is dragged.
   * Do not go smaller for a denser panel: this keeps every cell above the 40x40
   * touch target, and nothing else enforces that for a tile's `size`.
   */
  itemCell: number;
  /** Where the game's own art lives, so no addon writes a path. */
  icon: IconUrls;
  /**
   * Copper as the game writes it: `7s 80c`, with empty units left out.
   *
   * For TEXT, such as a tooltip line. For a readout's figure, pass `{ copper }` as
   * a bar's `value` to draw the game's coins.
   */
  money: (copper: number) => string;
  /**
   * Labelled controls for your own settings pane.
   *
   * Each hands back `{ el, value, set, destroy }`; `set` moves a control without
   * calling your handler, for a reset.
   */
  field: FieldBuilders;
  /**
   * A tab strip. Which pane it reveals is yours: the loader owns the strip only.
   */
  tabs: (opts: TabsOpts) => Tabs;
  /**
   * A context menu at an element or at a point, for per-row actions.
   *
   * There is ONE for the whole loader; opening a second closes the first. It closes
   * on select, on Escape, on a click elsewhere, and when your addon is disabled.
   *
   * Returns a close, which does nothing once another menu has opened.
   */
  menu: (at: Element | { x: number; y: number }, items: readonly MenuItem[]) => Unsubscribe;
  /**
   * An element the loader keeps over a point in the world.
   *
   * Nameplates, ground markers, a target arrow, a pin on a gathering node.
   *
   * ```js
   * const plate = woc.ui.anchor3d({ unit: 'target' });
   * plate.el.textContent = woc.world.target.name;
   * ```
   *
   * Prefer a `{ unit }` point over `() => entity.pos`: 'head' sits above the unit's
   * MODEL as the game's nameplate does, a height no addon can compute. Since
   * apiMinor 2.
   *
   * Nothing is written unless the point moved on screen. It hides itself when the
   * point cannot be trusted (see `ui.project`), when it is off screen by more than
   * `margin`, and before world entry.
   */
  anchor3d: (at: PointSource, opts?: Anchor3dOpts) => Anchor3d;
  /**
   * Where a world point or a unit is on screen right now, with no element.
   *
   * For decisions ABOUT screen positions (a line between two units, which of two
   * overlapping pins to hide); use `ui.anchor3d` to KEEP an element over a point.
   * Cheaper than measuring a placed element, which forces a layout.
   *
   * **Null means do not draw.** It is null before world entry, when the game cannot
   * be asked, and when the point has no trustworthy screen position: behind the
   * camera, or CLOSER than the near plane, where the raw projection gives finite
   * but wrong coordinates.
   *
   * It does NOT test the viewport rectangle: an off-screen point in front of the
   * camera still projects, which is what an edge arrow needs. Compare `x` and `y`
   * yourself, with a margin (`ui.anchor3d` defaults to 64 pixels).
   *
   * ```js
   * // How many pixels a 30 yard radius covers on screen right now.
   * const centre = woc.ui.project(point);
   * const edge = woc.ui.project({ ...point, x: point.x + 30 });
   * const pixels = centre && edge ? Math.hypot(edge.x - centre.x, edge.y - centre.y) : null;
   * ```
   *
   * Measure along the axis you are drawing on: under perspective a ground radius
   * covers different pixels across than up the screen. Since apiMinor 2.
   */
  project: (at: WorldPoint | UnitPoint) => ScreenPoint | null;
  /**
   * Resolves with the id of the button pressed, or with the cancel button's id
   * when dismissed, or null when there was no cancel button.
   *
   * It ALWAYS resolves, including when your addon is disabled while it is open.
   */
  alert: (opts: AlertOpts) => Promise<string | null>;
  /** A button on the game's own rail. Lands when the HUD does. */
  microButton: (opts: MicroButtonOpts) => Unsubscribe;
  /** An entry in the game menu, below the loader's own "Addons". */
  menuEntry: (opts: MenuEntryOpts) => Unsubscribe;
  /**
   * Shows on hover and on focus.
   *
   * A string is one line. The structured form adds a title, an icon from
   * `ui.icon`, and a tone per line. Everything is written as text, never as
   * markup.
   */
  tooltip: (el: Element, content: TooltipInput) => Unsubscribe;
}
