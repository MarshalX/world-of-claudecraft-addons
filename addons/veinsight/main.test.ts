// @vitest-environment happy-dom

// Veinsight, run through the real loader.
//
// The addon is a join: the table is the addon's, the respawn timers are the game's, and the two
// meet on a node id string. The fixtures are built from the shipped `nodes.json` and never from
// a stub, so every coordinate below was read out of that file.
//
// Three things this suite deliberately cannot see, and does not pretend to:
//
//  - Where an anchor ended up. The projector is a stand-in and nothing is painted onto a real
//    screen. Everything here asserts what a pin is, never where it went.
//  - Whether the bearing arrow points the way a player would say it does. The sign is derived
//    from the game's own turn handling and asserted against that derivation.
//  - What a real terrain height is. There is no terrain in a suite, so the three height
//    provenances are driven by their inputs: an entity standing near the point, a harvest
//    landing, and neither.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { characterNamespace, perCharacterKey } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the longwatch suite.
import SOURCE from './main.js?raw';
import TABLE_TEXT from './nodes.json?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const FQID = 'official/veinsight';
/** What tests/fakes/shared-services.ts says the player is called, and which host. */
const CHARACTER = 'Claudemoon/Marshal';
const CHANNEL = 'pbe';
const STORE_KEY = 'heights';
const DATA_FILE = 'nodes.json';
/**
 * The highest minor anything this addon calls arrived in. `woc.data`,
 * `world.nodeCooldowns` and `ui.project` are 2; `ui.list`, `fmt.duration`,
 * `fmt.compass`, `world.distanceTo`, `world.bearingTo` and `bus.follow` are 4;
 * `world.professions.toolEffectSlots` is 5.
 *
 * A frame's own `toggleKey` is 4 as well and is deliberately NOT on that list: the toggle
 * is bound by hand, for the reason written above the bind in `main.js`.
 *
 * Declared at 5 for `world.holdings` even though an older loader answers an empty list
 * rather than throwing, because that is the failure worth refusing: a silently empty list
 * makes the fine-grade answer short by a tier for anyone carrying a charm, with nothing on
 * screen saying so. At 6 for `resizable: 'width'`, where an older loader reads the string
 * as truthy and hands the player a height this panel cannot honour.
 */
const NEEDS_MINOR = 6;

const PLAYER_ID = PLAYER_ENTITY.id;
/** The redraw's period, so advancing this much runs exactly one of them. */
const TICK_MS = 1000;
/** How many microtask turns the table read, the frame restore and the reads want. */
const SETTLE_TURNS = 14;
/**
 * Seconds a node takes to come back, which is the denominator of every fill. Read out of the
 * shipped table rather than written here, because a number written here would be the addon's own
 * constant spelled a second time: every fill assertion would then agree with the addon whatever
 * the game does. The table's figure comes off `NODE_HARVEST_TABLE`.
 */
const RESPAWN_SECONDS = (JSON.parse(TABLE_TEXT) as { respawnSeconds: { ore: number } })
  .respawnSeconds.ore;

/**
 * Rows out of the shipped table, by hand, so a case names a coordinate a reader can
 * go and check. Everything here was read out of `nodes.json`.
 */
const ORE_1 = { id: 'ore_eastbrook_1', x: -70, z: -53 };
const ORE_2 = { id: 'ore_eastbrook_2', x: -73, z: -49 };
const ORE_3 = { id: 'ore_eastbrook_3', x: -67, z: -57 };
const ORE_6 = { id: 'ore_eastbrook_6', x: -65, z: -69 };
const WOOD_2 = { id: 'wood_eastbrook_2', x: -57, z: -6 };
const HERB_1 = { id: 'herb_eastbrook_1', x: -59, z: 91 };
/** Somebody else in the world, for the records the game broadcasts rather than sends. */
const OTHER_PLAYER = 777;
/** The nearest tier-2 node in the game, and the only kind a tier-1 tool refuses. */
const ORE_T2 = { id: 'ore_mirefen_t2', x: 36, z: 350 };
/**
 * A tier-1 vein in a zone whose material sits at rung 2, which is the case the fine grade
 * has to refuse: the tool outclasses the material and the VEIN does not carry it.
 */
const ORE_MIREFEN_T1 = { id: 'ore_mirefen_3', x: 35, z: 345 };

/**
 * Every eastbrook node within the default 150 yard draw distance, nearest first from ORE_1,
 * which is the default standpoint. Twelve of the zone's eighteen: the six left out are 152 to
 * 248 yards off rather than absent.
 */
const NEAR_ORE_1 = [
  'ore_eastbrook_1',
  'ore_eastbrook_2',
  'ore_eastbrook_3',
  'ore_eastbrook_6',
  'ore_eastbrook_5',
  'ore_eastbrook_4',
  'wood_eastbrook_2',
  'wood_eastbrook_1',
  'wood_eastbrook_3',
  'herb_eastbrook_4',
  'herb_eastbrook_2',
  'herb_eastbrook_1',
];

/** The tool ids the shipped table files under each type, at the tiers they cover. */
const COPPER_PICK = 'copper_mining_pick';
const IRON_PICK = 'iron_mining_pick';
const MITHRIL_PICK = 'mithril_mining_pick';
const SICKLE = 'gathering_sickle';
const HANDAXE = 'handaxe';

/**
 * The wield ladder, out of the shipped table rather than written here.
 *
 * These five numbers are pinned by the GAME's own suite against its live gain curve, so a
 * curve retune moves them, and a case asserting on 40 by hand would then be asserting that
 * the addon still applies a rung the game has retired.
 */
const WIELD_BY_TIER = (JSON.parse(TABLE_TEXT) as { wieldByTier: { 2: number; 3: number } })
  .wieldByTier;

/** How much counter is one gain tier, out of the table for the reason the ladder is. */
const GAIN_STEP = (JSON.parse(TABLE_TEXT) as { gain: { step: number } }).gain.step;
/**
 * How many gain tiers above a node's own you have to be before it pays nothing at all.
 *
 * Three, from the game's four-state curve: at, one below, two below, then zero. Written here
 * rather than read, because it is the SHAPE of the curve rather than a tuning figure, and the
 * table carries the two multipliers rather than the count of them.
 */
const GRAY_STEPS = 3;

