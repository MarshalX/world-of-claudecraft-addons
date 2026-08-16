// @vitest-environment happy-dom

// Lorebind, run through the real loader.
//
// The source ranking is what is under test, and everything else in this file is arrangement for
// it. The addon exists because an item id resolves to no name anywhere on the API, so the only
// question worth asking of it is which of four unequal answers it gives and whether it says
// which one it gave.
//
// Every fixture is a real row out of the shipped `items.json`, read through the same `?raw`
// import the loader's data cache is seeded from. A stub table would turn a case about the
// game's own content into a case about a fixture somebody wrote, and the row that matters most
// here (an item the game declares with no quality, of which there are 96) is exactly the row
// nobody inventing a fixture would think to write.
//
// The art file is the source that must never win and must never be published.
// `ui.icon.itemArtName` is provenance for a picture: measured at game 0.33.0, 21 of its 303
// named entries disagreed with what the game calls the item, and the loader documents it as
// provenance rather than as a name. So there are two cases about it.
// It loses to the table on screen, and it is kept off the bus altogether, because a subscriber
// that took an art name from a publisher would rank it above the identical fallback it already
// has, which turns a labelled guess into an unlabelled answer one hop away.
//
// A null icon is not evidence an id is fake. Every weapon is art-less, filed under a model name
// the game does not serve, and at game 0.35.0 that is all 134 of the items with no art. It
// reads in that direction only: an item can ship ahead of its art. `a weapon draws as
// text` pins that such an id is still a complete, readable row that says why it has no picture:
// a hidden icon slot makes "no file exists" look exactly like "this item does not exist".
//
// The fake's art manifest never settles, which is the state the loader is genuinely in for the
// first moments of every session: `icon.item` is optimistic and `itemArtName` is null until it
// lands. So the art count is held back rather than reported as zero. Where a case needs the
// manifest to have answered, it says so by spying.

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
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the satchel suite.
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
}

interface TableFile {
  gameVersion: string;
  fields: string;
  items: TableRow[];
}

function readHeader(): TableFile {
  return JSON.parse(TABLE_TEXT) as TableFile;
}

const TABLE: readonly TableRow[] = readHeader().items;
/** How many rows the shipped file holds, which is what every count on screen is against. */
const TABLE_SIZE = TABLE.length;

function rowFor(id: string): TableRow {
  const found = TABLE.find((row) => row.id === id);
  if (found === undefined) {
    throw new Error(`items.json no longer carries ${id}, so this fixture is stale`);
  }
  return found;
}

/**
 * Four real rows, each picked for the shape it has rather than for its name. A weapon, because
 * every weapon in the game is art-less. A helmet, because it is the ordinary complete row: kind,
 * slot and quality all present. A junk item, because it has a quality and no slot. And a quest
 * item, because the game declares no quality for it at all and "absent" and "poor" are answers
 * this addon must not confuse.
 */
const WEAPON = rowFor('worn_sword');
const HELMET = rowFor('acolytes_circlet');
const JUNK = rowFor('amber_hide');
const NO_QUALITY = rowFor('amberfall_sap_bucket');

/**
 * A fifth, for the numbers rather than for the strings: the one row here carrying all three of
 * a sell price, an item level and a level gate, which is what a subscriber ranks a bag by.
 */
const PRICED = rowFor('abyssal_loop');

/**
 * Three more, for the facts game 0.35.0 made worth drawing.
 *
 * A Warfare piece, because the honor gear is the only place the two PvP ratings and the honor
 * price appear at all. A heroic upgrade variant, because it is one of the 63 rows sharing a
 * display name with another row and nothing but its base id ties the pair together. And a
 * legendary heroic variant, which is the only row in the table that is BOTH: unique-equipped
 * with its base, so the wear rule counts the two of them as one item.
 */
const WARFARE = rowFor('furyforged_warhelm');
const HEROIC = rowFor('heroic_direfang_quiver');
const UNIQUE = rowFor('heroic_kingsbane_last_oath');

/** An id the shipped table does not carry, which is what a roll and the art file teach. */
const UNKNOWN_ID = 'lorebind_not_in_the_table';

const FQID = 'official/lorebind';

