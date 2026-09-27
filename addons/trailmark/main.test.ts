// @vitest-environment happy-dom

// Trailmark, run through the real loader, against the shipped `quests.json`; a case about a bad row
// doctors the real file.
//
// The world is EMPTY apart from the player: the answer comes off the table, never off interest
// scope, and a suite that seeded the mobs could not tell the difference.
//
// `advance` moves the monotonic clock a page load throws away; `setWallClock` moves the one it
// keeps.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import {
  characterNamespace,
  perCharacterKey,
  uiNamespace,
} from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the longwatch suite.
import SOURCE from './main.js?raw';
import TABLE_TEXT from './quests.json?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const FQID = 'official/trailmark';
/** What tests/fakes/shared-services.ts says the player is called, and which host. */
const CHARACTER = 'Claudemoon/Marshal';
const CHANNEL = 'pbe';
const STORE_KEY = 'trail';
const TABLE_FILE = 'quests.json';
/**
 * The highest minor anything this addon calls arrived in: `woc.data`, `woc.onFrame`,
 * `woc.wallClock` and `ui.project` are 2; `ui.list`, `world.distanceTo`, `world.bearingTo` and
 * `fmt.compass` are 4. A frame's `toggleKey` is not used; see the bind in `main.js`.
 */
const NEEDS_MINOR = 4;

const PLAYER_ID = PLAYER_ENTITY.id;
/** What the harness's wall clock starts at, and therefore what every case starts at. */
const NOW = 1_700_000_000_000;
/** The redraw's period, so advancing this much runs exactly one of them. */
const TICK_MS = 1000;
/** How many microtask turns the table read, the frame restore and the reads want. */
const SETTLE_TURNS = 14;

/** Quests picked for one shape of objective each, all out of the shipped table. */
const WOLVES = 'q_wolves';
const BOARS = 'q_boars';
const SUPPLIES = 'q_supplies';
const HUNTSMAN = 'q_hollow_the_huntsman';
const ORE = 'q_prof_intro';
const ESCORT = 'q_fv_seeing_wren_home';
/** The farming intro, whose two objectives are the only `farm` ones shipped. */
const FARM = 'q_farm_intro';
const HOLLOW = 'q_hollow';
const AMENDS = 'q_prof_amends_smith';
/** The escort that starts on Farshore, which shares Eastbrook Vale's z band. */
const FARSHORE = 'q_fs_bram_come_home';
/**
 * The three work orders, one per gathering profession. Each collects a material only a node yields,
 * which the classic collect lookups cannot answer: nothing drops it tagged and no crate is placed.
 */
const FORGE_ORDER = 'q_prof_workorder_forge';
const TOOLWORKS_ORDER = 'q_prof_workorder_toolworks';
const APOTHECARY_ORDER = 'q_prof_workorder_apothecary';

const WOLVES_KEY = `${WOLVES}#0`;
/**
 * The nearer wolf camp's x, authored at (-10, 6) with a 28.5 yard spawn radius. Every standpoint in
 * the bearing block is chosen against it; re-derive them if the camp moves, or a "due north" case
 * asserts on an arrow by accident.
 */
const WOLF_CAMP_X = -10;
/** The nearer wolf camp itself, for the standpoints that have to be placed against it. */
const WOLF_CAMP = { x: -10, z: 6 };
/** How far south or west of the camp a bearing case stands, far enough to read cleanly. */
const BEARING_YARDS = 23;
const BOARS_KEY = `${BOARS}#0`;
const SUPPLIES_KEY = `${SUPPLIES}#0`;
const HUNTSMAN_KEY = `${HUNTSMAN}#0`;
const ORE_KEY = `${ORE}#0`;
const ESCORT_KEY = `${ESCORT}#0`;
const FARM_KEY = `${FARM}#0`;
const HOLLOW_KEY = `${HOLLOW}#0`;
const AMENDS_KEY = `${AMENDS}#0`;
const FARSHORE_KEY = `${FARSHORE}#0`;
const FORGE_ORDER_KEY = `${FORGE_ORDER}#0`;
const TOOLWORKS_ORDER_KEY = `${TOOLWORKS_ORDER}#0`;
const APOTHECARY_ORDER_KEY = `${APOTHECARY_ORDER}#0`;
/** A turn-in row's key, which is the quest and no objective index. */
const TURN_IN_KEY = `${BOARS}!`;

/** How many camps the shipped table gives Forest Wolves, and boars. */
const WOLF_CAMPS = 2;
/**
 * How many ore nodes the table carries, and how many are inside the pin reach. Two sit past two
 * thousand yards, the manifest's maximum distance, so the case asks for five thousand and gets the
 * ceiling. The figures are content; the case is about the answer being every node and the pin
 * budget keeping that off screen.
 */
