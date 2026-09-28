// @vitest-environment happy-dom

// Lorebind, run through the real loader. The source ranking is what is under test: which of four
// unequal answers the addon gives for an id, and whether it says which.
//
// Every fixture is a real row of the shipped `items.json`, so a case is about the game's content
// rather than a fixture somebody wrote. The one exception is `LOPSIDED_WARFARE`.
//
// The art name must never win and never be published: it is provenance for a picture, and a
// subscriber taking it off the bus would rank a labelled guess above its own identical fallback.
//
// A null icon is not evidence an id is fake, since an item can ship ahead of its art.
//
// The fake's art manifest never settles, so `icon.item` stays optimistic and `itemArtName` null,
// as in the first moments of a real session. A case needing the manifest's answer spies on it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_SENDER } from '../../loader/src/runtime/bus/hub.ts';
import { loadAddon } from '../../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../../loader/src/shared/protocol.ts';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { type MountInput, mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { choosePicker } from '../../tests/fakes/controls.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import { createSharedServices } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
import TABLE_TEXT from './items.json?raw';
import PART_TWO_TEXT from './items-2.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
/** A fork's fqid on purpose: nothing here may assume the official marketplace. */
const ASKER = 'someone/satchel';

interface TableRow {
  id: string;
  name: string;
  kind: string;
  quality?: string;
  slot?: string;
  armorType?: string;
  set?: string;
  requiredClass?: string[];
  heroicOf?: string;
  uniqueEquipped?: true;
  itemLevel?: number;
  stats?: Record<string, number>;
  pvpOffenseRating?: number;
  pvpDefenseRating?: number;
  weapon?: { min: number; max: number; speed: number };
  requiredLevel?: number;
  sellValue?: number;
  priceHonor?: number;
  soulbound?: true;
}

interface TableFile {
  gameVersion: string;
  fields: string;
  parts: string[];
  items: TableRow[];
}

function readHeader(): TableFile {
  return JSON.parse(TABLE_TEXT) as TableFile;
}

function readPartTwo(): TableFile {
  return JSON.parse(PART_TWO_TEXT) as TableFile;
}

/** Every part the manifest declares, by the name the addon asks for it under. */
const PARTS: Record<string, string> = { 'items.json': TABLE_TEXT, 'items-2.json': PART_TWO_TEXT };

const TABLE: readonly TableRow[] = [...readHeader().items, ...readPartTwo().items];
/** How many rows the shipped file holds, the base of every count on screen. */
const TABLE_SIZE = TABLE.length;

function rowFor(id: string): TableRow {
  const found = TABLE.find((row) => row.id === id);
  if (found === undefined) {
    throw new Error(`items.json no longer carries ${id}, so this fixture is stale`);
  }
  return found;
}

/**
 * Real rows picked for their shape: a weapon; a helmet, the ordinary complete row; a junk item,
 * with a quality and no slot; and a quest item with no quality, since "absent" is not "poor".
 */
const WEAPON = rowFor('worn_sword');
const HELMET = rowFor('acolytes_circlet');
const JUNK = rowFor('amber_hide');
const NO_QUALITY = rowFor('amberfall_sap_bucket');

/** A row carrying a sell price, an item level and a level gate at once. */
const PRICED = rowFor('abyssal_loop');

/**
 * A Warfare piece, the only shape carrying the PvP ratings and an honor price; a heroic variant,
 * which shares its base's display name; and a legendary heroic variant, unique-equipped with its
 * base.
 */
const WARFARE = rowFor('furyforged_warhelm');
const HEROIC = rowFor('heroic_direfang_quiver');
const UNIQUE = rowFor('heroic_kingsbane_last_oath');

/**
 * A set piece whose id and set NAME share no word: 'emberscreed' is 'Creed of Embers Vestments'.
 */
const SET_PIECE = rowFor('emberscreed_helmet');

/** An id the shipped table does not carry, which is what a roll and the art file teach. */
const UNKNOWN_ID = 'lorebind_not_in_the_table';

const FQID = 'official/lorebind';

/** The newest member read is `ui.itemCell`, minor 7; off an older loader the grid is `NaNpx`. */
const NEEDS_MINOR = 7;

/** The row `mountAddon` would build, for the one case that mounts the addon by hand. */
function installedRow(): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    manifest: parseManifest(MANIFEST_TEXT),
    enabled: true,
    pin: null,
  };
}

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

/**
 * Chain `times` microtask hops without an await in a loop. `MICROTASKS` is set well past the
 * depth of the addon's start-up rather than at the exact hop count.
 */
function flush(times: number): Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  for (let step = 0; step < times; step += 1) {
    chain = chain.then(() => undefined);
  }
  return chain;
}

const MICROTASKS = 24;

interface Roll {
  rollId: number;
  itemId: string;
  itemName: string;
  quality: string;
}

interface WorldState {
  /** `lootRollPrompts` on the game's own world object: what YOU were asked. */
  prompts: Roll[];
  /** What `lootRollGroupStatus()` answers: every open roll in the party. */
  status: Roll[];
  inventory: Array<{ itemId: string; count: number }>;
  equipment: Record<string, string>;
  recipeList: Array<{ resultItemId: string; reagents: Array<{ itemId: string; count: number }> }>;
}

function emptyWorld(): WorldState {
  return { prompts: [], status: [], inventory: [], equipment: {}, recipeList: [] };
}

/**
 * The game's world object, every field a getter so the next poll sees what the suite moved.
 * `lootRollGroupStatus` is a call, as the loader's group reader expects.
 */