/**
 * `woc.data` landed at minor 2 and the kit's item quality axis at 3. The grid is a `ui.list`
 * now, the counting lines are `ui.line`, the strips are `ui.row`, the repaint is `woc.paint`,
 * the count is `fmt.count`, the name service is `bus.publish` and the key is the frame's own
 * `toggleKey`: all of them minor 4. The square a cell is drawn at is `ui.itemCell`, minor 7,
 * and the claim tracks the newest member rather than the oldest. An addon reading it off an
 * older loader gets `undefined`, and a grid whose track is `NaNpx` draws nothing at all.
 */
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
 * Chain `times` microtask hops, without an await inside a loop. The addon awaits `woc.data`
 * and then publishes, so its start-up is several promise hops deep and `MICROTASKS` is set
 * well past that depth rather than at the exact number of hops.
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
 * The game's own world object, with every field the addon reads as a getter, because that is
 * what the loader reads through: the suite moves the state and the next poll sees it.
 * `lootRollGroupStatus` is a call rather than a field, which is what the loader's own group
 * reader expects and is the one read on that surface that is.
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
    input.data = { 'items.json': options.table ?? TABLE_TEXT };
  }
  const harness = await mountAddon(input);
  teardown.push(harness.dispose);

  const sent: Published[] = [];
  // Subscribed as somebody else, because nobody receives their own messages: a listener
  // registered under the addon's own fqid would hear nothing. Two subscriptions rather than one,
  // because the hub matches a topic exactly: there is a wildcard for the sender and none for the
  // topic.
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
    // The repaint is `woc.paint`, which runs on the LOADER'S one frame loop rather than on an
    // animation frame of the addon's own, so a settle has to step that loop as well as the
    // clock. The fake runs the real loop over a clock a suite drives, so nothing here is a
    // stand-in for the coalescing: one tick is one frame, however many repaints were asked for.
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

/**
 * What ONE square announces itself as, which is the whole of what it says in words.
 *
 * A square is art, so its accessible name is where its name, quality, kind and slot live, and
 * that is what a screen reader is read and what these cases assert against. What the square
 * shows a sighted player is the picture, the quality border, and the record under the grid.
 */
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
 * The block under the kind line, ONE FACT PER ENTRY, in the order it is drawn.
 *
 * The record reads like the game's own tooltip: a column rather than three comma-joined
 * lines. `role` narrows to one kind of fact, which is what the colours say too: a `number` is
 * what the item is made of, a `stat` is what it gives you, and a `gate` is what it asks first.
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
 * The class the record's name is drawn under, which is where the tier's colour comes from.
 *
 * A class rather than a colour, because the palette is the LOADER'S: the kit carries the
 * game's own two quality tables and this addon may not hold a hex of its own. Under Vitest a
 * stylesheet is an empty string anyway, so the class is the only half of it a suite can see;
 * that the class paints anything is proved by running the loader, which is the stage's job.
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
 * What the tooltip says over an element, or '' when nothing is described.
 *
 * The hidden check is the whole point of the cases about turning the service off. There is one
 * tooltip element for the whole loader and it stays in the document holding its last text, so a
 * helper that only read `textContent` would report the previous row's tooltip for an element
 * that has none, and every "describes nothing" case would pass regardless.
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
 * Choose an equipment slot, in the words the control shows rather than the game's id.
 *
 * Through the loader's own dropdown, which is a button and a menu rather than a `<select>`:
 * the same two clicks a player makes. See tests/fakes/controls.ts.
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
 * Narrow to one id, which is how a codex of eight hundred-odd rows is actually read. Every case
 * about one item goes through here rather than reaching into an unfiltered list: the list is
 * capped, deliberately and visibly, so an assertion against the whole of it would be an
 * assertion about alphabetical position.
 */
async function only(h: Harness, needle: string): Promise<void> {
  search(needle);
  await h.settle();
}

/**
 * Narrow to one id and OPEN it, which is the pair of gestures every case about one item makes.
 *
 * The grid draws art and the record draws words, so a case about what the addon SAYS has to
 * pick a square first. Clicking is the same path a player takes rather than a hook only the
 * suite uses.
 */
async function open(h: Harness, itemId: string): Promise<void> {
  await only(h, itemId);
  pick(itemId);
  await h.settle();
}

