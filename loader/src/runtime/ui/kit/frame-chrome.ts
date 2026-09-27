// One frame's own chrome: the element, the title bar, the close button, and how tightly all
// three are drawn. Built once from options; kit/frame.ts owns placement and lifecycle.

import type { FrameBox } from '../frame/geometry.ts';
import { closeGlyphMarkup } from './close-glyph.ts';

type FrameChrome = 'frame' | 'window';

/**
 * How tightly a frame's own chrome is drawn. An enum, not a flag, because the axis has three
 * positions.
 *
 * `comfortable` (default) is the game's own desktop window scale, 13px tabs and buttons under
 * a 15px title. `compact` is tighter, for a dense readout. `bare` removes the panel, padding
 * and title bar. The touch tap floor (ui/styles/touch.css) applies to all of them.
 */
type FrameDensity = 'comfortable' | 'compact' | 'bare';

const DENSITIES: readonly FrameDensity[] = ['comfortable', 'compact', 'bare'];

/**
 * Which parts of a frame take the pointer, and therefore which parts of the world behind it
 * the player cannot click. The game binds `mousedown` and `wheel` to the canvas, so a covering
 * element consumes targeting, camera look and zoom, and nothing can forward them on.
 *
 * `auto` is the whole box. `content` makes the box transparent and leaves what the addon DREW
 * live, so gaps fall through while rows keep hover and tooltips. `none` is inert. The unlock
 * mode forces every frame back to `auto`.
 */
type FramePointer = 'auto' | 'content' | 'none';

const POINTERS: readonly FramePointer[] = ['auto', 'content', 'none'];

/**
 * A bare frame is `content` unless it says otherwise, and every other one is `auto`: a panel
 * with holes ignores the player, while a bare frame's empty space is invisible.
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
 * A window is never bare, since its close button lives in the title bar `bare` removes. An
 * unrecognised value also falls back to comfortable, so a typo cannot drop the floor.
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
  /** Draw a close button in the title bar. A window always has one; a `bare` frame never does. */
  closable?: boolean;
  /**
   * How wide it opens, and for a frame not resizable across, its fixed width (see kit/frame-size.ts
   * applyWidth).
   */
  width?: number;
  /** How tall it opens. A frame that is not resizable ignores it and follows its content. */
  height?: number;
  /**
   * How far the player may shrink it. Defaults to the opening size (see kit/frame-size.ts
   * sizeBounds).
   */
  minWidth?: number;
  minHeight?: number;
  /** How far the player may grow it. Defaults to the viewport. */
  maxWidth?: number;
  maxHeight?: number;
  /** Persist position and visibility for this character. */
  save?: boolean;
  /** Which axes the player may resize. Defaults to true for a window, false for a frame. */
  resizable?: boolean | 'width' | 'height';
  /** Whether it starts on screen. Ignored when a saved visibility is restored. */
  visible?: boolean;
  /**
   * A keybind id from the addon's manifest that toggles this frame. An undeclared id warns and
   * binds nothing.
   */
  toggleKey?: string;
  /** Added to the frame element, so an addon can style its own. */
  className?: string;
  /** How tightly the loader's own chrome is drawn. Defaults to 'comfortable'. */
  density?: FrameDensity;
  /** Which parts take the pointer. Defaults to 'content' when bare, else 'auto'. */
  pointer?: FramePointer;
  /**
   * Where the frame ended up, after every move the loader made, so an addon need not measure.
   * Fires on a drag, a resize, the restore of a saved box and a refit; NOT for the initial
   * placement (see `box()`).
   */
  onMove?: (box: FrameBox) => void;
}

interface Chrome {
  el: HTMLElement;
  handle: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  close: HTMLButtonElement | null;
  /**
   * The density this frame ended up at, after `densityOf`'s fallbacks. Read this, not
   * `opts.density`.
   */
  density: FrameDensity;
}

interface ChromeDeps {
  doc: Document;
  fqid: string;
  /**
   * The owning addon's manifest name, for the arrange-mode chip. Absent falls back to
   * the fqid: a poor label but a true one, where a title-cased id would be an invented name.
   */
  addonName?: string | undefined;
  chrome: FrameChrome;
  opts: FrameOpts;
}

/**
 * What the arrange-mode chip says: whose frame this is, and which of theirs. Composed here
 * into one attribute, since the sheet's `attr()` can reach only the fqid.
 */
function frameLabel(addon: string, frame: string): string {
  return `${addon} · ${frame}`;
}

/** The chip for one frame, from what its builder was given. */
function labelFor(deps: ChromeDeps): string {
  return frameLabel(deps.addonName ?? deps.fqid, deps.opts.title ?? deps.opts.id);
}

/** Where the chip's text lives, so `setTitle` can keep it in step. */
const LABEL_ATTR = 'data-woc-label';

/**
 * The class list, and the one place the game's `panel` class is decided. A bare frame must
 * not wear it: an empty one collapses to the panel border and reads as a stray dot.
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
 * Whether this frame gets a close button: a window always, a frame only when it asks, and a
 * bare frame never, having no title bar.
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
  // Loader-authored markup only (kit/close-glyph.ts).
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
  // Attributes rather than ids: two addons may both call a frame 'main'.
  el.setAttribute('data-woc-addon', deps.fqid);
  el.setAttribute('data-woc-frame', opts.id);
  el.setAttribute(LABEL_ATTR, labelFor(deps));
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

  // A bare frame has no title bar in the document, since a hidden one is still a hit area and
  // an accessibility-tree row. The title node is still built, for `setTitle` and `aria-label`.
  if (density === 'bare') {
    el.append(body);
    return { el, handle: el, title, body, close, density };
  }

  el.append(handle, body);
  return { el, handle, title, body, close, density };
}

export type { Chrome, ChromeDeps, FrameChrome, FrameDensity, FrameOpts, FramePointer };
export { buildChrome, frameLabel, LABEL_ATTR };
