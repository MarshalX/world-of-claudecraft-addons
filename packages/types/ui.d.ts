import type { Unsubscribe } from './addon.js';

export type FrameDensity = 'comfortable' | 'compact';

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
   * It also reaches your own controls: a `.woc-btn` or `.woc-tab` inside a
   * compact frame is drawn compact too, so reusing those classes gets you the
   * matching density for free.
   */
  density?: FrameDensity;
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
  /** Shows on hover and on focus. */
  tooltip: (el: Element, text: string) => Unsubscribe;
}
