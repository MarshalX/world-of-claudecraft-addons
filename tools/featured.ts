// Which addons the landing page and the README show a picture of.
//
// The ONE editorial decision in either, and it is deliberately the only one:
// everything else about a featured addon (its name, its version, what it does,
// its screenshot and that screenshot's alt text) is read from its own
// `addon.json`, so nothing about an addon is written twice and a rewritten
// description reaches both pages without anyone editing them. The list that this
// replaced was three blocks of hand-written prose per page, and it described the
// two addons that existed when the site was first built for as long as it took
// somebody to notice.
//
// A handful rather than a page of them, and the test each one has to pass is that
// it is a DIFFERENT reason to install rather than another of the same reason: a
// combat readout, an inventory across every character, nameplates over the world,
// a quest tracker, and a price history for a market that keeps none. Satchel and
// Ledgerline are the pair worth watching, since both are filed under `economy`
// and they earn separate blocks anyway: one is what you own and the other is what
// it is worth. Every id here MUST declare a preview, and both consumers fail
// loudly on one that does not: the site build throws from `Context.preview` and
// `pnpm readme` refuses to write.
const FEATURED = ['combat-meter', 'satchel', 'facemark', 'trailmark', 'ledgerline'] as const;

/**
 * Small counts, spelled out, for the sentence that introduces the blocks.
 *
 * The sentence says how many pictures follow, so the number has to come from the
 * list rather than from a template: it said "Four of them" in two files for as
 * long as there were four, and a fifth would have made both of them wrong in a
 * way no test could see. Spelled out because a digit inside a sentence reads as a
 * value rather than as a count, and capitalized because both callers open a
 * sentence with it. Above nine it falls back to the digits, which is a length
 * this list is not going to reach.
 */
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** A count as a word that starts a sentence: `spellOut(5)` is "Five". */
function spellOut(count: number): string {
  return WORDS[count] ?? String(count);
}

export { FEATURED, spellOut };
