// @vitest-environment happy-dom

// Wayfarer, run through the real loader, driven from the shipped `atlas.json` so every case
// is about the real table. `world.zone` is null unless a case states a label, so each heading
// is resolved from position alone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import MANIFEST_TEXT from './addon.json?raw';
import ATLAS_TEXT from './atlas.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the longwatch suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const DATA_FILE = 'atlas.json';
/**
 * The highest minor anything this addon reads: 6, for `resizable: 'width'`. An older loader
 * reads that string as truthy and owns BOTH axes, clipping the rows with nothing saying so.
 */
const NEEDS_MINOR = 6;
const PLAYER_ID = PLAYER_ENTITY.id;
/** The redraw's period, so advancing this much runs exactly one of them. */
const TICK_MS = 1000;
/** How many microtask turns the atlas read and the frame's own restore want. */
const SETTLE_TURNS = 12;

/** What the shipped atlas carries. Update on a regeneration that changes the content. */
const ZONE_COUNT = 15;
const POI_COUNT = 113;
const GRAVEYARD_COUNT = 20;
const MAILBOX_COUNT = 15;
const PORTAL_COUNT = 1;
/** Ten zones are grid columns with their own x bounds; five are the full-width strip. */
const COLUMN_ZONE_COUNT = 10;

/** The base of the instanced plane, `INSTANCE_X_BASE` in `src/sim/data.ts`. */
const INSTANCE_X_BASE = 99_400;
/** Half of `WORLD_SIZE`, which is how far a zone with no x bounds of its own runs. */
const STRIP_HALF_WIDTH = 180;
/** The game version stamped into the atlas by `generate.mjs`. */
const SEMVER = /^\d+\.\d+\.\d+/;
/** A real dungeon origin: `instanceOrigin(0, 0)` is x 100300, z -1250. */
const DUNGEON_X = INSTANCE_X_BASE + 900;
const DUNGEON_Z = -1250;

/** The topic this addon publishes on, and the question anybody may ask it with. */
const ZONE_TOPIC = 'zone';
const ASK_TOPIC = 'zone:ask';
/** Whoever is listening. Any fqid but the addon's own, since nobody hears themselves. */
const LISTENER = 'test/listener';

type Fake = Record<string, unknown>;

interface Atlas {
  source: { game: string };
  world: { stripMinX: number; stripMaxX: number; instanceXBase: number };
  zones: {
    id: string;
    name: string;
    xMin?: number;
    xMax?: number;
    pois: { id: string; label: string; x: number; z: number; town?: boolean; hidden?: boolean }[];
  }[];
  graveyards: { id: string; label: string; x: number; z: number }[];
  mailboxes: { id: string; label: string }[];
  portals: { id: string; label: string; a: { x: number; z: number } }[];
}

const ATLAS = JSON.parse(ATLAS_TEXT) as Atlas;

function zoneNamed(id: string) {
  const zone = ATLAS.zones.find((one) => one.id === id);
  if (zone === undefined) {
    throw new Error(`the shipped atlas has no zone ${id}`);
  }
  return zone;
}

const EASTBROOK = zoneNamed('eastbrook_vale');
const FARSHORE = zoneNamed('farshore_isle');

/**
 * Eastbrook's own hub, which the distance and bearing cases aim at. Read from the atlas so a
 * case about an arrow is not also a case about where the town is.
 */
const EASTBROOK_HUB = EASTBROOK.pois.find((poi) => poi.town === true);
if (EASTBROOK_HUB === undefined) {
  throw new Error('the shipped atlas has no town in Eastbrook Vale');
}
const HUB_ID = `town:eastbrook_vale:${EASTBROOK_HUB.id}`;

/** How far east of the hub the distance case stands, so the figure it reads is its own. */
const WALKED_YARDS = 3;

/** One of the two pois whose label the game has re-worded away from its frozen id. */
const PARTERRE = { zone: 'evergarden', id: 'the_statuary_walk', x: 360, z: 875 };

const teardown: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

function settle(): Promise<void> {
  let done = Promise.resolve();
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    done = done.then(() => undefined);
  }
  return done;
}

function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

/** The shipped atlas with one part replaced, so a bad-row case is about the real file. */
function doctored(patch: Record<string, unknown>): string {
  return JSON.stringify({ ...(JSON.parse(ATLAS_TEXT) as Record<string, unknown>), ...patch });
}