const ORE_NODES = 52;
const ORE_IN_RANGE = 50;
/** The addon's own ceiling on pins in the world at once. */
const PIN_BUDGET = 12;

/** The alt. `world.characterKey` is the realm and this, so changing it is a switch. */
const OTHER_CHARACTER = 'Marshalt';

const FRAME_ID = 'objectives';

interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a case wants that is not settings, storage or a quest log. */
interface Extra {
  table?: string;
  saved?: FrameBox;
}

/**
 * Three saved boxes, which is how a resize is driven: the loader owns a resizable frame's box,
 * restores a saved one asynchronously and reports it through `onMove`, as a drag does.
 */
const TALL: FrameBox = { x: 20, y: 20, w: 300, h: 400 };
const SHORT: FrameBox = { x: 20, y: 20, w: 300, h: 90 };
/** Saved smaller than the floor. The loader clamps it back up to one row. */
const CRAMPED: FrameBox = { x: 20, y: 20, w: 40, h: 10 };

type Fake = Record<string, unknown>;

interface Progress {
  questId: string;
  counts: number[];
  /** 'active' unless a case is about a turn-in. */
  state?: string;
}

const teardown: Array<() => void> = [];

beforeEach(() => {
  // For the redraw's interval only. Every stamp reads `woc.wallClock()`, which the harness owns and
  // `vi.setSystemTime` cannot reach.
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

/**
 * Write a field on a live entity. Computed access, because the fixture is a `Record<string,
 * unknown>`: the linter wants dot access on a literal key and the compiler forbids it on an index
 * signature.
 */
function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

function rowFor(key: string): HTMLElement | null {
  return document.querySelector(`.woc-tm-row[data-objective="${key}"]`);
}

function textIn(key: string, selector: string): string {
  return rowFor(key)?.querySelector(selector)?.textContent ?? '';
}

/** The per-character key the learned counts are supposed to land under. */
function storedTrail(storage: FakeStorage): unknown {
  const dumped = storage.dump();
  return dumped[`${characterNamespace(FQID)}/${perCharacterKey(CHANNEL, CHARACTER, STORE_KEY)}`];
}

/** Let the table read, the async frame restore and the per-character read land. */
function settle(): Promise<void> {
  let done = Promise.resolve();
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    done = done.then(() => undefined);
  }
  return done;
}

/** One row of the shipped table, as this suite has to reach into it. */
interface QuestRow {
  id: string;
  [field: string]: unknown;
}

/** The shipped table with one quest changed, as a hand edit would leave it. */
function doctored(id: string, patch: Record<string, unknown>): string {
  const file = JSON.parse(TABLE_TEXT) as { quests: QuestRow[] };
  const quests = file.quests.map((quest) => {
    if (quest.id !== id) {
      return quest;
    }
    return { ...quest, ...patch };
  });
  return JSON.stringify({ ...file, quests });
}

/** The same file with one whole section removed, which is the other hand edit. */
function without(section: string): string {
  const file = JSON.parse(TABLE_TEXT) as Record<string, unknown>;
  const { [section]: _dropped, ...rest } = file;
  return JSON.stringify(rest);
}

interface TrailHarness extends SharedHarness {
  storage: FakeStorage;
  /** Interest scope, so a case can prove the resolution needed nothing in it. */
  entities: ReadonlyMap<number, Fake>;
  /** Put a quest in the log, active, with the counts given. */
  accept: (progress: Progress) => void;
  drop: (questId: string) => void;
  /** Deliver one `questProgress` record off the socket, exactly as it arrives. */
  progress: (event: Record<string, unknown>) => void;
  /** Deliver one bare `{ questId }` record: `questReady` or `questDone`. */
  nudge: (type: string, questId: unknown) => void;
  /** Walk the player somewhere. Copied, because the game mutates `pos` in place. */
  walkTo: (x: number, z: number) => void;
  /** Turn the character. Radians, 0 at +z, growing as they turn left. */
  turnTo: (facing: unknown) => void;
  /** Become somebody else, which is what `world.characterKey` is derived from. */
  becomeCharacter: (name: string) => void;
  /** Re-read the world, which is what turns a set change into a handler call. */
  poll: () => void;
  /** Run the addon's once-a-second redraw. */
  tick: () => void;
  /** Run the loader's one frame loop, which is where the pins are painted. */
  frame: () => void;
  /** The objective keys with a row up, in the order they are drawn. */
  drawn: () => string[];
  /** The objective keys with a pin in the world, one entry per area drawn. */
  pinned: () => string[];
  /** One row's right-hand figure. */
  figureOf: (key: string) => string;
  /** One row's second line. */
  detailOf: (key: string) => string;
  /** One row's head line. */
  labelOf: (key: string) => string;
  /** Every class on one row, so a tone can be read off it. */
  classesOf: (key: string) => string[];
  /** The line under the list: the truncation, or why there is nothing. */
  note: () => string;
  /** The toast on screen, or '' when there is none. */
  toast: () => string;
}

/**
 * Start the addon over a world holding nothing but the player: the addon must never need an entity
 * to answer where an objective happens.
 */
async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
  log: readonly Progress[] = [],
  extra: Extra = {},
): Promise<TrailHarness> {
  const table = extra.table ?? TABLE_TEXT;
  if (extra.saved !== undefined) {
    await storage.set(uiNamespace(FQID), perCharacterKey(CHANNEL, CHARACTER, FRAME_ID), {
      box: extra.saved,
      visible: true,
    });
  }
  // Eastbrook Vale: z 0 is inside its band and x 0 inside the world strip.
  const player = liveEntity({
    set: { templateId: 'hunter', pos: { x: 0, y: 5, z: 0 }, kind: 'player' },
  });
  const questLog = new Map<string, unknown>();
  for (const row of log) {
    questLog.set(row.questId, { state: 'active', ...row });
  }
  const entities = new Map<number, Fake>([[PLAYER_ID, player]]);
  const world = {
    entities,
    player,
    known: [],
    questLog,
    questsDone: new Set<string>(),
  };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    storage,
    settings,
    data: { [TABLE_FILE]: table },
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  return {
    ...harness,
    storage,
    entities,
    accept: (progress) => {
      questLog.set(progress.questId, { state: 'active', ...progress });
    },
    drop: (questId) => {
      questLog.delete(questId);
    },
    progress: (event) => {
      harness.inbound(eventsFrame([{ type: 'questProgress', ...event }]));
    },
    nudge: (type, questId) => {
      harness.inbound(eventsFrame([{ type, questId }]));
    },
    walkTo: (x, z) => {
      setField(player, 'pos', { x, y: 5, z });
    },
    turnTo: (facing) => {
      setField(player, 'facing', facing);
    },
    becomeCharacter: (name) => {
      setField(player, 'name', name);
    },
    poll: () => harness.shared.world.watcher.poll(),
    tick: () => {
      vi.advanceTimersByTime(TICK_MS);
    },
    frame: () => {
      harness.frames.tick();
    },
    drawn: () =>
      [...document.querySelectorAll('.woc-tm-row')].map(
        (el) => el.getAttribute('data-objective') ?? '',
      ),
    pinned: () =>
      [...document.querySelectorAll('.woc-tm-pin')].map(
        (el) => el.getAttribute('data-objective') ?? '',
      ),
    figureOf: (key) => textIn(key, '.woc-bar-value'),
    detailOf: (key) => textIn(key, '.woc-bar-detail'),
    labelOf: (key) => textIn(key, '.woc-bar-label'),
    classesOf: (key) => [...(rowFor(key)?.classList ?? [])],
    note: () => document.querySelector('.woc-tm-note')?.textContent ?? '',
    toast: () => document.querySelector('.woc-toast')?.textContent ?? '',
  };
}

