// Purelight on the stage: one strip carrying both directions at once.
//
// A battleground rather than a raid, because a raid picture shows only the dispel direction (every
// boss debuff comes from a mob) and the addon also answers what can be purged off a hostile unit.
// Every id, name, kind, school and duration is the game's own, and ids and names disagree because
// the game's do (`polymorph` is "Bewitch", `ice_barrier` is "Frostveil").
//
// The five tiles cover everything the strip can say: Bewitch is control and sorts first (`fear`,
// `sleep` and `charm` are not aura kinds in this game); Blackrot and Hex of Anguish are damage,
// longest remaining first; Temporal Exhaustion (`sated`) has no ability art and is the one tile
// long enough to draw in minutes; Frostveil is a benefit on a hostile unit, a purge.
//
// The enemy casters are entities in the world because a tile's art is resolved through the caster's
// class, and a source the world cannot find draws no picture.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import TABLE from './refused.json' with { type: 'json' };

const TABLE_FILE = 'refused.json';
const DATA = { [TABLE_FILE]: JSON.stringify(TABLE) };

/**
 * One id, checked against the shipped table so a regeneration that drops it fails the scenario
 * rather than the picture.
 */
function mustBeRefused(id: string): string {
  if (!TABLE.auras.some((row) => row.id === id)) {
    throw new Error(`refused.json no longer carries ${id}, so this scenario is out of date`);
  }
  return id;
}

/** The local player's own entity id, which the shared fixture fixes at 661. */
const PLAYER_ID = 661;

/** Your group: the tank, the other healer, and the shaman who cost you a tile. */
const TANK = 701;
const PRIEST = 702;
const SHAMAN = 703;

/** The other side. Only the mage is selected; the warlock is here to be a caster. */
const MAGE = 710;
const WARLOCK = 711;

/** The raid case's one enemy, whose template id is the one a portrait is filed under. */
const BOSS = 720;
const BOSS_TEMPLATE = 'ignivar_herald_of_the_last_flame';

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
    // Empty on purpose: the addon never reads rows, which carry neither school nor
    // `unbreakableControl`.
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
 * The skirmish as the addon woke up in it. All in `world`, because art is filed per class and a
 * class stated after mounting is one the tiles were built without.
 */
function aSkirmish(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  addGroup(draft);
  addEnemies(draft);
}

/** The same group, in front of a boss. The boss is a `mob`, so its effects draw its PORTRAIT. */
function aRaid(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'name', 'Marshal');
  addGroup(draft);
  draft.mob(BOSS, {
    name: 'Ignivar, Herald of the Last Flame',
    kind: 'mob',
    hostile: true,
    templateId: BOSS_TEMPLATE,
    level: 25,
  });
}

/**
 * Put one effect on a unit already in the world. The list is replaced rather than pushed onto,
 * because reading `unit.auras` back is a literal key into a `Record<string, unknown>`, where Biome
 * and TypeScript want opposite spellings.
 */
function afflict(stage: Stage, id: number, over: Record<string, unknown>): void {
  const unit = stage.entities.get(id);
  if (unit !== undefined) {
    stage.set(unit, 'auras', [aura(over)]);
  }
}

/**
 * Wait for the strip to be on screen. A saved frame comes up HIDDEN until its per-character state
 * loads, and the addon skips drawing while hidden, so a scenario that only polls and ticks
 * photographs an empty page.
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
  // The mage's own barrier: a benefit on a hostile unit, the one tile pointing the other way.
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

/**
 * Two real Ignivar mechanics the game refuses beside an ordinary curse: ONE tile to act on and a
 * held tile counting two. Not the preview, which shows both directions.
 */
async function inTheForge(stage: Stage): Promise<void> {
  afflict(stage, TANK, {
    id: mustBeRefused('ignivar_brand_of_the_pyre'),
    name: 'Brand of the Pyre',
    kind: 'dot',
    school: 'fire',
    remaining: 42,
    duration: 600,
    value: 180,
    sourceId: BOSS,
  });
  // The boss's own haste: the purge direction, and refused too.
  afflict(stage, BOSS, {
    id: mustBeRefused('ignivar_last_inferno'),
    name: 'Last Inferno',
    kind: 'buff_haste',
    school: 'fire',
    remaining: 22.5,
    duration: 30,
    value: 1.2,
    sourceId: BOSS,
  });
  afflict(stage, PRIEST, {
    id: 'curse_of_agony',
    name: 'Hex of Anguish',
    kind: 'dot',
    school: 'shadow',
    remaining: 16.4,
    duration: 24,
    value: 9,
    sourceId: BOSS,
  });
  stage.set(stage.player, 'targetId', BOSS);
  await show(stage);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'skirmish',
    label: 'Both directions at once',
    preview: true,
    alt: 'a strip of five square tiles, each a countdown over the art with the name of whoever carries the effect under it. The borders colour by school, and one tile has no art at all.',
    data: DATA,
    world: aSkirmish,
    run: midFight,
  },
  {
    id: 'forge',
    label: 'A fight that owns its own effects',
    data: DATA,
    world: aRaid,
    run: inTheForge,
  },
  {
    // With nothing removable the bare frame draws nothing, indistinguishable from a switched-off
    // addon; the unlock outline is how a player finds it to move it.
    id: 'clear',
    label: 'Nothing worth a global',
    data: DATA,
    world: aSkirmish,
    run: show,
  },
];

export { SCENARIOS };