/** A full gathering kit at tier 1, which is what opens 138 of the game's 156 nodes. */
const TIER_1_KIT = [
  { itemId: COPPER_PICK, count: 1 },
  { itemId: HANDAXE, count: 1 },
  { itemId: SICKLE, count: 1 },
];

const PLAYER_HEIGHT = 5;
/** A height nothing else in a case uses, so a sampled pin cannot pass by accident. */
const MOB_HEIGHT = 11;

type Fake = Record<string, unknown>;

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

/** Let the table read, the frame restore and the per-character read all land. */
function settle(): Promise<void> {
  let done = Promise.resolve();
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    done = done.then(() => undefined);
  }
  return done;
}

/**
 * Write a field on a live entity. A computed access, because the fixture is a
 * `Record<string, unknown>`: the linter wants dot access on a literal key and the compiler
 * forbids it on an index signature.
 */
function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

function rowFor(id: string): HTMLElement | null {
  return document.querySelector(`.woc-vs-row[data-node="${id}"]`);
}

function stackFor(id: string): HTMLElement | null {
  return document.querySelector(`.woc-vs-stack[data-node="${id}"]`);
}

function textIn(id: string, selector: string): string {
  return rowFor(id)?.querySelector(selector)?.textContent ?? '';
}

/**
 * One data attribute off an element the addon wrote. The attribute rather than `dataset`,
 * because that is an index signature: the linter refuses the bracket form on it and the compiler
 * refuses the dotted one.
 */
function dataOf(el: HTMLElement | null, name: string): string {
  return el?.getAttribute(`data-${name}`) ?? '';
}

/** A node id the shipped table does not carry, for the cases about one arriving. */
const UNKNOWN_NODE = 'not_a_node';

/** Everything the addon warned about, which is where a dropped table row is named. */
function warnings(harness: SharedHarness): string[] {
  return harness.shared.logs
    .tail(FQID)
    .filter((entry) => entry.level === 'warn')
    .map((entry) => entry.text);
}

/** The per-character key the harvested heights are supposed to land under. */
function storedHeights(storage: FakeStorage): unknown {
  const dumped = storage.dump();
  return dumped[`${characterNamespace(FQID)}/${perCharacterKey(CHANNEL, CHARACTER, STORE_KEY)}`];
}

interface TableRow {
  id: string;
  [field: string]: unknown;
}

/**
 * The shipped table with one node row broken, as a hand edit would leave it. Built from the real
 * file so a case about a bad row is a case about this table with one field wrong.
 */
function doctored(id: string, patch: Record<string, unknown>): string {
  const file = JSON.parse(TABLE_TEXT) as { nodes: TableRow[] };
  const nodes = file.nodes.map((node) => {
    if (node.id !== id) {
      return node;
    }
    return { ...node, ...patch };
  });
  return JSON.stringify({ ...file, nodes });
}

interface Bag {
  itemId: string;
  count: number;
}

/** The bags the world hands over: a copy, or null for bags that cannot be read. */
function bagsFrom(carried: readonly Bag[] | null | undefined): Bag[] | null {
  if (carried === null) {
    return null;
  }
  return [...(carried ?? [])];
}

interface StartOpts {
  at?: { x: number; z: number };
  /** Which way they are facing, in radians, 0 being +Z. */
  facing?: number;
  /** What is in the bags. Null is bags the loader cannot read, which is not empty. */
  bags?: readonly Bag[] | null;
  /**
   * Your gathering counters, by profession id.
   *
   * Absent is a character who has gathered nothing, which is a real zero and locks every
   * tool above the first. Null is the sheet not having arrived at all, which is before
   * world entry and is a different answer.
   */
  proficiency?: Record<string, number> | null;
  /**
   * The tool effects slotted onto your gathering tools.
   *
   * Absent is the ordinary case: the game elides the wire key for anyone who has never
   * slotted one, which is most players, so the loader answers an empty array.
   */
  slots?: readonly { professionId: string; effectId: string; charges: number }[];
  /** Node id to seconds left on YOUR timer. A node with no entry is ready. */
  cooling?: Record<string, number>;
  table?: string;
}

interface VeinsightHarness extends SharedHarness {
  storage: FakeStorage;
  /** Walk the player somewhere. Copied, because the game mutates `pos` in place. */
  walkTo: (x: number, z: number) => void;
  /** Turn on the spot, which is the only thing a bearing is measured against. */
  faceTo: (radians: number) => void;
  /** Put a mob in the world, at a height nothing else in a case uses. */
  stand: (id: number, x: number, z: number, y?: number) => void;
  despawn: (id: number) => void;
  /** Put something in the bags, which is what the tool gate reads. */
  carry: (...itemIds: readonly string[]) => void;
  /** Move a gathering counter, which is what a harvest does and what a wield rung reads. */
  learn: (professionId: string, value: number) => void;
  cool: (nodeId: string, seconds: number) => void;
  ready: (nodeId: string) => void;
  /** A completed harvest off the socket, which is what measures a node's height. */
  harvest: (nodeId: string) => void;
  /** A gather cast starting, which carries the type and no node id at all. */
  castOn: (nodeType: string, entityId?: number) => void;
  /** Become somebody else, which is what `world.characterKey` is derived from. */
  becomeCharacter: (name: string) => void;
  /** Publish a zone the way a zone addon would, from an addon that is not this one. */
  publishZone: (id: string) => void;
  /** Publish a refusal, which is what a publisher sends outside the open world. */
  publishNoZone: (place: string) => void;
  /** Re-read the world, which is what turns a set change into a handler call. */
  poll: () => void;
  /** Run the once-a-second redraw. */
  tick: () => void;
  /** Move both clocks this far and let every redraw in between run. */
  wait: (seconds: number) => void;
  /** Run one frame of the loader's own loop, which is where the route line is laid out. */
  frame: () => void;
  /** Point `ui.project` at a camera, so a route leg has a real length to take. */
  camera: () => void;
  /** The node ids with a row, in the order they are drawn. */
  drawn: () => string[];
  /** The node ids with a pin in the world. */
  pinned: () => string[];
  /** The node ids the route line joins, in order. */
  route: () => string[];
  /** One row's right-hand figure. */
  figureOf: (id: string) => string;
  /**
   * What the tooltip says over one row, or '' when nothing is described.
   *
   * The hidden check matters: there is one tooltip element for the whole loader and it
   * stays in the document holding its last text, so reading `textContent` alone would
   * report the previous row's answer for a row that has none.
   */
  tipOf: (id: string) => string;
  /** The art on one row, which is what the harvest would actually hand you. */
  iconOf: (id: string) => string;
  /** The same answer on the pin, which has a 40px square to say it in. */
  pinFigureOf: (id: string) => string;
  /** One row's fill, as a percentage. A number, because the arithmetic is real. */
  fillOf: (id: string) => number;
  /** One row's second line. */
  detailOf: (id: string) => string;
  /** Whether the player could harvest one node from where they are standing. */
  reachOf: (id: string) => string;
  /** Which of the three ways one pin's height was worked out. */
  heightOf: (id: string) => string;
  /** Every class on one row, so a tone can be read off it. */
  classesOf: (id: string) => string[];
  /** What the panel says about itself, above the rows. */
  note: () => string;
  /** How long one route leg is drawn, in pixels. */
  legWidth: (toId: string) => string;
}

