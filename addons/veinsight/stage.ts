// Veinsight on the stage: a mining circuit half way round.
//
// THE TABLE IS THE SHIPPED FILE, imported rather than restated, and every
// coordinate below was read out of it. A fixture that invented its own nodes would
// photograph a world nobody installs, and the join this addon exists for is exactly
// the one a made-up table cannot get wrong.
//
// THE PINS SIT UNDER THE PANEL RATHER THAN BESIDE IT, and that is arithmetic rather
// than taste. `pnpm shots` crops around world anchors as well as frames, and a
// preview is served into a 350 CSS pixel slot (`PREVIEW_MIN_WIDTH` over `RETINA` in
// tools/site/shots.ts), so everything in the picture is rendered at 350 divided by
// the width of the whole crop. Side by side, the crop was 646 wide, the panel took
// half of it, and its 12px rows landed at about six pixels, which does not read as
// small text, it reads as text with the tops cut off.
//
// WIDTH is what costs, and height is nearly free: a portrait shot is only narrowed
// once it is taller than about 1.34 times its width (`PORTRAIT_MAX_HEIGHT` over the
// slot). So the panel is parked ABOVE its own pins, both inside one 320px column,
// and the crop is the panel's width rather than the panel plus the world. The rows
// render at 0.95x, the same as a panel with nothing beside it, and the pins are in
// the picture.
//
// That is also what caps the list at seven rows here. Nine put the crop past the
// portrait threshold, which narrows the whole picture to 0.85x to fit the height
// cap; seven keeps every type and every state on screen and stays under it.
//
// THE THREE PILLARS ARE THE POINT OF THE PINS, and each is produced by its own cause
// rather than asserted:
//
//   ore_eastbrook_2  this character harvested it a moment ago, standing on it, so
//                    the height is a measurement and the pillar is SOLID.
//   ore_eastbrook_1  a digger is standing two yards from the point, so its feet are
//                    the height, and the pillar is DASHED.
//   ore_eastbrook_3  nothing has been within six yards of it, so the pin sits at the
//                    player's own height and the pillar is DOTTED.
//
// WHICH VEIN IS HARVESTED IS FORCED, and finding out why is worth the line. The
// three are five yards apart and the addon samples anything within six, and the
// PLAYER is an entity like any other, so standing on one vein to mine it hands its
// neighbours a height too. Harvesting the middle one left nothing for the dotted
// case: it sampled both the others off the player's own feet, and the scenario drew
// dashed, solid, dashed. Mining the end of the run leaves the far vein untouched.
//
// The slope is why they are drawn at three different heights: the vein the player
// mined is half a yard above where they are standing now and the one with somebody
// on it is half a yard above that, which is what a hillside does and what a flat
// disc at one height would hide.
//
// NO SICKLE IN THE BAGS, deliberately. A gatherer who mines and logs and does not
// pick herbs is ordinary, and it is the only way this zone can show the tool gate:
// every node in Eastbrook Vale is tier 1, so a full kit opens all nine and the
// three herb rows would say nothing a timer does not already say.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame } from '../../tests/fakes/frames.ts';
import TABLE from './nodes.json' with { type: 'json' };

const TABLE_FILE = 'nodes.json';

/** The entity standing over the second vein, whose feet are its height. */
const PROSPECTOR = 820;

/**
 * Where this is photographed from, south and east of the ore.
 *
 * South so the veins are in front of the camera rather than behind it. EAST is the
 * half that is not obvious and is the whole reason the three pins are legible: the
 * cluster runs away from the camera rather than across it, six yards of x against
 * eight of z, so from anywhere on its own axis the three tiles land within forty
 * pixels of each other and overlap. From the east the nearest vein is also the
 * westernmost, so the perspective divide pulls it wide of the far one instead of
 * stacking them, and the same three rocks spread across two hundred pixels.
 * Standing an equal distance WEST does the opposite and collapses all three onto
 * one point, which is worth knowing before moving this.
 */
const STANDPOINT = { x: -60, y: 5, z: -25 };

/**
 * Which way the character is facing, and it is not a detail.
 *
 * The bearing column is measured against the CHARACTER rather than the camera, and
 * `facing` is 0 at +z, so a character who has not been turned is looking away from
 * everything the picture shows and every arrow reads backwards. Half a turn puts
 * them looking the way the camera is.
 */
