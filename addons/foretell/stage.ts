// Foretell on the stage: one mob and three hostile players casting at once.
//
// Every id and display name is the game's own. Use real ids: `shadow_bolt` is "Gloom Bolt" in
// the game, so its worked-out label is visibly wrong, where an invented id would title-case into
// a label that looks right.
//
// The mob's cast raises no cast event, draws no icon (a mob's `templateId` is no class) and gets
// no school. Two players cast abilities this mage knows, so they are named, drawn and tinted;
// the warlock's is art plus a guessed label. Only the column is photographed: the anchored
// layout at card size reads as a failed crop.

import type { Fake, Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

/** The class the player is, which is the directory their skill art is filed under. */
const CLASS_ID = 'mage';

const VHAROK = 900;
const VESSKEN = 901;
const ILVANE = 902;
const SORRELIN = 903;

/** How tall the game draws each kind of model here, in yards. */
const BOSS_HEIGHT = 3.6;
const PLAYER_HEIGHT = 1.8;

/**
 * The list widened for a Browse card, to a width the frame can really be dragged to. The height
 * is exactly four rows at the addon's 39px pitch, since a bare frame reserves its whole box.
 */
const WIDENED = { x: 60, y: 60, w: 380, h: 156 };

/**
 * This mage's spellbook, in the game's own shape, carrying only the fields the addon reads.
 * Every name here diverges from its id.
 */
const KNOWN = Object.freeze([
  { def: { id: 'pyroblast', name: 'Pyrelance', school: 'fire', requiresTarget: true }, rank: 2 },
  {
    def: { id: 'arcane_missiles', name: 'Aether Darts', school: 'arcane', requiresTarget: true },
    rank: 3,
  },
  { def: { id: 'frostbolt', name: 'Rimelance', school: 'frost', requiresTarget: true }, rank: 4 },
  {
    // `empowerStages` sits on the DEF, where the game declares it.
    def: {
      id: 'glacial_front',
      name: 'Glacial Front',
      school: 'frost',
      requiresTarget: false,
      empowerStages: 4,
    },
    rank: 1,
  },
]);

/** A cast in progress, as the wire spells it. */
interface Cast {
  ability: string;
  remaining: number;
  total: number;
  channeling?: boolean;
}

/** One hostile player: who they are, where they stand, what they are casting. */
interface Enemy {
  id: number;
  name: string;
  /** Their class, which is the directory the game files their art under. */
  cls: string;
  pos: { x: number; y: number; z: number };
  cast: Cast;
}

/**
 * Where the casters stand, in yards, around a player at the origin. The two mages stand close
 * enough that their anchored bars collide, so the farther one is lifted clear.
 */
const ENEMIES: readonly Enemy[] = [
  {
    id: VESSKEN,
    name: 'Vessken',
    cls: 'warlock',
    pos: { x: -1.2, y: 0, z: -4 },
    cast: { ability: 'shadow_bolt', remaining: 0.7, total: 1.5 },
  },
  {
    id: ILVANE,
    name: 'Ilvane',
    cls: 'mage',
    pos: { x: 2.3, y: 0, z: -13 },
    cast: { ability: 'pyroblast', remaining: 3.1, total: 4.5 },
  },
  {
    id: SORRELIN,
    name: 'Sorrelin',
    cls: 'mage',
    pos: { x: 2.9, y: 0, z: -13.6 },
    cast: { ability: 'arcane_missiles', remaining: 2.4, total: 3, channeling: true },
  },
];

/** A cast where the game writes one, which is on the entity and nowhere else. */
function casting(draft: WorldDraft, unit: Fake, cast: Cast): void {
  draft.set(unit, 'castingAbility', cast.ability);
  draft.set(unit, 'castRemaining', cast.remaining);
  draft.set(unit, 'castTotal', cast.total);
  draft.set(unit, 'channeling', cast.channeling === true);
}

/** The boss, whose mechanic nothing announces. */
function addBoss(draft: WorldDraft): void {
  const boss = draft.mob(VHAROK, {
    name: 'Tempest Vharok',
    templateId: 'rift_boss_storm',
    pos: { x: -1.4, y: 0, z: -9 },
  });
  draft.model(VHAROK, { height: BOSS_HEIGHT });
  casting(draft, boss, { ability: 'rift_thunderhead', remaining: 1.9, total: 3.5 });
}

/** One hostile player, which is a caster whose art the game does ship. */
function addEnemy(draft: WorldDraft, enemy: Enemy): void {
  const unit = draft.mob(enemy.id, {
    name: enemy.name,
    kind: 'player',
    templateId: enemy.cls,
    pos: enemy.pos,
  });
  draft.model(enemy.id, { height: PLAYER_HEIGHT });
  casting(draft, unit, enemy.cast);
}

/** Who you are, which is everything the addon reads before a bar exists. */
function aMage(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', CLASS_ID);
  draft.set(draft.player, 'pos', { x: 0, y: 0, z: 0 });
  draft.set(draft.world, 'known', KNOWN);
}

/** The fight, already under way when the addon starts. */
function aContestedRift(draft: WorldDraft): void {
  aMage(draft);
  addBoss(draft);
  for (const enemy of ENEMIES) {
    addEnemy(draft, enemy);
  }
}

/** Room for exactly the charged panel's three rows and no fourth. */
const CHARGED_BOX = { x: 60, y: 60, w: 380, h: 117 };

/**
 * Ilvane is 1.05 seconds from full on a 2.4 second charge, stage 3 of 4: past halfway and
 * outside the last second, so the stage counts in the school colour rather than going red.
 * Sorrelin casts an ordinary frostbolt, named and tinted from the same spellbook with no stage.
 */
const CHARGERS: readonly Enemy[] = [
  {
    id: ILVANE,
    name: 'Ilvane',
    cls: 'mage',
    pos: { x: 2.3, y: 0, z: -13 },
    cast: { ability: 'glacial_front', remaining: 1.05, total: 2.4 },
  },
  {
    id: SORRELIN,
    name: 'Sorrelin',
    cls: 'mage',
    pos: { x: -3.4, y: 0, z: -11 },
    cast: { ability: 'frostbolt', remaining: 1.6, total: 2.2 },
  },
];

/**
 * The same rift around the charge. `rift_thunderhead` is in nobody's spellbook, so the boss's
 * row is an ordinary cast bar carrying the mark.
 */
function aChargedFront(draft: WorldDraft): void {
  aMage(draft);
  addBoss(draft);
  for (const enemy of CHARGERS) {
    addEnemy(draft, enemy);
  }
}

/**
 * Let the frame come back, then read the world once and draw it. The settle is required: a saved
 * frame starts hidden until storage answers, and this addon draws nothing while it is hidden.
 */
async function look(stage: Stage): Promise<void> {
  await stage.settle();
  stage.poll();
  stage.frame();
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'column',
    label: 'Four casts as a column',
    preview: true,
    alt: 'a borderless column of four draining cast bars, soonest to land first, each naming its caster underneath; a question mark marks a name worked out from the ability id.',
    frames: { casts: { box: WIDENED, visible: true } },
    world: aContestedRift,
    run: look,
  },
  {
    id: 'anchors',
    label: 'A bar over each caster',
    alt: 'the same four casts as bars floating over the units casting them, scattered where those casters stand rather than ordered by anything: the boss bar highest, over a model twice the height of the rest, and the warlock nearest the camera and lowest. None of them names its caster, because each bar is already over the one it belongs to. The two mages stand together, so their bars would have landed in one place: the nearer keeps its position and the farther is lifted clear above it and takes its caster name, Sorrelin, back as a second line, which is the only thing saying that bar is no longer over anybody.',
    settings: { layout: 'anchors' },
    world: aContestedRift,
    run: look,
  },
  {
    // Not `preview: true`: the committed picture and its alt describe the column above.
    id: 'charged',
    label: 'A hold-to-charge cast',
    alt: 'three cast bars in a borderless column. The top one reads "Glacial Front 3/4", a stage counted out of the cast clock for an ability this mage knows; the second reads "Rimelance", known and tinted and carrying no stage because it has none; the third reads "Rift Thunderhead?" with the question mark that marks a name worked out from a cast id, and no stage, because the stage count comes off your own spellbook and nothing on the wire says whether that cast is being charged.',
    frames: { casts: { box: CHARGED_BOX, visible: true } },
    world: aChargedFront,
    run: look,
  },
  {
    // Nothing casting, which is most of a session. A bare frame draws nothing at all.
    id: 'quiet',
    label: 'Nothing casting',
    world: aMage,
    run: look,
  },
];

export { SCENARIOS };
