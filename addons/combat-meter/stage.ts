// Combat Meter on the stage: three tables, and the limit that shapes all three.
//
// Like the cooldown-bars scenarios, this is `main.test.ts`'s `run()` with the assertions taken
// out: the suite's fixture is the only description of this addon's world anybody has checked.
//
// Every shot here has to be honest about one thing: a combat event names an ability by its
// display name and never by its id, while skill art is filed under the id. So this addon can
// draw art only for abilities in your own spellbook, where `world.abilities.byName` closes the
// join, and for everything else there is no icon to be found. That is why it tints rows by
// school: the tint reaches the rows the art cannot.
//
// Every scenario below mixes the three cases, because a preview showing only the resolvable ones
// would claim a completeness this addon does not have:
//
//   `arcane_shot` is displayed as "Fell Shot". The event says "Fell Shot" and the file is
//   `arcane_shot.webp`, so a row with an icon proves the join ran backwards correctly.
//
//   "Auto Shot" is in nobody's spellbook. It is the residue every meter carries, and it draws
//   with a school tint and no art.
//
//   A mob's ability, on the Taken table, is the unrecoverable half: the event carries a name and
//   there is no route to an icon at all. That table is nearly all this case.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';

const PLAYER_ID = PLAYER_ENTITY.id;
const MOB_ID = 900;
/** The hunter's own wolf, which nothing but `ownerId` tells from any other mob. */
const PET_ID = 901;
const PET_NAME = 'Grizzle';

/** The class whose art directory a resolvable row's icon comes from. */
const CLASS_ID = 'hunter';

/**
 * How long to wait for the meter to redraw. `woc.setInterval(repaint, 500)` is a real interval
 * here rather than a fake one the suite steps, so a scenario that seeded events and returned
 * would photograph the panel as it stood before any of them landed. Comfortably over the period,
 * because being early is a blank meter and being late costs a third of a second.
 */
const REPAINT_WAIT_MS = 700;

/**
 * The spellbook, in the game's own shape. Only these three can ever carry art. The ids are real
 * hunter abilities that the deployed `/ui/skills/hunter/mapping.json` ships a file for, so a
 * missing icon in a shot is a real defect rather than a fixture naming art that never existed.
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
  {
    def: { id: 'volley', name: 'Volley', school: 'arcane', requiresTarget: false },
    rank: 1,
    cost: 60,
    castTime: 0,
    cooldown: 30,
  },
  {
    def: { id: 'raptor_strike', name: 'Raptor Strike', school: 'physical', requiresTarget: true },
    rank: 4,
    cost: 20,
    castTime: 0,
    cooldown: 6,
  },
]);

interface Blow {
  /** The DISPLAY name, which is the only form a combat event ever carries. Null is a swing. */
  ability: string | null;
  school: string;
  amount: number;
  crit?: boolean;
  /** Anything but 'hit' is an outcome with no damage: the meter counts it apart. */
  kind?: string;
  /** Milliseconds since the previous blow, so the fight has a real duration. */
  after?: number;
  /**
   * The PET is the one of the two of you involved: it dealt this outgoing blow, or this
   * incoming one landed on it. One flag rather than two, because which side it means is
   * already decided by the direction the exchange is running in.
   */
  pet?: true;
}

/**
 * What the player did, over about thirty seconds. Three abilities that resolve to art, one that
 * cannot, and four schools, so the tint is doing visible work down the table. The misses and the
 * dodge are there because the outcome line is half of why this addon exists: a meter showing only
 * landed hits would report a hit rate of 100% in every fight ever fought.
 *
 * The pet's swings are here because a hunter's are a real share of the total and no meter showed
 * them until game 0.35.0 delivered the records. They carry `ability: null`, which is what a swing
 * carries from anybody, and they are the only rows in this table whose art can never be found:
 * a pet's abilities are in nobody's spellbook.
 *
 * Every pet swing SPLITS a gap that was already there rather than adding one, so the fight is
 * still 29.9 seconds long and every surviving row's total and rate is unchanged. That is
 * deliberate: the only things this addition moves in the picture are the pet and the shares.
 *
 * Raptor Strike went to make room for it, and this is the constraint to know before adding to
 * this table: the panel opens at a fixed 320px and holds SIX rows plus the outcome line. A
 * seventh row does not scroll or grow the frame, it pushes the outcome line off the bottom and
 * clips its own second line, which reads in a Browse thumbnail as a panel that is broken.
 */