const ACROSS = 10;
const UP = 4;
const ORIGIN_X = 400;
const ORIGIN_Y = 300;

/** A camera over the floor: world x runs across the screen and world z runs up it. */
function overheadCamera() {
  return (x: number, _y: number, z: number) => ({
    x: ORIGIN_X + x * ACROSS,
    y: ORIGIN_Y - z * UP,
    depth: 20,
    behind: false,
  });
}

/**
 * Start the addon over a world holding nothing but the player. `nodeCooldowns` is a real Map
 * because the loader's own watch signature refuses anything else, and an empty one is what a
 * character who has harvested nothing holds. `inventory` is an array for the same reason.
 */
async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
  opts: StartOpts = {},
): Promise<VeinsightHarness> {
  const where = opts.at ?? ORE_1;
  const player = liveEntity({
    set: {
      templateId: 'hunter',
      kind: 'player',
      pos: { x: where.x, y: PLAYER_HEIGHT, z: where.z },
      facing: opts.facing ?? 0,
    },
  });
  const entities = new Map<number, Fake>([[PLAYER_ID, player]]);
  const cooldowns = new Map<string, number>(Object.entries(opts.cooling ?? {}));
  const bags = bagsFrom(opts.bags);
  // A plain record, and a fresh one on every change rather than a mutated one: the loader's
  // own watch signature counts the entries it holds, so a counter raised in place would be
  // read back correctly and would notify nobody.
  const gathering: { value: Record<string, number> | null } = { value: opts.proficiency ?? {} };
  if (opts.proficiency === null) {
    gathering.value = null;
  }
  const world = {
    entities,
    player,
    known: [],
    inventory: bags,
    nodeCooldowns: cooldowns,
    get gatheringProficiency() {
      return gathering.value;
    },
    toolEffectSlots: (opts.slots ?? []).map((slot) => ({
      ...slot,
      maxCharges: 20,
      confirmMode: 'always',
      selfCrafted: true,
    })),
  };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    storage,
    settings,
    data: { [DATA_FILE]: opts.table ?? TABLE_TEXT },
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  return {
    ...harness,
    storage,
    walkTo: (x, z) => {
      setField(player, 'pos', { x, y: PLAYER_HEIGHT, z });
    },
    faceTo: (radians) => {
      setField(player, 'facing', radians);
    },
    stand: (id, x, z, y = MOB_HEIGHT) => {
      entities.set(
        id,
        liveEntity({ set: { id, kind: 'mob', templateId: 'boar', pos: { x, y, z } } }),
      );
    },
    despawn: (id) => {
      entities.delete(id);
    },
    carry: (...itemIds) => {
      for (const itemId of itemIds) {
        bags?.push({ itemId, count: 1 });
      }
    },
    learn: (professionId, value) => {
      gathering.value = { ...gathering.value, [professionId]: value };
    },
    cool: (nodeId, seconds) => {
      cooldowns.set(nodeId, seconds);
    },
    ready: (nodeId) => {
      cooldowns.delete(nodeId);
    },
    harvest: (nodeId) => {
      harness.inbound(
        eventsFrame([
          {
            type: 'gatherResult',
            nodeId,
            nodeType: 'ore',
            professionId: 'mining',
            itemId: 'copper_ore',
            rarity: 'common',
            qty: 1,
            rareEvent: null,
          },
        ]),
      );
    },
    castOn: (nodeType, entityId = PLAYER_ID) => {
      harness.inbound(
        eventsFrame([
          { type: 'castStart', entityId, ability: 'gather', time: 2.5, gatherNodeType: nodeType },
        ]),
      );
    },
    becomeCharacter: (name) => {
      setField(player, 'name', name);
    },
    publishZone: (id) => {
      // The shape a real publisher sends, which is one set of keys in every state: `place`
      // says whether there is a zone at all and the other three are null when there is not.
      // Written out rather than trimmed to the `id` this addon reads, so a fixture cannot
      // go on describing a payload nobody emits.
      harness.shared.bus.emit('official/wayfarer', 'zone', {
        place: 'zone',
        id,
        name: id,
        levelRange: { min: 1, max: 7 },
      });
    },
    publishNoZone: (place) => {
      harness.shared.bus.emit('official/wayfarer', 'zone', {
        place,
        id: null,
        name: null,
        levelRange: null,
      });
    },
    poll: () => harness.shared.world.watcher.poll(),
    tick: () => {
      vi.advanceTimersByTime(TICK_MS);
    },
    wait: (seconds) => {
      // Both, because they are separate: `advance` moves what `woc.now()` answers
      // and the fake timers move the interval that redraws against it.
      harness.advance(seconds * TICK_MS);
      vi.advanceTimersByTime(seconds * TICK_MS);
    },
    frame: () => harness.frames.tick(),
    camera: () => {
      harness.shared.kit.project = overheadCamera();
    },
    drawn: () =>
      [...document.querySelectorAll('.woc-vs-row')].map((el) => el.getAttribute('data-node') ?? ''),
    pinned: () =>
      [...document.querySelectorAll('.woc-vs-stack')].map(
        (el) => el.getAttribute('data-node') ?? '',
      ),
    route: () =>
      [...document.querySelectorAll('.woc-vs-leg')].map((el) => el.getAttribute('data-to') ?? ''),
    figureOf: (id) => textIn(id, '.woc-bar-value'),
    tipOf: (id) => {
      rowFor(id)?.dispatchEvent(new Event('pointerenter'));
      const tip = document.getElementById('woc-tooltip');
      if (tip === null || tip.hidden) {
        return '';
      }
      return tip.textContent ?? '';
    },
    iconOf: (id) => rowFor(id)?.querySelector('img')?.getAttribute('src') ?? '',
    pinFigureOf: (id) => stackFor(id)?.querySelector('.woc-tile-value')?.textContent ?? '',
    fillOf: (id) =>
      Number.parseFloat(rowFor(id)?.querySelector<HTMLElement>('.woc-bar-fill')?.style.width ?? ''),
    detailOf: (id) => textIn(id, '.woc-bar-detail'),
    reachOf: (id) => dataOf(rowFor(id), 'reach'),
    heightOf: (id) => dataOf(stackFor(id), 'height'),
    classesOf: (id) => [...(rowFor(id)?.classList ?? [])],
    note: () => document.querySelector('.woc-vs-note')?.textContent ?? '',
    legWidth: (toId) =>
      document.querySelector<HTMLElement>(`.woc-vs-leg[data-to="${toId}"]`)?.style.width ?? '',
  };
}

