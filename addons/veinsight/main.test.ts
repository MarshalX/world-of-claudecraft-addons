// @vitest-environment happy-dom

// Veinsight, run through the real loader. Fixtures come from the shipped `nodes.json`, never a
// stub. The suite cannot see where an anchor lands on screen or a real terrain height, so pins
// are asserted by what they are and the three height provenances by their inputs.

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
 * The highest minor anything this addon reads: `world.professions.toolEffectSlots` is 5 and
 * `resizable: 'width'` is 6, which an older loader reads as truthy and resizes both axes.
 */
const NEEDS_MINOR = 6;

const PLAYER_ID = PLAYER_ENTITY.id;
/** The redraw's period, so advancing this much runs exactly one of them. */
const TICK_MS = 1000;
/** How many microtask turns the table read, the frame restore and the reads want. */
const SETTLE_TURNS = 14;
/**
 * Every fill's denominator, read from the shipped table: a literal here would restate the
 * addon's own number and agree with it whatever the game does.
 */
const RESPAWN_SECONDS = (JSON.parse(TABLE_TEXT) as { respawnSeconds: { ore: number } })
  .respawnSeconds.ore;

/** Rows copied out of `nodes.json`, so a case names a coordinate a reader can check. */
const ORE_1 = { id: 'ore_eastbrook_1', x: -20, z: 153 };
const ORE_2 = { id: 'ore_eastbrook_2', x: -23, z: 157 };
const ORE_3 = { id: 'ore_eastbrook_3', x: -17, z: 149 };
const ORE_6 = { id: 'ore_eastbrook_6', x: -15, z: 137 };
const WOOD_2 = { id: 'wood_eastbrook_2', x: -57, z: -6 };
/** The wood node nearest ORE_1. WOOD_2 is outside the default draw distance from there. */
const WOOD_5 = { id: 'wood_eastbrook_5', x: 7, z: 140 };
const HERB_1 = { id: 'herb_eastbrook_1', x: -58, z: 91 };
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
 * Every node within the default 150 yard draw distance of ORE_1, nearest first. It includes two
 * Mirefen nodes, which is what makes the zone filter cases below real.
 */
const NEAR_ORE_1 = [
  'ore_eastbrook_1',
  'ore_eastbrook_2',
  'ore_eastbrook_3',
  'ore_eastbrook_6',
  'ore_eastbrook_5',
  'ore_eastbrook_4',
  'wood_eastbrook_5',
  'herb_eastbrook_3',
  'wood_eastbrook_4',
  'herb_eastbrook_1',
  'herb_eastbrook_2',
  'wood_mirefen_4',
  'wood_eastbrook_6',
  'herb_mirefen_4',
  'wood_eastbrook_3',
];

/** The tool ids the shipped table files under each type, at the tiers they cover. */
const COPPER_PICK = 'copper_mining_pick';
const IRON_PICK = 'iron_mining_pick';
const MITHRIL_PICK = 'mithril_mining_pick';
const SICKLE = 'gathering_sickle';
const HANDAXE = 'handaxe';

/** The wield ladder, read from the shipped table because a game retune moves it. */
const WIELD_BY_TIER = (JSON.parse(TABLE_TEXT) as { wieldByTier: { 2: number; 3: number } })
  .wieldByTier;

/** How much counter is one gain tier, out of the table for the reason the ladder is. */
const GAIN_STEP = (JSON.parse(TABLE_TEXT) as { gain: { step: number } }).gain.step;
/**
 * Gain tiers above a node's own before it pays nothing. Written here because it is the SHAPE of
 * the game's curve (full, reduced, minimal, zero); the table carries only the multipliers.
 */
const GRAY_STEPS = 3;

