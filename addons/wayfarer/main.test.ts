// @vitest-environment happy-dom

// Wayfarer, run through the real loader.
//
// The decision this addon exists for is zone resolution, and specifically its refusal to answer
// where the game's own resolver would guess. So most of what follows is a player standing at a
// coordinate and one string being read off the heading, and the cases that matter most are the
// ones where the right answer is "not a zone at all": the instanced plane past x 99400, and any
// point no rectangle contains.
//
// Everything is driven from the shipped `atlas.json`. The fixtures below are read out of that
// file rather than written by hand, so a case about Farshore Isle sharing Eastbrook Vale's z
// band stays a case about the real table.
//
// `world.zone` is null throughout, because the shared world fake answers null for the game's own
// zone label. That is the right condition for these cases: every heading below is resolved from
// position with no label available at all.

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
 * The highest minor anything this addon CALLS arrived in.
 *
 * `woc.data`, `ui.project`, `woc.onFrame` and `world.stations` are 2. Six members are 4:
 * `ui.list` holds the rows and the pins, `ui.show` is what takes a crowded pin off screen,
 * `world.distanceTo` and `world.bearingTo` measure and point every row, `fmt.titleCase`
 * names a crafting station, and `bus.publish` answers the zone ask.
 *
 * `FrameOpts.toggleKey` is deliberately NOT on that list. It would have been the seventh,
 * and this addon declined it: its toggle also forces a redraw, so the bind is written by
 * hand. See the note above `keys.bind` in `main.js`.
 *
 * 6 is `resizable: 'width'`, which hands the player the one axis this panel can give away.
 * An older loader reads that string as truthy and takes BOTH, which writes a height over a
 * list whose length is a setting: the rows below the box are then clipped with nothing on
 * screen saying so, which is the failure the declaration refuses.
 */
const NEEDS_MINOR = 6;
const PLAYER_ID = PLAYER_ENTITY.id;
/** The redraw's period, so advancing this much runs exactly one of them. */
const TICK_MS = 1000;
/** How many microtask turns the atlas read and the frame's own restore want. */
const SETTLE_TURNS = 12;

/** What the shipped atlas has to carry, asserted so a hand edit cannot quietly thin it. */
const ZONE_COUNT = 14;
const POI_COUNT = 106;
const GRAVEYARD_COUNT = 18;
const MAILBOX_COUNT = 14;
const PORTAL_COUNT = 1;
/** Nine zones are grid columns with their own x bounds; five are the full-width strip. */
const COLUMN_ZONE_COUNT = 9;

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
    pois: { id: string; label: string; x: number; z: number; town?: boolean }[];
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
 * Eastbrook's own hub, which every bearing case aims at.
 *
 * Resolved out of the shipped atlas rather than written down, for the reason the zones
 * above are: a case about which way an arrow points should not also be a case about where
 * a town is. It is a town rather than an ordinary point because a town is the one row a
 * reader can place on the picture without looking anything up.
 */
const EASTBROOK_HUB = EASTBROOK.pois.find((poi) => poi.town === true);
if (EASTBROOK_HUB === undefined) {
  throw new Error('the shipped atlas has no town in Eastbrook Vale');
}
const HUB_ID = `town:eastbrook_vale:${EASTBROOK_HUB.id}`;

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

