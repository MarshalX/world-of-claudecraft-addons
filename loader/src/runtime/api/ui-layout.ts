// The layout vocabulary an addon lays its own panel out with.
//
// Split from api/ui.ts on the seam that file already uses for anchors and
// injections: this is the one family there that needs no disposal bag. These are
// plain elements the addon appends into its own frame, and the frame's teardown
// takes the whole tree with it. Contrast a bar, a tile or a list, each of which the
// addon may put in DOM the loader does not own and each of which holds something of
// its own to release. `show`, `units` and `itemCell` build nothing at all.

import { ITEM_CELL_PX } from '../ui/kit/item-cell.ts';
import { createColumn, createLine, createRow, show } from '../ui/kit/layout.ts';
import { units } from '../ui/kit/units.ts';

interface LayoutDeps {
  doc: Document;
}

interface LayoutSurface {
  column: (opts?: Parameters<typeof createColumn>[1]) => HTMLElement;
  row: (opts?: Parameters<typeof createRow>[1]) => HTMLElement;
  line: (opts?: Parameters<typeof createLine>[1]) => HTMLElement;
  show: typeof show;
  units: typeof units;
  itemCell: number;
}

function layoutSurface(deps: LayoutDeps): LayoutSurface {
  return {
    column: (opts) => createColumn(deps.doc, opts),
    row: (opts) => createRow(deps.doc, opts),
    line: (opts) => createLine(deps.doc, opts),
    show,
    units,
    itemCell: ITEM_CELL_PX,
  };
}

export type { LayoutSurface };
export { layoutSurface };