/**
 * One field off a published record. A helper rather than an index at the call site: Biome wants
 * `row.id` and TypeScript forbids dotting into an index signature.
 */
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
 * A table of one row, stating the two Warfare ratings at DIFFERENT values.
 *
 * Written rather than picked out of the shipped file because no shipped row does: all 47 carry
 * the pair twice over at one value, so the rule the game applies to them is invisible in the
 * content. This is the one fixture here that is not a real item, and it is one because the case
 * is about arithmetic rather than about the game's table.
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

  // The data file is the first-ranked source, so a manifest that stopped
  // declaring it would leave the addon with nothing but the art file to name an
  // item from, which is the exact inversion this addon exists to prevent.
  it('declares the item table as its data file', () => {
    expect(parseManifest(MANIFEST_TEXT).data).toEqual(['items.json']);
  });

  it('asks only for the world, a frame and a key', () => {
    expect(parseManifest(MANIFEST_TEXT).permissions).toEqual(['world.read', 'ui', 'keys']);
  });

  // An older loader strips an unknown option rather than refusing it, so a claim that is too
  // low installs and then draws wrongly rather than failing: at 3 this addon would have got a
  // grid of identical grey squares, and at 4 it would get a panel with no rows in it at all.
  // See NEEDS_MINOR for what is being claimed.
  it('declares the minor the members it calls arrived in', () => {
    expect(parseManifest(MANIFEST_TEXT).apiMinor).toBe(NEEDS_MINOR);
  });
});