const DEALT: readonly Blow[] = [
  { ability: 'Auto Shot', school: 'physical', amount: 214, after: 0 },
  { ability: null, school: 'physical', amount: 143, after: 900, pet: true },
  { ability: 'Aimed Shot', school: 'physical', amount: 806, crit: true, after: 1000 },
  { ability: 'Fell Shot', school: 'arcane', amount: 331, after: 1500 },
  { ability: 'Serpent Sting', school: 'nature', amount: 122, after: 900 },
  { ability: null, school: 'physical', amount: 128, after: 1100, pet: true },
  { ability: 'Auto Shot', school: 'physical', amount: 198, after: 1000 },
  { ability: null, school: 'physical', amount: 151, after: 900, pet: true },
  { ability: 'Fell Shot', school: 'arcane', amount: 645, crit: true, after: 900 },
  { ability: 'Auto Shot', school: 'physical', amount: 0, kind: 'miss', after: 1600 },
  { ability: 'Serpent Sting', school: 'nature', amount: 118, after: 1200 },
  { ability: null, school: 'physical', amount: 134, after: 1300, pet: true },
  { ability: 'Aimed Shot', school: 'physical', amount: 402, after: 1300 },
  { ability: 'Auto Shot', school: 'physical', amount: 0, kind: 'dodge', after: 1400 },
  { ability: null, school: 'physical', amount: 119, after: 800, pet: true },
  { ability: 'Fell Shot', school: 'arcane', amount: 358, after: 900 },
  { ability: null, school: 'physical', amount: 147, after: 1100, pet: true },
  { ability: 'Auto Shot', school: 'physical', amount: 231, after: 1100 },
  { ability: 'Serpent Sting', school: 'nature', amount: 124, after: 1300 },
  { ability: null, school: 'physical', amount: 126, after: 900, pet: true },
  { ability: 'Aimed Shot', school: 'physical', amount: 388, after: 900 },
  { ability: 'Volley', school: 'arcane', amount: 274, after: 1100 },
  { ability: null, school: 'physical', amount: 138, after: 2500, pet: true },
  { ability: 'Volley', school: 'arcane', amount: 291, crit: true, after: 900 },
  { ability: 'Volley', school: 'arcane', amount: 262, after: 3400 },
];

/**
 * What was hitting back. Every name here belongs to a mob, so not one of them can resolve to art
 * however this addon is improved: the game files art under an ability id and a combat event
 * carries a name. This table is what the school tint was built for.
 */
const TAKEN: readonly Blow[] = [
  { ability: 'Cleave', school: 'physical', amount: 268, after: 0 },
  { ability: 'Ember Lash', school: 'fire', amount: 341, crit: true, after: 2100 },
  { ability: 'Rimebite', school: 'frost', amount: 190, after: 1700 },
  { ability: 'Cleave', school: 'physical', amount: 244, after: 1500 },
  // The one that landed on the pet, which the meter files under the pet's name: on this table
  // the prefix says who took it, since the ability is the attacker's either way.
  { ability: 'Rend', school: 'physical', amount: 212, after: 1200, pet: true },
  { ability: 'Withering Gaze', school: 'shadow', amount: 205, after: 1200 },
  { ability: 'Ember Lash', school: 'fire', amount: 318, after: 1900 },
  { ability: 'Cleave', school: 'physical', amount: 0, kind: 'dodge', after: 1600 },
  { ability: 'Rimebite', school: 'frost', amount: 176, after: 2000 },
];

interface Cast {
  ability: string;
  amount: number;
  after: number;
  crit?: boolean;
  cueOnly?: boolean;
  /**
   * Healing lost to the target's missing-health clamp, which is new on the wire in game
   * 0.35.0. Only two of these carry one, so the table shows both readings: a row with a
   * marked overheal floor beside a row with nothing to say about it.
   */
  overheal?: number;
}

