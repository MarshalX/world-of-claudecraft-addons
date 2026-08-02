// @vitest-environment happy-dom

// Trailmark, run through the real loader.
//
// The decision this addon exists for is objective-to-location resolution, so that
// is what most of this suite is about, and every case drives it through the
// SHIPPED `quests.json` rather than a stub. A case that wants a broken row builds
// it by doctoring the real file, so a case about a bad entry stays a case about
// this table with one field wrong rather than about a fixture that stopped
// resembling it.
//
// THE DONE WHEN IS THE FIRST SECTION AND IT IS ASSERTED WITH AN EMPTY WORLD. The
// player stands at the origin in Eastbrook Vale, `world.entities` holds nobody but
// them, and the quest log names an objective whose only location is 1100 yards
// north in The Veiled Hollow. The row still names that zone and that distance,
// because the answer comes off a shipped table and never off interest scope. An
// addon that resolved from entities would draw nothing here and would look
// perfectly correct standing next to the mob.
//
// THE SECOND CLAIM IS THE LEARNED DENOMINATOR. `QuestProgress.resolvedCounts` is
// on the wire and off the published type, so the required count is learned from
// the `questProgress` event instead, held per character, and until then the
// shipped definition count is drawn as a LOWER BOUND with a plus on it. Both
// halves are asserted, including that the plus goes away the moment the server
// says a figure and that a stored figure survives a page load.
//
// The two clocks are driven separately, as they are in the longwatch suite:
// `advance` moves the monotonic clock a page load throws away, `setWallClock`
// moves the one it does not, and advancing the fake timers by a second runs the
// addon's own redraw. Nothing here needs a long wait, but the stamp on the stored
// record is wall clock and the case that proves it says so.

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
/** The minor `woc.data`, `woc.onFrame`, `woc.wallClock` and `ui.project` need. */
const NEEDS_MINOR = 2;

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
const HOLLOW = 'q_hollow';
const AMENDS = 'q_prof_amends_smith';
/** The escort that starts on Farshore, which shares Eastbrook Vale's z band. */
const FARSHORE = 'q_fs_bram_come_home';

/** The first objective of each, which is the only one any of them has. */
const WOLVES_KEY = `${WOLVES}#0`;
const BOARS_KEY = `${BOARS}#0`;
const SUPPLIES_KEY = `${SUPPLIES}#0`;
const HUNTSMAN_KEY = `${HUNTSMAN}#0`;
const ORE_KEY = `${ORE}#0`;
const ESCORT_KEY = `${ESCORT}#0`;
const HOLLOW_KEY = `${HOLLOW}#0`;
const AMENDS_KEY = `${AMENDS}#0`;
const FARSHORE_KEY = `${FARSHORE}#0`;
/** A turn-in row's key, which is the quest and no objective index. */
const TURN_IN_KEY = `${BOARS}!`;

/** How many camps the shipped table gives Forest Wolves, and boars. */
const WOLF_CAMPS = 2;
/**
 * How many ore nodes the table carries, and how many are inside the pin reach.
 *
 * A gather objective resolves to every node of its type, which is the game's own
 * answer. Two of the thirty-three sit more than two thousand yards from the origin
 * the player starts at here, and two thousand is the manifest's own maximum for the
 * distance setting: the LOADER clamps a larger value to it, so the case below asks
 * for five thousand and gets the ceiling, which is the reading a player would get.
 */
const ORE_NODES = 33;
const ORE_IN_RANGE = 31;
/** The addon's own ceiling on pins in the world at once. */
const PIN_BUDGET = 12;

/** The alt. `world.characterKey` is the realm and this, so changing it is a switch. */
const OTHER_CHARACTER = 'Marshalt';

/** The frame's own id, which is its persistence key. */
const FRAME_ID = 'objectives';

interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a case wants that is not settings, storage or a quest log. */
interface Extra {
  /** A doctored table, for a case about the file being wrong. */
  table?: string;
  /** A saved frame box, which is how a resize is driven. */
  saved?: FrameBox;
}

