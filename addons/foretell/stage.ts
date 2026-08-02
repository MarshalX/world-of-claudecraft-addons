// Foretell on the stage: four things casting at once, and one of them a mob.
//
// EVERY ABILITY ID AND ITS DISPLAY NAME HERE IS THE GAME'S OWN, read out of the
// deployed i18n bundle rather than invented, and that is what makes the picture say
// something true rather than something plausible. `shadow_bolt` is shown everywhere
// in the game as "Gloom Bolt", so the row this addon works out from the id reads
// "Shadow Bolt" and is WRONG, which is exactly what the note under the list is
// warning about. An invented id title-cases into a label that looks right, and a
// preview built on one would illustrate the caveat with a case where the caveat
// costs nothing.
//
// ONE MOB AND THREE HOSTILE PLAYERS, and the split is the whole composition rather
// than scenery.
//
//  - THE MOB is the reason this addon exists. `rift_thunderhead` is what the entity
//    carries while Tempest Vharok, the storm rift boss, winds up its mechanic, and
//    nothing raises a cast event for it: a display built on `castStart` draws
//    nothing here at all. It is also everything this addon cannot recover. Skill art
//    is filed under a player CLASS and `templateId` on a mob is the mob template, so
//    there is no icon to draw; a school is recoverable only out of your own
//    spellbook, so the fill is left plain. That row is the honest common case.
//  - THE PLAYERS are what makes the other half of the display visible. Two of them
//    cast something this mage also knows, so those rows carry the game's own name,
//    the game's own art and the school colour it files that damage under, and the
//    third casts a warlock's `shadow_bolt`, which no mage's spellbook can name: art,
//    because the caster is a player, and a guessed label, because the ability is not
//    yours.
//
// A contested rift is where those two meet, which is why the shot is one. Four mobs
// would be four plain untinted rows, true to the common case and silent about the
// rest of the display; four players would be a picture of a cast bar that any
// display built on the cast event could have drawn.
//
// The 0.7 second row is the only red one. Tone wins over school in the kit, so a row
// in its last second stops saying what kind of damage it is and starts saying that it
// is about to land, and putting that on the row whose name is a guess keeps the two
// readings separate: the colour is about time and the label is about knowledge.
//
// ONLY THE COLUMN IS PHOTOGRAPHED. Both layouts draw the same four casts and the
// anchored one is here to look at on the stage, but a sheet of the two is a picture of
// a setting rather than a picture of the addon: the panels are the same bars twice, and
// the anchored half is bars scattered over an empty background, which reads at card
// size as a screenshot that failed to crop. The column says what this addon is in one
// glance and is the layout it opens in.

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
 * The list as a player who has widened it holds it, which is what gets photographed.
 *
 * The addon opens at 240, which is a HUD width: narrow enough to park beside the game's
 * own frames and wide enough for a name and a countdown. As a picture it is a tall thin
 * strip, and a Browse card is a wide slot, so the shot is taken at a width the frame is
 * genuinely draggable to rather than by changing what the addon opens at. Nothing here
 * moves a bound: the only one this crosses is the addon's own 120px floor, and this is
 * above it.
 *
 * The HEIGHT is room for exactly the four casts below and no fifth row, which is the
 * one thing a crop cannot fix: a bare frame reserves its box whether or not anything
 * is drawn in it, so a five-row box would put a fifth of the picture aside for a bar
 * that is not there. 4 rows at the addon's own 39px pitch.
 */
const WIDENED = { x: 60, y: 60, w: 380, h: 156 };

/**
 * This mage's spellbook, in the game's own shape.
 *
 * Three fields of it are read and the rest is left out rather than filled in with
 * numbers nobody checked: `world.abilities` is the only bridge from an ability id to
 * anything the game says about it, and this addon asks it for a name and a school.
 * Every name here diverges from its id, which is why an id is a guess rather than a
 * near miss.
 */
const KNOWN = Object.freeze([
  { def: { id: 'pyroblast', name: 'Pyrelance', school: 'fire', requiresTarget: true }, rank: 2 },
  {
    def: { id: 'arcane_missiles', name: 'Aether Darts', school: 'arcane', requiresTarget: true },
    rank: 3,
  },
  { def: { id: 'frostbolt', name: 'Rimelance', school: 'frost', requiresTarget: true }, rank: 4 },
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
 * Where the casters stand, in yards, around a player at the origin.
 *
 * Read by the anchored panel and by nothing else, but stated once for both: the two
 * panels are the same fight seen two ways, and a world that changed between them
 * would make the pair a comparison of two fights.
 *
 * The two mages stand close enough that their bars would land on top of each other,
 * which is the case `ui.project` and its depth exist for: the nearer keeps its place
 * and the farther is lifted clear. Everything else is far enough apart to be left
 * where it belongs.
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

/**
 * The fight, stated before the addon has run a line.
 *
 * In `world` rather than in `run` because that is what a session looks like: the
 * addon starts, reads the world, and draws what is already happening. Its frame
 * handler repopulates from the world the first time the display is up, so a cast
 * that was underway before it started is drawn exactly like one that began after.
 */
function aContestedRift(draft: WorldDraft): void {
  aMage(draft);
  addBoss(draft);
  for (const enemy of ENEMIES) {
    addEnemy(draft, enemy);
  }
}

/**
 * Let the frame come back, then read the world once and draw it.
 *
 * The settle is not optional here and it is the one step this scenario cannot skip.
 * A frame that saves its visibility starts HIDDEN and shows once storage has
 * answered, and this addon draws nothing at all while its frame is down, so a poll
 * and a frame taken before that answer lands produce a display that never populates:
 * an empty box, photographed.
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
    alt: "a borderless column of four draining bars, soonest to land first, each naming its caster underneath. Shadow Bolt? at 0.7 seconds by Vessken, its fill red because it lands within a second, and its name worked out by title-casing the ability id, which the game itself calls Gloom Bolt: the question mark is the display saying so. Rift Thunderhead? at 1.9 seconds by the boss Tempest Vharok, marked the same way and drawn in the plain fill with no icon, because skill art is filed under a player class and nothing on the wire says what school a mob cast is. Aether Darts at 2.4 seconds by Sorrelin and Pyrelance at 3.1 seconds by Ilvane, both abilities this mage also knows, so both carry the game's own name unmarked, its art, and the colour the game gives that school, arcane blue and fire orange.",
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
    // What the display looks like with nothing casting, which is most of a session
    // and the state nobody thinks to photograph. The frame is bare, so there is
    // nothing on screen at all: the room it reserves is the price of having handles
    // to size it by.
    id: 'quiet',
    label: 'Nothing casting',
    world: aMage,
    run: look,
  },
];

export { SCENARIOS };