/**
 * One row's arrow rotation, read back off the transform the addon wrote.
 *
 * Null covers both a row that is not drawn and one whose arrow is hidden, which is the
 * same answer for the caller: nothing is being pointed at.
 */
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
  // `facing` is on the wire for every entity (`i.facing = e.f` on each snapshot apply) and
  // is not on the shared fake, because nothing before this addon read one. Zero is +z,
  // which makes a point due north of the player the one whose arrow points straight up.
  const player = liveEntity({
    set: { templateId: 'hunter', pos: { x: 0, y: 5, z: 0 }, kind: 'player', facing: 0 },
  });
  const visitedSet = new Set(visited);
  const world = {
    entities: new Map<number, Fake>([[PLAYER_ID, player]]),
    player,
    known: [],
    stationPlacements: stations,
    // The counters are what says the sheet has landed. The game's own `freshDeedStats()` writes
    // every key at 0 client-side, so a populated record is what an ordinary session holds from
    // its first tick and an empty one is the loader's stand-in for a world carrying no sheet.
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
  // A second addon on the bus, because nobody receives their own messages: subscribing
  // as somebody else is the only way to see what Wayfarer publishes at all.
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

  // Every one of these is spent, and nothing else is asked for. There is no socket read at all:
  // everything this addon draws comes off the world or out of its own file, and the frame's
  // saved position is loader-owned rather than addon storage.
  it('asks for exactly what it uses', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'keys']);
  });

  // An older loader strips an unknown manifest key rather than refusing it, so without
  // the minor this addon would install on a loader with no `woc.data`, start, and find
  // that the only file it has is not there.
  it('declares the atlas file and the minor that reads it', () => {
    expect(manifest().data).toEqual([DATA_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  it('binds the toggle to Alt+KeyW, which no other shipped addon claims', () => {
    expect(manifest().keybinds?.[0]?.default).toBe('Alt+KeyW');
  });
});

// What the shipped file carries. Asserted rather than assumed, because the table IS
// the addon: a row quietly dropped from it is a place that stops existing.
describe('the atlas it carries', () => {
  // Fails the moment anybody pastes the table back into the source. Asserted on the ids, because
  // the header comment names zones in prose to explain the rectangles and a display name is
  // therefore not the tell.
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

  // This is not fourteen plain rectangles: five zones are the original full-width strip and
  // carry no x bounds at all, so the world-width constants have to travel with the table.
  it('carries the world strip constants beside the nine zones that need them', () => {
    const columns = ATLAS.zones.filter((zone) => zone.xMin !== undefined);
    expect(columns).toHaveLength(COLUMN_ZONE_COUNT);
    expect(EASTBROOK.xMin).toBeUndefined();
    expect(FARSHORE.xMin).toBe(180);
  });

  // The file is generated, so it says which game it came out of. A hand-written replacement that
  // dropped the provenance would leave nobody able to tell whether the table is a release behind:
  // `node addons/wayfarer/generate.mjs --game=<checkout>` rebuilds it.
  it('says which game version it was generated from', () => {
    expect(ATLAS.source.game).toMatch(SEMVER);
  });

  // The instance base is content rather than a constant this addon may hold. The refusal cases
  // below turn on the value in the fixture, so this is what ties the two together: a release that
  // moves it fails here, next to a regeneration instruction, rather than silently turning the
  // refusal into a guess that names a zone for a player standing in a dungeon.
  it('carries the instance base the refusal turns on', () => {
    expect(ATLAS.world.instanceXBase).toBe(INSTANCE_X_BASE);
    expect(ATLAS.world.stripMinX).toBe(-STRIP_HALF_WIDTH);
    expect(ATLAS.world.stripMaxX).toBe(STRIP_HALF_WIDTH);
  });

  // The other correction: stations are the loader's, not the file's.
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

// The decision the addon exists for: resolved from position against the game's own rectangles,
// with the game's own strict resolver rather than its clamping one. `world.zone` is null in
// every case here, so nothing below could have come from the game's label.
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

  // The rectangle is half-open on BOTH axes. Farshore Isle shares Eastbrook Vale's z
  // band at x 180 to 540, so a test on z alone would report a player standing on
  // Farshore as standing in Eastbrook.
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

  // The game's own `zoneAt` clamps to the southmost band containing z and then to the
  // northmost zone, so for a player standing in a dungeon it answers The Drakelands. This
  // one refuses instead, which is what the exact heading below pins.
  it('refuses to name a zone for a player inside an instance', async () => {
    const h = await run();

    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();

    expect(h.heading()).toBe('Not in the open world');
    expect(h.note()).toContain('Inside an instance');
  });

  // The same refusal one step further out: the arena, the delve band and the rift
  // instances all sit further east still, and every one of them is past the base.
  it('refuses across the whole instanced plane rather than at one dungeon', async () => {
    const h = await run();

    h.walkTo(INSTANCE_X_BASE + 9000, 0);
    h.tick();

    expect(h.heading()).toBe('Not in the open world');
  });

  // A point in the open world that no rectangle contains is a different fact from an
  // instance, and the note says which. x 600 is past the world's east edge at 540 and
  // nowhere near the instanced plane.
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

    // No world, so no anchor may be hung in one and no zone may be claimed.
    expect(document.querySelectorAll('.woc-wf-anchor')).toHaveLength(0);
  });
});