/**
 * Three saved boxes, which is how a resize is driven here.
 *
 * The same path a drag takes: the loader owns a resizable frame's box, restores a
 * saved one asynchronously, and reports it through `onMove`. Dragging an edge is
 * not reachable from a suite, and the restore is the honest stand-in for it.
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
  // For the redraw's interval and nothing else. Every stamp this addon takes reads
  // `woc.wallClock()`, which the harness owns and `vi.setSystemTime` cannot reach.
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
 * Write a field on a live entity.
 *
 * A computed access, because the fixture is a `Record<string, unknown>`: the
 * linter wants dot access on a literal key and the compiler forbids it on an index
 * signature, and a helper is what settles the two.
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

/**
 * The shipped table with one quest changed, as a hand edit would leave it.
 *
 * Built from the real file so a case about a bad row is a case about THIS table.
 */
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
  /** Take one out, which is what a turn-in does. */
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
 * Start the addon over a world holding nothing but the player.
 *
 * The entity map is deliberately EMPTY apart from the player in every case. This
 * addon must never need an entity to answer where an objective happens, and a
 * suite that seeded the mobs would not be able to tell the difference.
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
  // Eastbrook Vale: z 0 is inside its band and x 0 inside the world strip, which
  // is the rectangle test the addon does from position alone.
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
 * `start`, plus the wait for the panel to come up and one draw in it.
 *
 * A frame that saves its state starts hidden and is shown once that state arrives,
 * keyed per character, and this addon draws nothing at all while it is hidden. The
 * extra tick is because the panel comes up asynchronously, after the addon's own
 * first draw has already declined to run. It moves no clock, so every case still
 * starts at `NOW`.
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

  // Every one of these is spent. The socket for the three quest events, the world
  // for the log and the position, storage for the learned counts, ui for the panel
  // and the pins, and keys for the toggle and the cycle. No sound: nothing here
  // interrupts the player with a noise.
  it('asks for exactly what it uses', () => {
    expect(manifest().permissions).toEqual(['net.read', 'world.read', 'ui', 'storage', 'keys']);
  });

  // `data` is what puts the tables in their own file, and the minor is what the
  // surface reading it needs. An older loader strips an unknown manifest key
  // rather than refusing it, so without the minor this addon would install on a
  // loader with no `woc.data`, start, and find its only content file missing.
  it('declares the table and the minor that reads it', () => {
    expect(manifest().data).toEqual([TABLE_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  it('binds both keys', () => {
    expect(manifest().keybinds?.map((bind) => bind.id)).toEqual(['toggle', 'cycle']);
  });
});

// THE DONE WHEN. An objective in a zone the player has never entered still points
// the right way, and the world here holds nobody but the player to prove it.
describe('an objective in a zone the player has never entered', () => {
  it('still names the zone and the distance', async () => {
    const h = await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    // Huntsman Deral is authored at 18, 1104: eleven hundred yards north of the
    // player, in a zone with no entity of any kind in scope.
    expect(h.detailOf(HUNTSMAN_KEY)).toBe('The Veiled Hollow, 1104 yd ↑');
  });

  it('resolves it with an interest scope holding nobody but the player', async () => {
    const h = await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect([...h.entities.keys()]).toEqual([PLAYER_ID]);
    expect(h.drawn()).toContain(HUNTSMAN_KEY);
  });
});

// The derivation itself, one case per objective shape, all against the shipped
// table. These are the game's own rules from `src/sim/quest_targets.ts`, so a
// change here is a change to what the game's own map would draw.
describe('resolving an objective to a place', () => {
  it('sends a kill objective to every camp with that mob', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    expect(pinsOf(h, WOLVES_KEY)).toBe(WOLF_CAMPS);
    // The nearer of the two wolf camps, at 24, 70.
    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 74 yd ↑');
  });

  // The join is on the loot entry's quest id, not on the item alone: the same
  // item can be tagged for one quest and drop untagged for another.
  it('sends a collect objective to the camps of the tagged droppers', async () => {
    const h = await run({}, undefined, [{ questId: BOARS, counts: [0] }]);

    expect(pinsOf(h, BOARS_KEY)).toBe(WOLF_CAMPS);
    expect(h.detailOf(BOARS_KEY)).toBe('Eastbrook Vale, 65 yd ←');
  });

  // Six crates scattered over the bandit camp become ONE circle: the centroid
  // plus the distance to the farthest of them, which is the game's own bound.
  it('sends a collect objective to one circle over a ground-object cluster', async () => {
    const h = await run({}, undefined, [{ questId: SUPPLIES, counts: [0] }]);

    expect(pinsOf(h, SUPPLIES_KEY)).toBe(1);
    expect(h.detailOf(SUPPLIES_KEY)).toBe('Eastbrook Vale, 110 yd ↙');
  });

  it('sends an interact objective to the NPC', async () => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(pinsOf(h, HUNTSMAN_KEY)).toBe(1);
  });

  // Every ore node in the game, which is what the game's own map draws for it.
  // The pin budget is what keeps that from being thirty-three tiles on screen.
  it(`sends a gather objective to every node of that type, ${String(ORE_NODES)} of them`, async () => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: ORE, counts: [0] }]);

    expect(h.note()).toContain(`of ${String(ORE_IN_RANGE)} areas in range pinned`);
    expect(pinsOf(h, ORE_KEY)).toBe(PIN_BUDGET);
  });

  it('sends an escort objective to where the escortee stands', async () => {
    const h = await run({ 'pin-distance': 5000 }, undefined, [{ questId: ESCORT, counts: [0] }]);

    expect(pinsOf(h, ESCORT_KEY)).toBe(1);
    expect(h.detailOf(ESCORT_KEY)).toContain('The Frostveil Reach');
  });

  // A dungeon boss has no camp, so the game's own map draws no area for it
  // either. Saying so beats pinning somewhere plausible.
  it('says a kill objective with no camp is nowhere on the map', async () => {
    const h = await run({}, undefined, [{ questId: HOLLOW, counts: [0] }]);

    expect(h.detailOf(HOLLOW_KEY)).toBe('Nowhere on the map');
    expect(pinsOf(h, HOLLOW_KEY)).toBe(0);
  });
});

