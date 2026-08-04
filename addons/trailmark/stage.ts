// Trailmark on the stage: a log half worked through, from a hillside in Eastbrook Vale.
//
// The table is the shipped file, imported rather than restated, and every quest, count, camp and
// NPC below was read out of it. The whole claim this addon makes is that it runs the game's own
// derivation over the game's own tables, and a fixture that invented a quest would photograph
// the one thing that cannot be wrong.
//
// The world holds nobody but the player, which is the picture rather than a saving. Every zone,
// distance and pin here is resolved from the table, so the two Mirefen rows point 180 yards into
// a zone with no entity of any kind in scope: an addon that resolved from `world.entities` would
// draw nothing for them and would look perfectly correct standing where this one is standing.
//
// Where the player stands is arithmetic. `pnpm shots` crops around the world anchors as well as
// the frame, and the picture is served into a 350 CSS pixel card, so every pixel of crop width
// costs legibility in the rows. The camera looks down world -z from over the player's shoulder,
// so a pinned point's screen offset is its x distance from the player over its depth: standing
// level with the boar camps in x and 100 yards north of them puts both tiles inside the panel's
// own 300px column.
//
// The pin reach is 160 yards for the same reason, and it is what decides which of the four
// quests is the one with pins. Both boar camps are inside it at 105 and 147; the Mirefen rows at
// 180 and the turn-in at 213 are outside, so they are listed with a zone and a distance and
// nothing is drawn over the world for them.
//
// Both denominator markings are on screen at once, on the same quest, which is why Silk and
// Venom is here rather than a second one-objective quest. Its kill has ticked while the addon
// was watching, so the server's own figure is known and the row reads 4/10; its collect has not,
// so the shipped definition count is drawn as the lower bound it is, 2/6+ and warm.
//
// The Codfather is the row that admits defeat. It is a fish, and fishing has no world node
// anywhere in the game, so no mob drops it, no crate holds it and no gathering node yields it:
// the game's own map draws nothing for it either. A scenario demonstrating honest refusal has to
// name something the game cannot answer either, and a fishing catch is that for a structural
// reason rather than a temporary one.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame } from '../../tests/fakes/frames.ts';
import TABLE from './quests.json' with { type: 'json' };

const TABLE_FILE = 'quests.json';

/** The quests in the log, in the order the log carries them. */
const PELTS = 'q_prowler_pelts';
const BOARS = 'q_boars';
const WIDOWS = 'q_widows';
const CODFATHER = 'q_the_codfather';

/**
 * Where this is photographed from: level with the boar camps, north of both. North because the
 * camera looks down -z, so anything pinned has to be in front of it, and level in x because that
 * is what keeps the two tiles in one column.
 */
const STANDPOINT = { x: 73.5, y: 5, z: 120 };

/**
 * Which way the character is looking, and it is not a detail. The arrow on a row is measured
 * against the character rather than the camera, and `facing` is 0 at +z, so a character nobody
 * has turned is looking away from everything in the picture and every arrow reads backwards.
 */
const FACING = Math.PI;

/** How far a camp may be and still be pinned. The two boar camps, and nothing else. */
const REACH = { 'pin-distance': 160 };

/**
 * The panel, parked directly over its own pins in the same 300px column. The height is the
 * addon's own arithmetic run backwards: its chrome figure plus the five rows the log comes to,
 * which is 243. Trailmark computes its row budget from the box it is given, so a pixel less holds
 * the fifth row back and more than this is empty space it will not fill.
 */
const PANEL = { box: { x: 440, y: 160, w: 300, h: 243 }, visible: true };

/**
 * One quest's live progress, in the shape the game's own log carries. `counts` is what has been
 * banked; the required figure is deliberately absent, as it is on the wire's published shape,
 * which is the gap the progress events below exist to close.
 */
function progress(questId: string, counts: number[], state = 'active'): [string, unknown] {
  return [questId, { questId, counts, state }];
}

/**
 * The log as this character woke up with it: three quests worked through, one done. Stated in
 * `world` rather than driven in `run` because an addon reads the log on its first line, and a
 * quest accepted after the body has run is one the addon reacted to.
 */
