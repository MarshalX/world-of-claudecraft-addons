// Veinsight on the stage: a mining circuit half way round.
//
// The table is the shipped file, imported rather than restated, and every coordinate below was
// read out of it. A fixture that invented its own nodes would photograph a world nobody installs.
//
// The pins sit under the panel rather than beside it, and that is arithmetic rather than taste.
// `pnpm shots` crops around world anchors as well as frames, and a preview is served into a 350
// CSS pixel slot, so everything in the picture is rendered at 350 divided by the width of the
// whole crop. Side by side, the crop is 646 wide, the panel takes half of it, and its 12px rows
// land at about six pixels, which reads as text with the tops cut off.
//
// Width is what costs and height is nearly free: a portrait shot is only narrowed once it is
// taller than about 1.34 times its width. So the panel is parked above its own pins, both inside
// one 320px column, and the crop is the panel's width rather than the panel plus the world.
//
// That is also what caps the list at seven rows here. Nine put the crop past the portrait
// threshold; seven stays under it. Four rows are what actually get drawn, because the reach that
// keeps the pins legible no longer holds seven nodes: `list-length` stays at seven so the cap is
// still the one that was measured, and the reach is the number that moved. See CIRCUIT.
//
// The three pillars are the point of the pins, and each is produced by its own cause rather than
// asserted:
//
//   ore_eastbrook_2  this character harvested it a moment ago, standing on it, so the height is a
//                    measurement and the pillar is solid.
//   ore_eastbrook_1  a digger is standing two yards from the point, so its feet are the height,
//                    and the pillar is dashed.
//   ore_eastbrook_3  nothing has been within six yards of it, so the pin sits at the player's own
//                    height and the pillar is dotted.
//
// Which vein is harvested is forced. The three are five yards apart and the addon samples
// anything within six, and the player is an entity like any other, so standing on one vein to
// mine it hands its neighbours a height too. Harvesting the middle one leaves nothing for the
// dotted case; mining the end of the run leaves the far vein untouched.
//
// The slope is why they are drawn at three different heights: the vein the player mined is half
// a yard above where they are standing now and the one with somebody on it is half a yard above
// that, which is what a hillside does and what a flat disc at one height would hide.
//
// No sickle in the bags, deliberately. A gatherer who mines and logs and does not pick herbs is
// ordinary, and every node in Eastbrook Vale is tier 1, so a full kit opens all of them and a
// herb row would say nothing a timer does not already say.
//
// The tool gate has its own pane. The nearest nine nodes to the circuit standpoint are all ore
// and wood inside forty-five yards and the nearest herb patch is 107 out, so no reach holds a
// herb row without drawing nine or more pins and no row cap reaches one without the crop going
// wide. Since the manifest's own description ends by promising the gate, the preview is a sheet
// of two panes: the circuit, and `gate` below, standing over the Goldleaf run where the same bags
// cannot open anything. Same character, same bags, same zone, and the second standpoint is chosen
// to reproduce the first's pin geometry so both crops are one shape.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame } from '../../tests/fakes/frames.ts';
import TABLE from './nodes.json' with { type: 'json' };

const TABLE_FILE = 'nodes.json';

/** The entity standing over the second vein, whose feet are its height. */
const PROSPECTOR = 820;

/**
 * South and east of the ore. South so the veins are in front of the camera; EAST is the half
 * that is not obvious and is why the three pins are legible, since from anywhere on the
 * cluster's own axis the tiles overlap and standing west collapses all three onto one point.
 */
const STANDPOINT = { x: -60, y: 5, z: -25 };

/**
 * Which way the character is facing, and it is not a detail. The bearing column is measured
 * against the character rather than the camera, and `facing` is 0 at +z, so a character who has
 * not been turned is looking away from everything the picture shows.
 */
const FACING = Math.PI;

/** The vein the player mined, from `nodes.json`, and the ground it stands on. */
const HARVESTED = { id: 'ore_eastbrook_2', x: -73, z: -49, y: 5.6 };

/**
 * Where the digger is standing, which is two yards off `ore_eastbrook_1`. Off the point rather
 * than on it, because that is what standing near a rock looks like and the addon takes anything
 * within six yards. Its own y is the whole of what the sampled pin is placed by.
 */
const PROSPECTOR_POS = { x: -71, y: 6.2, z: -51.5 };

/**
 * What was already on this character's timers when the addon woke up, in seconds.
 *
 * The third is absent ON PURPOSE: it belongs to the vein mined during the scenario, and a
 * harvest is what starts one. The nearly-ready one is a vein because `wood_eastbrook_1` falls
 * three hundredths of a yard outside the reach that keeps the pins legible.
 */
const COOLING: ReadonlyArray<readonly [string, number]> = [
  ['wood_eastbrook_2', 61],
  ['ore_eastbrook_3', 9],
];

/** Neither round nor the full 240: both are readings a player catches for one tick, so either
 * pictures the moment a timer started rather than a circuit being walked.
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
 * The x centres the 320px panel on the three pins below it, which land between 242 and 476, so
 * the crop is one column rather than a panel and a world side by side. The y clears the highest
 * tile, at 437, by the width of the crop's own margin and no more: every pixel of gap is a pixel
 * of crop height, and at 494 the whole picture starts being narrowed to fit the portrait cap.
 *
 * The width and height are the panel's own and are not a request: the frame is not resizable, so
 * it sizes to its content whatever a stored box says, and only the position is restored.
 */
const PANEL = { box: { x: 199, y: 84, w: 320, h: 340 }, visible: true };

