// Combat Meter on the stage: three tables, and the limit that shapes all three.
//
// This is `main.test.ts`'s `run()` without the assertions, so the scenarios and the suite describe
// one world.
//
// A combat event names an ability by display name while skill art is filed under the id, so art
// exists only for your own spellbook (`world.abilities.byName`), and rows are tinted by school to
// reach the rest. Every scenario mixes the three cases, so a preview never claims completeness the
// addon lacks: "Fell Shot" (`arcane_shot`) resolves backwards to its icon; "Auto Shot" is in
// nobody's spellbook and draws tint only; a mob's ability on the Taken table has no route to an
// icon at all.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';

const PLAYER_ID = PLAYER_ENTITY.id;
const MOB_ID = 900;
/** The mob's name and size, which name a kept fight: the meter latches the biggest mob it saw. */
const MOB_NAME = 'Sableweb Lurker';
const MOB_HP = 9400;
/** The hunter's own wolf, which nothing but `ownerId` tells from any other mob. */
const PET_ID = 901;
const PET_NAME = 'Grizzle';
/**
 * Something smaller, fought after the first and named after itself. A second fight against the SAME
 * mob would put two pages under one name, and the strip's job is to show the fight on screen is not
 * the one that just happened.
 */
const NEXT_ID = 902;
const NEXT_NAME = 'Deeprock Digger';
const NEXT_HP = 3100;

/** The class whose art directory a resolvable row's icon comes from. */
const CLASS_ID = 'hunter';

/**
 * How long to wait for a redraw. The meter's `woc.setInterval(repaint, 500)` is a real interval
 * here, so a scenario that returned straight away would photograph the panel before any event
 * landed. Comfortably over the period.
 */
const REPAINT_WAIT_MS = 700;

/** Comfortably past the meter's `fight-timeout`, which defaults to five seconds. */
const FIGHT_TIMEOUT_MS = 8000;

/**
 * The spellbook, in the game's shape. Only these three can carry art; each id has a file in the
 * deployed `/ui/skills/hunter/mapping.json`, so a missing icon in a shot is a real defect.
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
  /** The DISPLAY name, the only form a combat event carries. Null is a swing. */
  ability: string | null;
  school: string;
  amount: number;
  crit?: boolean;
  /** Anything but 'hit' is an outcome with no damage, counted apart. */
  kind?: string;
  /** Milliseconds since the previous blow, so the fight has a real duration. */
  after?: number;
  /**
   * The PET is the one of the two of you involved: it dealt this outgoing blow, or this incoming
   * one landed on it. One flag, because the direction already says which side.
   */
  pet?: true;
}

/**
 * What the player did over about thirty seconds: three abilities with art, one without, and four
 * schools, so the tint does visible work. The misses and the dodge feed the outcome line, without
 * which every fight reads as 100% hits. The pet's swings carry `ability: null` and never have art,
 * since a pet's abilities are in nobody's spellbook; each splits an existing gap, so the fight
 * stays 29.9 seconds.
 *
 * The panel opens at a fixed 348px and holds SIX rows plus the outcome line. A seventh row pushes
 * the outcome line off the bottom and clips, which in a Browse thumbnail reads as broken, so
 * something must go for anything added here.
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
 * What was hitting back. Every name belongs to a mob, so none can resolve to art: this table is
 * what the school tint is for.
 */
const TAKEN: readonly Blow[] = [
  { ability: 'Cleave', school: 'physical', amount: 268, after: 0 },
  { ability: 'Ember Lash', school: 'fire', amount: 341, crit: true, after: 2100 },
  { ability: 'Rimebite', school: 'frost', amount: 190, after: 1700 },
  { ability: 'Cleave', school: 'physical', amount: 244, after: 1500 },
  // The blow that landed on the pet, filed under the pet's name: on this table the prefix says who
  // took it.
  { ability: 'Rend', school: 'physical', amount: 212, after: 1200, pet: true },
  { ability: 'Withering Gaze', school: 'shadow', amount: 205, after: 1200 },
  { ability: 'Ember Lash', school: 'fire', amount: 318, after: 1900 },
  { ability: 'Cleave', school: 'physical', amount: 0, kind: 'dodge', after: 1600 },
  { ability: 'Rimebite', school: 'frost', amount: 176, after: 2000 },
];

