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
 * This moves the SIZE AND THE WEIGHT together, and both lines with them, which is
 * why there is no separate weight option. The game's display face has no lowercase
 * and only loads 400 to 700, so a huge light setting of it is less readable than a
 * medium heavy one: the two axes are not independent and offering them as if they
 * were would only offer combinations nobody wants.
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
   * Reach for 'large' when missing the warning ends the pull, not for every warning:
   * if everything is large then nothing is, which is the failure mode a raid mod
   * hits first.
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
 * Open for the reason `Cue` is: the set is content, a game release commits art before
 * these types catch up, and a published type must not be able to reject a working
 * addon. The known half is generated from every channel's manifest, so it autocompletes
 * what is actually reachable rather than every ability the game has.
 */
export type AbilityIconId = KnownSkillIcon | (string & Record<never, never>);

/**
 * An item id that ships a painted icon file, or any other string.
 *
 * Open for the reason `AbilityIconId` is: the set is content, a game release commits
 * art before these types catch up, and a published type must not be able to reject a
 * working addon. The known half is generated from the LIVE manifest, so it
 * autocompletes what most players' games actually have a file for.
 */
export type ItemIconId = KnownItemIcon | (string & Record<never, never>);

/**
 * A class the game files skill art under, or any other string.
 *
 * Open because the value you pass is normally `world.player.templateId`, which is a
 * plain string: a closed union would reject the ordinary call.
 */
export type IconClass = SkillIconClass | (string & Record<never, never>);

/**
 * Where the game's own art lives.
 *
 * Use these rather than writing a path: the directories are the game's, not the
 * loader's, and a hardcoded one in an addon breaks silently when the game moves
 * it. Every builder answers null for an id it cannot make a file name from.
 */
