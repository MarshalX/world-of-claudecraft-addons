import type { Unsubscribe } from './addon.js';
import type { KnownSkillIcon, SkillIconClass } from './icons.generated.js';
import type { FieldBuilders, MenuItem, Tabs, TabsOpts, TooltipInput } from './ui-controls.js';
import type { Bar, BarOpts, Tile, TileOpts } from './ui-timers.js';

export type FrameDensity = 'comfortable' | 'compact' | 'bare';

/** Where a frame is, in page pixels. The loader owns it; see `FrameOpts.onMove`. */
export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameOpts {
  /** Unique within your addon. It is the persistence key, so keep it stable. */
  id: string;
  title?: string;
  width?: number;
  height?: number;
  /**
   * Whether the edges resize it. Defaults to true for `window` and false for
   * `frame`: a frame is sized by its content, so an explicit height would leave
   * it padded out or clipped as its text changes.
   */
  resizable?: boolean;
  /** Persist position and visibility for this character. */
  save?: boolean;
  /** Whether it starts on screen. A restored `save` visibility wins over this. */
  visible?: boolean;
  /** Added to the frame element, so you can style your own. */
  className?: string;
  /**
   * How tightly the loader's own chrome is drawn. Defaults to 'comfortable'.
   *
   * 'comfortable' is 16px labels on a 40px minimum, which is the tap-target
   * floor the game itself holds to, and is right for anything a player OPERATES.
   * 'compact' is for a dense readout they glance at, where that floor makes the
   * title bar and close button the loudest things in the panel. Compact gives up
   * the tap floor, which is why it is opt-in: pick it for a desktop readout, not
   * for a form.
   *
   * 'bare' removes the chrome altogether: no panel behind your content, no
   * padding, no title bar. It is for an overlay that IS its content, a row of
   * timers floating on the HUD rather than a panel holding them. Two things
   * follow from having no title bar, and both are deliberate:
   *
   *  - The frame is dragged by its own content instead. Buttons, inputs and
   *    selects inside it stay clickable, so a bare frame full of controls is
   *    still awkward to move: it suits a readout, not a form.
   *  - `ui.window` IGNORES it and stays comfortable. A window's close button
   *    lives in the title bar, and a panel the player cannot dismiss is worse
   *    than one drawn more heavily than asked for.
   *
   * It also reaches your own controls: a `.woc-btn` or `.woc-tab` inside a
   * compact frame is drawn compact too, so reusing those classes gets you the
   * matching density for free.
   */
  density?: FrameDensity;
  /**
   * Where the frame ended up, after every move the loader made.
   *
   * The loader owns the box. It writes the position, and for a `resizable` frame
   * the size, and it re-clamps both when the viewport changes and when a saved box
   * is restored. Use this rather than measuring `frame.el`: a measurement forces a
   * synchronous layout, and a display that scales with its frame would pay for one
   * on every frame it draws.
   *
   * Fires on a drag, on a resize (at pointer rate, so keep it cheap), on the async
   * restore of a saved box, and when the window is resized under it. NOT for the
   * initial placement, which is the size you asked for and therefore already hold.
   *
   * A throw here is caught and written to your addon's log rather than breaking
   * the gesture the player is in the middle of.
   */
  onMove?: (box: FrameBox) => void;
}

export interface Frame {
  /** The frame element. Yours to fill; the loader only positions it. */
  readonly el: HTMLElement;
  /** Where your content goes. Everything above it is chrome. */
  readonly body: HTMLElement;
  readonly visible: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setTitle: (title: string) => void;
  destroy: () => void;
}

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
  item: (itemId: string) => string | null;
  /**
   * Read a class's art manifest, so `ability` is exact from its first call.
   *
   * Optional, and it never rejects: the manifest is fetched in the background the
   * first time you ask for an ability in that class either way. Await it when a
   * blank slot on the first row you draw would be worse than a frame's delay.
   */
  preload: (cls: IconClass) => Promise<void>;
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
  /** Where the game's own art lives, so no addon writes a path. */
  icon: IconUrls;
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
