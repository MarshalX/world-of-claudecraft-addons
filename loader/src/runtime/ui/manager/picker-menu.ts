// Which menu the manager's dropdowns open, held for the whole manager.
//
// Module state, deliberately. There is exactly one menu in the loader and exactly one manager,
// so the alternative is threading an opener through five components that have no other reason
// to know about it. It sits beside the stores that already live this way, and it is in its own
// module rather than in `picker.tsx` because a file exporting a component may export nothing
// else.
//
// A picker rendered before this is set opens nothing rather than throwing, which is the same
// answer as a manager that never mounted.

import type { MenuItem } from '../kit/menu.ts';
import type { OpenMenu } from '../kit/picker.ts';

let opener: OpenMenu | null = null;

/** Point every dropdown in the manager at the loader's one menu. Called once, at mount. */
function setPickerMenu(open: OpenMenu): void {
  opener = open;
}

function openPickerMenu(at: Element, items: readonly MenuItem[]): void {
  opener?.(at, items);
}

export { openPickerMenu, setPickerMenu };
