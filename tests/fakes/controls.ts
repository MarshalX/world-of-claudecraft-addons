// Driving the loader's own controls from a suite, the way a player drives them.
//
// One control needs this and the others do not: a dropdown is no longer a `<select>` whose
// value a case can assign, it is a button that opens the loader's ONE menu, so choosing an
// option is a click and then a click. Every suite that did the former was written against a
// native control, and every one of them broke on the same day for the same reason, which is
// what earned a shared helper rather than the same eight lines in four files.
//
// It drives the REAL menu, which is what the shared services already build: a case that
// stubbed the opener would prove its own stub opens. That also means the menu is in the
// document between the two calls, exactly as it is for a player.

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

/**
 * Choose an option by its label, through the menu, and let the menu close behind it.
 *
 * A no-op for a label nothing offers rather than a throw: a case asserting that an option is
 * GONE reads better as an unchanged panel than as a caught error.
 */
function choosePicker(within: ParentNode, label: string): void {
  pickerIn(within)?.click();
  menuItems()
    .find((item) => item.textContent === label)
    ?.click();
}

export { choosePicker, pickerIn, pickerOptions, pickerValue };