/** The shipped atlas with one zone row given a broken field. */
function doctoredZone(id: string, patch: Record<string, unknown>): string {
  const file = JSON.parse(ATLAS_TEXT) as { zones: { id: string }[] };
  const zones = file.zones.map((zone) => {
    if (zone.id !== id) {
      return zone;
    }
    return { ...zone, ...patch };
  });
  return doctored({ zones });
}

/** What `freshDeedStats()` leaves on a brand new character: every key, all at zero. */
const FRESH_COUNTERS = { kills: 0, deaths: 0, craftsPerformed: 0 };

/** The game's six placements, as `world.stations` reads them off the client world. */
const STATION_PLACEMENTS = [
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

/** What a case states about the world besides where the player is standing. */
interface WorldOptions {
  stations?: unknown[];
  counters?: Record<string, number>;
  /** The game's own minimap label, which is the whole of what `world.zone` answers. */
  label?: string;
}

interface WayfarerHarness extends SharedHarness {
  /** Walk the player somewhere. A fresh `pos` each time, so a captured one cannot follow. */
  walkTo: (x: number, z: number) => void;
  /** Turn the player. Radians, 0 at +z, which is the convention the wire uses. */
  faceTo: (radians: number) => void;
  /** One row's arrow rotation in degrees, or null where it is not pointing anywhere. */
  bearingOf: (id: string) => number | null;
  /** The ids of the tabs on the strip, and which one is open. */
  tabs: () => string[];
  openTab: () => string;
  /** Press a tab as the player would. */
  pressTab: (id: string) => void;
  /** The game icon names the strip managed to clone, in order. */
  clonedGlyphs: () => string[];
  /** Put a visit key in the deed set, in the game's own `poi:<zoneId>:<poiId>` shape. */
  markVisited: (key: string) => void;
  /** Run the once-a-second redraw where the player is now standing. */
  tick: () => void;
  /** Run one frame, which is what thins the pins. */
  frame: () => void;
  /** The heading, which is the resolved zone or the refusal. */
  heading: () => string;
  /** The note under it, which says why an empty list is empty. */
  note: () => string;
  /** The line between them, which is the game's own label rather than this addon's. */
  minimap: () => string;
  /** The ids of the rows drawn, in order. */
  drawn: () => string[];
  /** The labels of the rows drawn, in order. */
  labels: () => string[];
  /** One row's right-hand figure. */
  figureOf: (id: string) => string;
  /** One row's second line. */
  detailOf: (id: string) => string;
  /** The ids pinned into the world. */
  pinned: () => string[];
  /** Everything published on the `zone` topic, oldest first. */
  published: () => unknown[];
  /** Ask for the zone as another addon would, and return what came back. */
  ask: () => unknown[];
}

function rowFor(id: string): HTMLElement | null {
  return document.querySelector(`.woc-wf-row[data-place="${id}"]`);
}

/** One row's arrow rotation off the written transform, or null when not drawn or hidden. */
function readBearing(id: string): number | null {
  const arrow = rowFor(id)?.querySelector<SVGElement>('.woc-wf-arrow') ?? null;
  if (arrow === null || arrow.style.visibility === 'hidden') {
    return null;
  }
  const written = /rotate\((-?[\d.]+)deg\)/.exec(arrow.style.transform);
  if (written === null) {
    return null;
  }
  return Number(written[1]);
}

function textIn(id: string, selector: string): string {
  return rowFor(id)?.querySelector(selector)?.textContent ?? '';
}

/**
 * Start the addon over a world holding nothing but the player. Eastbrook Vale by default: z 0 is
 * inside its band and x 0 is inside the world strip, which is the rectangle test the addon does
 * from position alone.
 */
async function start(
  settings: Record<string, unknown> = {},
  atlas: string = ATLAS_TEXT,
  visited: string[] = [],
  options: WorldOptions = {},
): Promise<WayfarerHarness> {
  const stations = options.stations ?? STATION_PLACEMENTS;
  const counters = options.counters ?? FRESH_COUNTERS;
  // `facing` is on the wire but not on the shared fake. Zero is +z, so a point due north
  // is the one whose arrow points straight up.
  const player = liveEntity({
    set: { templateId: 'hunter', pos: { x: 0, y: 5, z: 0 }, kind: 'player', facing: 0 },
  });
  const visitedSet = new Set(visited);
  const world = {
    entities: new Map<number, Fake>([[PLAYER_ID, player]]),
    player,
    known: [],
    stationPlacements: stations,
    // The counters say the sheet has landed: the game writes every key at 0 client-side, so
    // an empty record stands for a world carrying no sheet.
    deedStats: {
      counters,
      itemsDiscovered: new Set<string>(),
      visited: visitedSet,
      dungeonClears: {},
    },
  };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings,
    data: { [DATA_FILE]: atlas },
    game: Promise.resolve({ world }),
    zoneName: () => options.label ?? null,
  });
  teardown.push(harness.dispose);

  const published: unknown[] = [];
  // Subscribe as another addon, since nobody receives their own messages.
  teardown.push(
    harness.shared.bus.subscribe({
      from: harness.fqid,
      topic: ZONE_TOPIC,
      owner: LISTENER,
      handler: (message) => {
        published.push(message.payload);
      },
      onError: () => undefined,
    }),
  );

  return {
    ...harness,
    walkTo: (x, z) => {
      setField(player, 'pos', { x, y: 5, z });
    },
    faceTo: (radians) => {
      setField(player, 'facing', radians);
    },
    bearingOf: (id) => readBearing(id),
    tabs: () =>
      [...document.querySelectorAll('.woc-wf-tab')].map((el) => el.getAttribute('data-view') ?? ''),
    openTab: () =>
      document.querySelector('.woc-wf-tab.woc-tab-active')?.getAttribute('data-view') ?? '',
    pressTab: (id) => {
      const button = document.querySelector<HTMLButtonElement>(`.woc-wf-tab[data-view="${id}"]`);
      button?.click();
    },
    clonedGlyphs: () =>
      [...document.querySelectorAll('.woc-wf-tab .woc-wf-glyph')].map(
        (el) => el.getAttribute('data-from') ?? '',
      ),
    markVisited: (key) => {
      visitedSet.add(key);
    },
    tick: () => {
      vi.advanceTimersByTime(TICK_MS);
    },
    frame: () => harness.frames.tick(),
    heading: () => document.querySelector('.woc-wf-head')?.textContent ?? '',
    note: () => document.querySelector('.woc-wf-note')?.textContent ?? '',
    minimap: () => document.querySelector('.woc-wf-minimap')?.textContent ?? '',
    drawn: () =>
      [...document.querySelectorAll('.woc-wf-row')].map(
        (el) => el.getAttribute('data-place') ?? '',
      ),
    labels: () =>
      [...document.querySelectorAll('.woc-wf-row .woc-bar-label')].map(
        (el) => el.textContent ?? '',
      ),
    figureOf: (id) => textIn(id, '.woc-bar-value'),
    detailOf: (id) => textIn(id, '.woc-bar-detail'),
    pinned: () =>
      [...document.querySelectorAll('.woc-wf-pin')].map(
        (el) => el.getAttribute('data-place') ?? '',
      ),
    published: () => [...published],
    ask: () => {
      const before = published.length;
      harness.shared.bus.emit(LISTENER, ASK_TOPIC, undefined);
      return published.slice(before);
    },
  };
}