describe('the shipped table', () => {
  // Neither the count nor the version is pinned to a literal: content moves both, and
  // `items.json` is a generated artifact this addon's own `generate.mjs` owns, so asserting
  // the output the generator is responsible for is what `AGENTS.md` says not to do. What is
  // asserted instead is what would STOP the generator: a header with no stamp, and a table
  // whose ids are not a key.
  it('stamps the game version it was derived from', () => {
    expect(readHeader().gameVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // The id is the Map key the whole addon is built on, so a duplicate would not
  // fail anywhere: the second row would quietly replace the first and one item
  // would read with another's stats. The count rides along because a table that
  // lost rows on its way through the reader is the other silent failure, and it
  // is checked against the file rather than against a number typed here.
  it('keys every row by an id of its own', () => {
    expect(TABLE.length).toBeGreaterThan(0);
    expect(new Set(TABLE.map((row) => row.id)).size).toBe(TABLE.length);
  });

  // Absent is not poor. 96 of the game's items declare no quality at all, and a
  // generator that filled one in would put a fact on screen the game never said.
  it('leaves quality and slot out where the game declares none', () => {
    expect(NO_QUALITY.quality).toBeUndefined();
    expect(JUNK.slot).toBeUndefined();
    expect(JUNK.quality).toBe('poor');
  });

  // The table carries what the game's own tooltip draws, which is the difference between a
  // browser and a lookup box. Asserted on real rows, so a generator that quietly stopped
  // extracting a field fails here rather than showing a blank record.
  it('carries the numbers the game draws, on the items that have them', () => {
    expect(HELMET.stats).toBeDefined();
    expect(HELMET.armorType).toBe('cloth');
    expect(WEAPON.weapon?.speed).toBeGreaterThan(0);
    expect(JUNK.stats).toBeUndefined();
  });

  // Derived by the game from where an item drops rather than declared on it, which is why
  // the generator calls the game's own two functions instead of copying a rule.
  it('carries the two levels the game derives rather than declares', () => {
    const levelled = TABLE.filter((row) => row.itemLevel !== undefined);
    const gated = TABLE.filter((row) => row.requiredLevel !== undefined);

    expect(levelled.length).toBeGreaterThan(0);
    expect(gated.length).toBeGreaterThan(0);
    expect(TABLE.every((row) => (row.requiredLevel ?? 2) > 1)).toBe(true);
  });
});

// The addon, in four cases. Each one is an id only ONE source can answer for,
// except the first, which is the id two can and is therefore the ranking itself.
describe('the source ranking', () => {
  // The search is what forces the repaint, and it has to: a sweep that learns nothing
  // deliberately schedules no paint, so a case that only ticked would be asserting against the
  // first paint, taken before the art spy existed.
  it('takes the table over the art file, which is the whole ordering', async () => {
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

  // An id nothing can name is a real answer, and it is not the same answer as an
  // id that does not exist. Drawing the raw id and saying nothing could name it
  // is what keeps the two apart.
  it('draws the raw id when nothing can name it, and says nothing could', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    await h.tick();
    await open(h, UNKNOWN_ID);

    expect(recordPart('name')).toBe(UNKNOWN_ID);
    expect(recordPart('source')).toContain('no name from any source');
  });
});

describe('the record under the grid', () => {
  // Absent is not poor. The game declares no quality for 96 of its items, and a record that
  // said nothing where every other one says a tier reads as the lowest tier rather than as a
  // fact nobody has.
  it('says a quality nobody knows is unknown rather than leaving it blank', async () => {
    const h = await start();
    await h.tick();
    await open(h, NO_QUALITY.id);

    expect(recordPart('kind')).toBe('Quest, quality unknown');
  });

  // The one thing a player reads an item list by. The hexes are the game's own table, so a
  // codex in any other palette would disagree with every bag and every loot roll on screen.
  it('hands the square and the name to the kit to colour by tier', async () => {
    const h = await start();
    await h.tick();
    await open(h, HELMET.id);

    expect(recordQuality()).toBe('woc-quality-uncommon');
    expect(cellQuality(HELMET.id)).toContain('woc-tile-quality-uncommon');
  });

  // The 96 items the game ranks at no tier get no class at all rather than the lowest one:
  // absent is not poor, and a colour would claim a tier nobody said.
  it('colours nothing for an item the game ranks at no tier', async () => {
    const h = await start();
    await h.tick();
    await open(h, NO_QUALITY.id);

    expect(recordQuality()).toBe('');
    expect(cellQuality(NO_QUALITY.id)).not.toContain('woc-tile-quality');
  });

  // The whole of what the record is for. Asserted line by line rather than on the block,
  // because each one is a different claim: what it IS, what it gives you, and what it asks
  // of you first, and the game draws them in that order.
  it('spells out an item the way the game does, in its own order', async () => {
    const h = await start();
    await h.tick();
    await open(h, HELMET.id);

    expect(recordPart('kind')).toBe('Uncommon cloth armor, helmet');
    expect(blockLines('number')).toContain('16 Armor');
    expect(blockLines('stat')).toEqual(['+2 Intellect', '+1 Spirit']);
    // This one is uncommon vendor stock, so the game derives no item level and no required
    // level for it, and what it DOES ask is a class, plus the set it belongs to.
    expect(blockLines('gate')).toContain('Classes: Mage, Priest, Warlock, Druid');
    expect(blockLines('gate').at(-1)).toContain('Sell price:');
  });

  // A swing, not a stat block: the two damage bounds, the speed, and the number a player
  // actually compares two weapons by, which the game computes rather than stores.
  it('works a weapon out to damage per second, as the game does', async () => {
    const h = await start();
    await h.tick();
    await open(h, WEAPON.id);

    const swing = WEAPON.weapon as { min: number; max: number; speed: number };
    const dps = (swing.min + swing.max) / 2 / swing.speed;

    expect(blockLines('number')[0]).toContain(`${String(swing.min)} - ${String(swing.max)} Damage`);
    expect(blockLines('number')[0]).toContain(`${dps.toFixed(1)} damage per second`);
  });

  // The numbers exist for a table id and for nothing else. An id learned off a roll has a
  // name and a quality and no stats at all, and the record has to be a name and a source
  // rather than a row of empty labels.
  it('draws no numbers at all for an id the table does not carry', async () => {
    const h = await start({ world: { prompts: [roll(UNKNOWN_ID, 'Gilded Censer', 'rare')] } });
    await h.tick();
    await open(h, UNKNOWN_ID);

    expect(blockLines()).toEqual([]);
    expect(recordPart('source')).toContain('from a loot roll');
  });

  // Until a square is clicked the record describes the first of them, so a full grid never
  // sits over an empty record that reads as a panel which has not finished loading.
  it('opens on the first square rather than on nothing', async () => {
    const h = await start();
    await h.tick();
    await only(h, 'Sableweb');

    expect(recordPart('name')).not.toBe('Pick an item');
    expect(recordPart('source').startsWith(drawnIds()[0] ?? '')).toBe(true);
  });

  // Every weapon in the game is filed under a model name nothing serves, so its icon slot is
  // permanently empty. A blank slot alone reads exactly like an id this addon made up, which is
  // the ambiguity the tooltip closes.
  it('says a weapon draws as text because the game ships no art for it', async () => {
    const h = await start();
    h.artFiles(new Set([HELMET.id]));
    await h.tick();
    search(WEAPON.name);
    await h.settle();

    expect(cellName(WEAPON.id)).toContain(WEAPON.name);
    expect(tipOver(cellEl(WEAPON.id))).toContain('ships no art');
  });

  // The table was derived at one game version and the player may be on another,
  // so a roll spelling an id differently is the only evidence available that a
  // rename has happened. Dropping it would throw that away silently.
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

  // The game keeps Warfare as two ratings and draws ONE line, the smaller of them, in its
  // tooltip and in its compare arrows alike. Forty-seven items carry the pair and every one of
  // them carries it twice over at the same value, so nothing in the shipped table can tell a
  // min from a max, a sum or an average: that is what the case below is for, and this one pins
  // that the line is drawn at all and reads the way the game's does.
  it('draws the Warfare pair as the single line the game draws', async () => {
    const h = await start();
    await h.tick();
    await open(h, WARFARE.id);

    const rating = Math.min(WARFARE.pvpOffenseRating ?? 0, WARFARE.pvpDefenseRating ?? 0);

    expect(rating).toBeGreaterThan(0);
    expect(blockLines('stat')).toContain(`+${String(rating)} Warfare`);
  });

  // The rule rather than the value, which needs a table of its own: no shipped row states the
  // two ratings differently, so a version taking the offense rating alone, or the larger of the
  // two, passes every case built on real content. It would over-report the moment content
  // separated them, which is the thing the game's own `Math.min` exists to prevent.
  it('takes the smaller of the two Warfare ratings, not the first or the larger', async () => {
    const h = await start({ table: LOPSIDED_WARFARE });
    await h.tick();
    await open(h, 'lopsided_warfare_ring');

    expect(blockLines('stat')).toContain('+4 Warfare');
  });

  // An honor price is not on the game's tooltip and is in this table on purpose: it is the only
  // price a Warfare piece has, since the honor gear declares no `buyValue` at all, and a codex
  // that draws a sell price and nothing else says the item cannot be bought.
  it('draws what a Quartermaster charges for a piece a vendor does not sell', async () => {
    const h = await start();
    await h.tick();
    await open(h, WARFARE.id);

    expect(WARFARE.priceHonor).toBeGreaterThan(0);
    expect(blockLines('gate')).toContain(`Honor price: ${String(WARFARE.priceHonor)}`);
  });

  // 63 pairs of rows in the table read as the same name, because the game resolves a heroic
  // variant's display name to its base's unchanged and says so in as many words. The tag is the
  // game's own answer to that and is the ONLY thing on either row that differs in words, so a
  // player searching "Direfang Quiver" can tell which of the two squares is which.
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

  // Unique-equipped is keyed on the item FAMILY rather than on the id: a heroic variant and its
  // base are one item for the wear rule, so a character wearing Thronebane cannot also wear the
  // heroic one. Both halves are on the record because neither is recoverable without the other:
  // the tag alone reads as "one of these", and the base id alone says nothing about wearing.
  it('says a legendary is unique-equipped and which item it counts as', async () => {
    const h = await start();
    await h.tick();
    await open(h, UNIQUE.id);

    expect(UNIQUE.uniqueEquipped).toBe(true);
    expect(blockLines('gate')).toContain('Unique-Equipped, so one worn copy per item');
    expect(blockLines('gate')).toContain(`Heroic upgrade of ${String(UNIQUE.heroicOf)}`);
  });

  // The other side of it, which is what keeps the tag meaningful: the table states the flag on
  // six rows and the addon must not infer it for a seventh. An epic Warfare piece is the row a
  // version deriving "unique" from anything but the flag would get wrong.
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

  // Until the manifest lands `icon.item` is optimistic, so every id looks as
  // though it has art. Reporting zero art-less items in that window would be a
  // measurement nobody took.
  //
  // Read off the counting line's own tooltip, which is where that sentence lives: it is a
  // caveat about the grid rather than a figure, it is the same words every session, and a
  // browser that spent one of its lines explaining itself would be a panel of text again.
  it('waits for the art manifest before counting what draws as text', async () => {
    const h = await start();
    await h.tick();

    expect(tipOver(document.querySelector('[data-role="coverage"]'))).toContain(
      'reading the art manifest',
    );
  });

  // Built from the shared services directly, because the spy has to exist before
  // the addon's first line: `preloadItems` is called during boot, so a spy
  // installed after mounting replaces a promise the addon is already holding.
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
    shared.addonData(FQID, 'items.json', TABLE_TEXT);

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
    // Why the count is not zero, which is what it reads as at game 0.36.0 in a real session:
    // art is commissioned behind content rather than absent by design, so the line says the
    // figure will move rather than naming a category that never gets one.
    expect(said).toContain('commissions art behind content');
  });
});

// The controls, which are what makes the window a browser rather than a search box. Every one
// of them narrows a fact the table already carries, so each case here is one control against
// one row of the shipped file.
describe('the filters', () => {
  it('shelves the table by kind, and leaves the other shelves out', async () => {
    const h = await start();
    await h.tick();
    pressTab('Weapon');
    await h.settle();

    expect(drawnIds()).toContain(WEAPON.id);
    expect(drawnIds()).not.toContain(HELMET.id);
  });

  // Nothing lit is EVERY tier rather than none, which is the only reading a chip row can be
  // started from: six chips all lit would make the first press a narrowing to five.
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

  // Counted rather than sampled, and counted off the shipped file rather than typed. The grid
  // is capped, so a case asserting that one helmet is in it and one sword is not would pass on
  // alphabetical position with the filter deleted: `acolytes_circlet` is inside the first 120
  // rows of the table and `worn_sword` is not.
  it('narrows to one equipment slot', async () => {
    const helmets = TABLE.filter((row) => row.slot === 'helmet');
    const h = await start();
    await h.tick();
    chooseSlot('helmet');
    await h.settle();

    expect(drawnIds()).toHaveLength(helmets.length);
    expect(drawnIds()).toContain(HELMET.id);
  });

  // The one filter that is about the PLAYER. An id is seen when this addon has proven it
  // exists from the world rather than from its own file, which is what the collection line
  // counts and what this narrows to.
  it('narrows to what this character has actually laid eyes on', async () => {
    const h = await start({ world: { inventory: [{ itemId: JUNK.id, count: 3 }] } });
    await h.tick();
    toggleSeen();
    await h.settle();

    expect(drawnIds()).toEqual([JUNK.id]);
  });

  // Four orders because the questions are different, and the three numeric ones are all a
  // "best" question, so they run highest first with the alphabet breaking ties. Quality sorts
  // by RANK rather than by its word, which is the one an alphabet gets exactly backwards.
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
    pressTab('Quest');
    pressChip('legendary');
    await h.settle();

    expect(drawnIds()).toEqual([]);
    expect(lineFor('status')).toContain('Nothing matches these filters');
  });
});

