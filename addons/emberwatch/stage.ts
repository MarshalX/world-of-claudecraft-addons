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
// The five tiles are one of each thing the strip can say, and the two the player did not cast are
// the reason `artOf` has a second branch: their ids are the mob's own, in no class manifest and in
// nothing an addon can reach, so those squares carry the applying mob's PORTRAIT. Both mobs here
// are catalogued templates with committed portrait art, which every mob template has.
//
// The dot on the target carries `mine`, which is the clause the whole addon turns on: two mages
// on one boss both leave a `pyroblast`, and only one is worth a global.
//
// The raid scenarios draw the boss PORTRAIT on every square: neither encounter's auras are in
// the served aura art manifest at game 0.41.0. In `varkhul-soak` the badge reads four BODIES,
// not four applications.

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

/** The two raid bosses game 0.41.0 added. Both ship a portrait, which is what fills their tiles. */
const IGNIVAR = 740;
const VARKHUL = 741;

/** Ignivar's brand ramps to three, and three is where the generic stacking rule joins in. */
const BRAND_STACKS = 3;
/** Varkhul's soak wants four bodies, and `stacks` is where the wire carries that. */
const SOAK_PLAYERS = 4;
/** The whole hit those four divide, as a fraction of one player's maximum health. */
const SOAK_SHARE = 1.4;

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
 * the addon's own box, because a mage's rules clip the two notes under them first. The eight
 * raid rules are on every class's pane, so the height covers eighteen rows; check the capture.
 */
const PANE = { box: { x: 24, y: 110, w: 700, h: 700 }, visible: true };

/**
 * The width three and two squares occupy, at the 48px square a 63px strip solves back to. Per
 * scenario for the reason STRIP is narrower than the addon's own box.
 */
const IGNIVAR_STRIP = { box: { x: 24, y: 24, w: 180, h: 63 }, visible: true };
const VARKHUL_STRIP = { box: { x: 24, y: 24, w: 126, h: 63 }, visible: true };

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

/** Ignivar from a non-tank's seat: the brand never lands on the tank, so no Molten Armor here. */
function anIgnivarPull(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  draft.mob(IGNIVAR, {
    name: 'Ignivar, Herald of the Last Flame',
    templateId: 'ignivar_herald_of_the_last_flame',
    level: 20,
  });
}

function aVarkhulPull(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  draft.mob(VARKHUL, {
    name: 'Varkhul, Forgefather of the Last Flame',
    templateId: 'varkhul_forgefather_of_the_last_flame',
    level: 20,
  });
}

/**
 * The last twenty seconds of Ignivar: branded at the cap, with the enrage running on the boss.
 * The brand's 600s remaining is the game's own figure; the encounter takes it off by script.
 */
async function ignivarEndgame(stage: Stage): Promise<void> {
  stage.set(stage.player, 'auras', [
    aura({
      id: 'ignivar_brand_of_the_pyre',
      name: 'Brand of the Pyre',
      kind: 'dot',
      school: 'fire',
      remaining: 600,
      duration: 600,
      value: 150,
      stacks: BRAND_STACKS,
      sourceId: IGNIVAR,
    }),
  ]);
  const boss = stage.entities.get(IGNIVAR);
  if (boss !== undefined) {
    stage.set(boss, 'auras', [
      aura({
        id: 'ignivar_last_inferno',
        name: 'Last Inferno',
        kind: 'buff_haste',
        school: 'fire',
        remaining: 18.4,
        duration: 45,
        value: 1.2,
        sourceId: IGNIVAR,
      }),
    ]);
  }
  stage.set(stage.player, 'targetId', IGNIVAR);
  await show(stage);
}

/**
 * Varkhul's soak: `stacks` is the players who have to stand in it and `value2` the whole hit
 * they divide. The beam scar rides along because both mechanics pick from the non-tanks.
 */
async function varkhulSoak(stage: Stage): Promise<void> {
  stage.set(stage.player, 'auras', [
    aura({
      id: 'varkhul_shared_pyre',
      name: 'Shared Pyre',
      kind: 'vulnerability',
      school: 'fire',
      remaining: 4.2,
      duration: 6,
      value: 0,
      value2: SOAK_SHARE,
      stacks: SOAK_PLAYERS,
      sourceId: VARKHUL,
    }),
    aura({
      id: 'varkhul_tempered_wound',
      name: 'Tempered Wound',
      kind: 'vuln_source',
      school: 'fire',
      remaining: 21.7,
      duration: 30,
      value: 0.5,
      sourceId: VARKHUL,
    }),
  ]);
  stage.set(stage.player, 'targetId', VARKHUL);
  await show(stage);
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
    id: 'ignivar',
    label: 'Ignivar: branded at the cap, with the enrage running',
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: IGNIVAR_STRIP },
    world: anIgnivarPull,
    run: ignivarEndgame,
  },
  {
    id: 'varkhul-soak',
    label: 'Varkhul: a soak, counting the players it needs',
    data: { [RULES_FILE]: JSON.stringify(RULES) },
    frames: { alerts: VARKHUL_STRIP },
    world: aVarkhulPull,
    run: varkhulSoak,
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
