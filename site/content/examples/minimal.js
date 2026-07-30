/// <reference types="@woc-addons/types" />

// The smallest addon that does something, and the one the landing page shows.
//
// A real file rather than prose in a template, so it is linted and typechecked
// like everything else and cannot drift from the API it claims to demonstrate.
// The landing page includes the `whole` region; the Quickstart walks the same
// file a piece at a time.

// The object literal is broken across lines deliberately. This block is rendered
// in a 510px column on the landing page, and a 71-character line overflows it: the
// reader's first sight of the API would be a sentence cut off mid-word. Keep every
// line here under about 55 characters.
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
