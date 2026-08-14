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
// The gate has its own pane, and it cannot be photographed in this zone at all. Eastbrook is
// tier 1 from end to end, so the only lock it can show is a missing tool, and the panel knows
// two: a tool you do not carry, and a tool you carry and cannot yet swing. The second pane is
// therefore one zone on, at the Mirefen crossing, where the same character with the same bags
// stands within twenty-five yards of a tier-2 vein their iron pick covers and cannot wield, a
// tier-1 vein their copper pick opens, a wood stand their axe opens, and a herb patch nothing
// they carry touches. Same character, same bags, same counters, and its panel is parked over
// its own pins so both crops come out one shape.

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

/**
 * Two picks and an axe, no sickle. Owning a gathering tool is carrying it.
 *
 * The iron pick is the one that makes the gate pane say anything: it is tier 2, it is bought
 * ahead of the counter that swings it, and a player who owns one is exactly who the wield
 * gate exists for. It changes nothing in the circuit pane, where every vein is tier 1 and
 * the copper pick wields at nothing.
 */
const BAGS = [
  { itemId: 'copper_mining_pick', count: 1 },
  { itemId: 'iron_mining_pick', count: 1 },
  { itemId: 'handaxe', count: 1 },
  { itemId: 'copper_ore', count: 14 },
  { itemId: 'ironbark_log', count: 6 },
];

/**
 * What this character has actually gathered, and it is a fact a session HAS at login rather
 * than one it learns, so it is stated in `world` with the bags.
 *
 * Both numbers sit under the tier-2 wield rung on purpose: that is what makes the iron pick
 * inert and the gate pane's `Skill` row true. They are also both past one gain step, so the
 * tier-1 rows say a harvest pays half rather than in full, which is the ordinary state of a
 * gatherer who has worked the starting zone and moved on. No herbalism at all, matching the
 * missing sickle.
 */
const COUNTERS = { mining: 31, logging: 27 };

/**
 * Where the panel is parked: directly over its own pins, in the same column.
 *
 * The x centres the panel on the three pins below it, which land between 242 and 476, so
 * the crop is one column rather than a panel and a world side by side. The y clears the highest
 * tile, at 437, by the width of the crop's own margin and no more: every pixel of gap is a pixel
 * of crop height, and at 494 the whole picture starts being narrowed to fit the portrait cap.
 *
 * The WIDTH is now a request and the height still is not. The panel resizes across, so a stored
 * width is restored and drawn; it states the declared 300 rather than a wider number so the
 * picture is the panel a player gets on install. The height is the content's either way.
 */
const PANEL = { box: { x: 199, y: 84, w: 300, h: 340 }, visible: true };

/**
 * The same parking for the second pane, over ITS pins, and it is a second box rather than the
 * same one because the two panes look at different ground.
 *
 * A pin's screen place is its offset from the camera axis, and the Mirefen cluster sits on the
 * other side of that axis from the Eastbrook run: at the crossing the three tiles land between
 * 623 and 857 where the circuit's land between 242 and 476. One shared box put the panel in one
 * column and its own pins in another, and the crop is the union of the two, so the picture came
 * out half as wide again as it needed to be with the tiles hanging off the panel's left edge.
 *
 * MEASURE A PANE AT 1200 BY 900 AND NOWHERE ELSE. `PANE_VIEWPORT` in `stage/src/sheet.ts` is
 * the box a sheet gives each pane, and the projection is a function of it, so the same scenario
 * opened at the stage's own 1440 viewport puts every tile somewhere else: these three land at
 * 748, 886 and 964 there. Numbers read from a full-width window look entirely plausible and
 * park the panel a hundred pixels off. The first pane's 242 and 476 above are 1200 numbers too.
 *
 * The x centres the 300px panel on the tiles below it. The y is measured off the lowest tile,
 * at 602, rather than copied from the first pane: it makes this crop exactly as tall as the
 * circuit's 441, and equal heights are what stop the sheet putting one panel lower than the
 * other. Panes are laid out against a common baseline, so a pane cropped shorter than its
 * neighbour hangs below it by the difference.
 */
