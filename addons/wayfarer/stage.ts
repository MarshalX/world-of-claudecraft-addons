// Wayfarer on the stage: on the road north of Eastbrook, and then underground.
//
// The atlas is the shipped file, imported rather than restated, so every rectangle, point,
// distance and level range below is the game's own. A fixture inventing a zone would
// photograph the one thing this addon cannot get wrong.
//
// WHERE THE PLAYER STANDS IS ARITHMETIC, the same as trailmark's. `pnpm shots` crops around
// the world anchors as well as the frame and the picture is served into a 350 CSS pixel card,
// so every pixel of crop width costs legibility in the rows. The camera looks down world -z
// from over the player's shoulder, which makes a pin's screen offset its x distance from the
// player over its depth. Standing on the road at x 0, sixty yards north of the town, puts the
// whole Eastbrook corridor (the hub, its mailbox, its graveyard, the forge and Reliquary Hill)
// inside four hundred pixels, and everything across the width of the vale far enough off the
// edge to hide itself: Sableweb at x -60 and Boar Meadow at x 65 are both nearer than the hill
// and neither is in the picture.
//
// ONE PIN'S HEIGHT IS MEASURED AND THE REST ARE GUESSED, which is the difference the pillars
// draw and the reason the standpoint is worth this much care. There is no ground height for an
// x and a z anywhere on this API, so a pin sits either at the height of something standing on
// the point or at the player's own. A prowler on Reliquary Hill is what makes that one pin a
// measurement, and the hill is thirteen yards above the road, which is why it is also the only
// pin drawn above the others rather than on the same line.
//
// The crafting stations come from the loader rather than from the file, so they are stated as
// the world hands them over and in the same words the suite states them. The Fenbridge tannery
// is here for the reason it is there: it is a station in ANOTHER zone, and a list headed by one
// zone has to leave it out.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import ATLAS from './atlas.json' with { type: 'json' };

const DATA_FILE = 'atlas.json';
const DATA = { [DATA_FILE]: JSON.stringify(ATLAS) };

/** Where the picture is taken from: on the road, sixty yards north of the hub. */
const STANDPOINT = { x: 0, y: 5, z: 60 };

/**
 * Which way the player is looking, which is what every arrow in the list is measured from.
 *
 * Radians with 0 at +z, so a half turn is facing -z: down the road at the town, which is
 * where the camera is pointed as well. It has to be stated, because `facing` is not on the
 * shared entity fixture and a player with none has no heading to be relative to, so every
 * arrow would hide itself and the picture would be of the panel this redesign replaced.
 * Facing the same way the camera looks is also what makes the picture readable: a pin to
 * the right of the view is a row whose arrow points right.
 */
const FACING_SOUTH = Math.PI;

/**
 * The hill, and the prowler standing on it.
 *
 * The point is the atlas's own `reliquary_hill`; the height is not, because the atlas carries
 * no y and could not. Thirteen yards over the road is what makes the sampled pin visibly higher
 * than the guessed ones, which is the whole of what this entity is here to show.
 */
const HILL = { x: -5, y: 18, z: -52 };
const PROWLER_ID = 4101;

/** A real dungeon origin: `instanceOrigin(0, 0)` is x 100300, z -1250. */
const DUNGEON = { x: 100_300, y: 5, z: -1250 };

/** Past the world's east edge at 540, and nowhere near the instanced plane. */
const OFF_THE_MAP = { x: 600, y: 5, z: 0 };

/** Two of the game's own placements, as `world.stations` reads them off the client world. */
const STATIONS = [
  {
    id: 'station_eastbrook_forge',
    type: 'forge',
    zoneId: 'eastbrook_vale',
    pos: { x: 12, z: 8 },
    masterNpcId: 'forgemistress_darva',
  },
  {
    id: 'station_fenbridge_tannery',
    type: 'tannery',
    zoneId: 'mirefen_marsh',
    pos: { x: -13, z: 314 },
    masterNpcId: 'tanner_hesk',
  },
];