// The panel is the smaller half of this addon. The bus is what `satchel` and `ledgerline`
// read to name an item, so the payload shape is the part that has to hold still.
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
      sellValue: HELMET.sellValue,
      source: 'table',
    });
  });

  // What a vendor pays is the one number in the table a consumer cannot approximate: `satchel`
  // totals a bag with it and `ledgerline` reads it as the floor a listing is worth beating. It
  // is copper, the same unit every price on the wire is in, so nothing has to convert.
  it('publishes the sell price in copper', async () => {
    const h = await start();
    await h.settle();

    expect(field(publishedFor(h.sent, PRICED.id) ?? {}, 'sellValue')).toBe(PRICED.sellValue);
    expect(PRICED.sellValue).toBe(5000);
  });

  // A subscriber naming an id out of a bag gets the base item's name for a heroic variant,
  // because that IS the game's name for it, so 63 pairs arrive as one name twice. The base id is
  // the only thing that separates them, it rides no wire payload, and the alternative left to a
  // subscriber is reading an id prefix, which is the guess this addon exists to make
  // unnecessary. `uniqueEquipped` is deliberately not published beside it: nothing draws
  // equipment yet, and a field with no reader is a promise kept for nobody.
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

  // The same rule the strings follow, and it matters more for a price: a consumer adding up a
  // bag has to be able to tell an item worth nothing to a vendor from one whose worth nobody
  // published, and a `0` reads as the first.
  it('leaves a number the table does not state out rather than sending a zero', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, NO_QUALITY.id) ?? {};

    expect(NO_QUALITY.sellValue).toBeUndefined();
    expect(record).not.toHaveProperty('sellValue');
    expect(record).not.toHaveProperty('itemLevel');
    expect(record).not.toHaveProperty('requiredLevel');
  });

  // Absent and empty are different answers, and a subscriber checking
  // `payload.quality` has no way to tell an item nobody knows the quality of
  // from one whose quality is the empty string.
  it('leaves an unknown field out rather than sending it empty', async () => {
    const h = await start();
    await h.settle();

    const record = publishedFor(h.sent, NO_QUALITY.id);

    expect(record).not.toHaveProperty('quality');
    expect(record).not.toHaveProperty('slot');
    expect(field(record ?? {}, 'name')).toBe(NO_QUALITY.name);
  });

  // The `toEqual` is the half that matters as much as the count. A roll spells a name and a
  // quality and says nothing about what the item is worth, so a version that filled the numbers
  // in from somewhere would make a subscriber's `sellValue` check mean "somebody mentioned this
  // item once" rather than "the table priced this".
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

  // The art name is provenance for a picture, and a subscriber already has the identical
  // fallback. Publishing it would rank a labelled guess above that fallback one hop away, with
  // the label lost on the way.
  //
  // The ask is what makes this bite: the batch on boot goes out before the art manifest can
  // answer, so a version that published art names would still look clean there. The batch length
  // is asserted for the same reason.
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

  // The unnamed half of the same refusal. An id the codex can prove exists and
  // cannot name is a row on screen and must not be a record on the bus: a
  // subscriber has no use for `{ id, name: '' }` and every use for silence.
  it('never publishes an id nothing can name', async () => {
    const h = await start({ world: { inventory: [{ itemId: UNKNOWN_ID, count: 1 }] } });
    await h.tick();
    h.sent.length = 0;
    h.ask();
    await h.settle();

    expect(publishedFor(h.sent, UNKNOWN_ID)).toBeUndefined();
    expect(h.sent[0]?.payload).toHaveLength(TABLE_SIZE);
  });

  // A publisher that only emitted on change tells an addon that started later
  // nothing at all, which is every consumer installed after this one.
  it('answers an ask from a fork with everything it knows', async () => {
    const h = await start();
    await h.settle();
    h.sent.length = 0;
    h.ask();

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.topic).toBe('items');
    expect(h.sent[0]?.payload).toHaveLength(TABLE_SIZE);
  });

  it('stamps from rather than letting the addon claim a sender', async () => {
    const h = await start();
    await h.settle();

    expect(h.sent[0]?.from).toBe('official/lorebind');
  });
});

describe('learning from rolls', () => {
  // A roll open before the addon started fires no watch handler, because a watch
  // key reports a CHANGE and the world is already live when an addon's body
  // runs. The sweep is what closes that window.
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

  // An empty grid reads as a measurement of zero, which is the one thing it
  // never means. Saying which search found nothing is the alternative.
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
  // The panel says the table could not be read rather than sitting there empty
  // implying the game has no items in it.
  it('says so rather than drawing an empty codex', async () => {
    const h = await start({ table: '{"items":"not an array"}' });
    await h.tick();

    expect(drawnIds()).toEqual([]);
    expect(lineFor('status')).toContain('could not be read');
  });

  // A row the file's own shape does not admit is dropped rather than half-read. The file is
  // content and a future generator could emit a kind this addon does not know; taking such a row
  // would put a name on screen with a `kind` nothing can render.
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
  // How another addon borrows the codex for a grid it drew itself, which is the
  // half of the name service that is not on the bus.
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

  // The setting has to mean something after the fact, not only at start-up. A version that
  // merely declined to add tooltips would leave every one already on screen answering.
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