const FACING = Math.PI;

/** The vein the player mined, from `nodes.json`, and the ground it stands on. */
const HARVESTED = { id: 'ore_eastbrook_2', x: -73, z: -49, y: 5.6 };

/**
 * Where the digger is standing, which is two yards off `ore_eastbrook_1`.
 *
 * Off the point rather than on it, because that is what standing NEAR a rock looks
 * like and the addon takes anything within six yards. Its own y is the whole of what
 * the sampled pin is placed by, and it is nearer that vein than the player ever gets,
 * which is what decides whose feet the height comes from.
 */
const PROSPECTOR_POS = { x: -71, y: 6.2, z: -51.5 };

/**
 * What was already on this character's own timers when the addon woke up, in
 * seconds: the stand cut a minute ago is halfway back, and the one cut before that
 * is nearly ready and goes warm for it.
 *
 * The third timer is not here on purpose. It belongs to the vein mined during the
 * scenario, and a harvest is what starts one.
 */
const COOLING: ReadonlyArray<readonly [string, number]> = [
  ['wood_eastbrook_2', 61],
  ['wood_eastbrook_1', 9],
];

/**
 * What is left on the vein just taken, out of the game's own 120.
 *
 * Not a round number and not the full length, because both are readings a player
 * only ever catches for one tick: a picture of either is a picture of the moment
 * the timer started rather than of a circuit being walked.
 */
const LEFT_ON_THE_VEIN = 83;

/** A pick and an axe, no sickle. Owning a gathering tool is carrying it. */
const BAGS = [
  { itemId: 'copper_mining_pick', count: 1 },
  { itemId: 'handaxe', count: 1 },
  { itemId: 'copper_ore', count: 14 },
  { itemId: 'ironbark_log', count: 6 },
];

/**
 * Where the panel is parked: directly over its own pins, in the same column.
 *
 * The x centres the 320px panel on the three pins below it, which land between 242
 * and 476, so the crop is one column rather than a panel and a world side by side.
 * The y clears the highest tile, at 437, by the width of the crop's own margin and
 * no more: every pixel of gap between the two is a pixel of crop height, and at 494
 * the whole picture starts being narrowed to fit the portrait height cap. Measured
 * at 489.
 *
 * The width and height are the panel's own and are not a request: the frame is not
 * resizable, so it sizes to its content whatever a stored box says, and only the
 * position is restored.
 */
const PANEL = { box: { x: 199, y: 84, w: 320, h: 340 }, visible: true };

/**
 * Seven nodes in range and room for seven, which is a pair rather than two numbers.
 *
 * The note says what the panel is holding BACK, so a list shorter than the range
 * reads "2 more in range" and the sentence that explains the whole addon, that a
 * gathering timer is yours and nobody can take a node off you, never gets drawn.
 * 115 yards reaches the first herb patch at 110 and stops short of the other two at
 * 118 and 122, which is what makes the two numbers agree.
 */
const CIRCUIT = { 'draw-distance': 115, 'list-length': 7 };

/** Nowhere near anything, at the tightest draw distance the addon offers. */
const NOWHERE = { x: 0, y: 5, z: 0 };

/** Who this is and what they carry, which is true of every scenario here. */
function aGatherer(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'name', 'Marshal');
  draft.set(draft.world, 'inventory', [...BAGS]);
  draft.set(draft.world, 'nodeCooldowns', new Map(COOLING));
}

/** Standing where the veins are in front of the camera, so the pins are drawn. */
function atTheVeins(draft: WorldDraft): void {
  aGatherer(draft);
  draft.set(draft.player, 'pos', { ...STANDPOINT });
  draft.set(draft.player, 'facing', FACING);
  draft.mob(PROSPECTOR, {
    name: 'Deeprock Digger',
    kind: 'mob',
    templateId: 'kobold',
    level: 5,
    pos: { ...PROSPECTOR_POS },
  });
}

/** Out on the circuit with nothing in reach, which is most of a gathering session. */
function anEmptyStretch(draft: WorldDraft): void {
  aGatherer(draft);
  draft.set(draft.player, 'pos', { ...NOWHERE });
}

/**
 * Wait for the panel to actually be on screen before driving anything into it.
 *
 * A saved frame comes up hidden and is shown once its stored state arrives, which
 * is a per-character read, and the addon draws nothing at all while its frame is
 * hidden. A scenario that only polls would photograph an empty page.
 */
