// Which menu the manager's dropdowns open. Module state, since there is one menu and one manager;
// its own module because a file exporting a component (picker.tsx) may export nothing else. A
// picker rendered before this is set opens nothing.

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