export interface IconUrls {
  /**
   * A class ability's icon.
   *
   * `cls` is the class the ability belongs to. For anything you cast that is
   * `world.player.templateId`, which is the class id for a player entity.
   *
   * Not every ability ships painted art. The game composites an icon for the rest
   * on a canvas, from a module no addon can reach, so those have no URL at all: the
   * ability has an icon in the game and none the loader can point at.
   *
   * The game serves a manifest of which ids have a file, so this returns null once
   * the loader KNOWS there is none. Until that manifest has been read the answer is
   * optimistic and the image load decides, which is why `ui.bar` hides its own icon
   * slot on error rather than making every addon handle it. See `preload`.
   */
  ability: (abilityId: AbilityIconId, cls: IconClass) => string | null;
  /** A mob or npc portrait, by the `templateId` on its entity. */
  mob: (templateId: string) => string | null;
  /**
   * An item's icon, or null when there is none to point at.
   *
   * The game serves a manifest of which item ids have a file, so this returns null
   * once the loader KNOWS there is none. Until that has been read the answer is the
   * URL and the image load decides, which is why `ui.bar` hides its own icon slot on
   * error. See `preloadItems`.
   *
   * Weapons used to be permanently absent and are not any more: game 0.36.0 gave
   * every authored weapon its own painting, and at that release every item in the
   * game ships a file. Write the null branch anyway. Art is commissioned behind
   * content, so an item can ship before its picture, and the gap empties and refills
   * with every release.
   *
   * A heroic weapon VARIANT is the one case that looks like a gap and is not: it
   * ships no file of its own and this answers with its base weapon's painting, which
   * is what the game draws for it too.
   */
  item: (itemId: ItemIconId) => string | null;
  /**
   * The name the item's ART was filed under, or null.
   *
   * NOT the item's name, and the difference is not academic. This is provenance
   * metadata for the icon file, gated by the game only on being non-empty, so it
   * drifts whenever content is renamed and the art is not: measured against game
   * 0.33.0, 281 of 303 agree with the game's own display name and 21 do not.
   *
   * It also answers for far less than it used to. The manifest keeps a name only for
   * a CURATED entry, and game 0.36.0 moved the catalogue into unnamed generated
   * batches, taking 307 named entries down to 39 reagents and bags. Those 39 all
   * agree with the game today, and that is not a reason to trust the next one:
   * nothing in the game compares the two.
   *
   * Null for an item whose art came from a generated batch, since those carry no
   * name at all, and null while the manifest has not been read.
   *
   * Use it as a labelled fallback, never as the item's name. Nothing on this API can
   * give you that: the item table is bundled into the game's own chunk.
   */
  itemArtName: (itemId: ItemIconId) => string | null;
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
   * Optional and never rejects, exactly like `preload`. One request covers every
   * item in the game, so a bag grid that would rather not flash costs one await.
   */
  preloadItems: () => Promise<void>;
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
   * Not a toast, and the difference is not cosmetic: this lands in the middle of
   * the view and is announced assertively, which interrupts a screen reader. Use
   * it for a mechanic about to land, not for information.
   *
   * There is ONE slot for the whole loader and a new banner replaces whatever is
   * up, including another addon's. Stacking these would cover the fight the
   * warning is about. For anything a player reads at their own pace, use a frame.
   */
  banner: (text: string, opts?: BannerOpts) => Unsubscribe;
  /**
   * A timer row: an icon, a name, a fill behind both, and a figure on the right.
   *
   * Append `bar.el` wherever you want it and call `bar.update()` as the numbers
   * move. Subscribe for the change and animate from the read: `world.on` fires
   * when a SET changes, so the bars that exist come from the subscription and how
   * full each one is comes from a frame loop.
   *
   * Inside a `density: 'compact'` frame the row is drawn compact too.
   */
  bar: (opts?: BarOpts) => Bar;
  /**
   * The square form of the same thing: art, a radial sweep over it, a countdown
   * and a stack count.
   *
   * Reach for this where the ART is the label and a strip of them is read at a
   * glance, which is what an aura display and a cooldown row are. Reach for `ui.bar`
   * where each timer needs a name beside it. There is no linear sweep here because
   * that is `ui.bar`, and one thing drawn two ways is how two addons end up looking
   * different for no reason anyone chose.
   *
   * It does not animate itself, exactly as a bar does not: subscribe for the set
   * changing and move `fraction` from a frame loop.
   */
  tile: (opts?: TileOpts) => Tile;
  /**
   * A keyed list of rows: created, updated, ordered and destroyed as your data
   * moves. Added in API minor 4.
   *
   * The other half of drawing a screenful of bars or tiles. Give it what makes two
   * items the same item across two reads and how to build one, then hand it the set
   * you want on screen: `sync([...])` destroys what left, builds what arrived,
   * paints everything and puts the elements in that order, writing nothing to the
   * document where nothing moved. So it is meant to be called from a frame loop.
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
   * Without a `parent` nothing is inserted and nothing is ordered, and the list is
   * the lifecycle alone. That is the form a set of world pins wants, since each pin
   * is already placed by its own `ui.anchor3d`.
   */
  list: <T, H extends Destroyable>(opts: ListOpts<T, H>) => List<T, H>;
  /**
   * A flex column: a pane, and most of what goes inside one. Added in API minor 4.
   *
   * ```js
   * const pane = woc.ui.column({ parent: frame.body, gap: 4 });
   * ```
   *
   * These three write a CLASS rather than a style attribute, which is the whole
   * reason they exist. An inline style outranks every selector a stylesheet can
   * spell, so a panel laid out in style writes silently opts out of rules the
   * loader holds for you, the tap-target floor on a touch screen among them. They
   * also carry `flex-shrink: 0`, so a screenful of them in a scrolling frame is a
   * list that scrolls rather than forty rows squeezed until each clips its own
   * second line.
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
   * `tone: 'muted'` is the smaller, dimmer note that goes under a figure, drawn in
   * the game's own secondary text colour at the size the game writes its own
   * captions at.
   */
  line: (opts?: LineOpts) => HTMLElement;
  /**
   * On screen or not. Added in API minor 4.
   *
   * Both halves, and both are needed. `hidden` alone does NOT take a kit element off
   * the screen: it is a user-agent rule at the lowest priority there is, and the
   * loader's own sheet is unlayered and more specific, so it outranks it. The class
   * alone would leave the element in the accessibility tree announcing figures
   * nobody can see.
   *
   * A class rather than a `display` write, so nothing has to remember what the
   * element was displayed as before it went: `display` is `flex` for some things
   * and unset for others, and putting back a `flex` that was never there draws a
   * kit bar's detail beside its figure instead of under it.
   *
   * It works on an element you gave an inline `display` of your own, which is the
   * one case a class would normally lose: the rule behind it is `!important` so
   * that you never have to know how hiding is implemented in order to hide
   * something. The only thing it does not beat is an inline `!important`, which is
   * you overriding the loader deliberately.
   *
   * Anything the loader drew: a column, a row, a line, `bar.el`, `tile.el`, or an
   * element of your own.
   */
  show: (el: Element, shown: boolean) => void;
  /** Where the game's own art lives, so no addon writes a path. */
  icon: IconUrls;
  /**
   * Copper as the game writes it: `7s 80c`, with empty units left out.
   *
   * Every amount the game sends is counted in copper, and this is the one place the
   * split into gold, silver and copper lives, so two addons showing a price cannot
   * spell it differently.
   *
   * For TEXT, which is most of a tooltip line. Where the figure is a readout's own,
   * pass `{ copper }` as a bar's `value` instead and it is drawn with the game's
   * coins rather than spelled out.
   */
  money: (copper: number) => string;
  /**
   * Labelled controls for your own settings pane.
   *
   * Each hands back `{ el, value, set, destroy }`, so a pane that saves to
   * `woc.storage` reads them all the same way, and `set` moves a control without
   * calling your handler back, which is what a reset needs.
   */
  field: FieldBuilders;
  /**
   * A tab strip. Which pane it reveals is yours: the loader owns the strip only.
   *
   * A strip rather than a field, because tabs are navigation rather than a value
   * the player is setting, and only one of those is worth persisting.
   */
  tabs: (opts: TabsOpts) => Tabs;
  /**
   * A context menu at an element or at a point, for per-row actions.
   *
   * There is ONE for the whole loader and opening a second closes the first: two
   * open context menus is not a state anyone means to be in. It closes on select,
   * on Escape, on a click anywhere else, and when your addon is disabled, which is
   * the part worth having in the loader rather than in each addon.
   *
   * Returns a close. Calling it once another menu has opened does nothing, so a
   * late teardown cannot take down someone else's menu.
   */
  menu: (at: Element | { x: number; y: number }, items: readonly MenuItem[]) => Unsubscribe;
  /**
   * An element the loader keeps over a point in the world.
   *
   * Nameplates, ground markers, a target arrow, a pin on a gathering node: all the
   * same thing, and none of them buildable by an addon, because the projection is
   * on the game's renderer and nothing else published here needs it.
   *
   * ```js
   * const plate = woc.ui.anchor3d({ unit: 'target' });
   * plate.el.textContent = woc.world.target.name;
   * ```
   *
   * A `{ unit }` point is the one to reach for over `() => entity.pos`, because
   * 'head' puts the element above that unit's MODEL exactly as the game's own
   * nameplate does, and no addon can work that height out: it comes off the
   * renderer's view of the unit, not off the wire. Since apiMinor 2.
   *
   * Every anchor shares ONE frame loop with every `woc.onFrame` handler, and
   * nothing is written unless the point moved on screen, so a camera nobody is
   * turning costs nothing. It hides itself when the point cannot be trusted (see
   * `ui.project` for what that covers), when it is off screen by more than
   * `margin`, and whenever the game cannot be asked at all, which includes every
   * moment before world entry.
   */
  anchor3d: (at: PointSource, opts?: Anchor3dOpts) => Anchor3d;
  /**
   * Where a world point or a unit is on screen right now, with no element.
   *
   * `ui.anchor3d` is the right tool when the loader should KEEP something over a
   * point. This is for the decisions an addon makes ABOUT screen positions: a line
   * drawn between two units, a list sorted by where things are, which of two
   * overlapping pins to hide. Measuring a placed element instead forces a
   * synchronous layout, which on a frame loop is the churn `FrameOpts.onMove`
   * exists to avoid.
   *
   * **Null means do not draw**, and that is the whole safety of this call. It is
   * null before world entry, null when the game cannot be asked, and null when the
   * point has no trustworthy screen position: behind the camera, or CLOSER than
   * the near plane. That last case is the one worth knowing about, because the raw
   * projection reports finite coordinates for it that are off by any amount, and
   * the game's own nameplates, chat bubbles and click picking all guard against
   * exactly it. There is deliberately no `onScreen` flag, because a flag is a
   * thing you can forget to read.
   *
   * It does NOT test the viewport rectangle: an off-screen point in front of the
   * camera still projects, which is what an arrow pointing off the edge of the
   * screen at an off-screen unit is built from. Compare `x` and `y` yourself, and
   * allow a margin the way `ui.anchor3d` allows 64 pixels by default, because your
   * element is centred on the point.
   *
   * ```js
   * // How many pixels a 30 yard radius covers on screen right now.
   * const centre = woc.ui.project(point);
   * const edge = woc.ui.project({ ...point, x: point.x + 30 });
   * const pixels = centre && edge ? Math.hypot(edge.x - centre.x, edge.y - centre.y) : null;
   * ```
   *
   * Measure that along the axis you are drawing on: under perspective a ground
   * radius covers a different number of pixels across than it does up the screen,
   * which is why the loader publishes no single scale figure. Since apiMinor 2.
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
   * A string is one line, which is what this took before and still does. The
   * structured form adds a title, an icon from `ui.icon`, and a tone per line, so
   * a hovered row can say what the game's own tooltips say.
   *
   * Everything is written as text, never as markup: an ability name and a player
   * name both reach this from the wire.
   */
  tooltip: (el: Element, content: TooltipInput) => Unsubscribe;
}
