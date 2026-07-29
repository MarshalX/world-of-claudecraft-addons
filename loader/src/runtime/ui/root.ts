// The #woc-addons root element and the loader stylesheet.
//
// Addon DOM lives here rather than under the game's #ui, which the HUD rebuilds.
// The stylesheet is injected unlayered so it outranks the game's @layer rules.

export function mountRoot(): never {
  throw new Error('not implemented: addon root');
}