// The bus contract. A consumer degrades to drawing no zone header, so silence and null
// both have to be safe.
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

  // A subscriber that keeps showing the last zone it heard about would have the player in
  // Thornpeak Heights while they stand in a dungeon. The refusal is published rather than
  // withheld, and it SAYS WHICH refusal it is: this addon exists to tell an instance from
  // an unmapped point from a world it cannot read yet, and a bare null told a consumer none
  // of the three. Every field but `place` is null, so one set of keys is read in all four
  // states rather than the shape changing under the consumer.
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

  // The state every session starts in, and the one a consumer must not read as a fact
  // about where the player is standing: the atlas is a promise and nothing is resolved
  // until it lands.
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

  // Two refusals in a row are two different answers, so the change test cannot key on the
  // id alone: with all three carrying a null id, riding out of a dungeon and off the edge
  // of the map would move between them in silence.
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

  // A late subscriber missed the last border crossing, and there is no replay on this
  // bus, so the ask is the whole of the protocol.
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

// The game's own minimap label, which the addon DRAWS and never reads. It is a localized
// display name, so a comparison against a string in the source would work on an English client
// and match nothing on any other, and underground it names the delve rather than a zone.
describe("the game's own label", () => {
  it('draws it under the heading, marked as the game speaking', async () => {
    const h = await run({}, undefined, undefined, { label: 'Eastbrook Vale' });

    expect(h.minimap()).toBe('Minimap: Eastbrook Vale');
  });

  it('draws nothing at all where the game has nothing to say', async () => {
    const h = await run();

    expect(h.minimap()).toBe('');
  });

  // The case that would catch a version resolving from the label: the label says one thing and
  // the rectangles say the player is nowhere, and the heading has to be the rectangles'. It is
  // also the state a delve is genuinely in, where the label is the more truthful of the two.
  it('refuses a zone the label names but no rectangle contains', async () => {
    const h = await run({}, undefined, undefined, { label: 'Wildheart' });

    h.walkTo(DUNGEON_X, DUNGEON_Z);
    h.tick();

    expect(h.heading()).toBe('Not in the open world');
    expect(h.minimap()).toBe('Minimap: Wildheart');
  });
});