/** Healing done, including the one record a meter must skip on the FLAG. */
const HEALED: readonly Cast[] = [
  { ability: 'Mend Wounds', amount: 340, after: 0 },
  { ability: 'Mend Wounds', amount: 512, crit: true, after: 2200, overheal: 148 },
  { ability: 'Renewing Breath', amount: 180, after: 1800 },
  // `cueOnly` records exist to drive a sound and carry no healing at all. Skipped on the flag
  // rather than on the amount, because a genuine direct heal lands at 0 on a target already at
  // full health and dropping those loses real casts.
  { ability: 'Mend Wounds', amount: 0, cueOnly: true, after: 900 },
  { ability: 'Renewing Breath', amount: 176, after: 1600 },
  { ability: 'Mend Wounds', amount: 366, after: 2100, overheal: 92 },
];

/**
 * The session this hunter logged in with, before the addon has run a line. The class and the
 * spellbook are both facts about the character rather than about the fight. The class is also
 * what any icon is filed under, and a row built before there is a class never gets one.
 */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.world, 'known', KNOWN);
  // The pet is out with you before a shot is fired, which is what makes it a fact about the
  // session rather than something that happened. It is a mob-kind entity like any other and
  // `ownerId` is the whole of what separates it from the thing it is biting.
  draft.mob(PET_ID, { name: PET_NAME, templateId: 'wolf', hostile: false, ownerId: PLAYER_ID });
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

/**
 * The same exchange with the pet standing in for the player.
 *
 * Which side that is falls out of the direction rather than being stated twice: outgoing, the
 * pet is the one swinging; incoming, it is the one being hit. That is also how the meter reads
 * it, which is why one flag on a blow is enough to say it.
 */
function sideFor(blow: Blow, direction: Direction): Direction {
  if (blow.pet !== true) {
    return direction;
  }
  if (direction.by === PLAYER_ID) {
    return { by: PET_ID, at: direction.at };
  }
  return { by: direction.by, at: PET_ID };
}

/** Run a whole exchange, then wait for the panel to catch up with it. */
async function exchange(stage: Stage, blows: readonly Blow[], direction: Direction): Promise<void> {
  await panelUp(stage);
  for (const blow of blows) {
    const side = sideFor(blow, direction);
    strike(stage, blow, side.by, side.at);
  }
  await repainted();
}

/**
 * Open one of the meter's tabs, the way a player does. Clicked at the DOM rather than reached
 * for through the stage: the tab strip is the loader's `ui.tabs`, so a click on it is the same
 * path a player takes, and a stage helper would be a second way to change tabs that only
 * scenarios use.
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
    preview: true,
    alt: 'The Combat Meter panel on its Damage tab, reading 5,850 damage (195.7/s) in 30s. Six rows (Aimed Shot 1,596, Fell Shot 1,334, Grizzle: Melee 1,086, Volley 827, Auto Shot 643, Serpent Sting 364) each show total, share and damage per second, over a second line of hits, crit rate, average and biggest hit. The third row is the swings the player pet Grizzle landed, folded into the total and labelled with the pet name. The fill behind each row is tinted by damage school, red for physical, blue for arcane and green for nature, and the four rows from the player own spellbook carry the art the game ships for that ability while Auto Shot and the pet row carry none. A summary line reads hit 88%, miss 6%, dodge 6%.',
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
              overheal: heal.overheal,
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
    // Before a single event: the state a meter is in every time a player logs in. A panel that
    // reads well full and reads as broken empty is one a player meets empty first.
    id: 'idle',
    label: 'Before the first fight',
    world: aHunter,
    run: async (stage) => {
      await panelUp(stage);
      await repainted();
    },
  },
  {
    // Detail and outcome lines off, which is the setting a player who wants a small overlay
    // reaches for. Worth its own shot because it is a different panel rather than the same one
    // with less in it: the rows lose their second line.
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