function fakeWorld(state: WorldState, player: unknown): Record<string, unknown> {
  return {
    entities: new Map([[PLAYER_ID, player]]),
    player,
    known: [],
    get lootRollPrompts(): Roll[] {
      return state.prompts;
    },
    lootRollGroupStatus: (): Roll[] => state.status,
    get inventory(): Array<{ itemId: string; count: number }> {
      return state.inventory;
    },
    get equipment(): Record<string, string> {
      return state.equipment;
    },
    get recipeList(): WorldState['recipeList'] {
      return state.recipeList;
    },
  };
}

interface Published {
  from: string;
  topic: string;
  payload: unknown;
}

interface Harness {
  dispose: () => void;
  /** Move the world under the addon. */
  set: (patch: Partial<WorldState>) => void;
  /** Re-read the world and let the addon's queued repaint settle. */
  settle: () => Promise<void>;
  /** Run one sweep interval, which is the tick the addon polls on. */
  tick: () => Promise<void>;
  /** Everything the addon has put on the bus, in order. */
  sent: Published[];
  /** Ask as another addon would, from a fork's fqid. */
  ask: () => void;
  /** A setting changing, which is what the loader reports on a write from either tab. */
  settingsChanged: (values: Record<string, unknown>) => void;
  /** Make the art manifest answer, which the shared fake's never does. */
  artNames: (names: ReadonlyMap<string, string>) => void;
  /** Make `icon.item` definite, which is what turns an optimistic URL into a null. */
  artFiles: (ids: ReadonlySet<string>) => void;
}

interface StartOptions {
  world?: Partial<WorldState>;
  settings?: Record<string, unknown>;
  /** Pass a broken file, or none at all, to pin what the panel says instead. */
  table?: string | null;
}

const SWEEP_MS = 1000;

async function start(options: StartOptions = {}): Promise<Harness> {
  const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
  const state: WorldState = { ...emptyWorld(), ...options.world };

  const input: MountInput = {
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings: options.settings ?? {},
    game: Promise.resolve({ world: fakeWorld(state, player) }),
  };
  if (options.table !== null) {
    input.data = PARTS;
  }
  if (typeof options.table === 'string') {
    input.data = { 'items.json': options.table };
  }
  const harness = await mountAddon(input);
  teardown.push(harness.dispose);

  const sent: Published[] = [];
  // Subscribed as somebody else, since nobody receives their own messages. One subscription per
  // topic: there is a wildcard for the sender and none for the topic.
  for (const topic of ['item', 'items']) {
    teardown.push(
      harness.shared.bus.subscribe({
        from: ANY_SENDER,
        topic,
        owner: ASKER,
        handler: (message) => {
          sent.push({ from: message.from, topic: message.topic, payload: message.payload });
        },
        onError: (err: unknown) => {
          throw err;
        },
      }),
    );
  }

  const settle = async (): Promise<void> => {
    harness.shared.world.watcher.poll();
    await flush(MICROTASKS);
    vi.advanceTimersToNextFrame();
    // `woc.paint` runs on the loader's frame loop, so a settle steps that loop as well as the
    // clock. One tick is one frame, however many repaints were asked for.
    harness.frames.tick();
    await flush(MICROTASKS);
  };
  await settle();

  return {
    dispose: harness.dispose,
    sent,
    set: (patch) => {
      Object.assign(state, patch);
    },
    settle,
    tick: async () => {
      vi.advanceTimersByTime(SWEEP_MS);
      await settle();
    },
    ask: () => {
      harness.shared.bus.emit(ASKER, 'item:ask', null);
    },
    settingsChanged: (values) => {
      harness.hub.remote(`config:${harness.fqid}`, 'values', values);
    },
    artNames: (names) => {
      vi.spyOn(harness.shared.kit.icons, 'itemArtName').mockImplementation(
        (itemId) => names.get(itemId) ?? null,
      );
    },
    artFiles: (ids) => {
      vi.spyOn(harness.shared.kit.icons, 'item').mockImplementation((itemId) => {
        if (ids.has(itemId)) {
          return `/ui/items/${itemId}.webp`;
        }
        return null;
      });
    },
  };
}

function cellEl(itemId: string): HTMLElement | null {
  return document.querySelector(`.woc-lorebind-grid [data-item="${itemId}"]`);
}

function partOf(el: Element | null, selector: string): string {
  return el?.querySelector(selector)?.textContent ?? '';
}

/** One square's accessible name, the only place a square of art says its name, tier and kind. */
function cellName(itemId: string): string {
  return cellEl(itemId)?.getAttribute('aria-label') ?? '';
}

/** Click a square, which is how the record under the grid is pointed at one item. */
function pick(itemId: string): void {
  cellEl(itemId)?.dispatchEvent(new Event('click', { bubbles: true }));
}

/** One of the record's own single lines: its name, its kind, or its provenance. */
function recordPart(role: string): string {
  return partOf(document.querySelector('[data-role="record"]'), `[data-role="${role}"]`);
}

/**
 * The block under the kind line, one fact per entry, in drawn order. `role` narrows to `number`
 * (what the item is), `stat` (what it gives) or `gate` (what it asks first).
 */
function blockLines(role = ''): string[] {
  let selector = 'div';
  if (role !== '') {
    selector = `[data-role="${role}"]`;
  }
  return [...document.querySelectorAll(`[data-role="block"] ${selector}`)].map(
    (el) => el.textContent ?? '',
  );
}

/**
 * The class the record's name is drawn under. A class, not a colour: the palette is the loader's,
 * and under Vitest a stylesheet is empty, so the stage proves the class paints.
 */
function recordQuality(): string {
  const el = document.querySelector('[data-role="record"] [data-role="name"]');
  return el?.className ?? '';
}

/** The tier one square carries, which is what the kit borders it by. */
function cellQuality(itemId: string): string {
  return cellEl(itemId)?.className ?? '';
}