/**
 * `start`, plus the wait for the panel to come up and one draw in it. A frame that saves its
 * state starts hidden and is shown once that state arrives, keyed per character, and this addon
 * draws nothing while it is hidden.
 */
async function run(
  settings: Record<string, unknown> = {},
  storage?: FakeStorage,
  opts?: StartOpts,
): Promise<VeinsightHarness> {
  const harness = await start(settings, storage, opts);
  harness.poll();
  await settle();
  harness.tick();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // Every one of these is spent. The socket for the harvest result and the gather
  // cast, the world for the timers, the position and the bags, storage for the
  // measured heights, ui for the panel and the pins, keys for the toggle. There is
  // no sound: this addon never interrupts anybody.
  it('asks for exactly what it uses', () => {
    expect(manifest().permissions).toEqual(['net.read', 'world.read', 'ui', 'storage', 'keys']);
  });

  // An older loader strips an unknown manifest key rather than refusing it, so
  // without the minor this addon would install on a loader with no `woc.data`,
  // start, and find that the only content file it has does not exist.
  it('declares the table file and the minor that reads it', () => {
    expect(manifest().data).toEqual([DATA_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  // A note rather than a dependency: the zone filter degrades to every zone when
  // nothing is publishing, and the panel says so.
  it('names the zone publisher as a companion rather than requiring one', () => {
    expect(manifest().companions).toEqual(['wayfarer']);
  });

  it('binds the toggle where the roadmap says', () => {
    expect(manifest().keybinds?.[0]?.default).toBe('Alt+KeyV');
  });
});

// The join, and the reason the addon has a data file at all. Nothing on the wire says a node
// exists; the only thing that can put a marker on one is the table agreeing with the player's
// own position.
describe('the join between the table and the world', () => {
  it('pins the node the player is standing on', async () => {
    const h = await run({}, undefined, { at: ORE_1 });

    expect(h.drawn()[0]).toBe(ORE_1.id);
    expect(h.pinned()).toContain(ORE_1.id);
    expect(h.detailOf(ORE_1.id)).toContain('0 yd');
    expect(h.reachOf(ORE_1.id)).toBe('true');
  });

  // Offset on x rather than on z, deliberately: a distance taken on one axis reads
  // as standing on the node from the other, and the pin would then be placed on a
  // point the player is nowhere near.
  it('says a node ten yards off is not in reach', async () => {
    const h = await run({}, undefined, { at: { x: ORE_1.x + 10, z: ORE_1.z } });

    expect(h.detailOf(ORE_1.id)).toContain('10 yd');
    expect(h.reachOf(ORE_1.id)).toBe('false');
  });

  it('draws the nodes in range nearest first', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    expect(h.drawn()).toEqual(NEAR_ORE_1);
  });

  it('draws nothing for a zone the player is nowhere near', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    expect(h.drawn()).not.toContain(ORE_T2.id);
  });

  it('follows the draw distance rather than a zone boundary', async () => {
    const h = await run({ 'list-length': 20, 'draw-distance': 20 }, undefined, { at: ORE_1 });

    expect(h.drawn()).toEqual([ORE_1.id, ORE_2.id, ORE_3.id, ORE_6.id, 'ore_eastbrook_5']);
  });
});

// The half the wire does answer, and it answers it completely: per player, off the
// snapshot, keyed by the same ids the table carries.
describe('the respawn timers', () => {
  it('reads a node with no entry as yours', async () => {
    const h = await run({}, undefined, { at: ORE_1, bags: TIER_1_KIT });

    expect(h.figureOf(ORE_1.id)).toBe('Yours');
    expect(h.fillOf(ORE_1.id)).toBe(0);
  });

  it("counts a cooling node down against the game's own respawn length", async () => {
    const h = await run({}, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_1.id]: 90 },
    });

    expect(h.figureOf(ORE_1.id)).toBe('1m 30s');
    expect(h.fillOf(ORE_1.id)).toBeCloseTo((90 / RESPAWN_SECONDS) * 100, 1);
  });

  // The respawn length is the game's number rather than this addon's, and taking it off the
  // shipped table is what stops a tune leaving a constant behind. With the addon holding 120
  // while the game counts down from 240, every node with more than two minutes left draws a full
  // bar that does not move for the whole first half of the wait, which reads as "nothing is
  // happening yet".
  it('takes the respawn length from the table rather than a constant of its own', async () => {
    expect(RESPAWN_SECONDS).toBe(240);

    const h = await run({}, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_1.id]: 180 },
    });

    expect(h.figureOf(ORE_1.id)).toBe('3m 0s');
    expect(h.fillOf(ORE_1.id)).toBeCloseTo(75, 1);
  });

  // A tune the other way is the case a clamp hides: with the addon reading a longer respawn than
  // the game uses, every bar would start part-full and nothing would look broken. So the fill is
  // pinned at the top of the range too.
  it('draws a freshly harvested node as a full bar', async () => {
    const h = await run({}, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_1.id]: RESPAWN_SECONDS },
    });

    expect(h.fillOf(ORE_1.id)).toBeCloseTo(100, 1);
  });

  it('goes warm as a node comes back', async () => {
    const h = await run({}, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_1.id]: 10 },
    });

    expect(h.classesOf(ORE_1.id)).toContain('woc-bar-warn');
    expect(h.figureOf(ORE_1.id)).toBe('10s');
  });

  it('is yours again the moment the key leaves the map', async () => {
    const h = await run({}, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_1.id]: 10 },
    });

    h.ready(ORE_1.id);
    h.poll();

    expect(h.figureOf(ORE_1.id)).toBe('Yours');
  });

  // The set changing is the signal. Nothing subscribes to the seconds, because
  // `world.on` reports the key set and the countdown is read off the clock.
  it('redraws when a node starts cooling without anything else moving', async () => {
    const h = await run({}, undefined, { at: ORE_1, bags: TIER_1_KIT });

    h.cool(ORE_1.id, 120);
    h.poll();

    expect(h.figureOf(ORE_1.id)).toBe('2m 0s');
  });

  // A pin is a 40px square and a row is 300px wide, so the same answer is written twice in two
  // units. Text that does not fit a tile is not clipped by it: the browser wraps it and paints
  // the second line over the world. Seconds rather than a rounded minute, because a respawn is
  // 120 of them and `2m` would stand for a quarter of the whole range.
  it('writes the pin countdown in seconds where the row spells out the minutes', async () => {
    const h = await run({}, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_1.id]: 83 },
    });

    expect(h.figureOf(ORE_1.id)).toBe('1m 23s');
    expect(h.pinFigureOf(ORE_1.id)).toBe('83s');
  });

  it('says the state in full on both, because a state is not a length', async () => {
    const h = await run({}, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_2.id]: 30 },
    });

    expect(h.pinFigureOf(ORE_1.id)).toBe('Yours');
    expect(h.pinFigureOf(ORE_2.id)).toBe('30s');
  });

  it('ignores a timer for a node the table does not carry', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      cooling: Object.fromEntries([[UNKNOWN_NODE, 60]]),
    });

    expect(h.drawn()).toEqual(NEAR_ORE_1);
  });
});

