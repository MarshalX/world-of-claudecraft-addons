// One frame's own chrome: the element, the title bar, the close button, and how
// tightly all three are drawn.
//
// Split out of frame.ts because it shares nothing with what is left there. That
// file owns placement and lifecycle (the drag and clamp rules, the saved box, the
// teardown); this one builds DOM from options and then never touches it again.
// The density variant landed here and pushed the pair over the file limit, which
// was the prompt rather than the reason: the seam was always in this place.

import { closeGlyphMarkup } from './close-glyph.ts';

type FrameChrome = 'frame' | 'window';

/**
 * How tightly a frame's own chrome is drawn.
 *
 * An enum rather than a `compact: true` flag because the axis has more than two
 * useful positions in it and a boolean cannot grow one: the next thing anyone
 * wants here is a borderless overlay, and `compact: true, bare: true` is how a
 * flag set turns into a matrix nobody can reason about.
 *
 * `comfortable` is the default and is what the manager is drawn at: 16px labels
 * on a 40px minimum, which is the mobile tap-target floor the game itself holds
 * to. `compact` is for a dense readout an addon glances at rather than operates,
 * where that floor makes the chrome the loudest thing on screen. It is the
 * addon's call, because only the addon knows which of the two it is.
 */
type FrameDensity = 'comfortable' | 'compact';

const DENSITIES: readonly FrameDensity[] = ['comfortable', 'compact'];

function densityOf(opts: FrameOpts): FrameDensity {
  if (opts.density !== undefined && DENSITIES.includes(opts.density)) {
    return opts.density;
  }
  return 'comfortable';
}

interface FrameOpts {
  /** Unique within the addon. It is the persistence key, so it must be stable. */
  id: string;
  title?: string;
  width?: number;
  height?: number;
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

/** A window is a dialog the player opened; a frame is grouped HUD furniture. */
function roleFor(chrome: FrameChrome): string {
  if (chrome === 'window') {
    return 'dialog';
  }
  return 'group';
}

/** The close button, or null for a frame, which deliberately has none. */
function buildClose(doc: Document, chrome: FrameChrome): HTMLButtonElement | null {
  if (chrome !== 'window') {
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

  const el = doc.createElement('section');
  el.className =
    `woc-window panel woc-addon-frame woc-chrome-${deps.chrome} ` +
    `woc-density-${densityOf(opts)}`;
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

  const close = buildClose(doc, deps.chrome);
  if (close !== null) {
    handle.appendChild(close);
  }

  const body = doc.createElement('div');
  body.className = 'woc-frame-body';

  el.append(handle, body);
  return { el, handle, title, body, close };
}

export type { Chrome, ChromeDeps, FrameChrome, FrameDensity, FrameOpts };
export { buildChrome };