function drawnIds(): string[] {
  return [...document.querySelectorAll('.woc-lorebind-grid [data-item]')].map(
    (el) => el.getAttribute('data-item') ?? '',
  );
}

function lineFor(role: string): string {
  const el = document.querySelector<HTMLElement>(`[data-role="${role}"]`);
  if (el === null || el.hidden) {
    return '';
  }
  return el.textContent ?? '';
}

/**
 * What the tooltip says over an element, or '' when nothing is described. Keep the hidden check:
 * the one shared tooltip keeps its last text, so without it every "describes nothing" case passes.
 */
function tipOver(el: Element | null): string {
  el?.dispatchEvent(new Event('pointerenter'));
  const tip = document.getElementById('woc-tooltip');
  if (tip === null || tip.hidden) {
    return '';
  }
  return tip.textContent ?? '';
}

/** Open one of the kind tabs, the way a player picks a shelf. */
function pressTab(label: string): void {
  const tab = [...document.querySelectorAll('.woc-tab')].find((el) => el.textContent === label);
  (tab as HTMLButtonElement | undefined)?.click();
}

/** Press one of the six quality chips, which toggles that tier. */
function pressChip(quality: string): void {
  document.querySelector<HTMLButtonElement>(`[data-quality="${quality}"]`)?.click();
}

/** Whether a chip reads as pressed, which is what says the filter is on. */
function chipOn(quality: string): string {
  return document.querySelector(`[data-quality="${quality}"]`)?.getAttribute('aria-pressed') ?? '';
}

/**
 * Choose an equipment slot by its shown words, through the loader's dropdown (a button and a
 * menu, not a `<select>`). See tests/fakes/controls.ts.
 */
function chooseSlot(value: string): void {
  choosePicker(document.querySelector('[data-role="slot"]') ?? document, value);
}

/** Choose one of the four orders the grid can be read in. */
function chooseSort(label: string): void {
  choosePicker(document.querySelector('[data-role="sort"]') ?? document, label);
}

/** Tick the one filter that is about this character rather than about the game. */
function toggleSeen(): void {
  document.querySelector<HTMLInputElement>('[data-role="seen"] input')?.click();
}

function search(value: string): void {
  const input = document.querySelector<HTMLInputElement>('[data-role="search"] input');
  if (input !== null) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
}

/**
 * Narrow by search. The grid is capped, so a case about one item narrows first; asserting against
 * the unfiltered list would be asserting alphabetical position.
 */
async function only(h: Harness, needle: string): Promise<void> {
  search(needle);
  await h.settle();
}

/** Narrow to one id and click it open, since only the record under the grid draws words. */
async function open(h: Harness, itemId: string): Promise<void> {
  await only(h, itemId);
  pick(itemId);
  await h.settle();
}

/** One field off a published record: Biome wants `row.id` and TypeScript forbids it here. */
function field(row: Record<string, unknown>, name: string): unknown {
  return row[name];
}

/** Every record the addon has published, flattened across `item` and `items`. */
function publishedRecords(sent: Published[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const message of sent) {
    if (message.topic === 'items' && Array.isArray(message.payload)) {
      rows.push(...(message.payload as Record<string, unknown>[]));
    }
    if (message.topic === 'item' && typeof message.payload === 'object') {
      rows.push(message.payload as Record<string, unknown>);
    }
  }
  return rows;
}

function publishedFor(sent: Published[], itemId: string): Record<string, unknown> | undefined {
  return publishedRecords(sent).find((row) => field(row, 'id') === itemId);
}

function roll(itemId: string, itemName: string, quality: string): Roll {
  return { rollId: 1, itemId, itemName, quality };
}

/**
 * A one-row table stating the two Warfare ratings at DIFFERENT values. Invented because no shipped
 * row does, which hides the `Math.min` rule; the only fixture here that is not a real item.
 */
const LOPSIDED_WARFARE = JSON.stringify({
  gameVersion: '0.0.0',
  items: [
    {
      id: 'lopsided_warfare_ring',
      name: 'Lopsided Warfare Ring',
      kind: 'armor',
      quality: 'epic',
      slot: 'ring',
      pvpOffenseRating: 11,
      pvpDefenseRating: 4,
    },
  ],
});

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // Without the data file the art file is the only source left to name an item from.
  it('declares the item table as its data file', () => {
    expect(parseManifest(MANIFEST_TEXT).data).toEqual(['items.json', 'items-2.json']);
  });

  it('asks only for the world, a frame and a key', () => {
    expect(parseManifest(MANIFEST_TEXT).permissions).toEqual(['world.read', 'ui', 'keys']);
  });

  // An older loader strips an unknown option rather than refusing it, so a claim too low installs
  // and draws wrongly. See NEEDS_MINOR.
  it('declares the minor the members it calls arrived in', () => {
    expect(parseManifest(MANIFEST_TEXT).apiMinor).toBe(NEEDS_MINOR);
  });
});

