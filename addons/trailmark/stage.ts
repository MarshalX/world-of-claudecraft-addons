// Trailmark on the stage: a log half worked through, from a hillside in Eastbrook Vale.
//
// The table is the shipped file, imported rather than restated, and every quest, count, camp and
// NPC below is read out of it, because the addon's claim is that it runs the game's derivation over
// the game's tables.
//
// The world holds nobody but the player: every zone, distance and pin is resolved from the table,
// so the two Mirefen rows point into a zone with no entity in scope, which an addon reading
// `world.entities` would leave blank.
//
// The standpoint is arithmetic. `pnpm shots` crops around the anchors as well as the frame, and the
// camera looks down world -z, so a pin's screen offset is its x distance over its depth: standing
// level with the boar camps in x and north of them keeps both pins inside the panel's 300px column.
// The reach decides which quest has pins: the boar camps are inside it, the Mirefen rows and the
// turn-in outside.
//
// Silk and Venom shows both denominator markings at once: its kill has ticked, so the server's
// figure is known (4/10); its collect has not, so the definition count is drawn as a lower bound
// (2/6+).
//
// The Codfather is a fish, and fishing has no world node, so neither the game's map nor this addon
// can place it: the row that honestly refuses.

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
 * Where this is photographed from: level in x with the boar camps (their midpoint) and north of
 * both, since the camera looks down -z. The z is what keeps the far camp inside `REACH`; if a
 * release moves the camps, re-derive both from the table, because a standpoint that leaves every
 * camp out of reach captures with NO PINS while the alt text still promises them, and nothing
 * fails.
 */
const STANDPOINT = { x: 77.5, y: 5, z: 74 };

/**
 * Which way the character faces. Row arrows are measured against the character, and `facing` 0 is
 * +z, so an unturned character looks away from everything and every arrow reads backwards.
 */
const FACING = Math.PI;

/**
 * How far a camp may be and still be pinned: both boar camps and nothing else. The window is narrow
 * (the far boar camp at 147 yards, the nearest other camp at 157); the prowler quest is a turn-in
 * and pins its NPC, so its camp stays out of the picture.
 */
const REACH = { 'pin-distance': 160 };

/**
 * The panel, parked over its own pins in the same 300px column. The height is the addon's chrome
 * figure plus the log's five rows: a pixel less holds the fifth row back, and more is empty space.
 */
const PANEL = { box: { x: 440, y: 160, w: 300, h: 243 }, visible: true };

/**
 * One quest's live progress as the game's log carries it. The required figure is absent, as on the
 * published shape, which is the gap the progress events close.
 */
function progress(questId: string, counts: number[], state = 'active'): [string, unknown] {
  return [questId, { questId, counts, state }];
}

/**
 * The log as this character woke up with it: three quests worked through, one done. In `world`
 * because the addon reads the log on its first line.
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
 * What the server said about an objective's true requirement. `required` rides only this event, so
 * an objective that has not ticked since the addon started is drawn with a plus.
 */
function learn(stage: Stage, questId: string, objectiveIndex: number, required: number): void {
  stage.inbound(eventsFrame([{ type: 'questProgress', questId, objectiveIndex, required }]));
}

/**
 * Let the table and the stored box land, then send progress, then draw. A progress event delivered
 * before the table is read names an unknown quest and is dropped.
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
  'a panel of the outstanding objectives in your quest log, each a bar saying how far along it is, where it is and which way to turn, with pins in the world below';

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
    // The same standpoint at the manifest's default reach. Seven areas are within reach and two are
    // in front of the camera; an anchor behind the view or past its edge hides itself.
    id: 'pinned',
    label: 'The default four hundred yard reach',
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { objectives: PANEL },
    world: aWorkedLog,
    run: halfWorkedThrough,
  },
  {
    // Nothing accepted: a fresh character. An empty list says in words why it is empty.
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