/** A full gathering kit at tier 1. */
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
   * Your gathering counters, by profession id. Absent is a real zero, which locks every tool
   * above the first; null is a counter map that cannot be read.
   */
  proficiency?: Record<string, number> | null;
  /** The tool effects slotted onto your gathering tools. Absent is none, as for most players. */
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
   * What the tooltip says over one row, or ''. Checks `hidden`: the loader's one tooltip
   * element keeps its last text, so `textContent` alone reports the previous row.
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
  // Replaced on every change, never mutated: the watch signature counts entries, so a counter
  // raised in place notifies nobody.
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
      // The full payload a real publisher sends, not just the `id` this addon reads.
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
      // Both: `advance` moves `woc.now()` and the fake timers move the redraw interval.
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

  it('asks for exactly what it uses', () => {
    expect(manifest().permissions).toEqual(['net.read', 'world.read', 'ui', 'storage', 'keys']);
  });

  // An older loader strips an unknown `data` key rather than refusing it; the minor gates it.
  it('declares the table file and the minor that reads it', () => {
    expect(manifest().data).toEqual([DATA_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  it('names the zone publisher as a companion rather than requiring one', () => {
    expect(manifest().companions).toEqual(['wayfarer']);
  });

  it('binds the toggle to Alt+V', () => {
    expect(manifest().keybinds?.[0]?.default).toBe('Alt+KeyV');
  });
});

describe('the join between the table and the world', () => {
  it('pins the node the player is standing on', async () => {
    const h = await run({}, undefined, { at: ORE_1 });

    expect(h.drawn()[0]).toBe(ORE_1.id);
    expect(h.pinned()).toContain(ORE_1.id);
    expect(h.detailOf(ORE_1.id)).toContain('0 yd');
    expect(h.reachOf(ORE_1.id)).toBe('true');
  });

  // Offset on x: a distance taken on z alone would read as standing on the node.
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

  // A stale respawn constant shorter than the game's draws a full, unmoving bar for part of the
  // wait, and the clamp hides it.
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

  // Pins the top of the range: a respawn read too long would start every bar part-full.
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

  // `world.on` reports the key set; the countdown itself is read off the clock.
  it('redraws when a node starts cooling without anything else moving', async () => {
    const h = await run({}, undefined, { at: ORE_1, bags: TIER_1_KIT });

    h.cool(ORE_1.id, 120);
    h.poll();

    expect(h.figureOf(ORE_1.id)).toBe('2m 0s');
  });

  // Text that overflows a 40px tile wraps and paints over the world, and a rounded minute would
  // cover a large share of the respawn, so the pin writes bare seconds.
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

describe('the tool gate', () => {
  // Bare hands harvest nothing, so an empty bag shuts even a tier-1 node.
  it('shuts every node when you carry no tool at all', async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    expect(h.figureOf(ORE_1.id)).toBe('Tool');
    expect(h.figureOf(WOOD_5.id)).toBe('Tool');
  });

  // Unreadable bags look like empty ones, and only empty is a claim the addon may make.
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

  // Same tier, different type: a single "best tool tier" number would open it.
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

/** Every tier above the first needs a gathering counter before the game will swing it. */
describe('the wield gate', () => {
  it('refuses a covering tool the counter cannot swing yet', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] - 1 },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Skill');
  });

  // A tool three tiers up with no counter opens nothing, not even tier 1.
  it('leaves a tier-1 node shut to an unearned tier-3 pick', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: [{ itemId: MITHRIL_PICK, count: 1 }],
    });

    expect(h.figureOf(ORE_1.id)).toBe('Skill');
  });

  it('says Tool rather than Skill when nothing carried covers the tier', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: COPPER_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[3] },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Tool');
  });

  // Names the rung of a tool ALREADY CARRIED, never the node's own tier.
  it('names the rung a tool in the bags would actually wield at', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: MITHRIL_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Skill');
    expect(h.tipOf(ORE_T2.id)).toContain(`wields at ${String(WIELD_BY_TIER[3])} mining`);
  });

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

  // Fails closed, as the game's `coerceProficiency` does: an unreadable counter map is zero.
  it('locks rather than opens when the counter map cannot be read', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: { x: ORE_T2.x, z: ORE_T2.z },
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: null,
    });

    expect(h.figureOf(ORE_T2.id)).toBe('Skill');
  });

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

  // A second addon over the same storage stands in for the next session.
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

  // A character switch inside one page load does not restart the addon, so it must drop samples.
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