// The gate the game actually applies, which is the tools in your bags rather than your skill at
// the profession. A tier-2 node is unopenable with a tier-1 pick however good a miner you are.
describe('the tool gate', () => {
  // Bare hands harvest nothing at all in this game, so an empty bag is not a
  // partial answer: every node in the world is shut, including a tier-1 one.
  it('shuts every node when you carry no tool at all', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    expect(h.figureOf(ORE_1.id)).toBe('Tool');
    expect(h.figureOf(WOOD_2.id)).toBe('Tool');
  });

  // Bags nobody can read look exactly like bags with nothing in them, and only one of those is a
  // claim this addon is entitled to make.
  it('applies no gate at all while the bags cannot be read', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1, bags: null });

    expect(h.figureOf(ORE_1.id)).toBe('Yours');
    expect(h.note()).toContain('Your bags cannot be read');
  });

  it('refuses a tier the tools cannot cover', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: COPPER_PICK, count: 1 }],
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Tool');
  });

  it('opens that tier once a tool covering it is carried AND wields', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Yours');
  });

  // The join is per node type, and the case has to be a node the tool's own tier would otherwise
  // cover: a sickle is tier 1 and so is this ore vein, so the only thing that can refuse it is
  // the type. A single "best tool tier" number would open it.
  it('does not let a herb tool open an ore vein of the same tier', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: [{ itemId: SICKLE, count: 1 }],
    });

    expect(h.figureOf(ORE_1.id)).toBe('Tool');
    expect(h.figureOf(HERB_1.id)).toBe('Yours');
  });

  it('hides what your tools cannot open when asked to', async () => {
    const h = await run(
      { 'draw-distance': 400, 'list-length': 20, 'above-tier': false },
      undefined,
      { at: { x: ORE_T2.x, z: ORE_T2.z }, bags: [{ itemId: COPPER_PICK, count: 1 }] },
    );

    expect(h.drawn()).not.toContain(ORE_T2.id);
  });

  it('reads the bags again when something lands in them', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: COPPER_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    h.carry(IRON_PICK);
    h.poll();

    expect(h.figureOf(ORE_T2.id)).toBe('Yours');
  });
});

/**
 * The second half of the gate, and the half this addon spent three versions getting wrong.
 *
 * Owning a tool and being able to swing it are different facts: every tier above the first
 * demands a gathering counter before the game's own harvest command will accept it. A panel
 * reading ownership alone offers a mithril pick's owner every vein in the world and the
 * server refuses them at all of them, while the game's own minimap draws the lock.
 */
describe('the wield gate', () => {
  it('refuses a covering tool the counter cannot swing yet', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] - 1 },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Skill');
  });

  // The case that motivated the whole rewrite: a tool three tiers up, bought or traded ahead,
  // opens NOTHING at all. Under the old ownership scan every node in the game read as open.
  it('leaves a tier-1 node shut to an unearned tier-3 pick', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: [{ itemId: MITHRIL_PICK, count: 1 }],
    });

    expect(h.figureOf(ORE_1.id)).toBe('Skill');
  });

  // Two different situations and two different words. `Tool` is a trip to a vendor and
  // `Skill` is a stretch of gathering with what is already in the bags, and only the second
  // is something a player can act on where they are standing.
  it('says Tool rather than Skill when nothing carried covers the tier', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: COPPER_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[3] },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Tool');
  });

  // The rung named is the cheapest one that would put something ALREADY CARRIED to work.
  // Naming the node's own tier instead would tell a player who carries only the tier-3 pick
  // that 40 opens this, which unlocks nothing they own.
  it('names the rung a tool in the bags would actually wield at', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: MITHRIL_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Skill');
    expect(h.tipOf(ORE_T2.id)).toContain(`wields at ${String(WIELD_BY_TIER[3])} mining`);
  });

  // A harvest moves the counter, and crossing a rung opens every node of a tier at once with
  // nothing else on screen moving to explain it.
  it('redraws when the counter crosses a rung', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] - 1 },
    });
    expect(h.figureOf(ORE_T2.id)).toBe('Skill');

    h.learn('mining', WIELD_BY_TIER[2]);
    h.poll();

    expect(h.figureOf(ORE_T2.id)).toBe('Yours');
  });

  // FAIL CLOSED, which is the game's own direction: `coerceProficiency` reads an absent or
  // malformed counter as zero, and zero locks every tool above the first. Guessing the other
  // way would offer nodes the server refuses, which is the failure this whole gate is about.
  // The sheet itself arrives with the player, so a drawn row always has a counter to read:
  // this is the map inside it being unreadable, not the sheet being absent.
  it('locks rather than opens when the counter map cannot be read', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: null,
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Skill');
  });

  // A sheet that HAS arrived carrying nothing for the profession is a real zero, which is what
  // the game's own read coerces an absent counter to.
  it('reads a sheet with no counter for the profession as zero', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { logging: WIELD_BY_TIER[3] },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Skill');
  });

  it('hides an unearned node when asked to', async () => {
    const h = await run(
      { 'draw-distance': 400, 'list-length': 20, 'above-tier': false },
      undefined,
      { at: { x: ORE_T2.x, z: ORE_T2.z }, bags: [{ itemId: IRON_PICK, count: 1 }] },
    );

    expect(h.drawn()).not.toContain(ORE_T2.id);
  });
});

