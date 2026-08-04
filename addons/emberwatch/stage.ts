// Emberwatch on the stage: what fired, and the rules it fired from.
//
// Both frames in one picture, because this addon is a rules engine and a strip of tiles is only
// half of it. Five squares is what every tile display looks like; the rules under them are the
// thing a player is installing, and the pane is where the two questions this addon refuses to
// answer are written down.
//
// Every id, name, kind, school, duration and stack here is the game's own, and the ids and the
// names disagree because the game's do: `arcane_power` is displayed as "Aether Surge" and
// `pyroblast` as "Pyrelance". That divergence is why art is filed under the id.
//
// A fire mage, and the spec is a decision rather than a flavour. The shipped set carries four
// mage rules and two of them belong to specs that cannot both be in play: `hot_streak` is fire
// and `brain_freeze` is frost. The pane still lists both, which is what a player sees, since a
// rule is switched off by hand rather than by a spec nothing on the wire states.
//
// The five tiles are one each of everything the strip can say, and the three that draw no
// picture each have a different reason for it:
//
//  - Silencing Shriek is anchored on a kind, which is how a rule names no ability at all. A mob
//    applied it, and a mob has no class directory to file art under.
//  - Brood Venom is anchored on nothing but a polarity and a stack count. Its aura id is
//    `stackpoison_mirefen_broodmother`, which is not an ability id, so there is no file to point
//    at however the caster resolves.
//  - Aether Surge is the player's own and still has none: the game composites that icon at run
//    time from a module an addon cannot reach.
//  - Hot Streak and Pyrelance resolve, because the game ships a painted file for both.
//
// Pyrelance is the one on the target, and its rule carries `mine`, which is the clause the whole
// addon turns on: two mages on one boss both leave a `pyroblast` dot, and the one worth a global
// is yours. It is also, with Aether Surge, one of the two drawn in the warning amber rather than
// in its school, since a rule that watches for an effect running out sets the tone.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import RULES from './rules.json' with { type: 'json' };

const PLAYER_ID = PLAYER_ENTITY.id;
const RULES_FILE = 'rules.json';

/** The boss this mage is on, and the add that shut them up. Both from zone 2. */
const BROODMOTHER = 720;
const SUMMONER = 721;

/** The one mob in the game with a stun worth photographing, from zone 3. */
const OGRE = 730;

/** The class the player is, which is the directory their own art comes from. */
const CLASS_ID = 'mage';

/**
 * The strip, sized to the five squares it is holding.
 *
 * The addon opens at 420, which is room for the six the tile budget allows plus the line saying
 * what it is not showing. A bare frame reserves its whole box whether or not anything is drawn in
 * it, and a crop cannot recover that, so the shot is taken at the width these tiles occupy: five
 * 48px squares, the 6px gaps, and the gap before the empty overflow line.
 */
const STRIP = { box: { x: 24, y: 24, w: 282, h: 63 }, visible: true };

/** The same strip, shut, for the scenario that is about the pane alone. */
const STRIP_SHUT = { box: STRIP.box, visible: false };

/**
 * The rules pane, open, directly under the strip.
 *
 * One picture rather than a sheet of two panels, because of the shapes: a sheet lines its panes
 * up on the caption baseline, so a 63px strip beside a 500px panel is a strip stranded at the
 * bottom of an empty column. Two frames in one scenario crop as the union of both, which is what
 * a player actually has on screen with the pane open.
 *
 * Wider and taller than the addon's own 460 by 380, for content rather than composition: the
 * shipped set gives a mage eight rules, and the two notes under them are the first thing a short
 * box clips.
 */
const PANE = { box: { x: 24, y: 110, w: 700, h: 526 }, visible: true };

/** One effect in the shape the client decodes onto an entity. */
function aura(over: Record<string, unknown>): Record<string, unknown> {
  return { value: 0, stacks: 1, sourceId: 0, ...over };
}

/**
 * The pull as the addon woke up in it. The class is here rather than in `run` for the reason the
 * Cooldown Bars scenario gives: skill art is filed per class, and a class stated after the addon
 * has mounted is a tile that was built without one and is never redrawn.
 */
function aBroodmotherPull(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  draft.mob(BROODMOTHER, { name: 'The Broodmother', templateId: 'mirefen_broodmother', level: 10 });
  draft.mob(SUMMONER, { name: 'Gravecaller Summoner', templateId: 'gravecaller_summoner' });
}

/** Everything on the player at once, which is four of the five rules in force. */
function afflictPlayer(stage: Stage): void {
  stage.set(stage.player, 'auras', [
    // Three bites in. The per-tick figure is what ramps, which is why the rule
    // watching this one is a stack threshold rather than an id.
    aura({
      id: 'stackpoison_mirefen_broodmother',
      name: 'Brood Venom',
      kind: 'dot',
      school: 'nature',
      remaining: 8.6,
      duration: 12,
      value: 9,
      stacks: 3,
      sourceId: BROODMOTHER,
    }),
    aura({
      id: 'silence_gravecaller_summoner',
      name: 'Silencing Shriek',
      kind: 'silence',
      school: 'shadow',
      remaining: 2.4,
      duration: 4,
      sourceId: SUMMONER,
    }),
    aura({
      id: 'arcane_power',
      name: 'Aether Surge',
      kind: 'buff_spelldmg',
      school: 'arcane',
      remaining: 2.6,
      duration: 10,
      value: 0.2,
      sourceId: PLAYER_ID,
    }),
    aura({
      id: 'hot_streak',
      name: 'Hot Streak',
      kind: 'next_cast_free',
      school: 'fire',
      remaining: 6.8,
      duration: 12,
      sourceId: PLAYER_ID,
    }),
  ]);
}

