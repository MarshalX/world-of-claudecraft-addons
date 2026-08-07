// Emberwatch on the stage: what fired, and the rules it fired from.
//
// Both frames in one picture, since a strip of tiles is half a rules engine and the pane is
// where the two questions this addon refuses to answer are written down.
//
// Every id, name, kind, school, duration and stack is the game's own, and the ids and names
// disagree because the game's do: `arcane_power` displays as "Aether Surge". That divergence is
// why art is filed under the id.
//
// A fire mage, deliberately: the shipped set carries `hot_streak` for fire and `brain_freeze` for
// frost, which cannot both be in play, and the pane lists both because a rule is switched off by
// hand rather than by a spec nothing on the wire states.
//
// The five tiles are one of each thing the strip can say, and the three artless ones each have a
// different reason: a rule anchored on a KIND names no ability at all, an aura id that is not an
// ability id has no file whatever the caster resolves to, and one ability's icon is composited at
// run time from a module an addon cannot reach.
//
// The dot on the target carries `mine`, which is the clause the whole addon turns on: two mages
// on one boss both leave a `pyroblast`, and only one is worth a global.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import RULES from './rules.json' with { type: 'json' };

const PLAYER_ID = PLAYER_ENTITY.id;
const RULES_FILE = 'rules.json';

/** Both from zone 2. */
const BROODMOTHER = 720;
const SUMMONER = 721;

/** The one mob with a stun long enough to photograph. */
const OGRE = 730;

/** The directory their own art comes from. */
const CLASS_ID = 'mage';

/**
 * Narrower than the addon's own 420: a bare frame reserves its whole box whether or not anything
 * is drawn in it, and no crop can recover that, so this is the width five squares occupy.
 */
const STRIP = { box: { x: 24, y: 24, w: 282, h: 63 }, visible: true };

/** Shut, for the scenario about the pane alone. */
const STRIP_SHUT = { box: STRIP.box, visible: false };

/**
 * One scenario rather than a sheet: a sheet lines panes up on the caption baseline, so a 63px
 * strip beside a 500px panel is stranded at the bottom of an empty column. Wider and taller than
 * the addon's own box, because a mage's eight rules clip the two notes under them first.
 */
const PANE = { box: { x: 24, y: 110, w: 700, h: 526 }, visible: true };

/** The shape the client decodes onto an entity. */
function aura(over: Record<string, unknown>): Record<string, unknown> {
  return { value: 0, stacks: 1, sourceId: 0, ...over };
}

/** The class is stated HERE: art is filed per class, and a tile built without one is never redrawn. */
function aBroodmotherPull(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  draft.mob(BROODMOTHER, { name: 'The Broodmother', templateId: 'mirefen_broodmother', level: 10 });
  draft.mob(SUMMONER, { name: 'Gravecaller Summoner', templateId: 'gravecaller_summoner' });
}

/** Four of the five rules in force. */
function afflictPlayer(stage: Stage): void {
  stage.set(stage.player, 'auras', [
    // The per-tick figure ramps, which is why this rule is a stack threshold rather than an id.
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

/** The boss is selected too, or a rule naming the target reads nothing. */
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

/** TWO settles: one for the saved frame coming up hidden, one for the data file the manifest declares. */
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

/** Where the stun comes from. */
function anOgrePull(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  draft.mob(OGRE, { name: 'Thornpeak Ogre', templateId: 'thornpeak_ogre', level: 16 });
}

/** The stun lands AFTER the first reading: the first is everything already up, which is not news. */
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

const ALERTS_ALT = 'five square alert tiles above the rules panel that produced them.';

const STUN_ALT = 'a STUNNED banner across the view, the alert strip shut.';

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
    // What a player has on screen for most of a fight: the pane is opened to set rules up and shut.
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
    // Strip shut on purpose: a banner is what reaches a player not looking at the overlay, and a
    // strip beside it would crop badly, since the banner sits at a fixed place in the view.
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
    // A bare strip with no alert draws nothing at all, which is the point: the unlock outline is
    // how a player finds it again.
    id: 'quiet',
    label: 'Nothing worth an alert',
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: STRIP },
    world: aBroodmotherPull,
    run: show,
  },
];

export { SCENARIOS };