// The list: what is near you, in the zone you are in, nearest first.
describe('the list of what is around', () => {
  it('lists the nearest points first', async () => {
    const h = await run();

    // Standing at the origin: Eastbrook town is 3 yards away, its graveyard 20, its
    // mailbox 7.5, and Reliquary Hill 52.
    expect(h.labels()[0]).toBe('Eastbrook');
  });

  it('holds only as many rows as the player asked for', async () => {
    const h = await run({ 'list-length': 3 });

    expect(h.drawn()).toHaveLength(3);
    expect(h.note()).toContain('more in range');
  });

  it('leaves out a point outside the draw distance', async () => {
    const h = await run({ 'draw-distance': 40, 'list-length': 20 });

    expect(h.labels()).toContain('Eastbrook');
    expect(h.labels()).not.toContain('Reliquary Hill');
  });

  it('leaves out a whole category the player switched off', async () => {
    const h = await run({ 'show-graveyards': false, 'list-length': 20 });

    expect(h.labels()).not.toContain('Eastbrook Rest');
    expect(h.labels()).toContain('Eastbrook');
  });

  // A town is the point of interest standing on its zone's own hub rather than a
  // second row beside it, so switching towns off takes exactly that one row away.
  //
  // Asserted on the row ID rather than on the label, because Eastbrook's mailbox is
  // labelled 'Eastbrook' too and is a different category standing a few yards away.
  it('files a town as its own category rather than as a second row', async () => {
    const h = await run({ 'show-towns': false, 'list-length': 20 });

    expect(h.drawn()).not.toContain('town:eastbrook_vale:eastbrook');
    expect(h.drawn()).toContain('mailbox:mailbox_eastbrook');
  });

  it('measures the distance from the player to the point', async () => {
    const h = await run({ 'list-length': 20 });

    expect(h.figureOf('town:eastbrook_vale:eastbrook')).toBe('3 yd');
  });

  // The list is the CURRENT zone's, which is what makes its heading true. A point 30
  // yards over a border is genuinely left out.
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

// The stations, which come from the loader rather than from the file.
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

// Deed progress: which points this character has actually stood in. The key shape is
// the game's own, `poi:<zoneId>:<poiId>`, and the id half of it is FROZEN content.
describe('the points this character has visited', () => {
  it('marks a point the deed set carries', async () => {
    const h = await run({ 'list-length': 20 }, undefined, ['poi:eastbrook_vale:eastbrook']);

    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, explored');
  });

  it('marks one it does not carry as not yet explored', async () => {
    const h = await run({ 'list-length': 20 }, undefined, []);

    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, not yet explored');
  });

  // A visit landing is a field change on the character sheet, not a set change, so
  // `world.on` reports nothing for it: `world.on('entities')` compares ids and the
  // sheet's own signature is taken over the deed COUNTERS. The set is therefore read
  // again on every draw rather than subscribed to, and this is what says so.
  it('picks up a visit that landed with nothing to announce it', async () => {
    const h = await run({ 'list-length': 20 }, undefined, []);
    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, not yet explored');

    h.markVisited('poi:eastbrook_vale:eastbrook');
    h.tick();

    expect(h.detailOf('town:eastbrook_vale:eastbrook')).toBe('Town, explored');
  });

  // The mark keys on the FROZEN id and never on the label, because the game re-words a
  // label freely and the deed mark has to survive it: `the_statuary_walk` is drawn as
  // The Parterre Walk. A version keying on the label would report both of the pois the
  // game has re-worded as unexplored for every character who has stood on them.
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

  // An empty visited set cannot say whether it is empty because the character has
  // explored nothing or because the sheet has not arrived, and those are opposite
  // facts. The COUNTERS settle it: the game fills every key at 0 client-side, so an
  // empty counters record is a sheet that is not there. A world with no deed sheet at
  // all reaches the loader as exactly that, and the panel has to say so rather than
  // telling a player who has walked the whole zone that they have explored none of it.
  it('says the progress cannot be read rather than reporting zero', async () => {
    const h = await run({}, undefined, ['poi:eastbrook_vale:eastbrook'], { counters: {} });

    expect(h.note()).toContain('deeds unread');
    expect(h.note()).not.toContain('0/');
  });
});

// The world pins. A pin's height is a guess in every case, which the panel says out
// loud and each pin's own pillar draws.
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

  // There is no ground height for an x and a z, so every pin here is anchored at
  // an estimate and the panel refuses to let that pass unsaid.
  it('says that every pin height is an estimate', async () => {
    const h = await run();

    expect(h.note()).toContain('heights estimated');
  });

  // The shared projector answers one screen point for everything, so every pin lands
  // on top of every other one and exactly one survives the thinning. That is a blunt
  // fixture and it is the right one: it proves the overlap decision runs at all and
  // that it keeps one rather than none.
  //
  // Read off the class rather than off an inline `display`, because `woc.ui.show` is
  // what hides a pin now and it deliberately writes neither: an inline style outranks
  // every selector a stylesheet can spell, so the loader hides with a class its own
  // sheet carries and with the `hidden` attribute that keeps a pin nobody can see out
  // of the accessibility tree. Both are asserted, since a pin that went off screen
  // without the attribute would still be announced.
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

// The direction each row points, which is the reading this panel is built around and the
// only one that is not a distance. `facing` is radians with 0 at +z and the bearing to a
// point reads the same way, so the whole of it is one subtraction and a sign; the sign is
// the part that is a claim about the game, so these cases pin it at the four quarters.
//
// Eastbrook's own hub sits south of the origin, so the fixtures below put the player at a
// coordinate and read the arrow rather than naming a place: what is under test is the
// arithmetic, and a case that also depended on where a town is would fail for two reasons.
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

  // The two cases the SIGN is in, and the reason they are worth a test each rather than a
  // shared one. A character facing +z has +z coming out of the screen toward you, so they
  // are facing you and their right hand is on your left: their right is -x. That is the
  // whole of `BEARING_SIGN`, and it is the one thing here a reader is likely to get
  // backwards, because the world turns one way and the screen turns the other.
  it('points right at a place off the player s right shoulder', async () => {
    // Standing east of the hub, facing north. The hub is to the WEST, which for a player
    // facing +z is their right hand, so the arrow turns a quarter clockwise.
    expect(await aimedFrom(EASTBROOK_HUB.x + 40, EASTBROOK_HUB.z, 0)).toBeCloseTo(90);
  });

  it('points left at a place off the player s left shoulder', async () => {
    expect(await aimedFrom(EASTBROOK_HUB.x - 40, EASTBROOK_HUB.z, 0)).toBeCloseTo(-90);
  });

  // The fourth quarter, which the three above leave open and which is the one a
  // half-turn can be wrong in without any of them noticing: a bearing convention with
  // the wrong sign still reads 0 straight ahead and still reads a half turn behind,
  // so only the two shoulders separate them and only this says which half turn it is.
  // Straight behind is -180 rather than 180, which is the end of the range the reading
  // is expressed in and therefore the value a normalisation has to agree on.
  it('points back at a place behind the player', async () => {
    // The same spot the first case stands on, turned the other way: the hub is now
    // squarely behind rather than squarely ahead.
    expect(await aimedFrom(EASTBROOK_HUB.x, EASTBROOK_HUB.z + 40, 0)).toBeCloseTo(-180);
  });

  it('turns with the player rather than with the world', async () => {
    const h = await run();
    h.walkTo(EASTBROOK_HUB.x - 40, EASTBROOK_HUB.z);
    h.faceTo(0);
    h.tick();
    expect(h.bearingOf(HUB_ID)).toBeCloseTo(-90);

    // Turned a quarter to face +x, standing still, which is straight at the hub. The frame
    // loop is what has to notice: nothing about the world changed and the next redraw is
    // up to a second away.
    h.faceTo(Math.PI / 2);
    h.frame();

    expect(h.bearingOf(HUB_ID)).toBeCloseTo(0);
  });

  // Before world entry there is no player and therefore no heading, and an arrow left
  // pointing at whatever it last knew is worse than one that says nothing.
  it('points nowhere at all with no heading to read', async () => {
    const h = await run();
    expect(h.bearingOf(HUB_ID)).not.toBeNull();

    h.faceTo(Number.NaN);
    h.frame();

    expect(h.bearingOf(HUB_ID)).toBeNull();
  });
});

// The strip, which narrows what is listed without touching what the player switched off in
// settings. The two filters answer different questions and the footer counts after both.
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

  // A category the player switched off stays off inside the view that would show it.
  // The strip is a view over what the settings allow, never a way round them.
  it('cannot show a category the settings turned off', async () => {
    const h = await run({ 'show-mailboxes': false });

    h.pressTab('service');

    for (const id of h.drawn()) {
      expect(id.startsWith('mailbox:')).toBe(false);
    }
  });
});

// The tab glyphs, which are the game's own icons cloned out of the running HUD rather than
// copied into this repository. The game hydrates every `[data-icon]` into an `<svg>` as the
// HUD mounts, and that drawn node is the only reachable form: the icon set is markup inside
// a module that is not on `__game`, and the game serves no file for any of them.
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