function aWorkedLog(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'name', 'Marshal');
  draft.set(draft.player, 'pos', { ...STANDPOINT });
  draft.set(draft.player, 'facing', FACING);
  draft.set(
    draft.world,
    'questLog',
    new Map([
      progress(PELTS, [8], 'ready'),
      progress(BOARS, [3]),
      progress(WIDOWS, [4, 2]),
      progress(CODFATHER, [0]),
    ]),
  );
  draft.set(draft.world, 'questsDone', new Set<string>());
}

/**
 * What the server has said out loud about an objective's true requirement. `required` rides this
 * event and nothing else, which is why an objective that has not ticked since the addon started
 * is drawn with a plus on it.
 */
function learn(stage: Stage, questId: string, objectiveIndex: number, required: number): void {
  stage.inbound(eventsFrame([{ type: 'questProgress', questId, objectiveIndex, required }]));
}

/**
 * Let the table land, then say what the server has said, then draw. The settles are the data file
 * and the frame's own stored box, both of which are promises the addon is a no-op until: a
 * progress event delivered before the table is read names a quest the addon has never heard of
 * and is dropped on the floor.
 */
async function halfWorkedThrough(stage: Stage): Promise<void> {
  await stage.settle();
  await stage.settle();
  await stage.settle();
  learn(stage, BOARS, 0, 5);
  learn(stage, WIDOWS, 0, 10);
  learn(stage, CODFATHER, 0, 1);
  stage.poll();
  await stage.settle();
  stage.frame();
}

const LOG_ALT =
  "a panel headed Trailmark listing five outstanding quest objectives as filling bars, with two pins hanging over the world below it. Every row carries a zone, a distance in yards and an arrow for the way to turn to reach it. The first row is a quest with nothing left to do, Pelts for the Causeway, its bar full and reading Ready, with Hand in to Provisioner Hale as its heading and Mirefen Marsh, 213 yd down and to the left underneath; it carries no picture, because the game ships no portrait for that NPC and the empty slot is closed up rather than left blank. Then Bristly Boar Hide at 3 of 5, in Eastbrook Vale 105 yards straight ahead, carrying the game art for the hide; Mirefen Widow slain at 4 of 10 behind that widow's own portrait, and Widow Venom Sac at 2 of 6, both 180 yards straight back in Mirefen Marsh, a zone this character has never entered and where nothing at all is in scope. The venom sac row is drawn in a warm amber and its figure carries a plus, which is this addon saying the count is the shipped definition and therefore a lower bound, until the server says otherwise. The last row, The Codfather at 0 of 1, reads Nowhere on the map where the others name a zone, a distance and a direction: the Codfather is a fish, and fishing has no world node anywhere in the game to point at, so no mob drops it, no crate holds it and the honest answer is that there is nowhere to send you. The row still carries the fish's own art, which is the shape of the whole limit: the game knows exactly what the thing looks like and cannot say where it is. Below the panel, two square pins carrying the boar hide art stand over the two camps that drop it, the nearer one hanging lower in the view than the one another forty yards beyond it.";

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'log',
    label: 'A log half worked through',
    preview: true,
    alt: LOG_ALT,
    settings: REACH,
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { objectives: PANEL },
    world: aWorkedLog,
    run: halfWorkedThrough,
  },
  {
    // The same standpoint at the manifest's own default reach, which is what a player installs
    // with. Seven areas are inside four hundred yards and two of them are in front of the camera:
    // an anchor whose point is behind the view or past its edge hides itself.
    id: 'pinned',
    label: 'The default four hundred yard reach',
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { objectives: PANEL },
    world: aWorkedLog,
    run: halfWorkedThrough,
  },
  {
    // Nothing accepted, which is what the panel looks like on a fresh character. An empty list is
    // not a measurement of zero, so it says in words why it is holding nothing.
    id: 'empty',
    label: 'Nothing in the log',
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { objectives: PANEL },
    world: (draft) => {
      aWorkedLog(draft);
      draft.set(draft.world, 'questLog', new Map());
    },
    run: halfWorkedThrough,
  },
];

export { SCENARIOS };