// The one thing here that is never a fact. Every pin stands at a height the addon
// worked out, and which of the three ways it did that is on the pin itself.
describe('the height under a node', () => {
  it('guesses from the player when nothing is standing near the point', async () => {
    const h = await run({}, undefined, { at: ORE_1 });

    expect(h.heightOf(HERB_1.id)).toBe('guessed');
  });

  it('samples a nearby entity, because a mob stands on the ground', async () => {
    const h = await start({}, undefined, { at: ORE_1 });
    h.stand(500, HERB_1.x, HERB_1.z);
    h.poll();
    await settle();
    h.tick();

    expect(h.heightOf(HERB_1.id)).toBe('sampled');
  });

  it('does not sample something standing twenty yards off', async () => {
    const h = await start({}, undefined, { at: ORE_1 });
    h.stand(500, HERB_1.x + 20, HERB_1.z);
    h.poll();
    await settle();
    h.tick();

    expect(h.heightOf(HERB_1.id)).toBe('guessed');
  });

  it('measures the height off a harvest of that node', async () => {
    const h = await run({}, undefined, { at: ORE_1 });

    h.harvest(ORE_1.id);

    expect(h.heightOf(ORE_1.id)).toBe('harvested');
  });

  it('writes a measured height down under this character', async () => {
    const storage = createFakeStorage();
    const h = await run({}, storage, { at: ORE_1 });

    h.harvest(ORE_1.id);
    await settle();

    expect(storedHeights(storage)).toEqual({ [ORE_1.id]: PLAYER_HEIGHT });
  });

  it('stores nothing for a harvest of a node the table does not carry', async () => {
    const storage = createFakeStorage();
    const h = await run({}, storage, { at: ORE_1 });

    h.harvest(UNKNOWN_NODE);
    await settle();

    expect(storedHeights(storage)).toBeUndefined();
  });

  // The measurement is what makes the pin exact, so it has to outlive the session that made it.
  // A second addon over the same storage is the only honest way to test that.
  it('takes a measured height back on the next session', async () => {
    const storage = createFakeStorage();
    const first = await run({}, storage, { at: ORE_1 });
    first.harvest(ORE_1.id);
    await settle();
    first.dispose();
    document.body.innerHTML = '';

    const second = await run({}, storage, { at: ORE_1 });

    expect(second.heightOf(ORE_1.id)).toBe('harvested');
  });

  // A sample belongs to the session that took it, so a character switch inside one
  // page load has to drop it: nothing else forces this addon to start again, and a
  // height captured for whoever was playing a moment ago would otherwise stand.
  it('drops a sampled height when the player becomes somebody else', async () => {
    const h = await start({}, undefined, { at: ORE_1 });
    h.stand(500, HERB_1.x, HERB_1.z);
    h.poll();
    await settle();
    h.tick();
    expect(h.heightOf(HERB_1.id)).toBe('sampled');

    h.despawn(500);
    h.becomeCharacter('Somebody Else');
    h.poll();
    await settle();
    h.tick();

    expect(h.heightOf(HERB_1.id)).toBe('guessed');
  });

  // The mirror of it: with nothing switching, a sample is captured ONCE and is not
  // re-taken when the thing that supplied it walks off.
  it('keeps a sampled height after the entity that supplied it leaves', async () => {
    const h = await start({}, undefined, { at: ORE_1 });
    h.stand(500, HERB_1.x, HERB_1.z);
    h.poll();
    await settle();
    h.tick();

    h.despawn(500);
    h.poll();
    h.tick();

    expect(h.heightOf(HERB_1.id)).toBe('sampled');
  });
});

// An empty list is never a measurement of zero, and a capped one is never the whole
// answer. Both have to say which they are.
describe('what it says about itself', () => {
  it('says why the list is empty rather than drawing an empty box', async () => {
    const h = await run({ 'draw-distance': 20 }, undefined, { at: { x: 0, z: 0 } });

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toContain('No node within 20 yd');
  });

  it('names the number it is not showing', async () => {
    const h = await run({ 'list-length': 3 }, undefined, { at: ORE_1 });

    expect(h.drawn()).toHaveLength(3);
    expect(h.note()).toContain('9 more in range');
  });

  it('says every type is off rather than reading as nothing being there', async () => {
    const h = await run({ 'show-ore': false, 'show-wood': false, 'show-herb': false }, undefined, {
      at: ORE_1,
    });

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toContain('switched off');
  });

  it("states that the timers are the player's own when there is nothing else to say", async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    expect(h.note()).toContain('yours alone');
  });

  it('says a harvest is under way without claiming which node it is of', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    h.castOn('ore');

    expect(h.note()).toContain('Harvesting ore vein');
  });

  // `castStart` is a broadcast rather than a personal record, so the miner standing
  // next to you emits one too, and the note would otherwise be about them.
  it("does not report somebody else's harvest as the player's own", async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    h.castOn('ore', OTHER_PLAYER);

    expect(h.note()).not.toContain('arvesting ore');
  });

  // An interrupted cast emits no result at all, so nothing else would ever take the
  // note down: a display that says a harvest is running forever is worse than one
  // that never mentioned it.
  it('stops saying so once the cast can no longer be running', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });
    h.castOn('ore');
    expect(h.note()).toContain('Harvesting ore vein');

    h.wait(3);

    expect(h.note()).not.toContain('arvesting ore');
  });
});

describe('the type filters', () => {
  it('drops a type the player switched off', async () => {
    const h = await run({ 'list-length': 20, 'show-wood': false }, undefined, { at: ORE_1 });

    expect(h.drawn().filter((id) => id.startsWith('wood'))).toEqual([]);
    expect(h.drawn()).toContain(ORE_1.id);
  });
});

