// The loader's UI kit, assembled from its four sheets into one string.
//
// Concatenated here rather than chained with @import: loader/build-runtime.mjs
// loads a .css import as TEXT, and a text load never follows an @import inside
// the file, so an @import would survive into the injected sheet and then resolve
// against the game's own origin at runtime. One string is also what root.ts
// needs, since exactly one <style> element is injected and adopted.
//
// The order is the cascade. Every rule in all four is scoped to a loader-owned
// element and none of them collide across the seams, but the sheets are still
// written to be read in this order: chrome sets a window up, panes fill it,
// catalog refines the four marketplace surfaces, and the kit refines all of them
// for what an addon draws.
//
// Injected UNLAYERED by runtime/ui/root.ts. Every game rule lives inside
// @layer base or @layer components, and an unlayered rule beats any layered one
// whatever the specificity, so nothing here can be lost to a game update that
// adds a layer or reorders the ones it has. The flip side is that these rules
// also beat the game's, so they are scoped to loader-owned elements throughout:
// under #woc-addons, or by the id of the one button the loader puts in the
// game's own rail.
//
// Colors, fonts, and radii come from the game's :root custom properties, which
// are inherited here like any other, so addon UI matches the game with no copied
// palette. Each var() carries a fallback in case the game renames one.
//
// Only SOME of them follow the theme picker. src/ui/theme.ts rewrites a fixed
// set on documentElement, and of the ones read here that is --gold, --gold-dim,
// --panel-base, --panel-bg, --color-text-light, --color-text-muted,
// --color-border-default and --color-border-focus. The fonts and radii are
// static in the game too. --color-text-error and --color-text-success are NOT
// themed and read poorly on the light Parchment panel (contrast 1.68 and 1.31),
// but the game renders those same two tokens on its own themed panels, so this
// kit is exactly as theme-aware as the game's own windows. Matching it is the
// point: deviating would look wrong beside the game and would mean keeping a
// copy of theme.ts's ensureReadable in sync.

// biome-ignore-start lint/correctness/noUnresolvedImports: loader/build-runtime.mjs loads .css as text, which a static resolver does not model
import catalog from './catalog.css';
import chrome from './chrome.css';
import kit from './kit.css';
import panes from './panes.css';

// biome-ignore-end lint/correctness/noUnresolvedImports: the four sheets above are the whole of it

const LOADER_CSS = [chrome, panes, catalog, kit].join('\n');

export { LOADER_CSS };