/** The mage's own dot on the boss, and the boss selected so the rule can read it. */
function afflictTarget(stage: Stage): void {
  const boss = stage.entities.get(BROODMOTHER);
  if (boss !== undefined) {
    stage.set(boss, 'auras', [
      aura({
        id: 'pyroblast',
        name: 'Pyrelance',
        kind: 'dot',
        school: 'fire',
        remaining: 3.4,
        duration: 12,
        value: 8,
        sourceId: PLAYER_ID,
      }),
    ]);
  }
  stage.set(stage.player, 'targetId', BROODMOTHER);
}

/**
 * Wait for the strip and the starter table before drawing anything. Two settles rather than one:
 * a saved frame comes up hidden and is shown once its stored state arrives, and the rules are a
 * second read, of the data file the manifest declares. The addon skips drawing entirely while its
 * frame is hidden and has no rules to fire until the table lands.
 */
async function show(stage: Stage): Promise<void> {
  stage.poll();
  await stage.settle();
  await stage.settle();
  stage.frame();
}

async function midFight(stage: Stage): Promise<void> {
  afflictPlayer(stage);
  afflictTarget(stage);
  await show(stage);
}

/** An ogre, which is where a stun long enough to see comes from. */
function anOgrePull(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  draft.mob(OGRE, { name: 'Thornpeak Ogre', templateId: 'thornpeak_ogre', level: 16 });
}

/**
 * The half of this addon that works when nobody is looking at the strip. The stun lands after the
 * first reading rather than in it, and that ordering is the whole scenario: the first reading of
 * a live world is everything already up, which is not news, so the addon makes no sound and
 * raises no banner during it.
 */
async function stunned(stage: Stage): Promise<void> {
  await show(stage);
  stage.set(stage.player, 'auras', [
    aura({
      id: 'concuss_thornpeak_ogre',
      name: 'Concussive Blow',
      kind: 'stun',
      school: 'physical',
      remaining: 2,
      duration: 2,
      sourceId: OGRE,
    }),
  ]);
  stage.poll();
  stage.frame();
}

const ALERTS_ALT =
  "a row of five square alert tiles above the rules panel that produced them. Left to right, the two that carry no picture at all, each for its own reason: Silencing Shriek at 3 seconds, bordered in shadow purple and artless because a mob applied it and skill art is filed under a player class; then Brood Venom at 9 seconds in nature green, a 3 in its corner for the three bites that have landed, artless for a second and unrelated reason, that its aura id is not an ability id and no file is named for it. Then three that do carry the art the game ships for the ability that applied them, all three cast by the mage themselves: Aether Surge at 3 seconds, drawn in the warning amber a rule watching for an effect running out puts over the school colour; Hot Streak at 7 seconds in fire red; and Pyrelance at 4 seconds, amber again. Each tile names who is carrying the effect underneath: Marshal four times, and The Broodmother, clipped to the width of the square, under the mage's own dot on the boss. Below the strip, the Emberwatch rules panel lists the eight rules in force for a mage, each a switched-on checkbox with what it fires on written beside it: four that apply to every class, watching for a target made untouchable in a duel, for being silenced, for anything harmful reaching three stacks on you, and for being stunned; then Aether Surge ending, Brain Freeze, Hot Streak, and Pyrelance fading on your target, that last one marked mine only. Two lines in smaller type close the panel with what the addon cannot answer: a party row carries no source, no duration and no stacks, and nothing anywhere can say how much damage a control will take before it breaks.";

const STUN_ALT =
  'a banner across the middle of the view, reading STUNNED in the display serif the game keeps for its own warnings, in the red it keeps for danger, over a quieter second line naming who it landed on. It sits on a soft dark scrim that fades out on every side, and there is nothing else in the panel: the strip is shut, and the alert reaches the player anyway.';

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'alerts',
    label: 'Five alerts, with the rules they came from',
    preview: true,
    caption: 'Alerts and rules',
    alt: ALERTS_ALT,
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: STRIP, rules: PANE },
    world: aBroodmotherPull,
    run: midFight,
  },
  {
    // The strip alone, which is what a player has on screen for most of a fight:
    // the pane is opened to set the rules up and shut again.
    id: 'strip',
    label: 'The alert strip alone',
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: STRIP },
    world: aBroodmotherPull,
    run: midFight,
  },
  {
    id: 'rules',
    label: 'The rules pane alone',
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: STRIP_SHUT, rules: PANE },
    world: aBroodmotherPull,
    run: show,
  },
  {
    // The loud path, with the strip shut on purpose: a rule carrying `banner` is what reaches a
    // player who is not looking at the overlay, and the engine keeps reading while the frame is
    // hidden precisely so that it can. A strip drawn beside it would crop badly, since the banner
    // is a loader-owned slot at a fixed place in the view.
    id: 'stun',
    label: 'A stun, with the banner it raises',
    preview: true,
    caption: 'An alert',
    alt: STUN_ALT,
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: STRIP_SHUT },
    world: anOgrePull,
    run: stunned,
  },
  {
    // Nothing worth saying, which is most of a fight. A bare strip with no alert on it draws
    // nothing at all, which is the point and is also indistinguishable from an addon that is
    // switched off: the unlock outline is how a player finds it again to move it.
    id: 'quiet',
    label: 'Nothing worth an alert',
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: STRIP },
    world: aBroodmotherPull,
    run: show,
  },
];

export { SCENARIOS };
