// Cooldown Bars on the stage. This is `main.test.ts`'s `start()` without the assertions; keep it
// that way, or the scenario describes a second, unchecked world.
//
// `system_unstuck` (the game's anti-relog timer, not an ability) is deliberately off the
// spellbook so the preview shows a measured row with its `?` mark beside the resolved ones.
// Fell Shot is deliberately not in the cooldown map: the game deletes that entry while any
// charge is left.

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
 * The spellbook in the game's own shape, with `cooldown` the resolved length. `counter_shot` and
 * `rapid_fire` are left out on purpose so they take the measured path and the mark.
 *
 * Every ability drawn here must ship art on BOTH live and pbe: a preview records no channel, so
 * a channel-only icon makes the picture true on one and false on the other.
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
 * The session this hunter logged in with. The class belongs here rather than in `run`: skill art
 * is filed under it, and a row built before it is set draws blank forever.
 */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.world, 'known', KNOWN);
}

/**
 * The charge wire, keyed by ability id (an entry pair because the game owns the key's naming).
 * `maxCharges` is the zero the client holds; the pool size has to come from the spellbook.
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
    // The column is sized for its budget, so the default of eight would photograph dead space.
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
    // Vitest cannot see a stylesheet colour. The learned abilities tint and the rest stay grey.
    id: 'tinted',
    label: 'Tinted by damage school',
    settings: { layout: 'bars', 'max-bars': SHOWN_TIMERS, 'tint-school': true },
    world: aHunter,
    run: onCooldown,
  },
  {
    // The state a panel spends most of its life in.
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