// THE SECOND CLAIM. The required count is learned from the event, because the
// per-player override that decides it is on the wire and off the published type.
describe('the required count', () => {
  it('draws the shipped definition as a lower bound until it learns one', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    expect(h.figureOf(AMENDS_KEY)).toBe('2/5+');
    expect(h.classesOf(AMENDS_KEY)).toContain('woc-bar-warn');
  });

  // The quest whose requirement the server genuinely overrides: five in the
  // definition, `5 + 3 * switchCount` for a character who has switched twice.
  it('takes the exact figure off the progress event', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 11 });
    h.accept({ questId: AMENDS, counts: [3] });
    h.tick();

    expect(h.figureOf(AMENDS_KEY)).toBe('3/11');
    expect(h.classesOf(AMENDS_KEY)).toContain('woc-bar-default');
  });

  // The definition can only ever be too SMALL, so a count already past it is a
  // better lower bound than the definition is.
  it('floors the bound at what is already banked', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [7] }]);

    expect(h.figureOf(AMENDS_KEY)).toBe('7/7+');
  });

  // An exact figure is what closes a row. A lower bound that has been reached
  // cannot say the objective is finished, so the row stays and stays marked.
  it('keeps an objective on screen while the bound is only a bound', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [5] }]);

    expect(h.drawn()).toContain(AMENDS_KEY);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 5, required: 5 });
    h.tick();

    expect(h.drawn()).not.toContain(AMENDS_KEY);
  });

  // The three quest kinds are undescribed by the published catalogue, so the
  // payload is `unknown` and every field is checked here. A bad denominator would
  // be written to disk and outlive the session that produced it.
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

