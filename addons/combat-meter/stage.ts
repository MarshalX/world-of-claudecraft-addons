// Combat Meter on the stage: three tables, and the limit that shapes all three.
//
// Like the cooldown-bars scenarios, this is `main.test.ts`'s `run()` with the
// assertions taken out, and for the same reason: the suite's fixture is the only
// description of this addon's world anybody has checked.
//
// THE ONE THING EVERY SHOT HERE HAS TO BE HONEST ABOUT is that a combat event
// names an ability by its DISPLAY NAME and never by its id, while skill art is
// filed under the id. So this addon can draw art only for abilities in YOUR OWN
// spellbook, where `world.abilities.byName` closes the join, and for everything
// else, which is most of what a mob casts, there is no icon that can be found.
// That is why it tints rows by SCHOOL: the tint reaches the rows the art cannot.
//
// Every scenario below therefore mixes the three cases on purpose, because a
// preview showing only the resolvable ones would claim a completeness this addon
// does not have:
//
//   `arcane_shot` is displayed as "Fell Shot". The event says "Fell Shot" and the
//   file is `arcane_shot.webp`, so a row with an icon here proves the join ran
//   BACKWARDS correctly rather than that some string reached some attribute.
//
//   "Auto Shot" is in nobody's spellbook. It is the residue every meter carries,
//   and it draws with a school tint and no art.
//
//   A mob's ability, on the Taken table, is the unrecoverable half: the event
//   carries a name, the game has no manifest that maps it, and there is no route
//   to an icon at all. That table is nearly all this case.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';

const PLAYER_ID = PLAYER_ENTITY.id;
const MOB_ID = 900;

/** The class whose art directory a resolvable row's icon comes from. */
const CLASS_ID = 'hunter';

/**
 * How long to wait for the meter to redraw.
 *
 * `woc.setInterval(repaint, 500)` is a REAL interval here rather than a fake one
 * the suite steps, so a scenario that seeded events and returned would photograph
 * the panel as it stood before any of them landed. Comfortably over the period,
 * because being early is a blank meter and being late costs a third of a second.
 */
const REPAINT_WAIT_MS = 700;

/**
 * The spellbook, in the game's own shape.
 *
 * Only these three can ever carry art. The ids are real hunter abilities that the
 * deployed `/ui/skills/hunter/mapping.json` ships a file for, so a missing icon in
 * a shot is a real defect rather than a fixture naming art that never existed.
 */
const KNOWN = Object.freeze([
  {
    def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
    rank: 3,
    cost: 55,
    castTime: 0,
    cooldown: 6,
  },
  {
    def: { id: 'aimed_shot', name: 'Aimed Shot', school: 'physical', requiresTarget: true },
    rank: 2,
    cost: 75,
    castTime: 2,
    cooldown: 180,
  },
  {
    def: { id: 'serpent_sting', name: 'Serpent Sting', school: 'nature', requiresTarget: true },
    rank: 2,
    cost: 40,
    castTime: 0,
    cooldown: 0,
  },
]);

interface Blow {
  /** The DISPLAY name, which is the only form a combat event ever carries. */
  ability: string;
  school: string;
  amount: number;
  crit?: boolean;
  /** Anything but 'hit' is an outcome with no damage: the meter counts it apart. */
  kind?: string;
  /** Milliseconds since the previous blow, so the fight has a real duration. */
  after?: number;
}

/**
 * What the player did, over about twenty seconds.
 *
 * Three abilities that resolve to art, one that cannot, and four schools, so the
 * tint is doing visible work down the table. The misses and the dodge are there
 * because the outcome line is half of why this addon exists: a meter that showed
 * only landed hits would report a hit rate of 100% in every fight ever fought.
 */
const DEALT: readonly Blow[] = [
  { ability: 'Auto Shot', school: 'physical', amount: 214, after: 0 },
  { ability: 'Aimed Shot', school: 'physical', amount: 806, crit: true, after: 1900 },
  { ability: 'Fell Shot', school: 'arcane', amount: 331, after: 1500 },
  { ability: 'Serpent Sting', school: 'nature', amount: 122, after: 900 },
  { ability: 'Auto Shot', school: 'physical', amount: 198, after: 2100 },
  { ability: 'Fell Shot', school: 'arcane', amount: 645, crit: true, after: 1800 },
  { ability: 'Auto Shot', school: 'physical', amount: 0, kind: 'miss', after: 1600 },
  { ability: 'Serpent Sting', school: 'nature', amount: 118, after: 1200 },
  { ability: 'Aimed Shot', school: 'physical', amount: 402, after: 2600 },
  { ability: 'Auto Shot', school: 'physical', amount: 0, kind: 'dodge', after: 1400 },
  { ability: 'Fell Shot', school: 'arcane', amount: 358, after: 1700 },
  { ability: 'Auto Shot', school: 'physical', amount: 231, after: 2200 },
  { ability: 'Serpent Sting', school: 'nature', amount: 124, after: 1300 },
  { ability: 'Aimed Shot', school: 'physical', amount: 388, after: 1800 },
];

/**
 * What was hitting back.
 *
 * Every name here belongs to a mob, so not one of them can resolve to art however
 * this addon is improved: the game files art under an ability id and a combat
 * event carries a name. This table is what the school tint was built for.
 */
