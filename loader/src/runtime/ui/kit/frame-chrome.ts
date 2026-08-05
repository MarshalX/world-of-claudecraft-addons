// One frame's own chrome: the element, the title bar, the close button, and how
// tightly all three are drawn.
//
// Split out of frame.ts because it shares nothing with what is left there. That
// file owns placement and lifecycle (the drag and clamp rules, the saved box, the
// teardown); this one builds DOM from options and then never touches it again.
// The density variant landed here and pushed the pair over the file limit, which
// was the prompt rather than the reason: the seam was always in this place.

import type { FrameBox } from '../frame/geometry.ts';
import { closeGlyphMarkup } from './close-glyph.ts';

type FrameChrome = 'frame' | 'window';

/**
 * How tightly a frame's own chrome is drawn.
 *
 * An enum rather than a `compact: true` flag because the axis has more than two
 * useful positions in it and a boolean cannot grow one. `bare` is the third
 * position that was predicted here when the second was added, and it arrived
 * without the matrix a flag set would have made of it.
 *
 * `comfortable` is the default and is what the manager is drawn at: the scale the
 * GAME draws its own windows at on a desktop, 13px tabs and buttons under a 15px
 * panel title. The mobile tap floor is not in it, and not because it was dropped:
 * the game applies that floor under `@media (pointer: coarse)` and the loader now
 * does too, in ui/styles/touch.css. `compact` is tighter than the game's own
 * panels, for a dense readout an addon glances at rather than operates, and the
 * touch floor reaches it as well. `bare` removes
 * the chrome entirely, for an overlay that is only its own content: no panel
 * behind it, no padding, no title bar.
 */
type FrameDensity = 'comfortable' | 'compact' | 'bare';

const DENSITIES: readonly FrameDensity[] = ['comfortable', 'compact', 'bare'];

/**
 * Which parts of a frame take the pointer, and therefore which parts of the world
 * behind it the player cannot click.
 *
 * The game binds `mousedown` and `wheel` to the CANVAS, so an element covering it
 * does not merely sit in front of a click, it consumes the whole gesture:
 * targeting, right-drag camera look and zoom together. Nothing can be forwarded
 * on afterwards, since the loader's root is not an ancestor of the canvas and a
 * synthesised event is both untrusted and forbidden here. `pointer-events` is the
 * only lever there is, which is why this is an option rather than a fix.
 *
 * It is also the game's own idiom: every read-only overlay it draws is
 * `pointer-events: none` (`#nameplates`, `#perf-overlay`, `#aura-overlays`) and
 * the aura overlay takes the pointer only under its `.placement` class, which is
 * its arrange mode. This kit's arrange mode is the unlock switch, and it forces
 * every frame back to `auto` for the same reason.
 *
 * `auto` is the whole box, chrome and empty space included. `content` makes the
 * box transparent and leaves what the addon DREW taking the pointer, so padding,
 * gaps and dead width fall through while rows keep their hover and their tooltip.
 * `none` is inert: no hover, no tooltip, no click.
 */
type FramePointer = 'auto' | 'content' | 'none';

const POINTERS: readonly FramePointer[] = ['auto', 'content', 'none'];

/**
 * A bare frame is `content` unless it says otherwise, and every other one is `auto`.
 *
 * The default is per density because the densities mean different things. A panel
 * is a surface the player operates, and a surface with holes in it is a surface
 * that sometimes ignores them. `bare` exists for an overlay that IS its content,
 * drawn over a world the player is still playing, and the empty half of one is
 * invisible: solid by default it is a rectangle that swallows clicks while showing
 * nothing, which is what a resizable bare frame with nothing to draw already was.
 */
function pointerOf(opts: FrameOpts, density: FrameDensity): FramePointer {
  if (opts.pointer !== undefined && POINTERS.includes(opts.pointer)) {
    return opts.pointer;
  }
  if (density === 'bare') {
    return 'content';
  }
  return 'auto';
}

/**
 * A window is never bare, and that is a refusal rather than an omission.
 *
 * A window is a panel the player opens and CLOSES, and its close button lives in
 * the title bar that `bare` removes. Honouring it here would hand back a panel
 * with no way to dismiss it, which is worse than ignoring the option. An
 * unrecognised value falls back the same way, because the failure to avoid is a
 * typo silently drawing a panel tighter than its author asked for.
 */
function densityOf(opts: FrameOpts, chrome: FrameChrome): FrameDensity {
  if (opts.density === 'bare' && chrome === 'window') {
    return 'comfortable';
  }
  if (opts.density !== undefined && DENSITIES.includes(opts.density)) {
    return opts.density;
  }
  return 'comfortable';
}