describe('the shipped table', () => {
  // Neither the count nor the version is pinned: the table is generated. What is asserted is
  // what would break a reader: a header with no stamp, and ids that are not a key.
  it('stamps the game version it was derived from', () => {
    expect(readHeader().gameVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // A part the manifest does not declare is refused at install, and one the list omits is never
  // read, so both sides must name the same files.
  it('names every declared part in every part, at one game version', () => {
    const declared = parseManifest(MANIFEST_TEXT).data;
    expect(readHeader().parts).toEqual(declared);
    expect(readPartTwo().parts).toEqual(declared);
    expect(readPartTwo().gameVersion).toBe(readHeader().gameVersion);
  });

  // The id is the addon's Map key, so a duplicate silently gives one item another's stats.
  it('keys every row by an id of its own', () => {
    expect(TABLE.length).toBeGreaterThan(0);
    expect(new Set(TABLE.map((row) => row.id)).size).toBe(TABLE.length);
  });

  // Absent is not poor: filling a quality in would state a fact the game never did.
  it('leaves quality and slot out where the game declares none', () => {
    expect(NO_QUALITY.quality).toBeUndefined();
    expect(JUNK.slot).toBeUndefined();
    expect(JUNK.quality).toBe('poor');
  });

  // Asserted on real rows, so a generator that stops extracting a field fails here rather than
  // drawing a blank record.
  it('carries the numbers the game draws, on the items that have them', () => {
    expect(HELMET.stats).toBeDefined();
    expect(HELMET.armorType).toBe('cloth');
    expect(WEAPON.weapon?.speed).toBeGreaterThan(0);
    expect(JUNK.stats).toBeUndefined();
  });

  // Pinned by id in BOTH directions, never by count: the generator drops an absent flag rather
  // than writing false, so a binding rule leaving the game reads like a field never extracted.
  // `forgefathers_warhammer` is an unbound boss drop and `emberscreed_helmet` a bound set piece.
  // The ledgerline suite pins the same pair from the market side; update both together.
  it('says which items bind, and drops the flag rather than writing false', () => {
    expect(rowFor('emberscreed_helmet').soulbound).toBe(true);
    expect(rowFor('forgefathers_warhammer').soulbound).toBeUndefined();
    expect(TABLE.some((row) => row.soulbound === true)).toBe(true);
    expect(TABLE.every((row) => row.soulbound === undefined || row.soulbound === true)).toBe(true);
  });

  // Derived by the game from where an item drops, so the generator calls the game's functions.
  it('carries the two levels the game derives rather than declares', () => {
    const levelled = TABLE.filter((row) => row.itemLevel !== undefined);
    const gated = TABLE.filter((row) => row.requiredLevel !== undefined);

    expect(levelled.length).toBeGreaterThan(0);
    expect(gated.length).toBeGreaterThan(0);
    expect(TABLE.every((row) => (row.requiredLevel ?? 2) > 1)).toBe(true);
  });
});

// Each case is an id only one source answers for, except the first, which two do.
describe('the source ranking', () => {
  // The search forces the repaint: a sweep that learns nothing schedules none, so a tick alone
  // would assert against the paint taken before the art spy existed.
  it('takes the table over the art file', async () => {
    const h = await start();
    h.artNames(new Map([[HELMET.id, 'Acolyte Circlet of Drift']]));
    await h.tick();
    await open(h, HELMET.id);

    expect(recordPart('name')).toBe(HELMET.name);
    expect(recordPart('source')).toContain('from the table');
  });

  it('takes a loot roll for an id the table does not carry', async () => {
    const h = await start({ world: { prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] } });
    await h.tick();
    await open(h, UNKNOWN_ID);

    expect(recordPart('name')).toBe('Gilded Censer');
    expect(recordPart('source')).toContain('from a loot roll');
    expect(recordPart('kind')).toBe('Rare, kind unknown');
  });

  it('falls back to the art file, and says in the record that it did', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    h.artNames(new Map([[UNKNOWN_ID, 'Gilded Censer']]));
    await h.tick();
    await open(h, UNKNOWN_ID);

    expect(recordPart('name')).toBe('Gilded Censer');
    expect(recordPart('source')).toContain('from its art file');
  });

  // An id nothing can name still exists; the raw id and the source line keep that distinct.
  it('draws the raw id when nothing can name it, and says nothing could', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    await h.tick();
    await open(h, UNKNOWN_ID);

    expect(recordPart('name')).toBe(UNKNOWN_ID);
    expect(recordPart('source')).toContain('no name from any source');
  });
});

