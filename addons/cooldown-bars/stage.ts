// Cooldown Bars on the stage: what to put on screen so a picture says what it is.
//
// This is `main.test.ts`'s `start()` with the assertions taken out, and keeping it
// that way is the point rather than laziness. The suite's fixture is the only
// description of this addon's world anybody has checked, so a scenario that
// invented its own would be a second one, drifting, with a screenshot as the only
// place the difference showed.
//
// Three things in it are load-bearing and none of them are cosmetic.
//
// `templateId: 'hunter'` on the player is the CLASS, which is the directory the
// game files skill art under. Without it there is nothing to build an icon URL
// from and every bar draws with an empty icon slot, which is a picture of a bug
// this addon does not have.
//
// The spellbook is the source of BOTH things this addon cannot read off the wire:
// an ability's display name and the real length of its cooldown. `arcane_shot` is
// shown as "Fell Shot" everywhere in the game, which is exactly the divergence a
// label derived from the id gets wrong, so it is in the shot on purpose.
//
// `rapid_fire` is deliberately NOT in the spellbook. It stands for the whole
// residue an addon cannot resolve: an item cooldown, or an ability granted from
// outside the class kit. It draws with a title-cased id and a measured
// denominator, and a preview that showed only resolvable rows would be claiming
// a completeness this addon does not have.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** Seconds remaining, longest last, which is the order the panel sorts into. */
const REMAINING_PAIRS = Object.freeze([
  ['rapid_fire', 4.4],
  ['arcane_shot', 5.8],
  ['counter_shot', 10.4],
  ['twinstrike', 97.5],
  ['aimed_shot', 155.5],
] as const);

/** Resolved lengths, from the spellbook, which is what a bar measures against. */
const ARCANE_SHOT_LENGTH = 8;
const AIMED_SHOT_LENGTH = 180;
const TWINSTRIKE_LENGTH = 120;

/** A charge pool of two, one spent. `maxCharges` is zero-filled on the wire. */
const POOL_CHARGES = 1;
const POOL_RECHARGE = 97.5;

/** The class whose art directory the icons come from. */
const CLASS_ID = 'hunter';

/**
 * The spellbook in the game's own shape.
 *
 * `cooldown` here is the RESOLVED length at the rank the player has learned,
 * which is the number the game itself works from and the only honest denominator
 * for a draining bar.
 */
const KNOWN = Object.freeze([
  {
    def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
    rank: 3,
    cost: 55,
    castTime: 0,
    cooldown: ARCANE_SHOT_LENGTH,
  },
  {
    def: { id: 'aimed_shot', name: 'Aimed Shot', school: 'physical', requiresTarget: true },
    rank: 2,
    cost: 75,
    castTime: 2,
    cooldown: AIMED_SHOT_LENGTH,
  },
  {
    def: { id: 'twinstrike', name: 'Twinstrike', school: 'physical', requiresTarget: true },
    rank: 1,
    cost: 30,
    castTime: 0,
    cooldown: TWINSTRIKE_LENGTH,
    charges: 2,
  },
]);

/**
 * The session this hunter logged in with, before the addon has run a line.
 *
 * The class and the spellbook are both here rather than in `run`, and the class
 * is the one that bites: a skill icon is filed under it, so a bar built for a
 * cooldown that is already running when the addon starts asks for its icon before
 * a class set later would exist. Those rows draw blank and are never redrawn.
 */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.world, 'known', KNOWN);
}

/** The world every scenario here shares: a hunter mid-fight with five timers up. */
function onCooldown(stage: Stage): void {
  const { player } = stage;
  stage.set(player, 'cooldowns', new Map<string, number>(REMAINING_PAIRS));
  stage.set(player, 'abilityCharges', {
    twinstrike: {
      charges: POOL_CHARGES,
      // Zero on the wire and permanently so: the server keeps the maximum to
      // itself. Reproduced rather than filled in, because an addon reading it as
      // a real maximum is the trap this field is famous for.
      maxCharges: 0,
      recharge: POOL_RECHARGE,
      rechargeLength: TWINSTRIKE_LENGTH,
    },
  });
  stage.poll();
  stage.frame();
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'bars',
    label: 'Five draining bars',
    preview: true,
    caption: 'Bars',
    alt: 'five draining bars ordered by time remaining, Rapid Fire 4.4s, Fell Shot 5.8s, Counter Shot 10.4s, Twinstrike 97.5s with one of two charges back, and Aimed Shot 155.5s, each row carrying the ability art the game files under its id except Twinstrike, for which the game ships none.',
    settings: { layout: 'bars' },
    world: aHunter,
    run: onCooldown,
  },
  {
    id: 'tiles',
    label: 'Swept icon strip',
    preview: true,
    caption: 'Icon strip',
    alt: 'the same five cooldowns as a row of square icons, each darkened by a sweep showing how much of its cooldown is left, with the seconds remaining over the art.',
    settings: { layout: 'tiles' },
    world: aHunter,
    run: onCooldown,
  },
  {
    // The state a panel spends most of its life in, and the one nobody thinks to
    // photograph. An overlay that looks right full and wrong empty is a thing a
    // player sees far more often than the picture on its Browse row.
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