/**
 * Everything in range fits in the list, which is a pair rather than two numbers.
 *
 * The note says what the panel is holding back, so a list shorter than the range spends that line
 * on "4 more in range" and the sentence that explains the whole addon never gets drawn. The reach
 * is what has to give, because the row cap is set by the crop.
 *
 * Thirty-three yards is a cliff rather than a round number. A pin is drawn for every node in
 * reach, so the reach sets the crop width, and a pinned point's screen offset is its x distance
 * from the player over its depth. Measured across this table, the offsets of everything in reach
 * span 0.32 at thirty-three yards and 1.13 at thirty-four, because `ore_eastbrook_5` comes in well
 * off the camera axis. That one yard is three and a half times the crop.
 *
 * What this reach costs is the tool gate, which the second pane covers instead: see the sickle
 * note at the top.
 */
const CIRCUIT = { 'draw-distance': 33, 'list-length': 7 };

/**
 * Where the second pane is photographed from: north of the Goldleaf herb run.
 *
 * The three patches this looks at are the only place in the starting zone the tool gate can be
 * photographed at all, because every node in Eastbrook Vale is tier 1 and a gate needs something
 * the bags cannot open. This character carries a pick and an axe and no sickle.
 *
 * The position is chosen to reproduce the first pane's pin geometry, so one panel box serves both
 * and the two crops are the same shape. A pinned point's screen offset is its x distance over its
 * depth: the first pane's three veins centre on -0.380 and span 0.323, and from here the three
 * patches centre on -0.378 and span 0.244. The span is narrower, which only ever crops tighter.
 *
 * What does not match is depth, and it cannot: the patches are authored 8 and 9 yards apart in z
 * where the veins are 4, so the far tile rides a little higher and smaller than its opposite
 * number in the first pane.
 */
const HERB_RUN = { x: -47, y: 5, z: 121 };

/**
 * Far enough to hold the wood stand that is not gated, and no further. The stand is the whole
 * point of the number: three rows all reading Tool photograph as a panel that says Tool rather
 * than as a gate, and one row answering with a time beside them is what makes the other three
 * mean something. It sits 57 yards off and behind the camera, so it is in the list and draws no
 * pin.
 */
const HERB_REACH = { 'draw-distance': 60, 'list-length': 7 };

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

/**
 * Standing over the herb run, which is the same character on the same circuit. The bags come from
 * `aGatherer` rather than being restated: two panes of one sheet are one player, and a second
 * pane that quietly carried a sickle would be a different character answering a different
 * question.
 */
function amongTheHerbs(draft: WorldDraft): void {
  aGatherer(draft);
  draft.set(draft.player, 'pos', { ...HERB_RUN });
  draft.set(draft.player, 'facing', FACING);
}

/** Out on the circuit with nothing in reach, which is most of a gathering session. */
function anEmptyStretch(draft: WorldDraft): void {
  aGatherer(draft);
  draft.set(draft.player, 'pos', { ...NOWHERE });
}

/**
 * Wait for the panel to actually be on screen before driving anything into it. A saved frame
 * comes up hidden and is shown once its stored state arrives, which is a per-character read, and
 * the addon draws nothing at all while its frame is hidden.
 */
async function show(stage: Stage): Promise<void> {
  stage.poll();
  await stage.settle();
  stage.frame();
}

/**
 * The harvest that measured one vein's height, taken where it was taken.
 *
 * The player is standing on the node when a gather cast completes, which is why their own feet
 * are the exact answer for a point the table gives no height for. So the stand and the walk back
 * are both real steps: firing the result from the standpoint would record the height of somewhere
 * else entirely.
 *
 * The timer arrives after the walk, which is both what the server does and what makes the picture
 * right: a position is not watched, so the last thing to redraw the panel decides which distances
 * it is holding.
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
 * Let the node table land before anything is driven into the addon. `woc.data` is a promise, and
 * every handler in this addon is a no-op against an empty table rather than wrong: a harvest fired
 * before the file has been read names a node the addon has never heard of and is dropped on the
 * floor, which photographs as a pin that never learned its own height.
 *
 * Written out rather than looped, for the reason `stage.ts` gives for its own settle: it is a
 * fixed number of turns with nothing to parallelise.
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

/**
 * The herb pane: read the table, then draw. Nothing is harvested here, and no bystander, so all
 * three pins stand at the player's own height and every pillar is dotted. That is the honest
 * picture for a run this character has never worked: a measured height is something a harvest
 * leaves behind.
 */
async function atTheHerbRun(stage: Stage): Promise<void> {
  await tableRead(stage);
  await show(stage);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'circuit',
    label: 'Half way round a circuit',
    preview: true,
    caption: 'The circuit',
    alt: 'a panel of gathering nodes in range, with pins in the world',
    settings: CIRCUIT,
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: atTheVeins,
    run: halfWayRound,
  },
  {
    // The second pane of the sheet, and it exists to put the tool gate back on a Browse row. The
    // manifest's own description ends "Says which ones no tool in your bags can open", and the
    // nearest herb patch sits outside the circuit pane's reach. Nothing here is a new claim: it is
    // the same character, the same bags and the same zone, standing somewhere the gate is visible.
    id: 'gate',
    label: 'What no tool of yours opens',
    preview: true,
    caption: 'The tool gate',
    alt: 'the same panel, three nodes reading Tool rather than a time',
    settings: HERB_REACH,
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: amongTheHerbs,
    run: atTheHerbRun,
  },
  {
    // The route is off by default and is the one thing here on the frame loop, since a leg's
    // length and angle are answers about the camera rather than the world. It joins only nodes
    // that are ready and openable, so the wood stand still counting down is stepped over.
    id: 'route',
    label: 'A route through the nearest',
    settings: { ...CIRCUIT, route: true },
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: atTheVeins,
    run: halfWayRound,
  },
  {
    // Riding between camps, which is most of a session. An empty list is not a zero, so the panel
    // says in words why it is holding nothing rather than leaving a blank box to be read as
    // broken.
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