/**
 * `start`, plus the wait for the panel and one draw. A saved frame starts hidden until its
 * per-character state loads, and the addon draws nothing while hidden. The extra tick moves no
 * clock, so every case starts at `NOW`.
 */
async function run(
  settings: Record<string, unknown> = {},
  storage?: FakeStorage,
  log?: readonly Progress[],
  extra?: Extra,
): Promise<TrailHarness> {
  const harness = await start(settings, storage, log, extra);
  harness.poll();
  await settle();
  harness.tick();
  return harness;
}

/** How many pins one objective has in the world right now. */
function pinsOf(harness: TrailHarness, key: string): number {
  return harness.pinned().filter((drawn) => drawn.startsWith(`${key}@`)).length;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // Every one is used: socket for the quest events, world for the log and position, storage for
  // learned counts, ui for panel and pins, keys for toggle and cycle. No sound.
  it('asks for exactly what it uses', () => {
    expect(manifest().permissions).toEqual(['net.read', 'world.read', 'ui', 'storage', 'keys']);
  });

  // An older loader strips an unknown manifest key such as `data`, so without the minor this would
  // install on a loader with no `woc.data` and find its only content file missing.
  it('declares the table and the minor that reads it', () => {
    expect(manifest().data).toEqual([TABLE_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  it('binds both keys', () => {
    expect(manifest().keybinds?.map((bind) => bind.id)).toEqual(['toggle', 'cycle']);
  });
});

// An objective in a zone the player has never entered still points the right way.
describe('an objective in a zone the player has never entered', () => {
  it('still names the zone and the distance', async () => {
    const h = await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    // Huntsman Deral is authored at 18, 1104, in a zone with no entity in scope.
    expect(h.detailOf(HUNTSMAN_KEY)).toBe('The Veiled Hollow, 1104 yd ↑');
  });

  it('resolves it with an interest scope holding nobody but the player', async () => {
    const h = await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect([...h.entities.keys()]).toEqual([PLAYER_ID]);
    expect(h.drawn()).toContain(HUNTSMAN_KEY);
  });
});

// The game's own rules from `src/sim/quest_targets.ts`, one case per objective shape, against the
// shipped table.
describe('resolving an objective to a place', () => {
  it('sends a kill objective to every camp with that mob', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    expect(pinsOf(h, WOLVES_KEY)).toBe(WOLF_CAMPS);
    // The nearer of the two wolf camps, at -10, 6.
    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 12 yd ↗');
  });

  // The join is on the loot entry's quest id, not the item alone: one item can be tagged for one
  // quest and untagged for another.
  it('sends a collect objective to the camps of the tagged droppers', async () => {
    const h = await run({}, undefined, [{ questId: BOARS, counts: [0] }]);

    expect(pinsOf(h, BOARS_KEY)).toBe(WOLF_CAMPS);
    // The nearer wild boar camp, at 58, -72.
    expect(h.detailOf(BOARS_KEY)).toBe('Eastbrook Vale, 92 yd ↙');
  });

  // Six crates over the bandit camp become ONE circle: the centroid plus the farthest crate.
  it('sends a collect objective to one circle over a ground-object cluster', async () => {
    const h = await run({}, undefined, [{ questId: SUPPLIES, counts: [0] }]);

    expect(pinsOf(h, SUPPLIES_KEY)).toBe(1);
    expect(h.detailOf(SUPPLIES_KEY)).toBe('Eastbrook Vale, 110 yd ↙');
  });

  it('sends an interact objective to the NPC', async () => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(pinsOf(h, HUNTSMAN_KEY)).toBe(1);
  });

  // Every ore node in the game, as the game's map draws it; the pin budget keeps that off screen.
  it(`sends a gather objective to every node of that type, ${String(ORE_NODES)} of them`, async () => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: ORE, counts: [0] }]);

    expect(h.note()).toContain(`of ${String(ORE_IN_RANGE)} areas in range pinned`);
    expect(pinsOf(h, ORE_KEY)).toBe(PIN_BUDGET);
  });

  /**
   * A farm objective is credited by planting or harvesting at a garden bed. The circle encloses the
   * patch's beds, so the pin lands on the beds: the anchor is their centroid, which on a 5 yard
   * grid sits BETWEEN them.
   */
  it('sends a farm objective to the beds of the patch it names', async () => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: FARM, counts: [0] }]);

    expect(pinsOf(h, FARM_KEY)).toBe(1);
    expect(h.detailOf(FARM_KEY)).not.toBe('Nowhere on the map');
  });

  it('sends an escort objective to where the escortee stands', async () => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: ESCORT, counts: [0] }]);

    expect(pinsOf(h, ESCORT_KEY)).toBe(1);
    expect(h.detailOf(ESCORT_KEY)).toContain('The Frostveil Reach');
  });

  // A dungeon boss has no camp, so the game's own map draws no area for it either.
  it('says a kill objective with no camp is nowhere on the map', async () => {
    const h = await run({}, undefined, [{ questId: HOLLOW, counts: [0] }]);

    expect(h.detailOf(HOLLOW_KEY)).toBe('Nowhere on the map');
    expect(pinsOf(h, HOLLOW_KEY)).toBe(0);
  });

  // A work order asks for a gathered material, which only `nodeYieldClusters` (the collect branch
  // of `questObjectiveAreas`) answers, so the game's map circles the veins.
  it.each([
    [FORGE_ORDER, FORGE_ORDER_KEY],
    [TOOLWORKS_ORDER, TOOLWORKS_ORDER_KEY],
    [APOTHECARY_ORDER, APOTHECARY_ORDER_KEY],
  ])('sends a collect objective for a gathered material to the nodes (%s)', async (quest, key) => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: quest, counts: [0] }]);

    expect(h.detailOf(key)).not.toBe('Nowhere on the map');
    expect(pinsOf(h, key)).toBeGreaterThan(0);
  });
});