// Nothing in the loader can say which zone the player is in. Every node row carries its own, so
// the filter is one bus message away and says so in words when nobody is sending one.
describe('the zone filter', () => {
  it('lists every zone and says why when nothing is publishing', async () => {
    const h = await run({ 'list-length': 20, 'this-zone-only': true }, undefined, { at: ORE_1 });

    expect(h.drawn()).toEqual(NEAR_ORE_1);
    expect(h.note()).toContain('No zone publisher is installed');
  });

  // Standing in Mirefen with Eastbrook published, and the two zones overlap inside
  // 400 yards, so this proves the filter is on the node's own `zoneId` rather than
  // on how far away it is.
  it('filters to the zone a publisher named', async () => {
    const h = await run(
      { 'draw-distance': 400, 'list-length': 20, 'this-zone-only': true },
      undefined,
      { at: { x: ORE_T2.x, z: ORE_T2.z } },
    );
    expect(h.drawn()).toContain(ORE_T2.id);

    h.publishZone('eastbrook_vale');

    expect(h.drawn()).not.toContain(ORE_T2.id);
    expect(h.drawn()).toContain('herb_eastbrook_3');
    expect(h.note()).not.toContain('zone publisher');
  });

  // The refusal half of the same contract, and the case that says this addon survived the
  // publisher's payload changing shape. A publisher outside the open world sends the same
  // keys with a null id rather than a bare null, so the guard here has to turn on the ID
  // being a string and not on the payload being an object: an `instance` record is an
  // object, and read as one it would name a zone called nothing.
  it('ignores a publisher saying there is no zone to name', async () => {
    const h = await run(
      { 'draw-distance': 400, 'list-length': 20, 'this-zone-only': true },
      undefined,
      { at: { x: ORE_T2.x, z: ORE_T2.z } },
    );

    h.publishNoZone('instance');

    // Still the unfiltered list, and still saying nobody has named a zone, which is the
    // same thing the bare null this replaced produced.
    expect(h.drawn()).toContain(ORE_T2.id);
    expect(h.note()).toContain('No zone publisher is installed');
  });

  it('keeps the nodes of a zone a publisher named', async () => {
    const h = await run({ 'list-length': 20, 'this-zone-only': true }, undefined, { at: ORE_1 });

    h.publishZone('eastbrook_vale');

    expect(h.drawn()).toEqual(NEAR_ORE_1);
  });
});

// The only thing here on the frame loop, and the only thing that has to be: a leg's
// length is an answer about the camera rather than about the world.
describe('the route line', () => {
  it('draws none unless it was asked for', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    expect(h.route()).toEqual([]);
  });

  it('joins the nearest nodes that are actually yours', async () => {
    const h = await run({ 'list-length': 20, route: true }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
    });

    expect(h.route()).toEqual([ORE_1.id, ORE_2.id, ORE_3.id, ORE_6.id]);
  });

  it('walks past a node that is still cooling for you', async () => {
    const h = await run({ 'list-length': 20, route: true }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      cooling: { [ORE_2.id]: 60 },
    });

    expect(h.route()).not.toContain(ORE_2.id);
  });

  // Nothing is takeable bare-handed, so there is nowhere to route to and no line is
  // drawn rather than one joining nodes the player cannot open.
  it('draws no line at all when nothing in range can be opened', async () => {
    const h = await run({ 'list-length': 20, route: true }, undefined, { at: ORE_1 });

    expect(h.route()).toEqual([]);
  });

  it('takes a leg its length from the camera rather than from the world', async () => {
    const h = await run({ 'list-length': 20, route: true }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
    });
    h.camera();
    h.frame();

    // ORE_1 to ORE_2 is 3 yards of x and 4 of z, which this camera stretches to 30
    // pixels across and 16 up.
    expect(h.legWidth(ORE_2.id)).toBe(`${String(Math.round(Math.hypot(30, 16)))}px`);
  });
});

describe('the bearing arrow', () => {
  // Facing +Z with the node straight up the z axis, which is straight ahead.
  it('points ahead at a node in front of the player', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: { x: WOOD_2.x, z: WOOD_2.z - 40 },
      facing: 0,
    });

    expect(h.detailOf(WOOD_2.id)).toContain('↑');
  });

  it('points behind at a node the player has ridden past', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: { x: WOOD_2.x, z: WOOD_2.z + 40 },
      facing: 0,
    });

    expect(h.detailOf(WOOD_2.id)).toContain('↓');
  });

  // `facing` grows as the player turns LEFT, so +x is on the left of +z. That is the
  // half of this that is a claim about the game rather than about arithmetic.
  it('puts a node on +x to the left of a player facing +z', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: { x: WOOD_2.x - 40, z: WOOD_2.z },
      facing: 0,
    });

    expect(h.detailOf(WOOD_2.id)).toContain('←');
  });

  // All EIGHT, because four of them is a table nobody has read the other half of, and the
  // failure this section exists for is a table written the other way round: that one agrees
  // at ahead and behind and disagrees at every sector in between.
  //
  // The player stands 40 yards due south of the node, which puts it at a bearing of exactly
  // 0, and then turns left through a full circle 45 degrees at a time. Turning your body
  // left moves the world right, so the arrow steps clockwise through the table.
  it('steps through all eight sectors as the player turns', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: { x: WOOD_2.x, z: WOOD_2.z - 40 },
      facing: 0,
    });
    const eighth = Math.PI / 4;
    const clockwise = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

    for (const [step, arrow] of clockwise.entries()) {
      h.faceTo(step * eighth);
      h.tick();

      expect(h.detailOf(WOOD_2.id)).toContain(arrow);
    }
  });

  it('turns the arrow with the player rather than with the world', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: { x: WOOD_2.x - 40, z: WOOD_2.z },
      facing: Math.PI / 2,
    });

    expect(h.detailOf(WOOD_2.id)).toContain('↑');
  });
});

