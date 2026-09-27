// A button on the game's micro-button rail.
//
// One insert, not an observer: the game builds the rail once with the HUD, and the caller
// waits for the HUD first (ui/hud-mount.ts). The loader's button goes after the game-menu
// button, and addon buttons follow it in registration order.
//
// The glyph is inline SVG. Do not use the game's [data-icon]: it hydrates from a closed
// registry of the game's own names, so a guessed name renders nothing or the wrong icon.

import { ANCHORS, GAME_MICRO_BUTTON_CLASS } from './anchors.ts';

/** The loader's own button, the one that opens the manager. */
const BUTTON_ID = 'woc-addons-micro-button';

/**
 * The id prefix every loader-owned rail button carries. A new button goes after the LAST
 * one, or the group would come out in reverse registration order.
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

  // after() rather than appendChild() keeps the group in place if the game appends later.
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