describe('the record under the grid', () => {
  // Absent is not poor: a blank where every other record names a tier reads as the lowest tier.
  it('says a quality nobody knows is unknown rather than leaving it blank', async () => {
    const h = await start();
    await h.tick();
    await open(h, NO_QUALITY.id);

    expect(recordPart('kind')).toBe('Quest, quality unknown');
  });

  it('hands the square and the name to the kit to colour by tier', async () => {
    const h = await start();
    await h.tick();
    await open(h, HELMET.id);

    expect(recordQuality()).toBe('woc-quality-uncommon');
    expect(cellQuality(HELMET.id)).toContain('woc-tile-quality-uncommon');
  });

  // Absent is not poor, so no tier class at all.
  it('colours nothing for an item the game ranks at no tier', async () => {
    const h = await start();
    await h.tick();
    await open(h, NO_QUALITY.id);

    expect(recordQuality()).toBe('');
    expect(cellQuality(NO_QUALITY.id)).not.toContain('woc-tile-quality');
  });

  it('spells out an item the way the game does, in its own order', async () => {
    const h = await start();
    await h.tick();
    await open(h, HELMET.id);

    expect(recordPart('kind')).toBe('Uncommon cloth armor, helmet');
    expect(blockLines('number')).toContain('16 Armor');
    expect(blockLines('stat')).toEqual(['+1 Stamina', '+2 Intellect', '+1 Spirit']);
    // Vendor stock: no derived levels, so the gates are a class and a set.
    expect(blockLines('gate')).toContain('Classes: Mage, Priest, Warlock, Druid');
    expect(blockLines('gate').at(-1)).toContain('Sell price:');
  });

  it('works a weapon out to damage per second, as the game does', async () => {
    const h = await start();
    await h.tick();
    await open(h, WEAPON.id);

    const swing = WEAPON.weapon as { min: number; max: number; speed: number };
    const dps = (swing.min + swing.max) / 2 / swing.speed;

    expect(blockLines('number')[0]).toContain(`${String(swing.min)} - ${String(swing.max)} Damage`);
    expect(blockLines('number')[0]).toContain(`${dps.toFixed(1)} damage per second`);
  });

  it('draws no numbers at all for an id the table does not carry', async () => {
    const h = await start({ world: { prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] } });
    await h.tick();
    await open(h, UNKNOWN_ID);

    expect(blockLines()).toEqual([]);
    expect(recordPart('source')).toContain('from a loot roll');
  });

  // An empty record under a full grid reads as a panel still loading.
  it('opens on the first square rather than on nothing', async () => {
    const h = await start();
    await h.tick();
    await only(h, 'Sableweb');

    expect(recordPart('name')).not.toBe('Pick an item');
    expect(recordPart('source').startsWith(drawnIds()[0] ?? '')).toBe(true);
  });

  // A blank icon slot alone reads like an id the addon made up; the tooltip says why it is blank.
  it('says an item with no art draws as text, and why', async () => {
    const h = await start();
    h.artFiles(new Set([HELMET.id]));
    await h.tick();
    search(WEAPON.name);
    await h.settle();

    expect(cellName(WEAPON.id)).toContain(WEAPON.name);
    expect(tipOver(cellEl(WEAPON.id))).toContain('ships no art');
  });

  // A roll spelling an id differently is the only evidence the table is behind a rename.
  it('shows a roll that disagrees with the table rather than hiding either', async () => {
    const h = await start({
      world: { prompts: [roll(HELMET.id, 'Acolyte Circlet', 'uncommon')] },
    });
    await h.tick();

    const said = tipOver(cellEl(HELMET.id));

    expect(cellName(HELMET.id)).toContain(HELMET.name);
    expect(said).toContain('Acolyte Circlet');
    expect(said).toContain('renamed');
  });

  // Shipped rows state both ratings equal, so this pins only that the line is drawn; the next
  // case pins the `Math.min`.
  it('draws the Warfare pair as the single line the game draws', async () => {
    const h = await start();
    await h.tick();
    await open(h, WARFARE.id);

    const rating = Math.min(WARFARE.pvpOffenseRating ?? 0, WARFARE.pvpDefenseRating ?? 0);

    expect(rating).toBeGreaterThan(0);
    expect(blockLines('stat')).toContain(`+${String(rating)} Warfare`);
  });

  // Needs its own table: with equal ratings, taking offense alone or the larger passes too.
  it('takes the smaller of the two Warfare ratings, not the first or the larger', async () => {
    const h = await start({ table: LOPSIDED_WARFARE });
    await h.tick();
    await open(h, 'lopsided_warfare_ring');

    expect(blockLines('stat')).toContain('+4 Warfare');
  });

  // The honor price is the only price a Warfare piece has; without it the item reads unbuyable.
  it('draws what a Quartermaster charges for a piece a vendor does not sell', async () => {
    const h = await start();
    await h.tick();
    await open(h, WARFARE.id);

    expect(WARFARE.priceHonor).toBeGreaterThan(0);
    expect(blockLines('gate')).toContain(`Honor price: ${String(WARFARE.priceHonor)}`);
  });

  // A heroic variant shares its base's display name; the tag is the only word that differs.
  it('marks a heroic variant the way the game does rather than renaming it', async () => {
    const h = await start();
    await h.tick();
    await open(h, HEROIC.id);

    const base = rowFor(HEROIC.heroicOf ?? '');

    expect(HEROIC.name).toBe(base.name);
    expect(recordPart('name')).toBe(base.name);
    expect(recordPart('kind')).toContain('[HEROIC]');
    expect(cellName(HEROIC.id)).toContain('[HEROIC]');
  });

  // Unique-equipped is keyed on the item family: a heroic variant and its base count as one.
  it('says a legendary is unique-equipped and which item it counts as', async () => {
    const h = await start();
    await h.tick();
    await open(h, UNIQUE.id);

    expect(UNIQUE.uniqueEquipped).toBe(true);
    expect(blockLines('gate')).toContain('Unique-Equipped, so one worn copy per item');
    expect(blockLines('gate')).toContain(`Heroic upgrade of ${String(UNIQUE.heroicOf)}`);
  });

  // The flag is read, never inferred: an epic Warfare piece is what an inference gets wrong.
  it('says nothing about wearing for an item the game does not restrict', async () => {
    const h = await start();
    await h.tick();
    await open(h, WARFARE.id);

    expect(WARFARE.uniqueEquipped).toBeUndefined();
    expect(blockLines('gate').join(' ')).not.toContain('Unique-Equipped');
    expect(recordPart('kind')).not.toContain('[HEROIC]');
  });
});

describe('the coverage line', () => {
  it('counts each source apart rather than reporting one total', async () => {
    const h = await start({ world: { prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] } });
    await h.tick();

    const said = lineFor('coverage');

    expect(said).toContain(`${String(TABLE_SIZE)} named from the table`);
    expect(said).toContain('1 from a roll');
  });

  it('marks an art-sourced name as a guess in the count itself', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    h.artNames(new Map([[UNKNOWN_ID, 'Gilded Censer']]));
    await h.tick();

    expect(lineFor('coverage')).toContain('1 from art files, a guess');
  });

  it('counts an id it can prove exists but cannot name', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    await h.tick();

    expect(lineFor('coverage')).toContain('1 by nothing');
  });

  // Until the manifest lands `icon.item` is optimistic, so a count of zero would be unmeasured.
  it('waits for the art manifest before counting what draws as text', async () => {
    const h = await start();
    await h.tick();

    expect(tipOver(document.querySelector('[data-role="coverage"]'))).toContain(
      'reading the art manifest',
    );
  });

  // Mounted by hand so the spy exists before the addon's first line: `preloadItems` runs at boot.
  it('counts what draws as text once the manifest has answered', async () => {
    const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
    const shared = createSharedServices(document, createFakeStorage(), {
      game: Promise.resolve({ world: fakeWorld(emptyWorld(), player) }),
    });
    vi.spyOn(shared.shared.kit.icons, 'preloadItems').mockResolvedValue(undefined);
    vi.spyOn(shared.shared.kit.icons, 'item').mockImplementation((itemId) => {
      if (itemId === HELMET.id) {
        return `/ui/items/${itemId}.webp`;
      }
      return null;
    });
    for (const [name, text] of Object.entries(PARTS)) {
      shared.addonData(FQID, name, text);
    }

    const addon = await loadAddon({ shared: shared.shared, row: installedRow(), source: SOURCE });
    teardown.push(() => {
      addon.dispose();
      shared.dispose();
    });
    await flush(MICROTASKS);
    vi.advanceTimersToNextFrame();
    await flush(MICROTASKS);

    const said = tipOver(document.querySelector('[data-role="coverage"]'));

    expect(said).toContain(`${String(TABLE_SIZE - 1)} of ${String(TABLE_SIZE)} ship no art`);
    // The line says the figure moves as art catches up with content.
    expect(said).toContain('commissions art behind content');
  });
});

