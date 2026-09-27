/// <reference types="@woc-addons/types" />

// The smallest addon that does something. The landing page and the Quickstart
// include the `whole` region; it is a real file so it is linted and typechecked.

// Keep every line under about 55 characters: the landing page renders this in a
// 510px column, so the object literal is broken across lines deliberately.
// #region whole
const win = woc.ui.frame({
  id: 'main',
  title: 'My Addon',
  save: true,
});

woc.net.onEvent('damage', (event) => {
  win.body.textContent = String(event.amount);
});

woc.keys.bind('toggle', () => {
  win.toggle();
  woc.sound.play('ui_click');
});
// #endregion