/** The points this character has stood in, in the game's own `poi:<zoneId>:<poiId>` shape. */
const VISITED = [
  'poi:eastbrook_vale:eastbrook',
  'poi:eastbrook_vale:wolf_run',
  'poi:eastbrook_vale:boar_meadow',
];

/**
 * The deed counters, which are what says the sheet has arrived at all.
 *
 * Nothing draws them. The game's own `freshDeedStats()` writes every key at 0 client-side, so
 * a counters record with no keys is a sheet that has not landed rather than a character who has
 * done nothing, and the panel says which. Given a played character's figures rather than zeroes
 * because a character who has explored three points has killed something.
 */
const COUNTERS = { kills: 486, deaths: 7, craftsPerformed: 63 };

function deedSheet(visited: readonly string[]): Record<string, unknown> {
  return {
    counters: COUNTERS,
    itemsDiscovered: new Set<string>(),
    visited: new Set(visited),
    dungeonClears: {},
  };
}

/**
 * The panel, parked UNDER its own pins and in the same column as them.
 *
 * Under rather than over, because a pin is drawn where its point is and a frame is drawn where
 * it is put: the four pins here land between y 369 and y 516 in a 900 pixel pane, and a panel
 * tall enough to hold the list would cover them wherever above them it went. Windows are over
 * anchors by design, so the overlap is not something a stacking order could be asked to solve.
 *
 * Only the position is taken from this. The frame is not resizable, so the loader holds it to
 * the width it declared and leaves the height to the rows it is holding.
 */
const PANEL = { box: { x: 443, y: 524, w: 320, h: 300 }, visible: true };

/**
 * Four rows rather than the manifest's eight, which is what the pane has room for.
 *
 * The sheet photographs each panel in a 900 pixel pane and the pins in this scenario run down
 * to y 516, so the panel below them has 360 pixels before the crop is cut off at the bottom
 * of the pane. A fifth row is 19 of them past that, and a preview missing its own last line
 * is worse than one showing four places instead of five.
 *
 * The four are still one row of four different categories, which is what makes the reading
 * worth photographing: a point of interest, a crafting station, a town and a mailbox. The
 * graveyard the fifth row held is the pin standing furthest left in the same picture, and the
 * footer says how many more are in range.
 */
const SHORT_LIST = { 'list-length': 4 };

/**
 * The session as it stood before the addon ran a line.
 *
 * Every one of these is something a player has at login rather than something that happens to
 * them, which is what `world` means: the addon reads its position, its stations and its deed
 * sheet on the first tick and would otherwise be photographed reacting to them.
 */
function onTheRoad(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'name', 'Marshal');
  draft.set(draft.player, 'pos', { ...STANDPOINT });
  draft.set(draft.player, 'facing', FACING_SOUTH);
  draft.set(draft.world, 'stationPlacements', STATIONS);
  draft.set(draft.world, 'deedStats', deedSheet(VISITED));
  draft.zone('Eastbrook Vale');
  draft.mob(PROWLER_ID, { name: 'Vale Prowler', pos: { ...HILL } });
}

/**
 * Let the atlas land, then place the pins.
 *
 * Four settles rather than one: the addon awaits `woc.data` and then adopts the file and draws,
 * and the frame's own stored box is a second promise. The frame ticks are what an anchor is
 * placed by, and the first of them is also what thins the pins, since whether two of them
 * overlap is a question about the camera rather than about the world.
 */
async function drawn(stage: Stage): Promise<void> {
  await stage.settle();
  await stage.settle();
  await stage.settle();
  await stage.settle();
  stage.poll();
  stage.frame();
  stage.frame();
}

/** The addon's own redraw period, which is a real timer here rather than a fake clock. */
const TICK_MS = 1000;

/**
 * Everything above, and then one of the addon's own ticks.
 *
 * For the one scenario whose subject is a state reached before the panel has anything: a frame
 * that saves its place comes up hidden and is shown again when storage answers, and the draw
 * that ran while it was hidden returned early. Nothing else redraws until the tick, so a
 * capture taken at `ready` photographs an empty panel rather than the sentence it is about.
 */
