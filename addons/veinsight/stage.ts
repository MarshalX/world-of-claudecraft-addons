// Veinsight on the stage: a mining circuit half way round, and the gate one zone on.
//
// The table is the shipped file, imported rather than restated, so the picture is a world a
// player installs.
//
// The panel is parked ABOVE its own pins in one column. `pnpm shots` crops around anchors as
// well as frames and scales the crop into a 350px slot, so side by side the rows shrink to
// unreadable; a portrait crop is only narrowed past about 1.34 times its width. That ratio is
// what caps `list-length` at seven.
//
// Each of the three circuit pillars is produced by its own cause:
//
//   ore_eastbrook_2  harvested a moment ago while standing on it: solid.
//   ore_eastbrook_1  a digger stands two yards from the point: dashed.
//   ore_eastbrook_3  nothing has been within six yards: dotted.
//
// Which vein is harvested is forced: the veins are five yards apart and the player is an entity
// the addon samples, so mining the middle one would leave nothing dotted.
//
// Eastbrook is tier 1 throughout, so it can only show the `Tool` lock. The gate pane stands at
// the Mirefen crossing with the same character, bags and counters, where `Skill`, `Tool` and a
// time are all in range.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame } from '../../tests/fakes/frames.ts';
import TABLE from './nodes.json' with { type: 'json' };

const TABLE_FILE = 'nodes.json';

/** The entity standing over the second vein, whose feet are its height. */
const PROSPECTOR = 820;

/**
 * South and east of the ore. EAST keeps the three pins apart: from the cluster's own axis the
 * tiles overlap. If the game moves the dig, every point here moves with it, and nothing warns
 * when a stale standpoint photographs an empty panel.
 */
const STANDPOINT = { x: -10, y: 5, z: 181 };

/** Bearings are measured against the character, and `facing` 0 looks away from the veins. */
const FACING = Math.PI;

/** The vein the player mined, from `nodes.json`, and the ground it stands on. */
const HARVESTED = { id: 'ore_eastbrook_2', x: -23, z: 157, y: 5.6 };

/** Two yards off `ore_eastbrook_1`. Its y is what the sampled pin is placed by. */
const PROSPECTOR_POS = { x: -21, y: 6.2, z: 154.5 };

/**
 * Timers already running at login, in seconds. The mined vein's is absent on purpose: the
 * harvest during the scenario starts it.
 */
const COOLING: ReadonlyArray<readonly [string, number]> = [['ore_eastbrook_3', 9]];

/** Neither round nor the full respawn, which would picture the instant a timer started. */
const LEFT_ON_THE_VEIN = 83;

/**
 * Two picks and an axe, no sickle. The tier-2 iron pick, carried ahead of the counter that
 * swings it, is what makes the gate pane read `Skill`.
 */
const BAGS = [
  { itemId: 'copper_mining_pick', count: 1 },
  { itemId: 'iron_mining_pick', count: 1 },
  { itemId: 'handaxe', count: 1 },
  { itemId: 'copper_ore', count: 14 },
  { itemId: 'ironbark_log', count: 6 },
];

/**
 * Gathering counters, known at login so stated in `world`. Both sit under the tier-2 wield rung,
 * which makes the iron pick inert, and past one gain step. No herbalism, matching the bags.
 */
const COUNTERS = { mining: 31, logging: 27 };

/**
 * Parked directly over its own pins (tiles between x 242 and 476, highest at y 437, measured in
 * a 1200 by 900 pane). Every pixel of gap is crop height, and past y 494 the portrait cap bites.
 * The width is the declared 300, so the picture is the panel a player gets on install.
 */
const PANEL = { box: { x: 199, y: 84, w: 300, h: 340 }, visible: true };

/**
 * The second pane's own parking: its pins land on the other side of the camera axis (x 623 to
 * 857), so a shared box would widen the crop to the union of both columns.
 *
 * MEASURE A PANE AT 1200 BY 900 AND NOWHERE ELSE. `PANE_VIEWPORT` in `stage/src/sheet.ts` sets
 * the projection, and the stage's own 1440 viewport puts every tile somewhere plausible and wrong.
 *
 * The y is measured off the lowest tile (602) so this crop is as tall as the circuit's: panes
 * share a baseline, and a shorter one hangs below its neighbour.
 */
const CROSSING_PANEL = { box: { x: 590, y: 161, w: 300, h: 340 }, visible: true };

/**
 * Everything in reach must fit the list, or the note says "N more in range" instead of the line
 * that explains the addon. Thirty-three yards is a cliff: at thirty-four `ore_eastbrook_5` comes
 * in far off the camera axis and the crop grows about three and a half times.
 */
const CIRCUIT = { 'draw-distance': 33, 'list-length': 7 };

/**
 * The Mirefen crossing, north of the tier-2 vein: in range sit a vein the iron pick covers and
 * cannot swing, tier-1 veins the copper pick opens, and a herb patch nothing carried touches, so
 * one pane reads Skill, Yours and Tool. Its pin spread matches the first pane's, so both crops
 * are the same shape; rows behind the camera draw no pin and cost the crop nothing.
 */
const MIREFEN_CROSSING = { x: 29, y: 5, z: 367 };

/** Twenty-five yards: at 29 `ore_mirefen_1`'s tile lands on top of `ore_mirefen_t2`'s. */
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

/** The same character one zone on: the bags and counters come from `aGatherer`, never restated. */
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

/** A saved frame starts hidden until its per-character state arrives, and draws nothing hidden. */
async function show(stage: Stage): Promise<void> {
  stage.poll();
  await stage.settle();
  stage.frame();
}

/**
 * The harvest that measured one vein's height. The player must stand on the vein when the result
 * lands, since their feet are the height. The timer arrives after the walk back: position is not
 * watched, so the last redraw decides which distances the panel holds.
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

/** Let `woc.data` land first: a harvest fired against an empty table is silently dropped. */
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

/** The gate pane: nothing harvested and no bystander, so every pillar is dotted. */
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
    // Puts both locks the manifest describes on the Browse row.
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
    // The route is off by default and joins only ready, openable nodes, so the cooling vein is
    // stepped over.
    id: 'route',
    label: 'A route through the nearest',
    settings: { ...CIRCUIT, route: true },
    data: { [TABLE_FILE]: JSON.stringify(TABLE) },
    frames: { nodes: PANEL },
    world: atTheVeins,
    run: halfWayRound,
  },
  {
    // Riding between camps: the panel says in words why it is holding nothing.
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