interface FrameOpts {
  /** Unique within the addon. It is the persistence key, so it must be stable. */
  id: string;
  title?: string;
  /**
   * Draw a close button in the title bar. A window always has one regardless.
   *
   * Ignored on a `bare` frame, which has no title bar to put it in.
   */
  closable?: boolean;
  /**
   * How wide it opens, and for a frame that is not resizable, how wide it may ever be.
   *
   * A content-sized frame is held to it as a CEILING rather than given it as a width. See
   * kit/frame.ts applyWidth for why the two axes part company here.
   */
  width?: number;
  /** How tall it opens. A frame that is not resizable ignores it and follows its content. */
  height?: number;
  /**
   * How far the player may shrink it. Defaults to the opening size.
   *
   * That default is what every frame did before the option existed, and it is
   * why the option exists: a resizable frame could not be dragged narrower than
   * the width it was created at. See kit/frame.ts sizeBounds for why the default
   * was left alone rather than lowered to the structural floor.
   */
  minWidth?: number;
  minHeight?: number;
  /** How far the player may grow it. Defaults to the viewport. */
  maxWidth?: number;
  maxHeight?: number;
  /** Persist position and visibility for this character. */
  save?: boolean;
  /** Defaults to true for a window and false for a frame. */
  resizable?: boolean;
  /** Whether it starts on screen. Ignored when a saved visibility is restored. */
  visible?: boolean;
  /** Added to the frame element, so an addon can style its own. */
  className?: string;
  /** How tightly the loader's own chrome is drawn. Defaults to 'comfortable'. */
  density?: FrameDensity;
  /** Which parts take the pointer. Defaults to 'content' when bare, else 'auto'. */
  pointer?: FramePointer;
  /**
   * Where the frame ended up, after every move the loader made.
   *
   * The loader owns the box: it writes the position and, for a resizable frame,
   * the size, and it re-clamps both on a viewport change and on a restore. So an
   * addon laying its own content out against that box has no way to know what it
   * is except by measuring the element, which costs a synchronous layout on every
   * frame of a display that is already writing styles every frame.
   *
   * Fires on a drag, on a resize, on the async restore of a saved box, and on a
   * refit. NOT for the initial placement, which is the size the addon asked for
   * and therefore already holds.
   */
  onMove?: (box: FrameBox) => void;
}

interface Chrome {
  el: HTMLElement;
  handle: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  close: HTMLButtonElement | null;
}

interface ChromeDeps {
  doc: Document;
  fqid: string;
  chrome: FrameChrome;
  opts: FrameOpts;
}

/**
 * The class list, and the one place `panel` is decided.
 *
 * `panel` is the GAME's class, worn so a frame inherits the game's border,
 * background and tokens rather than shipping a copy that a restyle would leave
 * behind. A bare frame must not wear it: it is not a panel, and the border it
 * brings is the whole of what a bare frame looks like once the background is
 * gone. An empty one then collapses to that border and reads as a stray dot on
 * the HUD, which is what this was found doing.
 */
function frameClasses(chrome: FrameChrome, density: FrameDensity, pointer: FramePointer): string {
  const variants = `woc-chrome-${chrome} woc-density-${density} woc-pointer-${pointer}`;
  if (density === 'bare') {
    return `woc-window woc-addon-frame ${variants}`;
  }
  return `woc-window panel woc-addon-frame ${variants}`;
}

/** A window is a dialog the player opened; a frame is grouped HUD furniture. */
function roleFor(chrome: FrameChrome): string {
  if (chrome === 'window') {
    return 'dialog';
  }
  return 'group';
}

/**
 * Whether this frame gets a close button.
 *
 * A window always does: it is a panel the player opens and closes, and that is
 * what makes it a window. A frame does so only when it ASKS, because a frame is
 * ordinarily a HUD readout that lives on screen and is toggled by a keybind.
 *
 * The option is refused on a bare frame, and that refusal is the same one
 * `densityOf` makes about a bare window: the button lives in a title bar that
 * `bare` removes, so honouring it would be a promise with nowhere to keep it. A
 * bare frame is dismissed by its keybind or by the unlock mode, which is what
 * those exist for.
 */
function wantsClose(opts: FrameOpts, chrome: FrameChrome, density: FrameDensity): boolean {
  if (chrome === 'window') {
    return true;
  }
  return opts.closable === true && density !== 'bare';
}

/** The close button, or null for a frame that did not ask for one. */
function buildClose(doc: Document, wanted: boolean): HTMLButtonElement | null {
  if (!wanted) {
    return null;
  }
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'woc-close x-btn';
  // Markup the loader authored, never anything an addon supplied. One geometry,
  // shared with the manager's own close button: see kit/close-glyph.ts.
  close.innerHTML = closeGlyphMarkup();
  close.setAttribute('aria-label', 'Close');
  return close;
}

function buildChrome(deps: ChromeDeps): Chrome {
  const { doc, opts } = deps;
  const density = densityOf(opts, deps.chrome);

  const el = doc.createElement('section');
  el.className = frameClasses(deps.chrome, density, pointerOf(opts, density));
  if (opts.className !== undefined) {
    el.classList.add(opts.className);
  }
  // Attributes rather than ids: two addons may legitimately both call a frame
  // 'main', and a duplicate id would make document.getElementById a coin flip.
  el.setAttribute('data-woc-addon', deps.fqid);
  el.setAttribute('data-woc-frame', opts.id);
  el.setAttribute('role', roleFor(deps.chrome));

  const handle = doc.createElement('header');
  handle.className = 'woc-titlebar panel-title';

  const title = doc.createElement('span');
  title.className = 'woc-title';
  title.textContent = opts.title ?? '';
  handle.appendChild(title);
  el.setAttribute('aria-label', opts.title ?? opts.id);

  const close = buildClose(doc, wantsClose(opts, deps.chrome, density));
  if (close !== null) {
    handle.appendChild(close);
  }

  const body = doc.createElement('div');
  body.className = 'woc-frame-body';

  // A bare frame has no title bar in the document at all, rather than one hidden
  // by a rule: a hidden bar is still a hit area and still a row in the
  // accessibility tree. The title node is still built and still written by
  // `setTitle`, because the frame's accessible name comes off `aria-label` and
  // an overlay with no name at all is worse than an unseen one.
  if (density === 'bare') {
    el.append(body);
    return { el, handle: el, title, body, close };
  }

  el.append(handle, body);
  return { el, handle, title, body, close };
}

export type { Chrome, ChromeDeps, FrameChrome, FrameDensity, FrameOpts, FramePointer };
export { buildChrome };