describe('the filters', () => {
  it('shelves the table by kind, and leaves the other shelves out', async () => {
    const h = await start();
    await h.tick();
    pressTab('Weapon');
    await h.settle();

    expect(drawnIds()).toContain(WEAPON.id);
    expect(drawnIds()).not.toContain(HELMET.id);
  });

  // Nothing lit means every tier.
  it('lights one tier at a time, and unlights it again', async () => {
    const h = await start();
    await h.tick();
    expect(chipOn('uncommon')).toBe('false');

    pressChip('uncommon');
    await h.settle();
    expect(chipOn('uncommon')).toBe('true');
    expect(drawnIds()).toContain(HELMET.id);
    expect(drawnIds()).not.toContain(JUNK.id);

    pressChip('uncommon');
    await h.settle();
    expect(drawnIds()).toContain(JUNK.id);
  });

  // Counted off the shipped file: the grid is capped, so "helmet in, sword out" would pass on
  // alphabetical position with the filter deleted.
  it('narrows to one equipment slot', async () => {
    const helmets = TABLE.filter((row) => row.slot === 'helmet');
    const h = await start();
    await h.tick();
    chooseSlot('helmet');
    await h.settle();

    expect(drawnIds()).toHaveLength(helmets.length);
    expect(drawnIds()).toContain(HELMET.id);
  });

  // The game added the trinket slot; a slot missing from the dropdown hides a whole shelf.
  it('narrows to trinkets', async () => {
    const trinkets = TABLE.filter((row) => row.slot === 'trinket');
    const h = await start();
    await h.tick();
    chooseSlot('trinket');
    await h.settle();

    expect(trinkets.length).toBeGreaterThan(0);
    expect(drawnIds()).toHaveLength(trinkets.length);
    expect(drawnIds()).toContain('gamblers_die');
  });

  // An id is seen when the world, not the file, proves it exists.
  it('narrows to what this character has actually laid eyes on', async () => {
    const h = await start({ world: { inventory: [{ itemId: JUNK.id, count: 3 }] } });
    await h.tick();
    toggleSeen();
    await h.settle();

    expect(drawnIds()).toEqual([JUNK.id]);
  });

  // Quality sorts by rank; the alphabet would put epic under poor.
  it('sorts by a tier rather than by the word for it', async () => {
    const h = await start();
    await h.tick();
    chooseSort('Quality');
    await h.settle();

    const top = TABLE.find((row) => row.id === drawnIds()[0]);

    expect(top?.quality).toBe('legendary');
  });

  it('puts the best first when sorted by item level, and the unlevelled last', async () => {
    const h = await start();
    await h.tick();
    chooseSort('Item level');
    await h.settle();

    const levels = drawnIds().map((id) => TABLE.find((row) => row.id === id)?.itemLevel ?? 0);
    const falling = [...levels].sort((a, b) => b - a);

    expect(levels).toEqual(falling);
    expect(levels[0]).toBeGreaterThan(0);
  });

  it('says nothing matches rather than drawing an empty grid', async () => {
    const h = await start();
    await h.tick();
    pressTab('Food');
    pressChip('legendary');
    await h.settle();

    expect(drawnIds()).toEqual([]);
    expect(lineFor('status')).toContain('Nothing matches these filters');
  });
});

