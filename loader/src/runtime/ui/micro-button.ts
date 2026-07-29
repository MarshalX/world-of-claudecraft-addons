// A button on the game's micro-button rail.
//
// One insert rather than an observer, unlike the game menu: the rail is built
// once with the rest of the HUD and the game never rebuilds it. It does not
// exist before world entry though, so the caller waits for the HUD first (see
// ui/hud-mount.ts).
//
// The loader's own button is placed after the game-menu button, which is the
// rail's last entry, so the two menu routes sit together and the ordering does
// not depend on how many buttons the game adds above them. Addon buttons follow
// it, in the order the addons asked for them.
//
// The glyph is an inline SVG rather than the game's data-icon mechanism. The
// game hydrates [data-icon] from a closed registry of its own names, so
// borrowing that attribute would either render nothing or, worse, silently pick
// up whatever the game later assigns to a name we guessed.

import { ANCHORS, GAME_MICRO_BUTTON_CLASS } from './anchors.ts';

/** The loader's own button, the one that opens the manager. */
const BUTTON_ID = 'woc-addons-micro-button';

/**
 * The id prefix every loader-owned rail button carries.
 *
 * A new button goes after the LAST one already there rather than after the
 * loader's own, or every addon button would be inserted directly after it and
 * the group would come out in reverse registration order.
 */
const LOADER_BUTTON_SELECTOR = '[id^="woc-"]';

/** A plug outline, drawn to sit on the same 24-unit grid as the game's own glyphs. */
const GLYPH = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5" />
</svg>`;

export interface MicroButtonDeps {
  doc: Document;
  /** Unique per button: the loader's own, plus one per addon that asks for one. */
  id: string;
  label: string;
  onOpen: () => void;
  /** Inline SVG markup. Defaults to the loader's plug glyph. */
  glyph?: string;
}

export interface MicroButton {
  /** The button, or null when the rail was not found. */
  el: HTMLButtonElement | null;
  dispose: () => void;
}

export function mountMicroButton(deps: MicroButtonDeps): MicroButton {
  const { doc } = deps;
  const column = doc.querySelector(ANCHORS.microColumn);
  if (column === null) {
    return { el: null, dispose: () => undefined };
  }

  const existing = doc.getElementById(deps.id);
  if (existing !== null) {
    return { el: existing as HTMLButtonElement, dispose: () => existing.remove() };
  }

  const button = doc.createElement('button');
  button.type = 'button';
  button.id = deps.id;
  button.className = GAME_MICRO_BUTTON_CLASS;
  button.title = deps.label;
  button.setAttribute('aria-label', deps.label);
  button.innerHTML = deps.glyph ?? GLYPH;
  button.addEventListener('click', deps.onOpen);

  // After the last loader button already on the rail, so the whole loader group
  // stays together and in registration order; otherwise after the game-menu
  // button, which is where the loader's own goes. after() rather than
  // appendChild() keeps the group in place even if the game appends its own
  // buttons later.
  const ours = [...column.querySelectorAll(LOADER_BUTTON_SELECTOR)];
  const anchor = ours.at(-1) ?? column.querySelector(ANCHORS.microOptions);
  if (anchor === null) {
    column.appendChild(button);
  } else {
    anchor.after(button);
  }

  return { el: button, dispose: () => button.remove() };
}

export { BUTTON_ID, GLYPH };
