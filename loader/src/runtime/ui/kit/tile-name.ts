// What a tile is announced as.
//
// A tile's face is all art, so its accessible name is composed from three parts and
// recomposed per update, per frame, nearly always to the same string.

/**
 * What the tile currently says, and the name last written, so an unchanged name is not
 * rewritten. It starts null to match the `aria-hidden` a freshly built tile carries.
 */
interface TileState {
  label: string | null;
  value: string;
  count: number | null;
  name: string | null;
}

/**
 * One accessible name for the whole tile, announced as one image. A tile with NO label is
 * hidden from assistive technology, since a bare "4.2" is worse than silence.
 */
function composeName(state: TileState): string | null {
  if (state.label === null) {
    return null;
  }
  const said = [state.label];
  if (state.value.length > 0) {
    said.push(state.value);
  }
  if (state.count !== null) {
    said.push(String(state.count));
  }
  return said.join(', ');
}

/**
 * Announce the tile as what it now says, and only when that moved. `role` and `aria-hidden`
 * are written only when the tile gains or loses its name.
 */
function applyName(el: HTMLElement, state: TileState): void {
  const name = composeName(state);
  if (name === state.name) {
    return;
  }
  const was = state.name;
  state.name = name;
  if (name === null) {
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.setAttribute('aria-hidden', 'true');
    return;
  }
  if (was === null) {
    el.removeAttribute('aria-hidden');
    el.setAttribute('role', 'img');
  }
  el.setAttribute('aria-label', name);
}

export type { TileState };
export { applyName, composeName };