// `satchel` and `ledgerline` name items off the bus, so the payload shape has to hold still.
describe('what it puts on the bus', () => {
  it('publishes the whole table as one batch rather than one message per row', async () => {
    const h = await start();
    await h.settle();

    const batches = h.sent.filter((message) => message.topic === 'items');

    expect(batches).toHaveLength(1);
    expect(h.sent.filter((message) => message.topic === 'item')).toHaveLength(0);
    expect(batches[0]?.payload).toHaveLength(TABLE_SIZE);
  });

  it('publishes the documented payload shape', async () => {
    const h = await start();
    await h.settle();

    expect(publishedFor(h.sent, HELMET.id)).toEqual({
      id: HELMET.id,
      name: HELMET.name,
      quality: HELMET.quality,
      kind: HELMET.kind,
      slot: HELMET.slot,
      armorType: HELMET.armorType,
      set: HELMET.set,
      requiredClass: HELMET.requiredClass,
      sellValue: HELMET.sellValue,
      source: 'table',
    });
  });

  // Copper, the wire's unit, which `satchel` and `ledgerline` both read directly.
  it('publishes the sell price in copper', async () => {
    const h = await start();
    await h.settle();

    expect(field(publishedFor(h.sent, PRICED.id) ?? {}, 'sellValue')).toBe(PRICED.sellValue);
    expect(PRICED.sellValue).toBe(5000);
  });

  // A heroic variant arrives under its base's name; `heroicOf` is the only thing separating them.
  // `uniqueEquipped` is deliberately unpublished.
  it('publishes the base id a heroic variant shares its name with', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, HEROIC.id) ?? {};

    expect(field(record, 'name')).toBe(rowFor(HEROIC.heroicOf ?? '').name);
    expect(field(record, 'heroicOf')).toBe(HEROIC.heroicOf);
    expect(publishedFor(h.sent, WARFARE.id)).not.toHaveProperty('heroicOf');
    expect(publishedFor(h.sent, UNIQUE.id)).not.toHaveProperty('uniqueEquipped');
  });

  it('publishes the two levels an item is ranked and gated by', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, PRICED.id) ?? {};

    expect(field(record, 'itemLevel')).toBe(PRICED.itemLevel);
    expect(field(record, 'requiredLevel')).toBe(PRICED.requiredLevel);
  });

  // A `0` would read as "worth nothing" rather than "unpriced".
  it('leaves a number the table does not state out rather than sending a zero', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, NO_QUALITY.id) ?? {};

    expect(NO_QUALITY.sellValue).toBeUndefined();
    expect(record).not.toHaveProperty('sellValue');
    expect(record).not.toHaveProperty('itemLevel');
    expect(record).not.toHaveProperty('requiredLevel');
  });

  it('leaves an unknown field out rather than sending it empty', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, NO_QUALITY.id);

    expect(record).not.toHaveProperty('quality');
    expect(record).not.toHaveProperty('slot');
    expect(field(record ?? {}, 'name')).toBe(NO_QUALITY.name);
  });

  // The `toEqual` pins that no numbers are filled in: a roll prices nothing.
  it('publishes one record, carrying no numbers, for a name learned off a roll', async () => {
    const h = await start();
    await h.settle();
    h.set({ prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] });
    await h.tick();

    const singles = h.sent.filter((message) => message.topic === 'item');

    expect(singles).toHaveLength(1);
    expect(singles[0]?.payload).toEqual({
      id: UNKNOWN_ID,
      name: 'Gilded Censer',
      quality: 'rare',
      source: 'loot roll',
    });
  });

  it('publishes a roll once however many times the group rolls it', async () => {
    const h = await start();
    await h.settle();
    h.set({ prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] });
    await h.tick();
    h.set({ prompts: [], status: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] });
    await h.tick();

    expect(h.sent.filter((message) => message.topic === 'item')).toHaveLength(1);
  });

  // The ask makes this bite: the boot batch goes out before the art spy can answer.
  it('never publishes a name it took off an art file', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    h.artNames(new Map([[UNKNOWN_ID, 'Gilded Censer']]));
    await h.tick();
    h.sent.length = 0;
    h.ask();
    await only(h, UNKNOWN_ID);

    expect(cellName(UNKNOWN_ID)).toContain('Gilded Censer');
    expect(publishedFor(h.sent, UNKNOWN_ID)).toBeUndefined();
    expect(h.sent[0]?.payload).toHaveLength(TABLE_SIZE);
  });

  // A row on screen, but `{ id, name: '' }` is no use to a subscriber.
  it('never publishes an id nothing can name', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    await h.tick();
    h.sent.length = 0;
    h.ask();
    await h.settle();

    expect(publishedFor(h.sent, UNKNOWN_ID)).toBeUndefined();
    expect(h.sent[0]?.payload).toHaveLength(TABLE_SIZE);
  });

  // An addon that started later hears nothing from a publisher that only emits on change.
  it('answers an ask from a fork with everything it knows', async () => {
    const h = await start();
    await h.settle();
    h.sent.length = 0;
    h.ask();

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.topic).toBe('items');
    expect(h.sent[0]?.payload).toHaveLength(TABLE_SIZE);
  });

  it('is stamped with its own fqid as the sender', async () => {
    const h = await start();
    await h.settle();

    expect(h.sent[0]?.from).toBe('official/lorebind');
  });
});

describe('what it says about a set piece', () => {
  it('publishes the set, the armor class and the class gate a piece carries', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, HELMET.id) ?? {};

    expect(field(record, 'set')).toBe(HELMET.set);
    expect(field(record, 'armorType')).toBe(HELMET.armorType);
    expect(field(record, 'requiredClass')).toEqual(HELMET.requiredClass);
    // Real content: pins that the row still carries all three.
    expect(HELMET.requiredClass).toHaveLength(4);
  });

  it('publishes the set display name and not the game set id', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, SET_PIECE.id) ?? {};

    expect(field(record, 'set')).toBe('Creed of Embers Vestments');
    expect(SET_PIECE.id.startsWith('emberscreed')).toBe(true);
  });

  // The bus freezes the envelope, not the payload.
  it('publishes a copy of the class list rather than the row it holds', async () => {
    const h = await start();
    await h.settle();

    const first = publishedFor(h.sent, HELMET.id) ?? {};
    const classes = field(first, 'requiredClass') as string[];
    classes.length = 0;
    await open(h, HELMET.id);

    expect(blockLines('gate')).toContain('Classes: Mage, Priest, Warlock, Druid');
  });

  // A subscriber testing `payload.requiredClass?.includes(myClass)` reads an empty list as
  // "nobody".
  it('leaves the class gate out for an item that has none', async () => {
    const h = await start();
    await h.settle();

    expect(PRICED.requiredClass).toBeUndefined();
    expect(publishedFor(h.sent, PRICED.id)).not.toHaveProperty('requiredClass');
    expect(publishedFor(h.sent, PRICED.id)).not.toHaveProperty('set');
    expect(publishedFor(h.sent, PRICED.id)).not.toHaveProperty('armorType');
  });
});