// The required count is learned from the event, because the per-player override is on the wire and
// off the published type.
describe('the required count', () => {
  it('draws the shipped definition as a lower bound until it learns one', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    expect(h.figureOf(AMENDS_KEY)).toBe('2/5+');
    expect(h.classesOf(AMENDS_KEY)).toContain('woc-bar-warn');
  });

  // The quest the server genuinely overrides: five in the definition, `5 + 3 * switchCount` for a
  // character who has switched twice.
  it('takes the exact figure off the progress event', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 11 });
    h.accept({ questId: AMENDS, counts: [3] });
    h.tick();

    expect(h.figureOf(AMENDS_KEY)).toBe('3/11');
    expect(h.classesOf(AMENDS_KEY)).toContain('woc-bar-default');
  });

  // The definition can only be too SMALL, so a count already past it is the better lower bound.
  it('floors the bound at what is already banked', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [7] }]);

    expect(h.figureOf(AMENDS_KEY)).toBe('7/7+');
  });

  // Only an exact figure closes a row; a reached lower bound cannot say the objective is finished.
  it('keeps an objective on screen while the bound is only a bound', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [5] }]);

    expect(h.drawn()).toContain(AMENDS_KEY);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 5, required: 5 });
    h.tick();

    expect(h.drawn()).not.toContain(AMENDS_KEY);
  });

  // The quest events are unpublished, so the payload is `unknown` and every field is checked. A bad
  // denominator would be written to disk.
  it('refuses a progress record that is not one', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 0 });
    h.progress({ questId: AMENDS, objectiveIndex: 0.5, current: 3, required: 9 });
    h.progress({ questId: AMENDS, objectiveIndex: -1, current: 3, required: 9 });
    h.progress({ objectiveIndex: 0, current: 3, required: 9 });
    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 'nine' });
    h.tick();

    expect(h.figureOf(AMENDS_KEY)).toBe('2/5+');
  });
});

