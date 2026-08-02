// Frames and windows: the panels an addon draws into.
//
// Split out of ui.d.ts on the subject axis, the way ui-timers.d.ts and
// ui-controls.d.ts were: this is one family, it is the largest one, and it is the
// one that grows on every UI change.

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
  /**
   * Draw a close button in the title bar. Since apiMinor 2.
   *
   * `ui.window` always has one and ignores this. A `ui.frame` does not, because a
   * frame is ordinarily a HUD readout that lives on screen and is toggled by a
   * keybind, and a button on every cooldown strip would be chrome nobody asked
   * for. Ask for one when your frame is a panel the player OPENS: a reference
   * list, a ledger, anything they would expect to dismiss with the mouse.
   *
   * Ignored on `density: 'bare'`, which removes the title bar the button would
   * live in. That is the same refusal `ui.window` makes about `bare`, and for the
   * same reason: a promise with nowhere to keep it is worse than an ignored
   * option. Dismiss a bare frame with its keybind or through the unlock mode.
   */
  closable?: boolean;
  width?: number;
  height?: number;
  /**
   * How far the player may SHRINK it. Defaults to the size it opened at.
   *
   * That default is the surprise these two options answer: without them a
   * resizable window cannot be dragged narrower or shorter than the `width` and
   * `height` it was created with, because the opening size is the floor. Set them
   * whenever you set a size and mean it as a starting point rather than a limit.
   *
   * The loader keeps a structural floor of its own underneath yours, so a frame
   * can never be resized down to something with no grab area left.
   */
  minWidth?: number;
  minHeight?: number;
  /**
   * How far the player may GROW it. Defaults to the viewport.
   *
   * The viewport is always the outer limit whatever you pass, and your MINIMUM
   * wins over your maximum: a max below the min is a contradiction, and the size
   * a display was built to be readable at is the one worth keeping.
   */
  maxWidth?: number;
  maxHeight?: number;
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
