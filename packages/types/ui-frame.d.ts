// Frames and windows: the panels an addon draws into.

export type FrameDensity = 'comfortable' | 'compact' | 'bare';

export type FramePointer = 'auto' | 'content' | 'none';

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
  /**
   * Draw a close button in the title bar. Since apiMinor 2.
   *
   * `ui.window` always has one and ignores this. A `ui.frame` is usually a
   * keybind-toggled HUD readout; ask for one when the frame is a panel the player
   * OPENS and expects to dismiss with the mouse.
   *
   * Ignored on `density: 'bare'`, which has no title bar. Dismiss a bare frame
   * with its keybind or through the unlock mode.
   */
  closable?: boolean;
  /**
   * How wide it is. A resizable frame opens at this; one that is not is HELD to it,
   * so a long line wraps and the panel never grows or shrinks with its text.
   * Omitting it takes the default width, not a content-sized one.
   *
   * The height has no equivalent: a non-resizable frame is as tall as its content.
   */
  width?: number;
  /**
   * How tall it opens.
   *
   * A frame that is not resizable IGNORES this and is as tall as its content. On a
   * resizable frame it is the opening height, and the floor a drag may not go
   * under unless you set `minHeight`.
   */
  height?: number;
  /**
   * How far the player may SHRINK it. Defaults to the size it opened at.
   *
   * So without these, a resizable frame cannot shrink below its opening `width`
   * and `height`. Set them when a size is a starting point, not a limit. The
   * loader keeps a structural floor of its own under yours.
   */
  minWidth?: number;
  minHeight?: number;
  /**
   * How far the player may GROW it. Defaults to the viewport.
   *
   * The viewport is always the outer limit, and your MINIMUM wins over a maximum
   * below it.
   */
  maxWidth?: number;
  maxHeight?: number;
  /**
   * Whether the edges resize it. Defaults to true for `window` and false for
   * `frame`.
   *
   * `'width'` and `'height'` (since apiMinor 6) hand the player ONE axis; the other
   * behaves as on a non-resizable frame. `'width'` suits a HUD list whose row count
   * is a setting. `minWidth` and the rest apply to the resizable axis.
   *
   * Any other value is read as `false`.
   */
  resizable?: boolean | 'width' | 'height';
  /** Persist position and visibility for this character. */
  save?: boolean;
  /** Whether it starts on screen. A restored `save` visibility wins over this. */
  visible?: boolean;
  /**
   * A keybind id from your manifest that shows and hides this frame. Since apiMinor 4.
   *
   * An undeclared id logs a warning and binds nothing; the frame is still built.
   * The bind is released when the frame is destroyed, so rebuilding a frame leaves
   * exactly one binding. Use `woc.keys.bind` when the key does more than toggle.
   */
  toggleKey?: string;
  /** Added to the frame element, so you can style your own. */
  className?: string;
  /**
   * How tightly the loader's own chrome is drawn. Defaults to 'comfortable'.
   *
   * 'comfortable' is the scale the game draws its own desktop windows at: 13px
   * tabs and buttons under a 15px title. 'compact' is tighter, for a dense readout
   * the player glances at.
   *
   * Both keep the touch tap-target floor (16px type on a 40px target under
   * `@media (pointer: coarse)`). Never write a font-size or min-height onto a kit
   * control: an inline style beats every stylesheet rule and opts it out.
   *
   * 'bare' removes the panel, padding and title bar, for an overlay that IS its
   * content. A bare frame moves and resizes ONLY in the unlock (arrange) mode, so
   * pressing its rows never drags it. `ui.window` ignores 'bare' and stays
   * comfortable, since its close button lives in the title bar.
   *
   * The density reaches `.woc-btn` and `.woc-tab` inside the frame too.
   */
  density?: FrameDensity;
  /**
   * Which parts of your frame take the pointer. Since apiMinor 2.
   *
   * Defaults to 'content' on a `bare` frame and 'auto' everywhere else.
   *
   * The game binds the world's `mousedown` and `wheel` to its canvas, so any
   * element over the world takes targeting, right-drag camera and wheel zoom for
   * its whole area, and nothing can pass them on:
   *
   *  - 'auto' is the whole box. For a panel the player operates.
   *  - 'content' lets empty space fall through to the world; what you DREW keeps
   *    hover, tooltips and clicks.
   *  - 'none' is inert: no hover, so no tooltips either.
   *
   * The unlock mode hands the whole frame back to the pointer while it is on.
   */
  pointer?: FramePointer;
  /**
   * Where the frame ended up, after every move the loader made.
   *
   * The loader owns the box. Use this or `frame.box()` rather than measuring
   * `frame.el`, which forces a layout.
   *
   * Fires on a drag, on a resize (at pointer rate, so keep it cheap), on the async
   * restore of a saved box, and when the viewport changes. NOT for the initial
   * placement; read `frame.box()` for that. A throw is caught and logged.
   */
  onMove?: (box: FrameBox) => void;
}

export interface Frame {
  /** The frame element. Yours to fill; the loader only positions it. */
  readonly el: HTMLElement;
  /** Where your content goes. Everything above it is chrome. */
  readonly body: HTMLElement;
  readonly visible: boolean;
  /**
   * Where the frame is now, as the loader is holding it. Since apiMinor 6.
   *
   * The companion to `onMove`, for the moments nothing changed, such as right after
   * building the frame. Cheap: no measurement and no layout, unlike
   * `frame.el.getBoundingClientRect()`.
   */
  box: () => FrameBox;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setTitle: (title: string) => void;
  destroy: () => void;
}