// Learned figures are per CHARACTER, because the override is per player.
describe('remembering what it learned', () => {
  it('writes the figures under the current character key', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 11 });
    await settle();

    const stored = storedTrail(h.storage) as { at: number; required: Record<string, number> };
    expect(stored.required[AMENDS_KEY]).toBe(11);
  });

  // Wall clock, never `woc.now()`: a monotonic stamp restarts near zero on every page load and
  // reads as future on the next session.
  it('stamps the record with the wall clock, not the monotonic one', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);
    h.advance(90_000);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 11 });
    await settle();

    const stored = storedTrail(h.storage) as { at: number };
    expect(stored.at).toBe(NOW);
  });

  // A page load is a torn-down addon and a fresh one over the same storage.
  it('comes back exact after a reload rather than back to a bound', async () => {
    const storage = createFakeStorage();
    const first = await run({}, storage, [{ questId: AMENDS, counts: [2] }]);
    first.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 11 });
    await settle();

    for (const stop of teardown.splice(0)) {
      stop();
    }
    document.body.innerHTML = '';
    const second = await run({}, storage, [{ questId: AMENDS, counts: [3] }]);
    await settle();
    second.tick();

    expect(second.figureOf(AMENDS_KEY)).toBe('3/11');
  });

  it('ignores a stored figure that is not one', async () => {
    const storage = createFakeStorage();
    await storage.set(characterNamespace(FQID), perCharacterKey(CHANNEL, CHARACTER, STORE_KEY), {
      at: NOW,
      required: { [AMENDS_KEY]: 'eleven', [`${WOLVES}#0`]: 0 },
    });

    const h = await run({}, storage, [{ questId: AMENDS, counts: [2] }]);
    await settle();
    h.tick();

    expect(h.figureOf(AMENDS_KEY)).toBe('2/5+');
  });

  // The game swaps characters without reloading, so the previous character's denominators would
  // show and be written under this one.
  it('forgets the previous character figures on a switch', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);
    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 2, required: 11 });
    h.tick();
    expect(h.figureOf(AMENDS_KEY)).toBe('2/11');

    h.becomeCharacter(OTHER_CHARACTER);
    h.poll();
    h.tick();

    expect(h.figureOf(AMENDS_KEY)).toBe('2/5+');
  });
});

// `woc.data` hands back `unknown`, so the table's shape is checked rather than trusted.
describe('the table it reads', () => {
  // Fails if the table is pasted back into the source.
  it('carries no quest of its own', () => {
    expect(SOURCE).not.toContain(WOLVES);
    expect(SOURCE).not.toContain('forest_wolf');
  });

  it('leaves out a quest the file got wrong and keeps the rest', async () => {
    const table = doctored(WOLVES, { objectives: [{ type: 'kill', count: 0, label: 'x' }] });
    const h = await run(
      {},
      undefined,
      [
        { questId: WOLVES, counts: [0] },
        { questId: BOARS, counts: [0] },
      ],
      { table },
    );

    expect(h.drawn()).not.toContain(WOLVES_KEY);
    expect(h.drawn()).toContain(BOARS_KEY);
  });

  // A missing section costs only the half that needed it: without camps a kill objective resolves
  // nowhere, and the NPC table still answers the interact objective.
  it('keeps going when a whole section is missing', async () => {
    const h = await run(
      {},
      undefined,
      [
        { questId: WOLVES, counts: [0] },
        { questId: HUNTSMAN, counts: [0] },
      ],
      { table: without('camps') },
    );

    expect(h.detailOf(WOLVES_KEY)).toBe('Nowhere on the map');
    expect(h.detailOf(HUNTSMAN_KEY)).toContain('The Veiled Hollow');
  });

  it('says so rather than throwing when the file is not a table at all', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }], {
      table: JSON.stringify({}),
    });

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toBe('Reading the quest tables.');
  });
});