// The table is a claim `woc.data` hands over as `unknown`, so this is where the
// claim is checked. A hand edit costs the row it broke and nothing else.
describe('the table it was given', () => {
  // The warning as well as the drop, because a row with a coordinate that is not a number falls
  // out of a distance test on its own: without the check it is absent for the wrong reason, and
  // the log line is the only thing that tells them apart.
  it('leaves out a node with no coordinate, says so, and keeps the rest', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      table: doctored(ORE_2.id, { x: 'over there' }),
    });

    expect(h.drawn()).not.toContain(ORE_2.id);
    expect(h.drawn()).toContain(ORE_1.id);
    expect(warnings(h).join('\n')).toContain('nodes.json: node 1 did not check out');
  });

  it('leaves out a tier that is not a number, which nothing else would refuse', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      table: doctored(ORE_2.id, { tier: 'high' }),
    });

    expect(h.drawn()).not.toContain(ORE_2.id);
  });

  it('leaves out a node naming a zone the table does not declare', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      table: doctored(ORE_2.id, { zone: 'atlantis' }),
    });

    expect(h.drawn()).not.toContain(ORE_2.id);
  });

  it('leaves out a node of a type the game does not have', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      table: doctored(ORE_2.id, { type: 'gold' }),
    });

    expect(h.drawn()).not.toContain(ORE_2.id);
  });

  it('draws nothing at all when the file is not a table', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      table: JSON.stringify({ nodes: 'all of them' }),
    });

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toContain('Reading the node table');
  });
});

describe('the panel itself', () => {
  it('takes its pins out of the world when it is hidden', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });
    expect(h.pinned().length).toBeGreaterThan(0);

    h.press('Alt+KeyV');

    expect(h.pinned()).toEqual([]);
    expect(document.querySelector('[data-woc-frame="nodes"]')?.classList).toContain('woc-hidden');
  });

  it('brings them back on the next press', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });
    h.press('Alt+KeyV');

    h.press('Alt+KeyV');

    expect(h.pinned()).toContain(ORE_1.id);
  });
});

/**
 * The second thing the counter buys once it is being read.
 *
 * A node pays proficiency against its own tier: every step of the counter is one gain tier,
 * and a node three tiers below yours pays nothing at all. On a table of 138 tier-1 nodes out
 * of 156 that means most of a circuit quietly stops teaching a gatherer past the third step,
 * with nothing in the game saying so and nothing on screen changing when it happens.
 */
describe('what a node still teaches you', () => {
  it('pays in full at a fresh counter', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1, bags: TIER_1_KIT });

    expect(h.tipOf(ORE_1.id)).toContain('raises your mining by 1');
  });

  it('halves it a gain tier up', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      proficiency: { mining: GAIN_STEP },
    });

    expect(h.tipOf(ORE_1.id)).toContain('raises your mining by 0.5');
  });

  it('says so when a node has stopped teaching you altogether', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      proficiency: { mining: GAIN_STEP * GRAY_STEPS },
    });

    expect(h.tipOf(ORE_1.id)).toContain('No longer raises your mining');
  });

  // Per profession, off the node's own type: a logger's counter says nothing about a vein.
  it('scores each type against its own profession', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      proficiency: { mining: GAIN_STEP * GRAY_STEPS },
    });

    expect(h.tipOf(WOOD_2.id)).toContain('raises your logging by 1');
  });
});

/**
 * What one harvest actually hands you, which is a fact about the zone and your tool rather
 * than about the node: the material is the zone's, and a tool STRICTLY above that material's
 * own rung, at a vein of at least that rung, mints the fine grade instead.
 *
 * The names come out of the table because an id is not a name here: this zone's ore is
 * `thorium_ore` two zones over and the game shows it as "Osmium Ore".
 */
describe('what a node yields you', () => {
  it('names the zone material', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1, bags: TIER_1_KIT });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Copper Ore');
  });

  it('names the fine grade when the tool outclasses the material', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Fine Copper Ore');
  });

  // BOTH arms of the rule, and this is the one a "better tool, better yield" reading misses:
  // the vein has to carry the material's own rung. A tier-1 vein in a rung-2 zone stays plain
  // however good the pick is, which is what keeps the base material gatherable at all.
  it('keeps the plain grade at a vein below the material rung', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: ORE_MIREFEN_T1,
      bags: [{ itemId: MITHRIL_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[3] },
    });

    expect(h.tipOf(ORE_MIREFEN_T1.id)).toContain('Yields Iron Ore');
  });

  // The case this addon used to DISCLOSE it could not answer, and now answers. A tool
  // sitting exactly on the material's rung mints the plain grade alone and the fine one
  // with a quality charm, which is the whole of what `world.professions.toolEffectSlots`
  // added at apiMinor 5. Nothing is disclosed any more, because nothing is unknown.
  it('names the fine grade when a quality charm carries the tool past the rung', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'mining', effectId: 'artisans_eye', charges: 5 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Fine Copper Ore');
    expect(h.tipOf(ORE_1.id)).not.toContain('slotted quality effect');
  });

  // A spent slot stays on the wire at 0 and contributes nothing, which is exactly what the
  // game's own bonus rule does with it. Reading the slot's presence rather than its charges
  // would promise a grade the harvest does not hand over.
  it('keeps the plain grade when the charm has no charges left', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'mining', effectId: 'artisans_eye', charges: 0 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Copper Ore');
  });

  // Only the QUALITY kind touches this comparison. A quantity charm is a real slot on the
  // same tool and adds units rather than grade, so folding it in would name a grade the
  // harvest never mints.
  it('keeps the plain grade for a charm of another kind', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'mining', effectId: 'gatherers_cache', charges: 5 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Copper Ore');
  });

  // A charm on a different tool. The slot list is one row per profession, so matching on
  // anything less than the profession id would let a herbalist's charm upgrade ore.
  it('ignores a charm slotted on another profession tool', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'herbalism', effectId: 'artisans_eye', charges: 5 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Copper Ore');
  });

  // The game suppresses a quality charm outright where the fine grade is out of reach at
  // this node's tier, so the charm must not carry a vein below the material rung either.
  it('keeps the plain grade at a vein below the rung even with a charm', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: ORE_MIREFEN_T1,
      bags: [{ itemId: MITHRIL_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[3] },
      slots: [{ professionId: 'mining', effectId: 'artisans_eye', charges: 5 }],
    });

    expect(h.tipOf(ORE_MIREFEN_T1.id)).toContain('Yields Iron Ore');
  });

  it('says nothing about an effect once the tool is past the rung', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    expect(h.tipOf(ORE_1.id)).not.toContain('slotted quality effect');
  });

  // The art moves with the grade, so a tool good enough to mint the fine one changes the
  // picture as well as the sentence.
  it('draws the yield art on the row, at the grade it would actually hand you', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    expect(h.iconOf(ORE_1.id)).toContain('fine_copper_ore');
  });
});