/**
 * An EARLIER fight, against something else, at melee range. A different table on purpose (other
 * mob, opener, shares, a parry rather than a dodge), because two panels of the same rows under two
 * captions say nothing about kept fights. The same six-row ceiling applies.
 */
const EARLIER: readonly Blow[] = [
  { ability: 'Raptor Strike', school: 'physical', amount: 288, after: 0 },
  { ability: null, school: 'physical', amount: 131, after: 800, pet: true },
  { ability: 'Auto Shot', school: 'physical', amount: 176, after: 900 },
  { ability: 'Serpent Sting', school: 'nature', amount: 109, after: 1100 },
  { ability: 'Raptor Strike', school: 'physical', amount: 512, crit: true, after: 1300 },
  { ability: null, school: 'physical', amount: 144, after: 900, pet: true },
  { ability: 'Auto Shot', school: 'physical', amount: 0, kind: 'parry', after: 1200 },
  { ability: 'Fell Shot', school: 'arcane', amount: 302, after: 1000 },
  { ability: null, school: 'physical', amount: 127, after: 1100, pet: true },
  { ability: 'Raptor Strike', school: 'physical', amount: 271, after: 1400 },
  { ability: 'Auto Shot', school: 'physical', amount: 191, after: 1200 },
  { ability: 'Serpent Sting', school: 'nature', amount: 113, after: 1300 },
  { ability: null, school: 'physical', amount: 139, after: 900, pet: true },
  { ability: 'Raptor Strike', school: 'physical', amount: 264, after: 1500 },
];

interface Cast {
  ability: string;
  amount: number;
  after: number;
  crit?: boolean;
  cueOnly?: boolean;
  /**
   * Healing lost to the target's missing-health clamp. Only two carry one, so the table shows a
   * marked overheal floor beside a row with none.
   */
  overheal?: number;
}

/** Healing done, including the one record a meter must skip on the FLAG. */
const HEALED: readonly Cast[] = [
  { ability: 'Mend Wounds', amount: 340, after: 0 },
  { ability: 'Mend Wounds', amount: 512, crit: true, after: 2200, overheal: 148 },
  { ability: 'Renewing Breath', amount: 180, after: 1800 },
  // `cueOnly` records drive a sound and carry no healing. Skipped on the flag, since a real direct
  // heal can land at 0 on a full target.
  { ability: 'Mend Wounds', amount: 0, cueOnly: true, after: 900 },
  { ability: 'Renewing Breath', amount: 176, after: 1600 },
  { ability: 'Mend Wounds', amount: 366, after: 2100, overheal: 92 },
];

/**
 * The session this hunter logged in with. The class and spellbook are facts about the character;
 * the class is what icons are filed under, and a row built before there is a class never gets one.
 */
function aHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.world, 'known', KNOWN);
  // The pet is out before a shot is fired. It is a mob-kind entity, and `ownerId` alone separates
  // it from what it is biting.
  draft.mob(PET_ID, { name: PET_NAME, templateId: 'wolf', hostile: false, ownerId: PLAYER_ID });
  // The mob is in scope before the first shot: the meter reads its name off the snapshot as records
  // land, so a late arrival would leave the fight unnamed.
  draft.mob(MOB_ID, { name: MOB_NAME, maxHp: MOB_HP });
  draft.mob(NEXT_ID, { name: NEXT_NAME, maxHp: NEXT_HP });
}