// A quest with nothing left to do gets a row and a pin naming whoever takes it. `world.quests.log`
// carries the state, so no event is needed: the `questReady` toast is the interrupt, and this is
// the display.
describe('a quest waiting to be handed in', () => {
  const Ready = [{ questId: BOARS, counts: [5], state: 'ready' }];

  it('names whoever takes it and where they stand', async () => {
    const h = await run({}, undefined, Ready);

    expect(h.labelOf(TURN_IN_KEY)).toContain('Hand in to Trader Wilkes');
    expect(h.figureOf(TURN_IN_KEY)).toBe('Ready');
    expect(h.detailOf(TURN_IN_KEY)).toContain('Eastbrook Vale');
  });

  it('pins the turn-in into the world', async () => {
    const h = await run({}, undefined, Ready);

    expect(pinsOf(h, TURN_IN_KEY)).toBe(1);
  });

  // Ahead of the focus and everything still being worked, so a turn-in is not buried.
  it('leads the list, ahead of an active quest', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }, ...Ready]);

    expect(h.drawn()[0]).toBe(TURN_IN_KEY);
  });

  // An NPC the sim spawns on demand has no position. No shipped quest reaches this, so it is driven
  // through a doctored table; the branch stays because the table is game content.
  it('says so when nothing placed can take it', async () => {
    const table = doctored(BOARS, { turnIn: ['brother_aldric_raid'] });
    const h = await run({}, undefined, Ready, { table });

    expect(h.labelOf(TURN_IN_KEY)).toContain('not on the map');
    expect(pinsOf(h, TURN_IN_KEY)).toBe(0);
  });

  // A turn-in has no denominator, so it wears no lower-bound marking.
  it('wears no lower-bound marking', async () => {
    const h = await run({}, undefined, Ready);

    expect(h.figureOf(TURN_IN_KEY)).not.toContain('+');
    expect(h.classesOf(TURN_IN_KEY)).toContain('woc-bar-default');
  });
});

// The tooltip carries what the row cannot: why the denominator reads as it does, and how wide the
// place is.
describe('what a row says under the pointer', () => {
  function hover(key: string): string {
    rowFor(key)?.dispatchEvent(new Event('pointerenter'));
    return document.getElementById('woc-tooltip')?.textContent ?? '';
  }

  // The game pads a camp's spawn radius by four yards, and the nearer wolf camp is authored at
  // 28.5. A distance to the centre is ambiguous without the width.
  it('says how wide the nearest area is, game padding included', async () => {
    await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    expect(hover(WOLVES_KEY)).toContain('reaches 33 yd from that point');
  });

  it('says a lone point is a six yard circle', async () => {
    await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(hover(HUNTSMAN_KEY)).toContain('reaches 6 yd from that point');
  });

  it('says the denominator is only a lower bound', async () => {
    await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    expect(hover(AMENDS_KEY)).toContain('At least this many');
  });

  // The sim nudges static NPCs out of buildings and deep water at world init, so the live entity
  // can stand a yard or two from the table.
  it('says an NPC position is authored rather than measured', async () => {
    await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(hover(HUNTSMAN_KEY)).toContain('Authored position');
  });

  it('says nothing about placement for a camp', async () => {
    await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    expect(hover(WOLVES_KEY)).not.toContain('Authored position');
  });
});

