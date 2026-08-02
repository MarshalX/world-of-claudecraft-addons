// Purelight on the stage: one strip carrying both directions at once.
//
// A BATTLEGROUND rather than a raid, and that is the composition rather than a
// setting. This addon answers two questions with one rule, "what harmful effect
// can be lifted off a friendly unit" and "what benefit can be stripped off a
// hostile one", and a raid picture can only show the first: a boss's debuffs all
// come from a mob, a mob's icon is composited on a canvas at run time, and the
// shot would be five squares of school colour saying nothing about where art comes
// from. In a battleground both halves are on screen and four of the five tiles
// resolve real art, because the thing applying them is a player and skill art is
// filed per player class.
//
// EVERY ID, NAME, KIND, SCHOOL AND DURATION HERE IS THE GAME'S OWN, read out of
// its content files rather than invented, and the ids and the names disagree on
// purpose because the game's do: `polymorph` is displayed as "Bewitch",
// `corruption` as "Blackrot", `curse_of_agony` as "Hex of Anguish" and
// `ice_barrier` as "Frostveil". That divergence is why art is filed under the ID
// and why nothing here derives one from the other.
//
// The five tiles are one each of everything the strip can say:
//
//  - BEWITCH on the tank is CONTROL, so it sorts to the front whatever is left on
//    it. It is also the reason this file exists in its current form: `polymorph`
//    is one of the game's real control kinds, and an earlier CONTROL_KINDS named
//    `fear`, `sleep`, `charm` and `horror`, none of which is an aura kind in this
//    game, so this tile sorted below the dots and the picture would have been of
//    the bug.
//  - BLACKROT and HEX OF ANGUISH are damage, ordered longest-remaining first,
//    which is the opposite of a cooldown list and for the opposite reason: an
//    effect about to fall off on its own is the one NOT worth a global.
//  - TEMPORAL EXHAUSTION is the artless case, and it is not a contrivance: it is
//    what your own shaman leaves on the group after Bloodlust, its aura id is
//    `sated` rather than any ability id, so there is no file to point at however
//    the caster's class resolves. It also runs 600 seconds, which is the only
//    thing on the strip drawn in minutes, since a 40 pixel square cannot spell out
//    "552".
//  - FROSTVEIL is the other DIRECTION: a benefit on a hostile unit, which is a
//    purge rather than a dispel, and the tooltip on it says so in as many words.
//
// The two enemy casters are entities in the world whether or not they are on the
// strip, and they have to be: a tile's art is resolved through the CASTER's class,
// so a source the world cannot find is a tile with no picture for a reason that
// has nothing to do with the game.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** The local player's own entity id, which the shared fixture fixes at 661. */
const PLAYER_ID = 661;

/** Your group. The tank, the other healer, and the shaman who cost you a tile. */
const TANK = 701;
const PRIEST = 702;
const SHAMAN = 703;

/** The other side. Only the mage is selected; the warlock is here to be a caster. */
const MAGE = 710;
const WARLOCK = 711;

/** The class the player is, which is the directory their own art would come from. */
const CLASS_ID = 'paladin';

/** One effect in the shape the client decodes onto an entity. */
function aura(over: Record<string, unknown>): Record<string, unknown> {
  return { value: 0, stacks: 0, sourceId: 0, ...over };
}

/** A party row, in the compact shape the wire sends and the loader hands on. */
function member(pid: number, name: string, cls: string): Record<string, unknown> {
  return {
    pid,
    name,
    cls,
    level: 20,
    hp: 780,
    mhp: 1000,
    res: 0,
    mres: 0,
    rtype: null,
    x: 0,
    z: 0,
    dead: 0,
    inCombat: 1,
    group: 1,
    // Deliberately empty. Rows are what this addon refuses to read: one carries
    // neither a school nor `unbreakableControl`, which are two of the three
    // clauses, so a row can only ever answer half the question.
    auras: [],
  };
}

/** Your side: three players near enough to have entities, and the roster. */
function addGroup(draft: WorldDraft): void {
  draft.mob(TANK, { name: 'Bragg', kind: 'player', hostile: false, templateId: 'warrior' });
  draft.mob(PRIEST, { name: 'Sunna', kind: 'player', hostile: false, templateId: 'priest' });
  draft.mob(SHAMAN, { name: 'Karrek', kind: 'player', hostile: false, templateId: 'shaman' });
  draft.set(draft.world, 'partyInfo', {
    leader: PLAYER_ID,
    raid: false,
    members: [
      member(PLAYER_ID, 'Marshal', CLASS_ID),
      member(TANK, 'Bragg', 'warrior'),
      member(PRIEST, 'Sunna', 'priest'),
      member(SHAMAN, 'Karrek', 'shaman'),
    ],
  });
}

