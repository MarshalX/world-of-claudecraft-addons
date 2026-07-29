// The Addons button on the game's micro-button rail.
//
// One insert rather than an observer, unlike the game menu: the rail is built
// once with the rest of the HUD and the game never rebuilds it. It does not
// exist before world entry though, so the caller waits for the HUD first (see
// ui/hud-mount.ts).
//
// The button is placed after the game-menu button, which is the rail's last
// entry, so the two menu routes sit together and the ordering does not depend on
// how many buttons the game adds above them.
//
// The glyph is our own inline SVG rather than the game's data-icon mechanism.
// The game hydrates [data-icon] from a closed registry of its own names, so
// borrowing that attribute would either render nothing or, worse, silently pick
// up whatever the game later assigns to a name we guessed.

import { ANCHORS, GAME_MICRO_BUTTON_CLASS } from './anchors.ts';

const BUTTON_ID = 'woc-addons-micro-button';

/** A plug outline, drawn to sit on the same 24-unit grid as the game's own glyphs. */
const GLYPH = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5" />
</svg>`;

export interface MicroButtonDeps {
  doc: Document;
  label: string;
  onOpen: () => void;
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

  const existing = doc.getElementById(BUTTON_ID);
  if (existing !== null) {
    return { el: existing as HTMLButtonElement, dispose: () => existing.remove() };
  }

  const button = doc.createElement('button');
  button.type = 'button';
  button.id = BUTTON_ID;
  button.className = GAME_MICRO_BUTTON_CLASS;
  button.title = deps.label;
  button.setAttribute('aria-label', deps.label);
  button.innerHTML = GLYPH;
  button.addEventListener('click', deps.onOpen);

  // after() rather than appendChild(), so the button keeps its place next to the
  // game menu even if the game later appends more of its own.
  const menuButton = column.querySelector(ANCHORS.microOptions);
  if (menuButton === null) {
    column.appendChild(button);
  } else {
    menuButton.after(button);
  }

  return { el: button, dispose: () => button.remove() };
}