// The learned figures are per CHARACTER, because the override behind them is per
// player: an alt who has switched archetype twice needs a different denominator
// for the same quest than the main who never has.
describe('remembering what it learned', () => {
  it('writes the figures under this character"s own key', async () => {
    const h = await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    h.progress({ questId: AMENDS, objectiveIndex: 0, current: 3, required: 11 });
    await settle();

    const stored = storedTrail(h.storage) as { at: number; required: Record<string, number> };
    expect(stored.required[AMENDS_KEY]).toBe(11);
  });

  // Wall clock, never `woc.now()`. A monotonic stamp restarts near zero on every
  // page load, so a stored one reads as being in the future on the next session
  // with nothing to indicate it.
  it('stamps the record with the wall clock", not the monotonic one', async () => {
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

  // A character switch inside one page load is real: the game clones and removes
  // its HUD rather than reloading. The previous character's denominators would be
  // shown under this one's name and written back out under their key.
  it('forgets the previous character"s figures on a switch', async () => {
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

// The tables come from a FILE, and `woc.data` hands back `unknown`, so the shape
// is a claim this addon checks rather than one it can lean on.
describe('the table it reads', () => {
  // Fails the moment anybody pastes the table back into the source, which is the
  // only way this addon quietly stops being a file plus a reader again.
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

  // A missing section costs the half that needed it and nothing else: without the
  // camps a kill objective resolves nowhere, and the interact objective is still
  // answered by the NPC table.
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

// A quest with nothing left to do is a reward waiting to be collected, so it gets
// a row and a pin of its own naming whoever takes it. `world.quests.log` carries
// the state, so this needs no event: the `questReady` toast is the interrupt, and
// this is the display.
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

  // Ahead of the focus, and ahead of everything still being worked: a turn-in
  // buried under an active quest's objectives is a turn-in forgotten for an hour.
  it('leads the list, ahead of an active quest', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }, ...Ready]);

    expect(h.drawn()[0]).toBe(TURN_IN_KEY);
  });

  // An NPC the sim walks in mid-encounter rather than placing has no position at
  // all. No shipped quest reaches this at 0.33.1, because the one that names a
  // spawned-on-demand turn-in names a placed NPC beside it, so it is driven
  // through a doctored table: the branch is kept because the table is game
  // content and the next release owes this addon nothing.
  it('says so when nothing placed can take it', async () => {
    const table = doctored(BOARS, { turnIn: ['brother_aldric_raid'] });
    const h = await run({}, undefined, Ready, { table });

    expect(h.labelOf(TURN_IN_KEY)).toContain('not on the map');
    expect(pinsOf(h, TURN_IN_KEY)).toBe(0);
  });

  // A turn-in has no denominator, so the lower-bound marking every objective row
  // wears would be a claim about nothing.
  it('wears no lower-bound marking', async () => {
    const h = await run({}, undefined, Ready);

    expect(h.figureOf(TURN_IN_KEY)).not.toContain('+');
    expect(h.classesOf(TURN_IN_KEY)).toContain('woc-bar-default');
  });
});

// The tooltip carries the two things the row cannot: why the denominator reads
// the way it does, and how wide the place actually is.
describe('what a row says under the pointer', () => {
  function hover(key: string): string {
    rowFor(key)?.dispatchEvent(new Event('pointerenter'));
    return document.getElementById('woc-tooltip')?.textContent ?? '';
  }

  // The game pads a camp's own spawn radius by four yards, and the nearer wolf
  // camp is authored at 26. A distance measured to the centre is ambiguous
  // without this: 74 yards to a spot and 74 yards to a thirty yard sweep are
  // different rides.
  it('says how wide the nearest area is, with the game"s own padding on it', async () => {
    await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    expect(hover(WOLVES_KEY)).toContain('reaches 30 yd from that point');
  });

  it('says a lone point is the game"s six yard circle', async () => {
    await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(hover(HUNTSMAN_KEY)).toContain('reaches 6 yd from that point');
  });

  it('says the denominator is only a lower bound', async () => {
    await run({}, undefined, [{ questId: AMENDS, counts: [2] }]);

    expect(hover(AMENDS_KEY)).toContain('At least this many');
  });

  // The one caveat an authored NPC point earns and a camp does not: the sim
  // nudges every static NPC out of buildings and deep water at world init, so the
  // live entity can stand a yard or two from the table.
  it('says an NPC position is authored rather than measured', async () => {
    await run({}, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(hover(HUNTSMAN_KEY)).toContain('Authored position');
  });

  it('says nothing about placement for a camp', async () => {
    await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    expect(hover(WOLVES_KEY)).not.toContain('Authored position');
  });
});

// The zone match is done from POSITION against the shipped rectangles and never
// from `world.zone`, which is localized display text: an addon comparing that
// against a string works in English and matches nothing anywhere else.
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

  // THE RECTANGLE IS HALF-OPEN ON BOTH AXES AND THE X BOUNDS ARE LOAD-BEARING.
  // The Farshore sits at x 180 to 540 and shares Eastbrook Vale's z band, so a
  // test on z alone reports an objective standing on Farshore as being in
  // Eastbrook Vale, which is the wrong side of the world.
  it('does not put a Farshore point in the zone sharing its band', async () => {
    const h = await run({ 'pin-distance': 2000 }, undefined, [{ questId: FARSHORE, counts: [0] }]);

    expect(h.detailOf(FARSHORE_KEY)).toContain('The Farshore');
    expect(h.detailOf(FARSHORE_KEY)).not.toContain('Eastbrook');
  });

  // The same rectangle read from the player's side rather than the objective's.
  it('does not put a player outside the strip in the zone sharing its band', async () => {
    const h = await run({ 'other-zones': false }, undefined, [
      { questId: WOLVES, counts: [0] },
      { questId: FARSHORE, counts: [0] },
    ]);

    h.walkTo(252, -8);
    h.tick();

    expect(h.drawn()).toEqual([FARSHORE_KEY]);
  });

  // Nothing watches for a border crossing and nothing needs to: the filter is
  // re-resolved on every draw.
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

// Which way to turn, which is a fact about the CHARACTER and not about the camera.
// The sign is the one thing here that cannot be caught by looking: an arrow that
// points consistently the wrong way round reads as a working display right up until
// somebody follows it.
describe('the bearing on a row', () => {
  // The nearer wolf camp is at 24, 70, which is very nearly due north of a player
  // standing at the origin, and `facing` starts at 0, which is +z.
  it('points straight ahead for an objective the character is facing', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 74 yd ↑');
  });

  it('turns the arrow when the character turns rather than when the camera does', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.turnTo(Math.PI);
    h.tick();

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 74 yd ↓');
  });

  // THE SIGN. `facing` grows as the character turns LEFT, so with the character
  // looking up +z an objective due +x is on their left, and the sectors have to run
  // that way. Walked to twenty-three yards due west of the western wolf camp, at
  // -27, 71, which puts that camp at +x and nothing else in the way of reading it.
  it('puts an objective at +x on the left of a character facing +z', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.walkTo(-50, 70);
    h.tick();

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 23 yd ←');
  });

  // A field the game stopped sending is the ordinary way this goes wrong, and an
  // arrow defaulted to straight ahead would be confidently wrong on every row.
  it('draws no arrow at all when the facing cannot be read', async () => {
    const h = await run({}, undefined, [{ questId: WOLVES, counts: [0] }]);

    h.turnTo(null);
    h.tick();

    expect(h.detailOf(WOLVES_KEY)).toBe('Eastbrook Vale, 74 yd');
  });
});

