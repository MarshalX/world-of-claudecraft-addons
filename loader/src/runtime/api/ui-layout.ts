// The layout vocabulary for an addon's own panel. Needs no disposal bag: these are plain elements
// inside the addon's frame, whose teardown takes them. `show`, `units` and `itemCell` build
// nothing.

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