/** The other side: the mage you have selected, and the warlock working on you. */
function addEnemies(draft: WorldDraft): void {
  draft.mob(MAGE, { name: 'Emberlash', kind: 'player', templateId: 'mage', level: 20 });
  draft.mob(WARLOCK, { name: 'Nyxhollow', kind: 'player', templateId: 'warlock', level: 20 });
}

/**
 * The skirmish as the addon woke up in it.
 *
 * All of it in `world` rather than in `run`, since every one of these is a fact a
 * session would already have: who is in your group, who is standing in front of
 * you, and what class each of them is. The classes are the half that bites, for
 * the reason the Cooldown Bars scenario gives one level down: art is filed per
 * class, and a class stated after the addon has mounted is a class the tiles
 * already built without.
 */
function aSkirmish(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  addGroup(draft);
  addEnemies(draft);
}

/**
 * Put one effect on a unit that is already in the world.
 *
 * The list is REPLACED rather than pushed onto, because nobody here is carrying
 * more than one thing: reading `unit.auras` back out would be a literal key into a
 * `Record<string, unknown>`, which is the one place Biome and TypeScript want
 * opposite spellings, and the array this writes is the same array the game would
 * have handed over.
 */
function afflict(stage: Stage, id: number, over: Record<string, unknown>): void {
  const unit = stage.entities.get(id);
  if (unit !== undefined) {
    stage.set(unit, 'auras', [aura(over)]);
  }
}

/**
 * Wait for the strip to actually be on screen before drawing into it.
 *
 * A saved frame comes up HIDDEN and is shown once its stored state arrives, and
 * that answer is keyed per character, so it takes a poll to find the character and
 * a storage read to come back. The addon skips the drawing entirely while its
 * frame is hidden, so a scenario that only polls and ticks photographs an empty
 * page and reports success.
 */
async function show(stage: Stage): Promise<void> {
  stage.poll();
  await stage.settle();
  stage.frame();
}

/** What has actually landed, which is the only part of this that is an event. */
async function midFight(stage: Stage): Promise<void> {
  afflict(stage, TANK, {
    id: 'polymorph',
    name: 'Bewitch',
    kind: 'polymorph',
    school: 'arcane',
    remaining: 14.2,
    duration: 20,
    sourceId: MAGE,
  });
  afflict(stage, PLAYER_ID, {
    id: 'corruption',
    name: 'Blackrot',
    kind: 'dot',
    school: 'shadow',
    remaining: 15.4,
    duration: 18,
    value: 14,
    sourceId: WARLOCK,
  });
  afflict(stage, PRIEST, {
    id: 'curse_of_agony',
    name: 'Hex of Anguish',
    kind: 'dot',
    school: 'shadow',
    remaining: 9.8,
    duration: 24,
    value: 9,
    sourceId: WARLOCK,
  });
  afflict(stage, SHAMAN, {
    id: 'sated',
    name: 'Temporal Exhaustion',
    kind: 'sated',
    school: 'nature',
    remaining: 552,
    duration: 600,
    sourceId: SHAMAN,
  });
  // The mage's own barrier, on the mage. A benefit on a hostile unit, so it is the
  // one tile here pointing the other way.
  afflict(stage, MAGE, {
    id: 'ice_barrier',
    name: 'Frostveil',
    kind: 'absorb',
    school: 'frost',
    remaining: 41,
    duration: 60,
    value: 240,
    sourceId: MAGE,
  });
  stage.set(stage.player, 'targetId', MAGE);
  await show(stage);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'skirmish',
    label: 'Both directions at once',
    preview: true,
    alt: 'a strip of five square tiles, each with a countdown over the art and the name of whoever is carrying the effect under it. Bewitch on Bragg first at 15 seconds, a polymorph and the only control on the strip, which is what puts it ahead of everything else whatever is left on it. Then Blackrot on Marshal at 16 seconds and Hex of Anguish on Sunna at 10, both damage over time, both bordered in the shadow school and both carrying the art the game files under the ability that applied them. Then Temporal Exhaustion on Karrek at 10m, a green nature border around no picture at all, because its aura id is not an ability id and there is no file for it anywhere. Last, Frostveil on Emberlash, the enemy mage, at 41 seconds, which is on the strip for the opposite reason: it is a benefit on a hostile unit, so it can be stripped away rather than lifted off.',
    world: aSkirmish,
    run: midFight,
  },
  {
    // Most of a session, and the state nobody thinks to photograph. A bare frame
    // with nothing removable in front of you draws nothing at all, which is the
    // whole point and is also indistinguishable from an addon that is switched
    // off: the unlock outline is how a player finds it again to move it.
    id: 'clear',
    label: 'Nothing worth a global',
    world: aSkirmish,
    run: show,
  },
];

export { SCENARIOS };
