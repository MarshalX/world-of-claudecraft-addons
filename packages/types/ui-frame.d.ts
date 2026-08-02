// Frames and windows: the panels an addon draws into.
//
// Split out of ui.d.ts on the subject axis, the way ui-timers.d.ts and
// ui-controls.d.ts were: this is one family, it is the largest one, and it is the
// one that grows on every UI change.

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
   * Which parts of your frame take the pointer. Since apiMinor 2.
   *
   * Defaults to 'content' on a `bare` frame and 'auto' everywhere else, which is
   * almost always what you want; set it when your overlay is bigger than what it
   * draws, or when it is a readout the player should never have to click at all.
   *
   * This matters more here than it would on a web page, because the game binds
   * the world's `mousedown` and `wheel` to its canvas. An element over the world
   * does not just cover a click, it takes the whole gesture: selecting a target,
   * holding right to turn the camera, and scrolling to zoom, all three, for as
   * long as it is there. Nothing can hand them on afterwards. So the size of your
   * frame is the size of the hole you have made in the player's controls, and
   * these are the three ways to shrink it:
   *
   *  - 'auto' is the whole box, chrome, padding and empty space included. Right
   *    for a panel the player operates, and for anything with a form in it.
   *  - 'content' makes the box transparent and leaves what you DREW taking the
   *    pointer. Gaps, padding and the dead width beside a short row fall through
   *    to the world; your rows keep their hover, their tooltip and their clicks.
   *  - 'none' is inert. No hover, no tooltip, no click, nothing to hit. For a
   *    readout that is purely a readout.
   *
   * Two consequences worth holding on to. With 'content' you grab the frame by
   * something it drew, so a drag or an edge resize works over a row and goes to
   * the game over empty space; with 'none' there is nothing to grab at all. In
   * both cases the unlock mode is the way in, which is what it is for, and it
   * hands the whole frame back to the pointer for as long as it is on. And a
   * tooltip needs hover, so 'none' is a choice to give tooltips up: the browser
   * has no way to watch a pointer that is passing through.
   */
  pointer?: FramePointer;
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
