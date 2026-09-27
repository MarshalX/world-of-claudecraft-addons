// The loader's UI kit, assembled from its sheets into one string.
//
// Concatenated rather than chained with @import: loader/build-runtime.mjs loads a .css import
// as TEXT, so an @import would survive into the sheet and resolve against the game's origin.
//
// Every rule is scoped to a loader-owned element, so order is mostly readability, with two
// exceptions. The reduced-motion floor at the end of kit.css is !important, since it must
// outrank every later rule. touch.css must be LAST: it matches the (1,2,0) density variants
// and wins on source order alone.
//
// Injected UNLAYERED by runtime/ui/root.ts, so it beats every (layered) game rule whatever
// the specificity; hence the scoping to #woc-addons or the loader's own rail button id.
//
// Colours, fonts and radii come from the game's :root custom properties, each var() with a
// fallback. Only some follow the game's theme picker, exactly as on the game's own windows;
// do not add contrast fixes the game's own panels lack.

// biome-ignore-start lint/correctness/noUnresolvedImports: loader/build-runtime.mjs loads .css as text, which a static resolver does not model
import banner from './banner.css';
import bar from './bar.css';
import catalog from './catalog.css';
import chrome from './chrome.css';
import kit from './kit.css';
import layout from './layout.css';
import menu from './menu.css';
import panes from './panes.css';
import picker from './picker.css';
import quality from './quality.css';
import tile from './tile.css';
import touch from './touch.css';
import unitClass from './unit-class.css';

// biome-ignore-end lint/correctness/noUnresolvedImports: the thirteen sheets above are the whole of it

const LOADER_CSS = [
  chrome,
  panes,
  catalog,
  layout,
  kit,
  menu,
  picker,
  quality,
  unitClass,
  bar,
  tile,
  banner,
  touch,
].join('\n');

export { LOADER_CSS };