/** Let the panel's saved state come back, which is what un-hides it. */
async function panelUp(stage: Stage): Promise<void> {
  // The frame saves per character, so it starts hidden until that read lands: one watcher sample to
  // find the character, then the read.
  stage.poll();
  await stage.settle();
}

/**
 * Wait out one repaint period, then run the frame that performs it. The interval only ASKS through
 * `woc.paint`, which coalesces onto the loader's frame loop, and the stage drives that loop by
 * hand; waiting alone photographs the last drawn state, which for a first shot is nothing.
 */
async function repainted(stage: Stage): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, REPAINT_WAIT_MS);
  });
  stage.frame();
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
/** The earlier fight, which is against the other mob and is what gives it its own name. */
const EARLIER_ON: Direction = { by: PLAYER_ID, at: NEXT_ID };

/**
 * The same exchange with the pet standing in for the player: outgoing the pet swings, incoming it
 * is hit, as the meter reads it.
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

/** Land every blow in a table, in the direction it was fought. */
function blows(stage: Stage, table: readonly Blow[], direction: Direction): void {
  for (const blow of table) {
    const side = sideFor(blow, direction);
    strike(stage, blow, side.by, side.at);
  }
}

/** Run a whole exchange, then wait for the panel to catch up with it. */
async function exchange(stage: Stage, table: readonly Blow[], direction: Direction): Promise<void> {
  await panelUp(stage);
  blows(stage, table, direction);
  await repainted(stage);
}

/**
 * Open one of the meter's tabs by clicking the DOM, the path a player takes through the loader's
 * `ui.tabs`, rather than a stage-only helper.
 */
function openTab(label: string): void {
  const button = [...document.querySelectorAll('.woc-meter-tabs .woc-tab')].find(
    (el) => el.textContent === label,
  );
  (button as HTMLButtonElement | undefined)?.click();
}

/** Page the fight strip back with the same click a player makes. */
function stepBack(): void {
  const button = document.querySelector('[data-role="fights"] [data-step="1"]');
  (button as HTMLButtonElement | null)?.click();
}

/**
 * Let the fight end, which puts it on a page of its own. The meter closes a fight on its own idle
 * timeout, checked on its repaint interval, so this jumps the addon's clock and then waits for the
 * interval.
 */
async function closed(stage: Stage): Promise<void> {
  stage.advance(FIGHT_TIMEOUT_MS);
  await repainted(stage);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'damage',
    label: 'Damage, mid-fight',
    preview: true,
    caption: 'The fight you are in',
    alt: 'the Combat Meter on its Damage tab, the fight strip reading Current: six ability rows tinted by damage school under a per-second total, above the attack table.',
    world: aHunter,
    run: async (stage) => {
      await exchange(stage, DEALT, OUTGOING);
    },
  },
  {
    // The fights it keeps. Two whole fights, then a step back onto the first: the strip names the
    // fight rather than numbering it.
    id: 'history',
    label: 'A fight you kept',
    preview: true,
    caption: 'One you already had',
    alt: 'the same panel paged back one fight, the strip naming the mob and marking page two of three, above that earlier fight and its own rows.',
    world: aHunter,
    run: async (stage) => {
      await panelUp(stage);
      blows(stage, EARLIER, EARLIER_ON);
      await closed(stage);
      blows(stage, DEALT, OUTGOING);
      await closed(stage);
      stepBack();
      await repainted(stage);
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
      await repainted(stage);
    },
  },
  {
    id: 'taken',
    label: 'What is hitting you',
    world: aHunter,
    run: async (stage) => {
      await exchange(stage, TAKEN, INCOMING);
      openTab('Taken');
      await repainted(stage);
    },
  },
  {
    // Before a single event: the state a player meets on every login.
    id: 'idle',
    label: 'Before the first fight',
    world: aHunter,
    run: async (stage) => {
      await panelUp(stage);
      await repainted(stage);
    },
  },
  {
    // Detail and outcome lines off, the small-overlay setting. A different panel rather than less
    // of the same: rows lose their second line.
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
