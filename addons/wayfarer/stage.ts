// Wayfarer on the stage: on the road north of Eastbrook, and then underground.
//
// The atlas is the shipped file rather than a fixture, so every rectangle, point and level
// range below is the game's own.
//
// WHERE THE PLAYER STANDS IS ARITHMETIC. The camera looks down world -z over the player's
// shoulder, so a pin's screen offset is its x distance over its depth: the standpoint is
// chosen to put the whole Eastbrook corridor inside the crop and everything across the
// width of the vale outside it.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import ATLAS from './atlas.json' with { type: 'json' };

const DATA_FILE = 'atlas.json';
const DATA = { [DATA_FILE]: JSON.stringify(ATLAS) };

const STANDPOINT = { x: 0, y: 5, z: 60 };

/**
 * Radians, 0 at +z, so a half turn faces the town and the camera. It HAS to be stated:
 * `facing` is not on the shared entity fixture and every arrow hides itself without one.
 */
const FACING_SOUTH = Math.PI;

/**
 * The atlas's own `reliquary_hill`, given a height the atlas cannot carry. The prowler standing
 * on it is what makes that one pin a MEASUREMENT and its pillar dashed among three dotted ones.
 */
const HILL = { x: -5, y: 18, z: -52 };
const PROWLER_ID = 4101;

/** A real dungeon origin: `instanceOrigin(0, 0)` is x 100300, z -1250. */
const DUNGEON = { x: 100_300, y: 5, z: -1250 };

/** Past the world's east edge at 540, and nowhere near the instanced plane. */
const OFF_THE_MAP = { x: 600, y: 5, z: 0 };

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

/** The game's own visit-key shape, `poi:<zoneId>:<poiId>`. */
const VISITED = [
  'poi:eastbrook_vale:eastbrook',
  'poi:eastbrook_vale:wolf_run',
  'poi:eastbrook_vale:boar_meadow',
];

/**
 * Nothing draws these. They are what says the sheet ARRIVED: an empty counters record is a
 * missing sheet rather than a character who has done nothing, and the panel says which.
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
 * Parked UNDER its own pins: a window is over an anchor by design, so a panel anywhere above
 * them covers them. Only the position is read, since the frame is not resizable.
 */
const PANEL = { box: { x: 443, y: 524, w: 320, h: 300 }, visible: true };

/**
 * Four rather than the manifest's eight: a fifth is 19 pixels past the bottom of the pane, and
 * these four are still one row each of four different categories.
 */
const SHORT_LIST = { 'list-length': 4 };

/**
 * Everything a player HAS at login rather than anything that happens to them, which is what
 * `world` means: the addon reads all of it on its first tick.
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
 * Four settles rather than one: the atlas read and the frame's stored box are two promises.
 * The frame ticks are what places an anchor, and the first also thins the pins.
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

/** The addon's redraw period. A real timer here, not a fake clock. */
const TICK_MS = 1000;

/**
 * A saved frame comes up hidden and the draw that ran while it was hidden returned early, so
 * without a tick the capture is of an empty panel rather than of the sentence it is about.
 */
async function ticked(stage: Stage): Promise<void> {
  await drawn(stage);
  await new Promise((resolve) => {
    setTimeout(resolve, TICK_MS + TICK_MS / 5);
  });
  stage.frame();
}

/** 180 characters. Say what it IS; the rows, distances and arrows are deliberately not in it. */
const VALE_ALT =
  'four named pins standing over the world on thin pillars, each with its distance beside it, and a panel under them naming the zone and listing the nearest places in it.';

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
    // The refusal this addon exists for: the game's `zoneAt` would answer The Drakelands here.
    // The minimap label is stated too, since underground it is the truthful reading of the two.
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
    // Off the map in the open world, which is a different fact from an instance and reads as one.
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
    // An empty list is never a measurement, so the panel says WHY rather than drawing a box.
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
    // The first half second of every session, which is the state nobody thinks to look at.
    id: 'reading',
    label: 'Before the atlas has been read',
    frames: { atlas: PANEL },
    world: onTheRoad,
    run: ticked,
  },
];

export { SCENARIOS };