// The zone match is from POSITION against the shipped rectangles, never `world.zone`, which is
// localized display text.
describe('which zone an objective is in', () => {
  it('names the zone from the rectangle the point falls in', async () => {
    const h = await run({}, undefined, [{ questId: ESCORT, counts: [0] }]);

    expect(h.detailOf(ESCORT_KEY)).toContain('The Frostveil Reach');
  });

  it('lists only the current zone when asked to', async () => {
    const h = await run({ 'other-zones': false }, undefined, [
      { questId: WOLVES, counts: [0] },
      { questId: HUNTSMAN, counts: [0] },
    ]);

    expect(h.drawn()).toEqual([WOLVES_KEY]);
  });

  // The rectangle is half-open and the x bounds matter: the Farshore (x 180 to 540) shares
  // Eastbrook Vale's z band, so a z-only test puts it in Eastbrook Vale.
  it('does not put a Farshore point in the zone sharing its band', async () => {
    const h = await run({ 'pin-distance': 2000 }, undefined, [{ questId: FARSHORE, counts: [0] }]);

    expect(h.detailOf(FARSHORE_KEY)).toContain('The Farshore');
    expect(h.detailOf(FARSHORE_KEY)).not.toContain('Eastbrook');
  });

  // The same rectangle read from the player's side.
  it('does not put a player outside the strip in the zone sharing its band', async () => {
    const h = await run({ 'other-zones': false }, undefined, [
      { questId: WOLVES, counts: [0] },
      { questId: FARSHORE, counts: [0] },
    ]);

    h.walkTo(252, -8);
    h.tick();

    expect(h.drawn()).toEqual([FARSHORE_KEY]);
  });

  // The filter is re-resolved on every draw, so nothing watches for a border crossing.
  it('follows the player across a border with no set change', async () => {
    const h = await run({ 'other-zones': false }, undefined, [
      { questId: WOLVES, counts: [0] },
      { questId: HUNTSMAN, counts: [0] },
    ]);

    h.walkTo(0, 1100);
    h.tick();

    expect(h.drawn()).toEqual([HUNTSMAN_KEY]);
  });
});

// The bearing is relative to the character, not the camera. A consistently reversed arrow looks
// like a working display, so the sign is pinned.
describe('the bearing on a row', () => {
  // Due south of the nearer wolf camp: dead ahead of a character whose `facing` starts at 0 (+z).
  it('points straight ahead for an objective the character is facing', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.walkTo(WOLF_CAMP.x, WOLF_CAMP.z - BEARING_YARDS);
    h.tick();

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 23 yd ↑');
  });

  it('turns the arrow when the character turns rather than when the camera does', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.walkTo(WOLF_CAMP.x, WOLF_CAMP.z - BEARING_YARDS);
    h.turnTo(Math.PI);
    h.tick();

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 23 yd ↓');
  });

  // `facing` grows as the character turns left, so facing +z an objective due +x is on their left.
  // Standing due west of the nearer wolf camp puts it at +x.
  it('puts an objective at +x on the left of a character facing +z', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.walkTo(WOLF_CAMP.x - BEARING_YARDS, WOLF_CAMP.z);
    h.tick();

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 23 yd ←');
  });

  // All EIGHT, because a table written the other way round agrees at ahead and behind and disagrees
  // everywhere between. The character stands due south of the camp (bearing 0) and turns left 45
  // degrees at a time; the world moves right, so the arrow steps clockwise.
  it('steps through all eight sectors as the character turns', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);
    h.walkTo(WOLF_CAMP_X, 0);
    const eighth = Math.PI / 4;
    const clockwise = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

    for (const [step, arrow] of clockwise.entries()) {
      h.turnTo(step * eighth);
      h.tick();

      expect(h.detailOf(WOLVES_KEY)).toContain(arrow);
    }
  });

  // An arrow defaulted to straight ahead would be confidently wrong on every row when the field
  // goes missing.
  it('draws no arrow at all when the facing cannot be read', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.turnTo(null);
    h.tick();

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 12 yd');
  });
});

// The pins are anchors over the world, not children of the panel.
describe('the world pins', () => {
  it('leaves out an area past the pin distance', async () => {
    const h = await run({ 'pin-distance': 100 }, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(pinsOf(h, HUNTSMAN_KEY)).toBe(0);
    // The ROW stays: not pinning something far away is not declining to say where it is.
    expect(h.drawn()).toContain(HUNTSMAN_KEY);
  });

  // `ui.project` answering null means DO NOT DRAW, covering behind the camera and the near plane as
  // well as off the edge.
  it('hides a pin whose point cannot be projected', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);
    h.frame();
    expect(pinVisibility()).toBe('visible');

    h.shared.kit.project = () => null;
    h.frame();

    expect(pinVisibility()).toBe('hidden');
  });

  it('takes the pins out of the world the moment the panel is hidden', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);
    expect(h.pinned().length).toBeGreaterThan(0);

    h.press('Alt+KeyQ');

    expect(h.pinned()).toEqual([]);
    expect(document.querySelectorAll('.woc-tm-anchor')).toHaveLength(0);
  });
});

/** The first pin's own visibility, which is what the projection decides. */
function pinVisibility(): string {
  return document.querySelector<HTMLElement>('.woc-tm-pin')?.style.visibility ?? '';
}