async function show(stage: Stage): Promise<void> {
  stage.poll();
  await stage.settle();
  stage.frame();
}

/**
 * The harvest that measured one vein's height, taken where it was taken.
 *
 * The player is standing ON the node when a gather cast completes, which is the
 * whole reason their own feet are the exact answer for a point the table gives no
 * height for. So the stand and the walk back are both real steps: firing the result
 * from the standpoint would record the height of somewhere else entirely.
 *
 * The timer arrives AFTER the walk, which is both what the server does and what
 * makes the picture right: a position is not watched, so the last thing to redraw
 * the panel decides which distances it is holding, and a timer landing is one of
 * the two things this addon redraws on.
 */
function mineTheFirstVein(stage: Stage): void {
  stage.set(stage.player, 'pos', { x: HARVESTED.x, y: HARVESTED.y, z: HARVESTED.z });
  stage.inbound(
    eventsFrame([
      {
        type: 'gatherResult',
        nodeId: HARVESTED.id,
        nodeType: 'ore',
        professionId: 'mining',
        itemId: 'copper_ore',
        rarity: 'common',
        qty: 1,
        rareEvent: null,
      },
    ]),
  );
  stage.set(stage.player, 'pos', { ...STANDPOINT });
  stage.set(
    stage.world,
    'nodeCooldowns',
    new Map([...COOLING, [HARVESTED.id, LEFT_ON_THE_VEIN] as const]),
  );
}

/**
 * Let the node table land before anything is driven into the addon.
 *
 * `woc.data` is a promise, and every handler in this addon is a no-op against an
 * empty table rather than wrong: a harvest fired before the file has been read
 * names a node the addon has never heard of and is dropped on the floor. That is
 * silent, and what it photographs as is a pin that never learned its own height.
 *
 * Written out rather than looped, for the reason `stage.ts` gives for its own
 * settle: it is a fixed number of turns with nothing to parallelise.
 */
async function tableRead(stage: Stage): Promise<void> {
  await stage.settle();
  await stage.settle();
  await stage.settle();
}

async function halfWayRound(stage: Stage): Promise<void> {
  await tableRead(stage);
  mineTheFirstVein(stage);
  await show(stage);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'circuit',
    label: 'Half way round a circuit',
    preview: true,
    alt: "a panel headed Veinsight, with three pins standing out in the world below it. The panel lists the seven gathering nodes in range in Eastbrook Vale, nearest first, under a note reading Timers are yours alone, nobody else can take a node off you. Each row is a draining bar carrying what the node is, the zone, the distance in yards and an arrow for the way to turn to reach it: a wood stand 19 yards off at 1m 1s, an ore vein at 27 yards at 1m 23s, two more ore veins at 30 and 33 reading Yours, a wood stand at 33 with 9 seconds left and drawn warm because it is nearly back, another at 44 reading Yours, and a herb patch 110 yards out reading Tool rather than a time, because there is no sickle in these bags and no waiting will open it. Below the panel, one pin over each of the three ore veins: a square tile on a thin pillar in the game's own grey for ore, each standing at its own height. The left one is dimmed and reads 83s, since it is the vein just harvested and still coming back, and the other two read Yours. The pillars are drawn three different ways to say how the ground under each pin was arrived at: solid where this character's own harvest measured it, dashed where somebody standing beside it gave it away, and dotted where nothing better was known and the pin sits at the player's own height.",
    settings: CIRCUIT,
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: atTheVeins,
    run: halfWayRound,
  },
  {
    // The route is off by default and is the one thing here on the frame loop, since
    // a leg's length and angle are answers about the camera rather than the world.
    // It joins only nodes that are ready AND openable, so the wood stand still
    // counting down is stepped over rather than walked to.
    id: 'route',
    label: 'A route through the nearest',
    settings: { ...CIRCUIT, route: true },
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: atTheVeins,
    run: halfWayRound,
  },
  {
    // Riding between camps, which is most of a session and the state nobody thinks
    // to photograph. An empty list is not a zero, so the panel says in words why it
    // is holding nothing rather than leaving a blank box to be read as broken.
    id: 'empty',
    label: 'Nothing within reach',
    settings: { 'draw-distance': 20 },
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: anEmptyStretch,
    run: show,
  },
];

export { SCENARIOS };