describe('what it says about itself', () => {
  it('says why the list is empty rather than drawing an empty box', async () => {
    const h = await run({ 'draw-distance': 20 }, undefined, { at: { x: 0, z: 0 } });

    expect(h.drawn()).toEqual([]);
    expect(h.note()).toContain('No node within 20 yd');
  });

  it('names the number it is not showing', async () => {
    const h = await run({ 'list-length': 3 }, undefined, { at: ORE_1 });

    expect(h.drawn()).toHaveLength(3);
    expect(h.note()).toContain('12 more in range');
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

  // `castStart` is a broadcast, so a miner beside you emits one too.
  it("does not report somebody else's harvest as the player's own", async () => {
    const h = await run({ 'list-length': 20 }, undefined, { at: ORE_1 });

    h.castOn('ore', OTHER_PLAYER);

    expect(h.note()).not.toContain('arvesting ore');
  });

  // An interrupted cast emits no result, so the note has to expire on its own.
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

describe('the zone filter', () => {
  it('lists every zone and says why when nothing is publishing', async () => {
    const h = await run({ 'list-length': 20, 'this-zone-only': true }, undefined, { at: ORE_1 });

    expect(h.drawn()).toEqual(NEAR_ORE_1);
    expect(h.note()).toContain('No zone publisher is installed');
  });

  // The zones overlap inside 400 yards, so this proves the filter reads the node's `zoneId`.
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

  // Outside the open world a publisher sends the same keys with a null id, so the guard has to
  // test the ID being a string, not the payload being an object.
  it('ignores a publisher saying there is no zone to name', async () => {
    const h = await run(
      { 'draw-distance': 400, 'list-length': 20, 'this-zone-only': true },
      undefined,
      { at: { x: ORE_T2.x, z: ORE_T2.z } },
    );

    h.publishNoZone('instance');

    expect(h.drawn()).toContain(ORE_T2.id);
    expect(h.note()).toContain('No zone publisher is installed');
  });

  // The two Mirefen nodes in range are what a filter that did nothing would leave in.
  it('keeps the nodes of a zone a publisher named', async () => {
    const h = await run({ 'list-length': 20, 'this-zone-only': true }, undefined, { at: ORE_1 });

    h.publishZone('eastbrook_vale');

    expect(h.drawn()).toEqual(NEAR_ORE_1.filter((id) => !id.includes('mirefen')));
    expect(h.drawn()).not.toContain('wood_mirefen_4');
  });
});

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

  // `facing` grows as the player turns LEFT, so +x is on the left of +z.
  it('puts a node on +x to the left of a player facing +z', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: { x: WOOD_2.x - 40, z: WOOD_2.z },
      facing: 0,
    });

    expect(h.detailOf(WOOD_2.id)).toContain('←');
  });

  // All eight: a mirrored table agrees at ahead and behind and nowhere else. Turning left moves
  // the world right, so the arrow steps clockwise.
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

// A hand edit costs the row it broke and nothing else.
describe('the table it was given', () => {
  // A non-numeric coordinate also falls out of the distance test, so only the warning proves
  // the row was refused for the right reason.
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

/** A node three gain tiers below your counter pays nothing, and the game never says so. */
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

  it('scores each type against its own profession', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      proficiency: { mining: GAIN_STEP * GRAY_STEPS },
    });

    expect(h.tipOf(WOOD_5.id)).toContain('raises your logging by 1');
  });
});

/**
 * The material is the zone's, and a tool STRICTLY above its rung, at a vein of at least that
 * rung, mints the fine grade. Names come from the table because an id is not a display name.
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

  // The arm a "better tool, better yield" reading misses: the vein must carry the rung too.
  it('keeps the plain grade at a vein below the material rung', async () => {
    const h = await run({ 'draw-distance': 400, 'list-length': 20 }, undefined, {
      at: ORE_MIREFEN_T1,
      bags: [{ itemId: MITHRIL_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[3] },
    });

    expect(h.tipOf(ORE_MIREFEN_T1.id)).toContain('Yields Iron Ore');
  });

  // A tool exactly on the rung mints fine only with a quality charm.
  it('names the fine grade when a quality charm carries the tool past the rung', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'mining', effectId: 'artisans_eye', charges: 5 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Fine Copper Ore');
    expect(h.tipOf(ORE_1.id)).not.toContain('slotted quality effect');
  });

  // A spent slot stays on the wire at 0 charges and adds nothing.
  it('keeps the plain grade when the charm has no charges left', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'mining', effectId: 'artisans_eye', charges: 0 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Copper Ore');
  });

  // A quantity charm adds units, not grade.
  it('keeps the plain grade for a charm of another kind', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'mining', effectId: 'gatherers_cache', charges: 5 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Copper Ore');
  });

  // Slots are one row per profession, so the match must be on the profession id.
  it('ignores a charm slotted on another profession tool', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: TIER_1_KIT,
      slots: [{ professionId: 'herbalism', effectId: 'artisans_eye', charges: 5 }],
    });

    expect(h.tipOf(ORE_1.id)).toContain('Yields Copper Ore');
  });

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

  it('draws the yield art on the row, at the grade it would actually hand you', async () => {
    const h = await run({ 'list-length': 20 }, undefined, {
      at: ORE_1,
      bags: [{ itemId: IRON_PICK, count: 1 }],
      proficiency: { mining: WIELD_BY_TIER[2] },
    });

    expect(h.iconOf(ORE_1.id)).toContain('fine_copper_ore');
  });
});
