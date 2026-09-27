// Drives the loader's dropdowns as a player does: a click on the picker button, then a click on a
// row of the real shared menu. A stubbed opener would only prove the stub opens.

/** The dropdown inside a field, or inside the whole document when nothing is named. */
function pickerIn(within: ParentNode = document): HTMLButtonElement | null {
  return within.querySelector<HTMLButtonElement>('button.woc-picker');
}

function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('#woc-menu .woc-menu-item')];
}

/** What one dropdown offers, in the order it offers it. Leaves the menu open. */
function pickerOptions(within: ParentNode = document): string[] {
  pickerIn(within)?.click();
  return menuItems().map((item) => item.textContent ?? '');
}

/** What the dropdown currently reads, which is the chosen option rather than the field's name. */
function pickerValue(within: ParentNode = document): string {
  return pickerIn(within)?.querySelector('.woc-picker-value')?.textContent ?? '';
}

/** Choose an option by label through the menu. A label nothing offers is a no-op, not a throw. */
function choosePicker(within: ParentNode, label: string): void {
  pickerIn(within)?.click();
  menuItems()
    .find((item) => item.textContent === label)
    ?.click();
}

export { choosePicker, pickerIn, pickerOptions, pickerValue };