describe('learning from rolls', () => {
  // A watch key reports a change, so only the sweep sees a roll open before the addon started.
  it('learns a roll that was already open when it started', async () => {
    const h = await start({ world: { status: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] } });
    await h.tick();
    await only(h, UNKNOWN_ID);

    expect(cellName(UNKNOWN_ID)).toContain('Gilded Censer');
  });

  it('learns from a roll it was never a candidate for', async () => {
    const h = await start();
    await h.settle();
    h.set({ status: [roll(UNKNOWN_ID, 'Gilded Censer', 'epic')] });
    await h.tick();
    await open(h, UNKNOWN_ID);

    expect(recordPart('source')).toContain('from a loot roll');
  });

  it('learns nothing from rolls when the player has turned that off', async () => {
    const h = await start({
      settings: { 'learn-rolls': false },
      world: { prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] },
    });
    await h.tick();
    await only(h, UNKNOWN_ID);

    expect(cellEl(UNKNOWN_ID)).toBeNull();
    expect(publishedFor(h.sent, UNKNOWN_ID)).toBeUndefined();
  });
});

describe('the ids it can prove exist', () => {
  it('takes them from the bags, the worn gear and the recipe table', async () => {
    const h = await start({
      world: {
        inventory: [{ itemId: 'lorebind_carried', count: 1 }],
        equipment: { helmet: 'lorebind_worn' },
        recipeList: [
          {
            resultItemId: 'lorebind_crafted',
            reagents: [{ itemId: 'lorebind_reagent', count: 2 }],
          },
        ],
      },
    });
    await h.tick();
    await only(h, 'lorebind_');

    const ids = drawnIds();

    expect(ids).toContain('lorebind_carried');
    expect(ids).toContain('lorebind_worn');
    expect(ids).toContain('lorebind_crafted');
    expect(ids).toContain('lorebind_reagent');
  });
});

describe('the search', () => {
  it('matches on the name, and on the id, quality, kind and slot too', async () => {
    const h = await start();
    await h.tick();

    search(HELMET.name);
    await h.settle();
    expect(drawnIds()).toContain(HELMET.id);

    search(WEAPON.id);
    await h.settle();
    expect(drawnIds()).toEqual([WEAPON.id]);
  });

  it('says which search found nothing rather than drawing an empty list', async () => {
    const h = await start();
    await h.tick();
    search('there is no such item');
    await h.settle();

    expect(drawnIds()).toEqual([]);
    expect(lineFor('status')).toContain('Nothing here matches "there is no such item"');
  });

  it('caps the grid and says it capped it', async () => {
    const h = await start({ settings: { 'max-results': 24 } });
    await h.tick();

    expect(drawnIds()).toHaveLength(24);
    expect(lineFor('status')).toContain(`Showing 24 of ${String(TABLE_SIZE)} items`);
  });
});

describe('when the table cannot be read', () => {
  it('says so rather than drawing an empty codex', async () => {
    const h = await start({ table: '{"items":"not an array"}' });
    await h.tick();

    expect(drawnIds()).toEqual([]);
    expect(lineFor('status')).toContain('could not be read');
  });

  // A row with an unknown kind is dropped rather than half-read.
  it('drops a row whose kind the game does not declare, and keeps the rest', async () => {
    const good = JSON.stringify({ ...HELMET });
    const bad = JSON.stringify({ ...JUNK, kind: 'lorebind_not_a_kind' });
    const h = await start({ table: `{"items":[${good},${bad}]}` });
    await h.tick();

    expect(drawnIds()).toEqual([HELMET.id]);
    expect(lineFor('coverage')).toContain('1 named from the table');
  });

  it('drops a row with no name rather than drawing a nameless one', async () => {
    const good = JSON.stringify({ ...HELMET });
    const bad = JSON.stringify({ id: JUNK.id, kind: JUNK.kind, quality: JUNK.quality });
    const h = await start({ table: `{"items":[${good},${bad}]}` });
    await h.tick();

    expect(drawnIds()).toEqual([HELMET.id]);
  });

  it('still learns from a roll with no table at all', async () => {
    const h = await start({
      table: '{"items":[]}',
      world: { prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] },
    });
    await h.tick();
    await only(h, UNKNOWN_ID);

    expect(cellName(UNKNOWN_ID)).toContain('Gilded Censer');
  });
});

describe('the tooltip service', () => {
  // How another addon borrows the codex for elements it drew.
  it('describes an element another addon marked', async () => {
    const h = await start();
    await h.tick();

    const marked = document.createElement('div');
    marked.setAttribute('data-woc-item', HELMET.id);
    document.querySelector('#woc-addons')?.appendChild(marked);
    await h.tick();

    const said = tipOver(marked);

    expect(said).toContain(HELMET.name);
    expect(said).toContain('from the table');
  });

  // Declining to add new tooltips is not enough: the ones already attached must go too.
  it('takes its tooltips back when the setting is turned off mid-session', async () => {
    const h = await start();
    await h.tick();

    const marked = document.createElement('div');
    marked.setAttribute('data-woc-item', HELMET.id);
    document.querySelector('#woc-addons')?.appendChild(marked);
    await h.tick();
    expect(tipOver(marked)).toContain(HELMET.name);

    h.settingsChanged({ tooltips: false });
    await h.tick();

    expect(tipOver(marked)).toBe('');
  });

  it('describes nothing when the player has turned tooltips off', async () => {
    const h = await start({ settings: { tooltips: false } });
    await h.tick();

    const marked = document.createElement('div');
    marked.setAttribute('data-woc-item', HELMET.id);
    document.querySelector('#woc-addons')?.appendChild(marked);
    await h.tick();

    expect(tipOver(marked)).toBe('');
  });
});