const TAKEN: readonly Blow[] = [
  { ability: 'Cleave', school: 'physical', amount: 268, after: 0 },
  { ability: 'Ember Lash', school: 'fire', amount: 341, crit: true, after: 2100 },
  { ability: 'Rimebite', school: 'frost', amount: 190, after: 1700 },
  { ability: 'Cleave', school: 'physical', amount: 244, after: 1500 },
  { ability: 'Withering Gaze', school: 'shadow', amount: 205, after: 2400 },
  { ability: 'Ember Lash', school: 'fire', amount: 318, after: 1900 },
  { ability: 'Cleave', school: 'physical', amount: 0, kind: 'dodge', after: 1600 },
  { ability: 'Rimebite', school: 'frost', amount: 176, after: 2000 },
];

/** Healing done, including the one record a meter must skip on the FLAG. */
const HEALED = [
  { ability: 'Mend Wounds', amount: 340, after: 0 },
  { ability: 'Mend Wounds', amount: 512, crit: true, after: 2200 },
  { ability: 'Renewing Breath', amount: 180, after: 1800 },
  // `cueOnly` records exist to drive a sound and carry no healing at all. Skipped
  // on the flag rather than on the amount, because a genuine direct heal lands at
  // 0 on a target already at full health and dropping those loses real casts.
  { ability: 'Mend Wounds', amount: 0, cueOnly: true, after: 900 },
  { ability: 'Renewing Breath', amount: 176, after: 1600 },
  { ability: 'Mend Wounds', amount: 366, after: 2100 },
];

/**
 * The session this hunter logged in with, before the addon has run a line.
 *
 * The class and the spellbook are both facts about the character rather than about
 * the fight, so both belong here. The class is also what any icon is filed under,
 * and a row built before there is a class to file it under never gets one.
 */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.world, 'known', KNOWN);
}

/** Let the panel's saved state come back, which is what un-hides it. */
async function panelUp(stage: Stage): Promise<void> {
  // The frame saves per character, so it starts hidden and is shown once that read
  // lands: one watcher sample to find the character, then the read keyed on it.
  stage.poll();
  await stage.settle();
}

/** Wait out one repaint period, since the meter draws on a real interval. */
function repainted(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, REPAINT_WAIT_MS);
  });
}

/** Deliver one blow as the socket would, from `by` to `at`. */
function strike(stage: Stage, blow: Blow, by: number, at: number): void {
  stage.advance(blow.after ?? 0);
  stage.inbound(
    eventsFrame([
      {
        type: 'damage',
        sourceId: by,
        targetId: at,
        amount: blow.amount,
        ability: blow.ability,
        kind: blow.kind ?? 'hit',
        crit: blow.crit ?? false,
        school: blow.school,
      },
    ]),
  );
}

/** Who is hitting whom. Named rather than a boolean, which reads as neither. */
interface Direction {
  by: number;
  at: number;
}

const OUTGOING: Direction = { by: PLAYER_ID, at: MOB_ID };
const INCOMING: Direction = { by: MOB_ID, at: PLAYER_ID };

/** Run a whole exchange, then wait for the panel to catch up with it. */
async function exchange(stage: Stage, blows: readonly Blow[], direction: Direction): Promise<void> {
  await panelUp(stage);
  for (const blow of blows) {
    strike(stage, blow, direction.by, direction.at);
  }
  await repainted();
}

/**
 * Open one of the meter's tabs, the way a player does.
 *
 * Clicked at the DOM rather than reached for through the stage, which has no API
 * for this and should not grow one: the tab strip is the LOADER's `ui.tabs`, so a
 * click on it is the same path a player takes, and a stage helper would be a
 * second way to change tabs that only scenarios use.
 */
function openTab(label: string): void {
  const button = [...document.querySelectorAll('.woc-meter-tabs .woc-tab')].find(
    (el) => el.textContent === label,
  );
  (button as HTMLButtonElement | undefined)?.click();
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'damage',
    label: 'Damage, mid-fight',
    world: aHunter,
    run: async (stage) => {
      await exchange(stage, DEALT, OUTGOING);
    },
  },
  {
    id: 'healing',
    label: 'Healing done',
    world: aHunter,
    run: async (stage) => {
      await panelUp(stage);
      for (const heal of HEALED) {
        stage.advance(heal.after);
        stage.inbound(
          eventsFrame([
            {
              type: 'heal2',
              sourceId: PLAYER_ID,
              targetId: PLAYER_ID,
              amount: heal.amount,
              ability: heal.ability,
              crit: heal.crit ?? false,
              cueOnly: heal.cueOnly,
            },
          ]),
        );
      }
      openTab('Healing');
      await repainted();
    },
  },
  {
    id: 'taken',
    label: 'What is hitting you',
    world: aHunter,
    run: async (stage) => {
      await exchange(stage, TAKEN, INCOMING);
      openTab('Taken');
      await repainted();
    },
  },
  {
    // Before a single event. The state a meter is in every time a player logs in,
    // and the one nobody thinks to photograph: a panel that reads well full and
    // reads as broken empty is one a player meets empty first.
    id: 'idle',
    label: 'Before the first fight',
    world: aHunter,
    run: async (stage) => {
      await panelUp(stage);
      await repainted();
    },
  },
  {
    // Detail and outcome lines off, which is the setting a player who wants a
    // small overlay reaches for. Worth its own shot because it is a different
    // panel, not the same one with less in it: the rows lose their second line.
    id: 'compact',
    label: 'Damage, detail lines off',
    settings: { 'show-detail': false, 'show-outcomes': false },
    world: aHunter,
    run: async (stage) => {
      await exchange(stage, DEALT, OUTGOING);
    },
  },
];

export { SCENARIOS };
