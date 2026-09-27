// Which addons the landing page and the README show a picture of: the one editorial decision in
// either, since everything else about a featured addon is read from its own `addon.json`. Each
// entry should be a different reason to install. Every id MUST declare a preview: the site build
// throws from `Context.preview` and `pnpm readme` refuses to write without one.
const FEATURED = ['combat-meter', 'satchel', 'facemark', 'trailmark', 'ledgerline'] as const;

/** Small counts spelled out and capitalized, for the sentence that says how many pictures follow. */
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** A count as a word that starts a sentence: `spellOut(5)` is "Five". */
function spellOut(count: number): string {
  return WORDS[count] ?? String(count);
}

export { FEATURED, spellOut };
