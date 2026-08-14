// Cooldown Bars on the stage: what to put on screen so a picture says what it is.
//
// This is `main.test.ts`'s `start()` with the assertions taken out, and keeping it that way is
// the point: the suite's fixture is the only description of this addon's world anybody has
// checked, so a scenario that invented its own would be a second one, drifting.
//
// Every id, name and length here is the game's own, read off the class table the deployed client
// ships. Four things in it are load-bearing.
//
// `templateId: 'hunter'` on the player is the class, which is the directory the game files skill
// art under. Without it there is nothing to build an icon URL from and every bar draws with an
// empty icon slot, which is a picture of a bug this addon does not have.
//
// The spellbook is the source of both things this addon cannot read off the wire: an ability's
// display name and the real length of its cooldown. Both entries are shown under a name an id
// cannot be turned into, `arcane_shot` as "Fell Shot" and `bestial_wrath` as "Howling Rage".
//
// Fell Shot's pool of two is a talent's doing, and it is the hunter's one resolved-after-talents
// fact. The content table gives that ability no `maxCharges` at all; the Twin Fletching row is
// what turns it into a pool of two on the spellbook, which is where the "1/2" on that row comes
// from. `maxCharges` on the wire is the zero the client fills in, reproduced here so that a
// reading which trusted it would draw "1 of 0". The ability is deliberately not also in the
// cooldown map: the game deletes that entry while any charge is left.
//
// `system_unstuck` is deliberately not in the spellbook, and it is the residue rather than a
// stand-in for it: a real key of the game's own cooldown map, the five-minute anti-relog timer,
// shipped in the `cds` payload unfiltered and provably not an ability. So it draws a title-cased
// id with the question mark that says the name was worked out, a measured denominator, and no
// icon. A preview showing only resolvable rows would claim a completeness this addon does not
// have, and the marker is how a row says which kind it is without a legend under the list.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** Seconds remaining, longest last, which is the order the panel sorts into. */
const REMAINING_PAIRS = Object.freeze([
  ['counter_shot', 10.4],
  ['rapid_fire', 41.2],
  ['bestial_wrath', 97.5],
  ['system_unstuck', 155.5],
] as const);

/** Everything drawn here: the four timers above, and the charge pool below them. */
const SHOWN_TIMERS = REMAINING_PAIRS.length + 1;

/** Resolved lengths, from the spellbook, which is what a bar measures against. */
const FELL_SHOT_LENGTH = 6;
const HOWLING_RAGE_LENGTH = 120;

/** Fell Shot's pool under Twin Fletching: two uses, one spent and coming back. */
const POOL_SIZE = 2;
const POOL_CHARGES = 1;
const POOL_RECHARGE = 4.4;

/** The class whose art directory the icons come from. */
const CLASS_ID = 'hunter';

/**
 * The spellbook in the game's own shape.
 *
 * `cooldown` here is the resolved length at the rank the player has learned, which is the number
 * the game itself works from and the only honest denominator for a draining bar.
 *
 * Two entries rather than four, because the two ids left out are what make the picture say
 * something. `counter_shot` and `rapid_fire` are real hunter abilities this hunter has not
 * learned, so they take the measured path and the marker, alongside `system_unstuck`, which
 * nobody can ever learn.
 *
 * Every ability drawn here ships art on both channels, and that is a requirement rather than
 * luck. A preview is one committed file, so a row whose icon depends on which game the capture
 * proxied to makes the picture true on one channel and false on the other. Live and pbe share 17
 * hunter ids and disagree about 23, so this is the normal case.
 */
const KNOWN = Object.freeze([
  {
    def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
    rank: 3,
    cost: 55,
    castTime: 0,
    cooldown: FELL_SHOT_LENGTH,
    charges: POOL_SIZE,
  },
  {
    def: { id: 'bestial_wrath', name: 'Howling Rage', school: 'physical', requiresTarget: true },
    rank: 1,
    cost: 30,
    castTime: 0,
    cooldown: HOWLING_RAGE_LENGTH,
  },
]);

/**
 * The session this hunter logged in with, before the addon has run a line. The class and the
 * spellbook are both here rather than in `run`, and the class is the one that bites: a skill icon
 * is filed under it, so a bar built for a cooldown already running when the addon starts asks
 * for its icon before a class set later would exist, and those rows draw blank forever.
 */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.world, 'known', KNOWN);
}

/**
 * The charge wire, keyed by ability id. An entry pair rather than an object literal because the
 * key is a name the game owns rather than one this file chose.
 *
 * `maxCharges` is zero on the wire and permanently so, since the server keeps the maximum to
 * itself. Reproduced rather than filled in, because an addon reading it as a real maximum is the
 * trap this field is famous for.
 */
const CHARGE_POOLS = Object.fromEntries([
  [
    'arcane_shot',
    {
      charges: POOL_CHARGES,
      maxCharges: 0,
      recharge: POOL_RECHARGE,
      rechargeLength: FELL_SHOT_LENGTH,
    },
  ],
]);

/** The world every scenario here shares: a hunter mid-fight with five timers up. */
function onCooldown(stage: Stage): void {
  const { player } = stage;
  stage.set(player, 'cooldowns', new Map<string, number>(REMAINING_PAIRS));
  stage.set(player, 'abilityCharges', CHARGE_POOLS);
  stage.poll();
  stage.frame();
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'bars',
    label: 'Five draining bars',
    preview: true,
    caption: 'Bars',
    alt: 'a column of named, draining bars, soonest ready at the top.',
    // The bar budget is set to the five timers this world holds, because the column is sized
    // for its budget rather than for what is running: left at the default of eight it would
    // photograph three rows of dead space under the picture, which in a Browse thumbnail
    // reads as a panel that failed to draw.
    settings: { layout: 'bars', 'max-bars': SHOWN_TIMERS },
    world: aHunter,
    run: onCooldown,
  },
  {
    id: 'tiles',
    label: 'Swept icon strip',
    preview: true,
    caption: 'Icon strip',
    alt: 'the same cooldowns as square icons, each swept and counting down.',
    settings: { layout: 'tiles' },
    world: aHunter,
    run: onCooldown,
  },
  {
    // The tint, which no Vitest case can answer for: a suite reads the class the kit wrote and
    // the colour is a rule in a stylesheet that resolves to '' there. It is the MIXED panel
    // that is worth looking at rather than the colour, since the two abilities this hunter has
    // learned are tinted and the three the spellbook cannot answer for stay grey.
    id: 'tinted',
    label: 'Tinted by damage school',
    settings: { layout: 'bars', 'max-bars': SHOWN_TIMERS, 'tint-school': true },
    world: aHunter,
    run: onCooldown,
  },
  {
    // The state a panel spends most of its life in. An overlay that looks right full and wrong
    // empty is a thing a player sees far more often than the picture on its Browse row.
    id: 'idle',
    label: 'Nothing on cooldown',
    settings: { layout: 'bars' },
    world: aHunter,
    run: (stage) => {
      stage.poll();
      stage.frame();
    },
  },
];

export { SCENARIOS };