// The pins, which are anchors the loader holds over the world rather than
// children of the panel.
describe('the world pins', () => {
  it('leaves out an area past the pin distance', async () => {
    const h = await run({ 'pin-distance': 100 }, undefined, [{ questId: HUNTSMAN, counts: [0] }]);

    expect(pinsOf(h, HUNTSMAN_KEY)).toBe(0);
    // The ROW is still there: not pinning something eleven hundred yards away is
    // not the same as declining to say where it is.
    expect(h.drawn()).toContain(HUNTSMAN_KEY);
  });

  // `ui.project` answering null means DO NOT DRAW, and that covers a point behind
  // the camera and one closer than the near plane as well as one off the edge.
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

// The panel is resizable, so its content has to reflow with the box: the row
// budget comes off the box `onMove` hands over, and anything past it is reported
// as a count rather than clipped.
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

  // The floor is one row, never the current count: bounds cannot be restated
  // after the frame is built, so a floor set while three rows showed would trap
  // the player who later has one. The loader clamps a saved box to the bounds the
  // frame declared, so a box saved smaller than the floor comes back at the floor.
  it('never falls below one row', async () => {
    const h = await run({}, undefined, three, { saved: CRAMPED });

    expect(h.drawn()).toHaveLength(1);
  });
});

// An empty grid reads as a measurement of zero, which is the one thing it never
// means. Every empty state here says which one it is.
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

    // Not asserted: that no row was built. An addon runs before world entry by
    // design and the loader is what keeps its frames off the landing page. What
    // must not happen is a world anchor, because there is no world to hang one in.
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

  // The rotation is over the LOG's order rather than the drawn list, so a quest
  // the zone filter hid is still reachable.
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

// The one thing this addon does that interrupts: saying where a ready quest is
// handed in, at the moment it becomes possible.
describe('a quest going ready', () => {
  it('says who to hand it in to and where they are', async () => {
    const h = await run({}, undefined, [{ questId: BOARS, counts: [5] }]);

    h.nudge('questReady', BOARS);

    expect(h.toast()).toContain('Trader Wilkes');
    expect(h.toast()).toContain('Eastbrook Vale');
  });

  // An NPC the sim walks in mid-encounter rather than placing carries no position
  // at all. No shipped quest reaches this at 0.33.1, because the one that names a
  // spawned-on-demand turn-in names a placed NPC beside it, so the case is driven
  // through a doctored table: the branch is kept because the table is game content
  // and the next release owes this addon nothing.
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