async function ticked(stage: Stage): Promise<void> {
  await drawn(stage);
  await new Promise((resolve) => {
    setTimeout(resolve, TICK_MS + TICK_MS / 5);
  });
  stage.frame();
}

const VALE_ALT =
  "four named pins standing over the world, each with its distance beside it, and a panel under them. The pins are labels on thin dotted pillars planted where those places are: Eastbrook Rest at 75 yd, Eastbrook at 63 yd and Forge at 53 yd across the middle distance, and Reliquary Hill at 112 yd higher up the view on a dashed pillar, dashed because a prowler standing on the hill gave that pin a measured height while the other three sit at the player's own. The panel is headed Eastbrook Vale, levels 1 to 7, which this addon resolved from the player's position rather than read anywhere; under it a quiet line reads Minimap: Eastbrook Vale, which is the game's own label. Then a strip of four tabs, All, Explore, Travel and Service, with All open. Then four rows, nearest first. Each begins with a small arrow pointing the way the player would have to turn to walk there, then the name over what kind of place it is, then a bar filled by how much of the three hundred yard draw distance you have already closed, so the nearest row is almost full and each one below it is shorter, and then the distance on the right: Wolf Run, a point of interest, explored, 10 yd, whose arrow points back down the way the player came; Forge, a crafting station, 53 yd; Eastbrook, a town, explored, 63 yd; and Eastbrook, a mailbox, 68 yd, the last three all ahead and their arrows pointing up. A dim footer closes it: 3 of 12 explored, 12 more in range, 12 pins max, heights estimated.";

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'vale',
    label: 'On the road north of Eastbrook',
    preview: true,
    alt: VALE_ALT,
    settings: SHORT_LIST,
    data: DATA,
    frames: { atlas: PANEL },
    world: onTheRoad,
    run: drawn,
  },
  {
    // The refusal this addon exists for. The game's own `zoneAt` clamps to a nearest band and
    // would answer The Drakelands for a player standing here; this one says it does not know.
    //
    // The minimap label is the truthful reading underground, where the delve painter owns the
    // same element, so it is stated as well. `Wildheart` is a real dungeon in the game (see
    // longwatch's roster), and the exact text is unimportant in a way it would not be anywhere
    // else: nothing compares this string against anything, because it is localized.
    id: 'delve',
    label: 'Inside a dungeon, naming nothing',
    data: DATA,
    frames: { atlas: PANEL },
    world: (draft) => {
      onTheRoad(draft);
      draft.set(draft.player, 'pos', { ...DUNGEON });
      draft.zone('Wildheart');
    },
    run: drawn,
  },
  {
    // Off the map in the open world, which is a different fact from an instance and reads as
    // one. Nothing is past the east edge, so no rectangle contains the player and none is made
    // to fit.
    id: 'nowhere',
    label: 'Outside every rectangle',
    data: DATA,
    frames: { atlas: PANEL },
    world: (draft) => {
      onTheRoad(draft);
      draft.set(draft.player, 'pos', { ...OFF_THE_MAP });
      draft.zone(null);
    },
    run: drawn,
  },
  {
    // A zone the player has walked into the middle of, with every category switched off but the
    // graveyards and nothing near enough to list. An empty list is never a measurement, so the
    // panel says why it is empty rather than drawing an empty box.
    id: 'quiet',
    label: 'Nothing in range',
    settings: {
      'draw-distance': 40,
      'show-points': false,
      'show-towns': false,
      'show-mailboxes': false,
      'show-stations': false,
    },
    data: DATA,
    frames: { atlas: PANEL },
    world: (draft) => {
      onTheRoad(draft);
      draft.set(draft.player, 'pos', { x: -150, y: 5, z: 150 });
    },
    run: drawn,
  },
  {
    // Before the file lands there is no rectangle to be in, so the panel is the addon's own
    // name and one sentence. It is the first half second of every session, and it is here
    // because it is the state nobody thinks to look at.
    id: 'reading',
    label: 'Before the atlas has been read',
    frames: { atlas: PANEL },
    world: onTheRoad,
    run: ticked,
  },
];

export { SCENARIOS };