// The row budget comes off the box `onMove` hands over, and anything past it is counted rather than
// clipped.
describe('the panel resizing', () => {
  const three = [
    { questId: WOLVES, counts: [0] },
    { questId: BOARS, counts: [0] },
    { questId: SUPPLIES, counts: [0] },
  ];

  it('draws every row when the box is tall enough', async () => {
    const h = await run({}, undefined, three, { saved: TALL });

    expect(h.drawn()).toHaveLength(3);
    expect(h.note()).toBe('');
  });

  it('draws fewer rows in a shorter box and says how many are left', async () => {
    const h = await run({}, undefined, three, { saved: SHORT });

    expect(h.drawn()).toHaveLength(1);
    expect(h.note()).toContain('2 more below the panel');
  });

  // The floor is one row, never the current count: bounds cannot be restated after the frame is
  // built. The loader clamps a saved box to the declared bounds.
  it('never falls below one row', async () => {
    const h = await run({}, undefined, three, { saved: CRAMPED });

    expect(h.drawn()).toHaveLength(1);
  });
});

// An empty grid reads as a measurement of zero, so every empty state says which one it is.
describe('when there is nothing to draw', () => {
  it('says there are no quests in the log', async () => {
    const h = await run();

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toContain('No quests in your log');
  });

  it('says the zone filter is what emptied it', async () => {
    const h = await run({ 'other-zones': false }, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(h.note()).toContain('Other zones are switched off');
  });

  it('says there is no quest log before world entry', async () => {
    const harness = await mountAddon({
      manifest: MANIFEST_TEXT,
      source: SOURCE,
      data: { [TABLE_FILE]: TABLE_TEXT },
      settings: {},
    });
    teardown.push(harness.dispose);
    await settle();

    // Rows are not asserted absent: the loader keeps frames off the landing page. A world anchor
    // must not appear, since there is no world.
    expect(document.querySelectorAll('.woc-tm-anchor')).toHaveLength(0);
  });
});

// Which quest leads the list, and the two ways it moves.
describe('the focused quest', () => {
  it('puts a newly accepted quest at the head', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.accept({ questId: HUNTSMAN, counts: [0] });
    h.poll();

    expect(h.drawn()[0]).toBe(HUNTSMAN_KEY);
  });

  it('leaves the head alone when the player switched that off', async () => {
    const h = await run({ 'auto-track': false }, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.accept({ questId: HUNTSMAN, counts: [0] });
    h.poll();

    expect(h.drawn()[0]).toBe(WOLVES_KEY);
  });

  // The rotation is over the LOG's order, so a quest the zone filter hid is still reachable.
  it('moves to the next active quest on the keybind', async () => {
    const h = await run({ 'auto-track': false }, undefined, [
      { questId: WOLVES, counts: [0] },
      { questId: BOARS, counts: [0] },
    ]);

    h.press('Alt+Shift+KeyQ');

    expect(h.drawn()[0]).toBe(WOLVES_KEY);

    h.press('Alt+Shift+KeyQ');

    expect(h.drawn()[0]).toBe(BOARS_KEY);
  });
});

// The one interruption: saying where a ready quest is handed in, when it becomes possible.
describe('a quest going ready', () => {
  it('says who to hand it in to and where they are', async () => {
    const h = await run({}, undefined, [{ questId: BOARS, counts: [5] }]);

    h.nudge('questReady', BOARS);

    expect(h.toast()).toContain('Trader Wilkes');
    expect(h.toast()).toContain('Eastbrook Vale');
  });

  // An NPC the sim spawns on demand has no position. No shipped quest reaches this, so it is driven
  // through a doctored table.
  it('says the turn-in is not on the map when the NPC is spawned on demand', async () => {
    const table = doctored(BOARS, { turnIn: ['brother_aldric_raid'] });
    const h = await run({}, undefined, [{ questId: BOARS, counts: [5] }], { table });

    h.nudge('questReady', BOARS);

    expect(h.toast()).toContain('not on the map');
  });

  it('ignores a record with no quest id on it', async () => {
    const h = await run({}, undefined, [{ questId: BOARS, counts: [5] }]);

    h.nudge('questReady', 42);

    expect(h.toast()).toBe('');
  });
});

describe('the toggle', () => {
  it('hides the panel', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.press('Alt+KeyQ');

    expect(document.querySelector('[data-woc-frame="objectives"]')?.classList).toContain(
      'woc-hidden',
    );
  });
});

describe('disabling it', () => {
  it('leaves no row, no pin, no keybind and no redraw timer behind', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('.woc-tm-row')).toHaveLength(0);
    expect(document.querySelectorAll('.woc-tm-anchor')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.tick()).not.toThrow();
  });
});