const CROSSING_PANEL = { box: { x: 590, y: 161, w: 300, h: 340 }, visible: true };

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
 * Where the second pane is photographed from: the Mirefen crossing, north of the tier-2 vein.
 *
 * The whole gate is here and nowhere else. Eastbrook Vale is tier 1 from end to end, so the
 * only lock it can picture is a missing tool, and the pane used to stand over its herb run
 * doing exactly that: three rows reading Tool, which pictures half of what the panel knows.
 * Mirefen carries both. Within thirty yards of this spot sit a tier-2 vein this character's
 * iron pick covers and cannot swing, two tier-1 veins the copper pick opens outright, and a
 * herb patch nothing in the bags touches, so one pane says Skill, Yours and Tool at once.
 *
 * The position holds the first pane's pin geometry, so one panel box serves both and the two
 * crops are the same shape. A pinned point's screen offset is its x distance over its depth:
 * the first pane's three veins span 0.323 and the four pins here span 0.329. They sit right
 * of the camera axis where the first pane's sit left, which mirrors the picture and cannot
 * change its width.
 *
 * Two of the six rows are BEHIND the camera and draw no pin, which is the same thing the old
 * pane did with its wood stand: a row with no pin costs the crop nothing and still says what
 * the gate answered.
 */
const MIREFEN_CROSSING = { x: 29, y: 5, z: 367 };

/**
 * Twenty-five yards, and the number is set by ONE node rather than by the crop.
 *
 * `ore_mirefen_1` sits 29 yards out at a screen offset of 0.407, five thousandths from
 * `ore_mirefen_t2`'s 0.412, so at thirty yards its tile lands on top of the vein the whole
 * pane exists to show. Twenty-five drops it and leaves three pins spaced 0.19 and 0.14 apart,
 * which is wider than the first pane's tightest pair.
 */
const CROSSING_REACH = { 'draw-distance': 25, 'list-length': 7 };

/** Nowhere near anything, at the tightest draw distance the addon offers. */
const NOWHERE = { x: 0, y: 5, z: 0 };

/** Who this is and what they carry, which is true of every scenario here. */
function aGatherer(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'name', 'Marshal');
  draft.set(draft.world, 'inventory', [...BAGS]);
  draft.set(draft.world, 'gatheringProficiency', { ...COUNTERS });
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
 * Standing at the crossing, which is the same character one zone on. The bags and the counters
 * come from `aGatherer` rather than being restated: two panes of one sheet are one player, and a
 * second pane that quietly carried a sickle, or forty mining, would be a different character
 * answering a different question.
 */
function atTheCrossing(draft: WorldDraft): void {
  aGatherer(draft);
  draft.set(draft.player, 'pos', { ...MIREFEN_CROSSING });
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
 * The gate pane: read the table, then draw. Nothing is harvested here, and no bystander, so
 * every pin stands at the player's own height and every pillar is dotted. That is the honest
 * picture for ground this character has never worked: a measured height is something a harvest
 * leaves behind.
 */
async function atTheCrossingRun(stage: Stage): Promise<void> {
  await tableRead(stage);
  await show(stage);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'circuit',
    label: 'Half way round a circuit',
    preview: true,
    caption: 'The circuit',
    alt: 'a panel of gathering nodes in range, each row carrying the art of what it yields, with pins in the world',
    settings: CIRCUIT,
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: atTheVeins,
    run: halfWayRound,
  },
  {
    // The second pane of the sheet, and it exists to put the gate on a Browse row. The manifest's
    // own description promises both locks, and the circuit pane's reach holds neither: it is the
    // same character with the same bags one zone on, standing where all three answers are visible
    // at once.
    id: 'gate',
    label: 'What your tools and your skill open',
    preview: true,
    caption: 'The gate',
    alt: 'the same panel one zone on, a vein reading Skill and a patch reading Tool among rows that read a time',
    settings: CROSSING_REACH,
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: CROSSING_PANEL },
    world: atTheCrossing,
    run: atTheCrossingRun,
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