/** `start`, plus the wait for the panel to come up and one draw in it. */
async function run(
  settings: Record<string, unknown> = {},
  atlas?: string,
  visited?: string[],
  options?: WorldOptions,
): Promise<WayfarerHarness> {
  const harness = await start(settings, atlas, visited, options);
  await settle();
  harness.tick();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  it('asks for exactly what it uses', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'keys']);
  });

  // An older loader strips an unknown manifest key, so only the minor keeps it off a loader
  // with no `woc.data`.
  it('declares the atlas file and the minor that reads it', () => {
    expect(manifest().data).toEqual([DATA_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  it('binds the toggle to Alt+KeyW, which no other shipped addon claims', () => {
    expect(manifest().keybinds?.[0]?.default).toBe('Alt+KeyW');
  });
});

// The table IS the addon: a row quietly dropped from it is a place that stops existing.
describe('the atlas it carries', () => {
  // Asserted on ids, since the source names zones in prose.
  it('carries no zone table in the source', () => {
    expect(SOURCE).not.toContain('eastbrook_vale');
    expect(SOURCE).not.toContain('the_farshore_causeway');
    expect(SOURCE).not.toContain('gy_thornpeak');
  });

  it('carries every zone, point, graveyard, mailbox and portal in the game', () => {
    expect(ATLAS.zones).toHaveLength(ZONE_COUNT);
    expect(ATLAS.zones.flatMap((zone) => zone.pois)).toHaveLength(POI_COUNT);
    expect(ATLAS.graveyards).toHaveLength(GRAVEYARD_COUNT);
    expect(ATLAS.mailboxes).toHaveLength(MAILBOX_COUNT);
    expect(ATLAS.portals).toHaveLength(PORTAL_COUNT);
  });

  // By id as well as by count: a count cannot say WHICH row moved. This row is read through
  // a same-module constant, the case `withLocalConstants` in the generator handles.
  it('carries The Wreck on the Farshore isle, at the point the game authored it', () => {
    const isle = ATLAS.zones.find((zone) => zone.id === 'farshore_isle');

    expect(isle?.pois).toContainEqual({ id: 'the_wreck', label: 'The Wreck', x: 306, z: 123.05 });
  });

  it('carries the Last Keep churchyard, at the point the game authored it', () => {
    const yard = ATLAS.graveyards.find((one) => one.id === 'gy_last_keep');

    expect(yard).toEqual({ id: 'gy_last_keep', label: 'Last Keep Churchyard', x: 451, z: 2134 });
  });

  // Some zones are the full-width strip with no x bounds, so the strip constants travel with
  // the table.
  it('carries the world strip constants beside the column zones', () => {
    const columns = ATLAS.zones.filter((zone) => zone.xMin !== undefined);
    expect(columns).toHaveLength(COLUMN_ZONE_COUNT);
    expect(EASTBROOK.xMin).toBeUndefined();
    expect(FARSHORE.xMin).toBe(180);
  });

  // The stamp is the only thing saying how old the table is. Rebuild with
  // `node addons/wayfarer/generate.mjs --game=<checkout>`.
  it('says which game version it was generated from', () => {
    expect(ATLAS.source.game).toMatch(SEMVER);
  });

  // The refusal cases below turn on this value, so a release that moves it fails here rather
  // than turning the refusal into a guess.
  it('carries the instance base the refusal turns on', () => {
    expect(ATLAS.world.instanceXBase).toBe(INSTANCE_X_BASE);
    expect(ATLAS.world.stripMinX).toBe(-STRIP_HALF_WIDTH);
    expect(ATLAS.world.stripMaxX).toBe(STRIP_HALF_WIDTH);
  });

  it('embeds no crafting station, because world.stations answers for them', () => {
    expect(ATLAS_TEXT).not.toContain('station_eastbrook_forge');
    expect(SOURCE).not.toContain('station_eastbrook_forge');
  });

  it('leaves out a zone row the file got wrong and keeps the rest', async () => {
    const h = await run({}, doctoredZone('eastbrook_vale', { zMax: -999 }));

    expect(h.heading()).toBe('Not in the open world');
    h.walkTo(0, 600);
    h.tick();
    expect(h.heading()).toContain('Thornpeak Heights');
  });

  it('draws nothing rather than throwing when the file is not an atlas at all', async () => {
    const h = await run({}, JSON.stringify({ places: [] }));

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toBe('Reading the atlas.');
  });
});

// Resolved from position with the game's strict rectangle test, never its clamping `zoneAt`.
describe('resolving the zone from position', () => {
  it('names the zone the player is standing in, with its level range', async () => {
    const h = await run();

    expect(h.heading()).toBe('Eastbrook Vale, levels 1 to 7');
  });

  it('follows the player across a border with nothing watching the border', async () => {
    const h = await run();

    h.walkTo(0, 600);
    h.tick();

    expect(h.heading()).toBe('Thornpeak Heights, levels 13 to 20');
  });

  // Farshore Isle shares Eastbrook Vale's z band at x 180 to 540, so the x test is required.
  it('does not put a player outside the strip in the zone sharing its band', async () => {
    const h = await run();

    h.walkTo(200, 0);
    h.tick();

    expect(h.heading()).toBe('The Farshore, levels 3 to 7');
  });

  it('is half-open on z, so the zMax of a band belongs to the band above it', async () => {
    const h = await run();

    h.walkTo(0, 179.9);
    h.tick();
    expect(h.heading()).toContain('Eastbrook Vale');

    h.walkTo(0, 180);
    h.tick();
    expect(h.heading()).toContain('Mirefen Marsh');
  });

  // The game's `zoneAt` would answer The Drakelands here.
  it('refuses to name a zone for a player inside an instance', async () => {
    const h = await run();

    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();

    expect(h.heading()).toBe('Not in the open world');
    expect(h.note()).toContain('Inside an instance');
  });

  // The arena, delve band and rift instances all sit further east, past the base.
  it('refuses across the whole instanced plane rather than at one dungeon', async () => {
    const h = await run();

    h.walkTo(INSTANCE_X_BASE + 9000, 0);
    h.tick();

    expect(h.heading()).toBe('Not in the open world');
  });

  // x 600 is past the world's east edge at 540 and nowhere near the instanced plane.
  it('says off the map rather than in an instance for a point in neither', async () => {
    const h = await run();

    h.walkTo(600, 0);
    h.tick();

    expect(h.heading()).toBe('Not in the open world');
    expect(h.note()).toContain('Outside every zone rectangle');
  });

  it('names nothing at all before world entry', async () => {
    const harness = await mountAddon({
      manifest: MANIFEST_TEXT,
      source: SOURCE,
      data: { [DATA_FILE]: ATLAS_TEXT },
      settings: {},
    });
    teardown.push(harness.dispose);
    await settle();

    expect(document.querySelectorAll('.woc-wf-anchor')).toHaveLength(0);
  });
});

// The bus contract: a consumer degrades to no zone header, so silence and null must be safe.
describe('publishing the zone', () => {
  it('publishes the zone it resolved, in the payload shape it documents', async () => {
    const h = await run();

    expect(h.published().at(-1)).toEqual({
      place: 'zone',
      id: 'eastbrook_vale',
      name: 'Eastbrook Vale',
      levelRange: { min: 1, max: 7 },
    });
  });

  it('publishes once on a border crossing rather than every second', async () => {
    const h = await run();
    const before = h.published().length;

    h.walkTo(0, 600);
    h.tick();
    h.tick();
    h.tick();

    expect(h.published().length - before).toBe(1);
    expect(h.published().at(-1)).toMatchObject({ id: 'thornpeak_heights' });
  });

  // Withholding a refusal leaves a subscriber showing the last zone. `place` says which
  // refusal; every other field is null so the shape never changes under the consumer.
  it('publishes the dungeon rather than a bare nothing', async () => {
    const h = await run();

    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();

    expect(h.published().at(-1)).toEqual({
      place: 'instance',
      id: null,
      name: null,
      levelRange: null,
    });
  });

  it('tells a point outside every rectangle from a point inside an instance', async () => {
    const h = await run();

    h.walkTo(600, 0);
    h.tick();

    expect(h.published().at(-1)).toMatchObject({ place: 'nowhere', id: null });
  });

  // Every session starts here, and a consumer must not read it as a fact about position.
  it('says it does not know yet rather than saying nowhere', async () => {
    const harness = await mountAddon({
      manifest: MANIFEST_TEXT,
      source: SOURCE,
      settings: {},
      game: Promise.resolve({ world: { entities: new Map(), player: null, known: [] } }),
    });
    teardown.push(harness.dispose);
    const heard: unknown[] = [];
    teardown.push(
      harness.shared.bus.subscribe({
        from: harness.fqid,
        topic: ZONE_TOPIC,
        owner: LISTENER,
        handler: (message) => {
          heard.push(message.payload);
        },
        onError: () => undefined,
      }),
    );

    harness.shared.bus.emit(LISTENER, ASK_TOPIC, undefined);

    expect(heard.at(-1)).toMatchObject({ place: 'unknown', id: null });
  });

  // All three refusals carry a null id, so the change test cannot key on the id alone.
  it('publishes again when one refusal becomes another', async () => {
    const h = await run();
    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();
    const before = h.published().length;

    h.walkTo(600, 0);
    h.tick();

    expect(h.published().length - before).toBe(1);
    expect(h.published().at(-1)).toMatchObject({ place: 'nowhere' });
  });

  // There is no replay on the bus, so a late subscriber relies on the ask.
  it('answers an ask immediately, even with nothing having changed', async () => {
    const h = await run();

    const answers = h.ask();

    expect(answers).toEqual([
      {
        place: 'zone',
        id: 'eastbrook_vale',
        name: 'Eastbrook Vale',
        levelRange: { min: 1, max: 7 },
      },
    ]);
  });

  it('keeps publishing while the panel is hidden', async () => {
    const h = await run();
    h.press('Alt+KeyW');

    h.walkTo(0, 600);
    h.tick();

    expect(h.published().at(-1)).toMatchObject({ id: 'thornpeak_heights' });
  });
});

// The game's minimap label is localized, so the addon DRAWS it and never compares it.
describe("the game's own label", () => {
  it('draws it under the heading, marked as the game speaking', async () => {
    const h = await run({}, undefined, undefined, { label: 'Eastbrook Vale' });

    expect(h.minimap()).toBe('Minimap: Eastbrook Vale');
  });

  it('draws nothing at all where the game has nothing to say', async () => {
    const h = await run();

    expect(h.minimap()).toBe('');
  });

  // Catches resolving from the label: the heading must follow the rectangles.
  it('refuses a zone the label names but no rectangle contains', async () => {
    const h = await run({}, undefined, undefined, { label: 'Wildheart' });

    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();

    expect(h.heading()).toBe('Not in the open world');
    expect(h.minimap()).toBe('Minimap: Wildheart');
  });
});

describe('the list of what is around', () => {
  // Stand on the hub read from the atlas, never a fixed coordinate, so a moved town does not
  // break these on distance.
  it('lists the nearest points first', async () => {
    const h = await run();

    h.walkTo(EASTBROOK_HUB.x, EASTBROOK_HUB.z);
    h.tick();

    expect(h.labels()[0]).toBe('Eastbrook');
  });

  it('holds only as many rows as the player asked for', async () => {
    const h = await run({ 'list-length': 3 });

    expect(h.drawn()).toHaveLength(3);
    expect(h.note()).toContain('more in range');
  });

  it('leaves out a point outside the draw distance', async () => {
    const h = await run({ 'draw-distance': 40, 'list-length': 20 });

    h.walkTo(EASTBROOK_HUB.x, EASTBROOK_HUB.z);
    h.tick();

    expect(h.labels()).toContain('Eastbrook');
    expect(h.labels()).not.toContain('Reliquary Hill');
  });

  it('leaves out a whole category the player switched off', async () => {
    const h = await run({ 'show-graveyards': false, 'list-length': 20 });

    expect(h.labels()).not.toContain('Eastbrook Rest');
    expect(h.labels()).toContain('Eastbrook');
  });

  // Asserted on the row id, because Eastbrook's mailbox is labelled 'Eastbrook' too.
  it('files a town as its own category rather than as a second row', async () => {
    const h = await run({ 'show-towns': false, 'list-length': 20 });

    expect(h.drawn()).not.toContain('town:eastbrook_vale:eastbrook');
    expect(h.drawn()).toContain('mailbox:mailbox_eastbrook');
  });

  it('measures the distance from the player to the point', async () => {
    const h = await run({ 'list-length': 20 });

    h.walkTo(EASTBROOK_HUB.x + WALKED_YARDS, EASTBROOK_HUB.z);
    h.tick();

    expect(h.figureOf('town:eastbrook_vale:eastbrook')).toBe(`${String(WALKED_YARDS)} yd`);
  });

  it('lists nothing at all inside an instance', async () => {
    const h = await run();

    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toContain('Inside an instance');
  });

  it('says why it is empty rather than drawing an empty box', async () => {
    const h = await run({ 'draw-distance': 40, 'show-points': false, 'show-towns': false });

    h.walkTo(-170, 170);
    h.tick();

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toContain('Nothing within 40 yd');
  });
});

describe('the crafting stations', () => {
  it('lists the station the loader publishes for this zone', async () => {
    const h = await run({ 'list-length': 20 });

    expect(h.labels()).toContain('Forge');
    expect(h.detailOf('station:station_eastbrook_forge')).toBe('Crafting station');
  });

  it('leaves out a station the loader files under another zone', async () => {
    const h = await run({ 'list-length': 20 });

    expect(h.labels()).not.toContain('Tannery');
  });

  it('lists no station at all when the loader has none', async () => {
    const h = await run({ 'list-length': 20 }, undefined, undefined, { stations: [] });

    expect(h.labels()).not.toContain('Forge');
  });
});

// The deed key is the game's `poi:<zoneId>:<poiId>`, and the poi id is FROZEN content.
describe('the points this character has visited', () => {
  it('marks a point the deed set carries', async () => {
    const h = await run({ 'list-length': 20 }, undefined, ['poi:eastbrook_vale:eastbrook']);

    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, explored');
  });

  it('marks one it does not carry as not yet explored', async () => {
    const h = await run({ 'list-length': 20 }, undefined, []);

    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, not yet explored');
  });

  // `world.on` reports nothing for a visit (the sheet's signature covers the counters only),
  // so the set is re-read on every draw.
  it('picks up a visit that landed with nothing to announce it', async () => {
    const h = await run({ 'list-length': 20 }, undefined, []);
    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, not yet explored');

    h.markVisited('poi:eastbrook_vale:eastbrook');
    h.tick();

    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, explored');
  });

  // The game re-words labels freely: `the_statuary_walk` is drawn as The Parterre Walk.
  it('keys the mark on the frozen id rather than on the label', async () => {
    const h = await run({ 'list-length': 20 }, undefined, [`poi:${PARTERRE.zone}:${PARTERRE.id}`]);

    h.walkTo(PARTERRE.x, PARTERRE.z);
    h.tick();

    expect(h.labels()).toContain('The Parterre Walk');
    expect(h.detailOf(`poi:${PARTERRE.zone}:${PARTERRE.id}`)).toBe('Point of interest, explored');
  });

  it('counts how much of the zone has been explored', async () => {
    const h = await run({}, undefined, [
      'poi:eastbrook_vale:eastbrook',
      'poi:eastbrook_vale:wolf_run',
    ]);

    expect(h.note()).toContain(`2/${String(EASTBROOK.pois.length)} explored`);
  });

  // The game drops a hidden poi from its map but its deed sweep still counts it, so it
  // leaves the list and stays in the denominator. Eastbrook carries one.
  it('leaves a hidden point out of the list and in the exploration total', async () => {
    const hidden = EASTBROOK.pois.filter((poi) => poi.hidden === true);
    expect(hidden).toHaveLength(1);

    const h = await run({ 'list-length': 20 }, undefined, [`poi:eastbrook_vale:${hidden[0]?.id}`]);
    h.walkTo(hidden[0]?.x ?? 0, hidden[0]?.z ?? 0);
    h.tick();

    expect(h.labels()).not.toContain(hidden[0]?.label);
    expect(h.note()).toContain(`1/${String(EASTBROOK.pois.length)} explored`);
  });

  // An empty visited set is ambiguous; an empty COUNTERS record means the sheet is missing.
  it('says the progress cannot be read rather than reporting zero', async () => {
    const h = await run({}, undefined, ['poi:eastbrook_vale:eastbrook'], { counters: {} });

    expect(h.note()).toContain('deeds unread');
    expect(h.note()).not.toContain('0/');
  });
});

describe('the world pins', () => {
  it('pins what is in range and drops them when the panel is hidden', async () => {
    const h = await run();
    expect(h.pinned().length).toBeGreaterThan(0);

    h.press('Alt+KeyW');

    expect(h.pinned()).toEqual([]);
    expect(document.querySelectorAll('.woc-wf-anchor')).toHaveLength(0);
  });

  it('takes every pin out of the world inside an instance', async () => {
    const h = await run();

    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();

    expect(h.pinned()).toEqual([]);
  });

  it('says that every pin height is an estimate', async () => {
    const h = await run();

    expect(h.note()).toContain('heights estimated');
  });

  // The shared projector answers one point for everything, so exactly one pin survives.
  // `woc.ui.show` hides with a class and the `hidden` attribute, never an inline style, and
  // both are asserted since a pin without the attribute is still announced.
  it('hides a pin that has landed on top of a nearer one', async () => {
    const h = await run();
    const drawn = h.pinned().length;
    expect(drawn).toBeGreaterThan(1);

    h.frame();

    const pins = [...document.querySelectorAll<HTMLElement>('.woc-wf-pin')];
    const visible = pins.filter((el) => !el.classList.contains('woc-hidden'));
    expect(visible).toHaveLength(1);
    expect(pins.filter((el) => el.hasAttribute('hidden'))).toHaveLength(drawn - 1);
  });
});

// `facing` is radians with 0 at +z. The sign is the claim about the game, so these pin it
// at all four quarters, standing relative to the hub.
describe('which way each row points', () => {
  async function aimedFrom(x: number, z: number, facing: number): Promise<number | null> {
    const h = await run();
    h.walkTo(x, z);
    h.faceTo(facing);
    h.tick();
    return h.bearingOf(HUB_ID);
  }

  it('points straight up at a place the player is already facing', async () => {
    // Due south of the hub looking north at it: dead ahead, whatever the coordinates are.
    expect(await aimedFrom(EASTBROOK_HUB.x, EASTBROOK_HUB.z + 40, Math.PI)).toBeCloseTo(0);
  });

  // A character facing +z faces the viewer, so their right is -x. The world turns one way
  // and the screen the other, which is the part a reader gets backwards.
  it('points right at a place off the player s right shoulder', async () => {
    // Standing east of the hub, facing north. The hub is to the WEST, which for a player
    // facing +z is their right hand, so the arrow turns a quarter clockwise.
    expect(await aimedFrom(EASTBROOK_HUB.x + 40, EASTBROOK_HUB.z, 0)).toBeCloseTo(90);
  });

  it('points left at a place off the player s left shoulder', async () => {
    expect(await aimedFrom(EASTBROOK_HUB.x - 40, EASTBROOK_HUB.z, 0)).toBeCloseTo(-90);
  });

  // Straight behind is -180, never 180: the end of the range a normalisation must agree on.
  it('points back at a place behind the player', async () => {
    expect(await aimedFrom(EASTBROOK_HUB.x, EASTBROOK_HUB.z + 40, 0)).toBeCloseTo(-180);
  });

  it('turns with the player rather than with the world', async () => {
    const h = await run();
    h.walkTo(EASTBROOK_HUB.x - 40, EASTBROOK_HUB.z);
    h.faceTo(0);
    h.tick();
    expect(h.bearingOf(HUB_ID)).toBeCloseTo(-90);

    // Facing +x, straight at the hub. Only the frame loop can notice; the redraw is a second away.
    h.faceTo(Math.PI / 2);
    h.frame();

    expect(h.bearingOf(HUB_ID)).toBeCloseTo(0);
  });

  // An arrow left pointing at whatever it last knew is worse than a hidden one.
  it('points nowhere at all with no heading to read', async () => {
    const h = await run();
    expect(h.bearingOf(HUB_ID)).not.toBeNull();

    h.faceTo(Number.NaN);
    h.frame();

    expect(h.bearingOf(HUB_ID)).toBeNull();
  });
});

// The strip narrows the list without overriding settings; the footer counts after both.
describe('the strip of views', () => {
  it('opens on the view that shows every category', async () => {
    const h = await run();

    expect(h.tabs()).toEqual(['all', 'explore', 'travel', 'service']);
    expect(h.openTab()).toBe('all');
  });

  it('narrows the list to the open view', async () => {
    const h = await run();
    const everything = h.drawn();

    h.pressTab('service');

    expect(h.openTab()).toBe('service');
    expect(h.drawn().length).toBeGreaterThan(0);
    for (const id of h.drawn()) {
      expect(id.startsWith('mailbox:') || id.startsWith('station:')).toBe(true);
    }
    expect(h.drawn().length).toBeLessThan(everything.length);
  });

  it('takes the pins with it, so nothing is pinned that is not listed', async () => {
    const h = await run();

    h.pressTab('service');

    for (const id of h.pinned()) {
      expect(id.startsWith('mailbox:') || id.startsWith('station:')).toBe(true);
    }
  });

  it('cannot show a category the settings turned off', async () => {
    const h = await run({ 'show-mailboxes': false });

    h.pressTab('service');

    for (const id of h.drawn()) {
      expect(id.startsWith('mailbox:')).toBe(false);
    }
  });
});

// The glyphs are the game's own icons, cloned from the `[data-icon]` nodes the HUD hydrates.
describe('the icons on the strip', () => {
  /** One hydrated game icon, as the HUD holds it once the game has drawn it. */
  function hydrate(name: string): void {
    const host = document.createElement('div');
    host.setAttribute('data-icon', name);
    host.innerHTML = '<svg class="ui-icon" viewBox="0 0 512 512"><path d="M0 0h1v1H0z"/></svg>';
    document.body.appendChild(host);
  }

  it('draws the strip with no glyphs at all before the HUD has any', async () => {
    const h = await run();

    expect(h.tabs()).toHaveLength(4);
    expect(h.clonedGlyphs()).toEqual([]);
  });

  it('picks each one up on the redraw after the game has drawn it', async () => {
    const h = await run();
    hydrate('map');
    hydrate('crafting');

    h.tick();

    expect(h.clonedGlyphs()).toEqual(['map', 'crafting']);
  });

  it('clones it once rather than on every redraw', async () => {
    const h = await run();
    hydrate('map');

    h.tick();
    h.tick();
    h.tick();

    expect(h.clonedGlyphs()).toEqual(['map']);
  });
});

describe('the toggle', () => {
  it('hides the panel', async () => {
    const h = await run();

    h.press('Alt+KeyW');

    expect(document.querySelector('[data-woc-frame="atlas"]')?.classList).toContain('woc-hidden');
  });
});

describe('disabling it', () => {
  it('leaves no row, no pin, no keybind and no redraw timer behind', async () => {
    const h = await run();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('.woc-wf-row')).toHaveLength(0);
    expect(document.querySelectorAll('.woc-wf-anchor')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.tick()).not.toThrow();
  });
});
