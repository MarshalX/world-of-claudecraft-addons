// @vitest-environment happy-dom

// Ledgerline, run through the real loader.
//
// The recording cases come first, because the addon is a ledger before it is a panel and the
// screen can be right while nothing was saved. Every write path here is asserted on the store:
// a pane redrawn from memory looks identical whether or not the write behind it happened.
//
// `world.market` answers `near`, `away` or `unknown`, and only the first carries a page.
// Recording on `away` would erase the ledger the moment the player walked three paces from the
// Merchant, and drawing `away` as an empty market would tell a player standing in a town that
// nobody is selling anything. Both are pinned.
//
// The reconnect blip cannot be seen from the state. The online client force-nulls its own
// market mirror on reconnect, so one snapshot of `away` arrives while the player is still
// standing at the Merchant. The guard is `woc.net.state.reconnects`, driven here from both
// sides: a bumped count holds the page, and an unbumped one is believed at once. The third
// case decides the shape of the guard: a watch key fires on a change, so a player who stays
// away sends no second reading, and a guard that waited for one would leave the panel saying
// "resyncing" for the rest of the session. Only a timer satisfies all three.
//
// The unit price is the arithmetic worth pinning. `price` is the total buyout for the whole
// stack, so a series that compares totals is comparing stack sizes. The fixtures mix a stack
// of 20 against a single at the same total, which reads identically to a total-based series and
// ten times apart to a correct one.
//
// The undercut check is pinned on what it refuses to say. Name-sorted, the server groups the
// others section by display name and then by price, so a block is contiguous and ascending and
// its first row is the cheapest competitor. Two answers are therefore not available: an item
// with no block on the page reads as "not on this page" rather than as uncontested, and a block
// that begins at the very first row of a page after the first may have started on the page
// before. Price-sorted (game 0.37.1), the same rows arrive spread across the book by price, so
// the refusal widens to every later page and page 0 becomes the one certain reading.
//
// The cut and the cap are read, so the fixtures use figures that are not the game's own 5
// percent and 12 listings: an addon that hardcoded either would pass against a fixture that
// agreed with it and fail here.
//
// The bus contract: a publisher that is not installed is an ordinary state, a fork's fqid
// answers as readily as the official one, and the ask goes out after the subscription so that a
// synchronous answer reaches a handler that already exists.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_SENDER } from '../../loader/src/runtime/bus/hub.ts';
import { loadAddon } from '../../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../../loader/src/shared/protocol.ts';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { inSeries } from '../../loader/src/shared/sequence.ts';
import {
  addonNamespace,
  characterNamespace,
  perCharacterKey,
} from '../../loader/src/shared/storage-keys.ts';
import { type MountInput, mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { HELLO_FRAME, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import {
  createSharedServices,
  type SharedHarness,
  WALL_CLOCK_MS,
} from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
import FLOORS_TEXT from './floors.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the satchel suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
const FQID = 'official/ledgerline';
const NAMESPACE = addonNamespace(FQID);
const CHARACTER_NAMESPACE = characterNamespace(FQID);

/**
 * The ledger's key, which is the answer to what a price history is of. Account-wide, so every
 * character shares it, and scoped to the market: the realm off the hello frame and the
 * deployment the shared fake reports. Written out rather than imported, because the addon is a
 * function body with no exports and a key both sides computed the same way would prove nothing.
 */
const LEDGER_KEY = 'ledger/pbe/Claudemoon';
/** Where this install's own id lives, which is the one account key that is not a ledger. */
const INSTALL_KEY = 'install';

/** The stamps are one character's, so the loader's own per-character key holds them. */
const MINE_KEY = perCharacterKey('pbe', 'Claudemoon/Marshal', 'mine-seen');

/**
 * The sale record, which is per character for the same reason the stamps are: the Merchant
 * keeps a collection per SELLER, so a completed sale is one character's and not the realm's.
 */
const SOLD_KEY = perCharacterKey('pbe', 'Claudemoon/Marshal', 'sold');

/** How long a write is held before it lands, and how long one trip lasts. */
const WRITE_HOLD_MS = 2000;
const VISIT_WINDOW_MS = 10 * 60 * 1000;
/**
 * The ask a follower sends, which `woc.bus.follow` derives from the topic it follows.
 *
 * `items:ask` rather than the `item:ask` this protocol shipped with. The publisher answers
 * both, so nothing between these addons moved; what a fork publishing the old protocol sees is
 * an ask under the new name. See the note on the topics in `main.js`.
 */
const ASK_TOPIC = 'items:ask';
/** A fork's fqid on purpose: a consumer that named the official one would miss it. */
const PUBLISHER = 'someone/lorebind';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The Merchant's terms, deliberately not the game's own 5 and 12. Both ride the payload, so an
 * addon that wrote either down would agree with a fixture that used the real ones and could
 * never be caught.
 */
const CUT_PCT = 7;
const MAX_LISTINGS = 9;

/** How long the addon holds a page after a reconnect before believing the away. */
const RESYNC_GRACE_MS = 2000;

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

/** One row of the Merchant's book, under the game's own field names. */
interface Listing {
  id: number;
  sellerName: string;
  itemId: string;
  count: number;
  /** The TOTAL buyout for the whole stack, which is what the wire carries. */
  price: number;
  mine: boolean;
  house: boolean;
}

/**
 * One completed sale of the player's own, as the Merchant's pending ledger carries it. No id
 * and no clock: the rows are identified by their POSITION in a queue that only ever grows
 * until a collect empties it, which is the whole reason the addon needs a position of its own.
 */
interface Sale {
  itemId: string;
  count: number;
  /** GROSS buyout the buyer paid for the whole stack. */
  price: number;
  /** NET copper it added to the collection, after the Merchant's cut. */
  proceeds: number;
  buyerName: string;
}

interface MarketPayload {
  listings: Listing[];
  totalCount: number;
  filter: string;
  itemType: string;
  subtype: string;
  armorClass: string;
  primaryStat: string;
  rarity: string;
  /** The browse ORDER, from game 0.37.1. A server older than that sends none. */
  sort?: string;
  page: number;
  pageCount: number;
  collectionCopper: number;
  collectionItems: Array<{ itemId: string; count: number }>;
  /** Optional, because a server that predates game 0.35.0 sends neither of these at all. */
  collectionSales?: Sale[];
  collectionSalesOmitted?: number;
  cutPct: number;
  maxListings: number;
  myListingCount: number;
}

interface MarketState {
  /** Null is what the SERVER sends for a player who is not at the counter. */
  market: MarketPayload | null;
  collectPending: boolean;
}

/**
 * One recorded visit, as it lands in storage: when, cheapest, dearest, query, and when the trip
 * BEGAN. An array rather than an object because the ledger is one value holding every item a
 * player has browsed, and field names repeated per visit would be most of the file. The times are
 * in seconds for the same reason.
 *
 * The fifth slot is APPENDED, which is the whole migration: a ledger written before it existed
 * has nothing there, `parseVisit` supplies the only stamp it has, and no migration pass runs.
 * `first` exists because `at` SLIDES, moving forward as a trip is paged through, so it cannot
 * identify a visit across two copies of one ledger. The start does not move.
 */
type StoredVisit = [number, number, number, string, number?];

interface StoredLedger {
  items: Record<string, StoredVisit[]>;
}

interface StoredStamp {
  id: number;
  price: number;
  count: number;
  seen: number;
}

/**
 * One drained sale as it lands in storage: when, how many, gross, net, who bought it, and which
 * install drained it.
 *
 * The sixth slot is appended for the reason the fifth on a visit is, and it is what lets an
 * import replace one device's rows without touching another's. A row written before it existed
 * carries an empty origin, which can only mean this device: the store is local and nothing else
 * has ever written to it.
 */
type StoredSale = [number, number, number, number, string, string?];

interface StoredSold {
  sales: Record<string, StoredSale[]>;
  /** How far into the CURRENT pending ledger the addon has read. */
  read: number;
  /** The last row it read, so a queue it has not seen before is not mistaken for that one. */
  anchor: string;
  /** Sales that happened and were dropped before the addon could read them. */
  lost: number;
}

function listing(patch: Partial<Listing> = {}): Listing {
  return {
    id: 1,
    sellerName: 'Someone',
    itemId: 'ore',
    count: 1,
    price: 100,
    mine: false,
    house: false,
    ...patch,
  };
}

function sale(patch: Partial<Sale> = {}): Sale {
  return { itemId: 'ore', count: 1, price: 500, proceeds: 465, buyerName: 'Bragg', ...patch };
}

function marketPayload(patch: Partial<MarketPayload> = {}): MarketPayload {
  return {
    listings: [],
    totalCount: 0,
    filter: '',
    itemType: '',
    subtype: '',
    armorClass: '',
    primaryStat: '',
    rarity: '',
    sort: 'name',
    page: 0,
    pageCount: 1,
    collectionCopper: 0,
    collectionItems: [],
    cutPct: CUT_PCT,
    maxListings: MAX_LISTINGS,
    myListingCount: 0,
    ...patch,
  };
}

/** What the server derives from the rows it is sending, kept in step with them. */
function pageOf(rows: Listing[]): Partial<MarketPayload> {
  return {
    listings: rows,
    totalCount: rows.length,
    myListingCount: rows.filter((row) => row.mine).length,
  };
}

/** A page as game 0.35.0 sends one, carrying the pending sale ledger even when it is empty. */
function page(rows: Listing[], patch: Partial<MarketPayload> = {}): MarketPayload {
  return marketPayload({
    ...pageOf(rows),
    collectionSales: [],
    collectionSalesOmitted: 0,
    ...patch,
  });
}

/**
 * The same page from a server that predates the ledger, which sends NEITHER field.
 *
 * Built without them rather than built and stripped, because an absent key and a key holding
 * undefined are the same thing to a reader asking `Array.isArray` and different to one asking
 * `in`, and only the first of the two is what an older wire actually does.
 */
function olderPage(rows: Listing[], patch: Partial<MarketPayload> = {}): MarketPayload {
  return marketPayload({ ...pageOf(rows), ...patch });
}

/** The one file this addon ships, or nothing, which is the failed-fetch case. */
function floorsFor(floors: string | null | undefined): Record<string, string> {
  if (floors === null) {
    return {};
  }
  return { 'floors.json': floors ?? FLOORS_TEXT };
}

interface StartOptions {
  settings?: Record<string, unknown>;
  storage?: FakeStorage;
  state?: Partial<MarketState>;
  /** Leave the world out, which is where an addon's first line actually runs. */
  world?: boolean;
  /** Start with no entity decoded, which is what `unknown` actually is. */
  empty?: boolean;
  /** `null` is the player whose floor table never arrived. Anything else replaces the real one. */
  floors?: string | null;
}

interface LedgerHarness extends SharedHarness {
  fqid: string;
  /** Change what the Merchant is sending, the way a snapshot merge does. */
  send: (patch: Partial<MarketState>) => void;
  /** Re-read the world and let the addon's queued repaint and writes settle. */
  settle: () => Promise<void>;
  /** Publish an item record as another addon would. */
  publish: (payload: unknown, from?: string) => void;
  /** Publish the batch form, which is how a publisher answers a catch-up. */
  publishAll: (rows: unknown, from?: string) => void;
  /** The socket came back, which is what the away blip rides on. */
  reconnect: () => void;
}

function installedRow(): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    manifest: parseManifest(MANIFEST_TEXT),
    enabled: true,
    pin: null,
  };
}

function typeSearch(value: string): void {
  const input = document.querySelector<HTMLInputElement>('.woc-ledgerline-pane input');
  if (input !== null) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
}

/**
 * Let every queued microtask run, without an await inside a loop. The addon reads its stored
 * ledger through `storage.keys()` and then one `get` per item, so its start-up is several
 * promise hops deep and a fixed pair of flushes would settle it only by luck.
 */
function flush(times: number): Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  for (let step = 0; step < times; step += 1) {
    chain = chain.then(() => undefined);
  }
  return chain;
}

const MICROTASKS = 24;

/** Code point order, since `useArraySortCompare` refuses the implicit one. */
function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

function rowIn(list: string, key: string): HTMLElement | null {
  return document.querySelector(`[data-list="${list}"] [data-row="${key}"]`);
}

function keysIn(list: string): string[] {
  return [...document.querySelectorAll(`[data-list="${list}"] [data-row]`)].map(
    (el) => el.getAttribute('data-row') ?? '',
  );
}

function partOf(el: Element | null, selector: string): string {
  return el?.querySelector(selector)?.textContent ?? '';
}

function labelOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-label');
}

/**
 * The figure at the end of a row, as it is announced. A price is drawn as coins: discs carrying
 * the units and bare numbers beside them, so the text content of that slot is `low44` and says
 * nothing about units. The kit puts the whole figure in an `aria-label` in words, which is both
 * what a screen reader gets and the only readable assertion to make here.
 */
function figureOf(list: string, key: string): string {
  const value = rowIn(list, key)?.querySelector('.woc-bar-value');
  return value?.getAttribute('aria-label') ?? partOf(rowIn(list, key), '.woc-bar-value');
}

function detailOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-detail');
}

/** The width the kit painted a row's fill at, which is the one magnitude every pane now draws. */
function fillOf(list: string, key: string): string {
  const fill = rowIn(list, key)?.querySelector<HTMLElement>('.woc-bar-fill');
  return fill?.style.width ?? '';
}

function lineFor(role: string): string {
  return document.querySelector(`[data-role="${role}"]`)?.textContent ?? '';
}

/** One figure off the status strip, without the label beside it. */
function statFor(role: string): string {
  const chip = document.querySelector(`[data-role="${role}"]`);
  return chip?.querySelector('.woc-ledgerline-stat-value')?.textContent ?? '';
}

function tipOver(el: Element | null): string {
  el?.dispatchEvent(new Event('pointerenter'));
  return document.getElementById('woc-tooltip')?.textContent ?? '';
}

function tipOn(list: string, key: string): string {
  return tipOver(rowIn(list, key));
}

/** The tooltip the header strip carries, which is where the page number and the cut moved. */
function tipOnStrip(): string {
  return tipOver(document.querySelector('[data-role="status"]'));
}

function frameTitle(): string {
  return document.querySelector('[data-woc-frame="ledger"]')?.getAttribute('aria-label') ?? '';
}

/**
 * The game's own world object, with the market as a getter, because that is what the loader
 * reads through: the suite changes what the Merchant is sending and the read moves with it,
 * exactly as it does when a player walks up to the counter.
 */
function fakeWorld(state: MarketState, player: unknown, empty: boolean): Record<string, unknown> {
  const entities = new Map<number, unknown>();
  if (!empty) {
    entities.set(PLAYER_ID, player);
  }
  return {
    entities,
    player,
    known: [],
    // The WIRE name, which is what the loader reads off the game's own world object.
    get marketInfo(): MarketPayload | null {
      return state.market;
    },
    get marketCollectPending(): boolean {
      return state.collectPending;
    },
  };
}

async function start(options: StartOptions = {}): Promise<LedgerHarness> {
  const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
  const state: MarketState = { market: null, collectPending: false, ...options.state };
  const storage = options.storage ?? createFakeStorage();

  const input: MountInput = {
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings: options.settings ?? {},
    storage,
    // The REAL table by default, so a fixture priced under a real vendor floor is a deal for the
    // reason a player's would be. `floors: null` is the addon without it, which is what a player
    // whose fetch failed has: every estimate still works and nothing is certain any more.
    data: floorsFor(options.floors),
  };
  if (options.world !== false) {
    input.game = Promise.resolve({ world: fakeWorld(state, player, options.empty === true) });
  }
  const harness = await mountAddon(input);
  teardown.push(harness.dispose);
  harness.inbound(HELLO_FRAME);

  const settle = async (): Promise<void> => {
    harness.shared.world.watcher.poll();
    await flush(MICROTASKS);
    vi.advanceTimersToNextFrame();
    // The repaint is `woc.paint`, which runs on the LOADER'S one frame loop rather than on an
    // animation frame of the addon's own, so a settle has to step that loop as well as the
    // clock. The fake runs the real loop over a clock a suite drives, so the coalescing under
    // test is the loader's own: one tick is one frame, however many repaints were asked for.
    harness.frames.tick();
    await flush(MICROTASKS);
  };
  await settle();

  const reconnects = { count: 0 };
  return {
    ...harness,
    send: (patch) => {
      Object.assign(state, patch);
    },
    settle,
    publish: (payload, from = PUBLISHER) => {
      harness.shared.bus.emit(from, 'item', payload);
    },
    publishAll: (rows, from = PUBLISHER) => {
      harness.shared.bus.emit(from, 'items', rows);
    },
    reconnect: () => {
      reconnects.count += 1;
      harness.netState({ reconnects: reconnects.count });
    },
  };
}

/**
 * Let a held write land. The ledger is one value, so writes are coalesced behind a timer rather
 * than made per page. Every assertion on the store goes through this, and one that forgot would
 * read the state before the page it just delivered.
 */
/** The most recent toast on screen, which is where an import reports what it did. */
function lastToast(): string {
  return [...document.querySelectorAll('.woc-toast')].at(-1)?.textContent ?? '';
}

/** The button a player presses, by the label it carries. */
function press(label: string): void {
  const el = document.querySelector<HTMLButtonElement>(
    `[data-role="transfer"] [data-action="${label}"]`,
  );
  if (el === null) {
    throw new Error(`no ${label} button`);
  }
  el.click();
}

/**
 * Press Export and read back what it wrote.
 *
 * Through the real button and the real blob, because the file is the contract: a suite that
 * called an encoder directly would pass while the button wrote nothing, and the download is the
 * only route a player has.
 */
async function exportFrom(): Promise<Record<string, unknown>> {
  const blobs: Blob[] = [];
  const make = URL.createObjectURL;
  URL.createObjectURL = (blob: Blob): string => {
    blobs.push(blob);
    return 'blob:test';
  };
  URL.revokeObjectURL = (): void => undefined;
  try {
    press('export');
  } finally {
    URL.createObjectURL = make;
  }
  const written = blobs.at(-1);
  if (written === undefined) {
    throw new Error('Export wrote no file');
  }
  return JSON.parse(await written.text()) as Record<string, unknown>;
}

/**
 * Press Import and hand it a file.
 *
 * The input is built inside the handler and clicked, so the fake stands in for the pick: the
 * click is intercepted, `files` is defined on that instance, and `change` is dispatched, which is
 * the sequence a real pick produces.
 */
async function importInto(payload: unknown): Promise<void> {
  const text = JSON.stringify(payload);
  const { click } = HTMLInputElement.prototype;
  HTMLInputElement.prototype.click = function fake(this: HTMLInputElement): void {
    Object.defineProperty(this, 'files', {
      configurable: true,
      value: [{ size: text.length, text: () => Promise.resolve(text) }],
    });
    this.dispatchEvent(new Event('change'));
  };
  try {
    press('import');
  } finally {
    HTMLInputElement.prototype.click = click;
  }
  await flush(MICROTASKS);
}

async function saved(): Promise<void> {
  vi.advanceTimersByTime(WRITE_HOLD_MS);
  await flush(MICROTASKS);
}

/** The ledger as it landed in the store, or nothing where none was written. */
function storedLedger(h: LedgerHarness): StoredLedger | undefined {
  return h.hub.dump()[`${NAMESPACE}/${LEDGER_KEY}`] as StoredLedger | undefined;
}

/** One item's recorded visits, oldest first, or none where the item is not held. */
function visitsFor(h: LedgerHarness, itemId: string): StoredVisit[] {
  const ledger = storedLedger(h);
  if (ledger === undefined) {
    return [];
  }
  return ledger.items[itemId] ?? [];
}

function storedItems(h: LedgerHarness): string[] {
  const ledger = storedLedger(h);
  if (ledger === undefined) {
    return [];
  }
  return Object.keys(ledger.items).sort();
}

/** Every key this addon owns, which is the point of the whole storage model. */
function storedKeys(h: LedgerHarness): string[] {
  return Object.keys(h.hub.dump())
    .filter((key) => key.startsWith(`${NAMESPACE}/`))
    .map((key) => key.slice(`${NAMESPACE}/`.length))
    .sort();
}

function storedStamps(h: LedgerHarness): StoredStamp[] {
  return (h.hub.dump()[`${CHARACTER_NAMESPACE}/${MINE_KEY}`] as StoredStamp[] | undefined) ?? [];
}

/** What nothing written down looks like, so every reading below is of the same shape. */
const NO_SOLD: StoredSold = { sales: {}, read: 0, anchor: '', lost: 0 };

function storedSold(h: LedgerHarness): StoredSold {
  return (h.hub.dump()[`${CHARACTER_NAMESPACE}/${SOLD_KEY}`] as StoredSold | undefined) ?? NO_SOLD;
}

/** One item's drained sales, oldest first, or none where nothing of it has sold. */
function salesFor(h: LedgerHarness, itemId: string): StoredSale[] {
  return storedSold(h).sales[itemId] ?? [];
}

function lostSales(h: LedgerHarness): number {
  return storedSold(h).lost;
}

/** Open one of the panel's tabs, clicked at the DOM the way a player reaches it. */
function openTab(label: string): void {
  const button = [...document.querySelectorAll('#woc-addons .woc-tab')].find(
    (el) => el.textContent === label,
  );
  (button as HTMLButtonElement | undefined)?.click();
}

function seedLedger(storage: FakeStorage, items: Record<string, StoredVisit[]>): void {
  storage.remote(NAMESPACE, LEDGER_KEY, { items });
}

/**
 * One stored visit, in the units the store holds: seconds, and copper per item.
 *
 * The two stamps are an OBJECT rather than two more parameters, because a visit already carries
 * four positional values and a fifth and sixth loose number is a call nobody can read.
 */
function visit(at: number, low: number, high = low, said: VisitSaid = {}): StoredVisit {
  return [
    Math.round(at / 1000),
    low,
    high,
    said.query ?? '',
    Math.round((said.first ?? at) / 1000),
  ];
}

interface VisitSaid {
  query?: string;
  first?: number;
}

/** The same visit as a ledger written before `first` existed holds it: four slots, no start. */
function legacyVisit(at: number, low: number, high = low, query = ''): StoredVisit {
  return [Math.round(at / 1000), low, high, query] as StoredVisit;
}

function seedSold(storage: FakeStorage, held: Partial<StoredSold>): void {
  storage.remote(CHARACTER_NAMESPACE, SOLD_KEY, {
    sales: {},
    read: 0,
    anchor: '',
    lost: 0,
    ...held,
  });
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  it('asks for the world, the socket, a frame, a sound, a store and a key', () => {
    expect(parseManifest(MANIFEST_TEXT).permissions).toEqual([
      'world.read',
      'net.read',
      'ui',
      'sound',
      'storage',
      'keys',
    ]);
  });

  // The floors table is what makes a vendor-backed deal certain rather than estimated, and it
  // is only reachable because the manifest declares it: `woc.data` checks its argument against
  // this list, so an undeclared file is refused rather than fetched.
  it('declares the vendor floor table it ships', () => {
    expect(parseManifest(MANIFEST_TEXT).data).toEqual(['floors.json']);
  });

  // The topic it consumes comes from a publisher the loader cannot require, so the
  // manifest says so and gates nothing.
  it('names lorebind as a companion', () => {
    expect(parseManifest(MANIFEST_TEXT).companions).toEqual(['lorebind']);
  });
});

// The addon is a ledger before it is a panel, and every case here asserts on the STORE.
describe('what is written down', () => {
  it('records a browsed page as one visit per item', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', count: 1, price: 500 }),
        listing({ id: 2, itemId: 'cloth', count: 4, price: 800 }),
      ]),
    });
    await h.settle();
    await saved();

    expect(storedItems(h)).toEqual(['cloth', 'ore']);
    // The cheapest and the dearest ask PER ITEM, at the wall clock, under the query the
    // page came from. The cloth is a stack of four for 800, so it is 200 each.
    expect(visitsFor(h, 'ore')).toEqual([visit(WALL_CLOCK_MS, 500)]);
    expect(visitsFor(h, 'cloth')).toEqual([visit(WALL_CLOCK_MS, 200)]);
  });

  // A namespace is a prefix on one flat store shared by every addon, so a key per item costs a
  // scan of everything the loader holds, a bridge round trip per item on the way in, and a
  // cross-tab watcher left behind for each. This is the guard on the whole storage model:
  // however much a player browses, it is one key.
  it('keeps the whole ledger in one key however many items are on the page', async () => {
    const h = await start();
    const rows = Array.from({ length: 40 }, (_unused, at) =>
      listing({ id: at + 1, itemId: `item_${String(at)}`, price: 100 + at }),
    );
    h.send({ market: page(rows) });
    await h.settle();
    await saved();

    // The install id is the only other key, and it is one value for the life of the install
    // rather than anything that grows with browsing.
    expect(storedItems(h)).toHaveLength(40);
    expect(storedKeys(h)).toEqual([INSTALL_KEY, LEDGER_KEY]);
  });

  // The spread of one page is not a price moving: those asks are the same moment. What
  // is kept is what the trip found, and a second look ten minutes later is the same trip.
  it('reads several pages of one visit as a single reading', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 300 })]) });
    await h.settle();
    await saved();

    // One reading, holding the cheapest and the dearest ask of the whole trip, stamped when the
    // player finished looking and carrying the moment they started. Both stamps matter and they
    // are different: the end is what keeps four pages one visit, and the start is what lets two
    // copies of this ledger agree that they hold the same reading.
    expect(visitsFor(h, 'ore')).toEqual([
      visit(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2, 300, 500, { first: WALL_CLOCK_MS }),
    ]);
  });

  it('starts a new reading once the player has been away for a while', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS + HOUR_MS);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 300 })]) });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')).toHaveLength(2);
  });

  // The rule this feature turns on. The server sends nothing for a counter the player is not
  // standing at, and recording that as an empty market would erase the ledger the moment they
  // walked away from it.
  it('records nothing at all while the player is away', async () => {
    const h = await start();
    h.send({ market: null });
    await h.settle();
    await saved();

    expect(storedItems(h)).toEqual([]);
  });

  it('keeps a recorded price when the player walks away', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.send({ market: null });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')).toHaveLength(1);
  });

  // A price the player chose is not a reading of what the market is asking, and folding
  // it in would put their own hopeful price into the low they are judging against.
  it('leaves the player own listings out of the price series', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500, mine: true })]) });
    await h.settle();

    expect(storedItems(h)).toEqual([]);
  });

  it('leaves the house stock out unless the setting says otherwise', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500, house: true })]) });
    await h.settle();

    expect(storedItems(h)).toEqual([]);
  });

  it('records the house stock when the setting says to', async () => {
    const h = await start({ settings: { 'record-house': true } });
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500, house: true })]) });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')).toHaveLength(1);
  });

  // The stamp is a wall clock reading, pinned against the monotonic one: the two are far apart
  // here on purpose, because a row stored in one session and read in the next is exactly the
  // case a monotonic stamp gets silently wrong.
  it('stamps a recording with the wall clock rather than the monotonic one', async () => {
    const h = await start();
    h.setWallClock(WALL_CLOCK_MS + DAY_MS);
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')[0]?.[0]).toBe((WALL_CLOCK_MS + DAY_MS) / 1000);
  });

  // The echo is the only thing that can see a fresh join reset the server-side query while the
  // window's own controls survive, so a series that dropped it would mix a filtered reading with
  // an unfiltered one and never be able to say which was which.
  it('records which query produced a reading', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore' })], { filter: 'ore', rarity: 'rare' }),
    });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')[0]?.[3]).toContain('ore');
    expect(visitsFor(h, 'ore')[0]?.[3]).toContain('rare');
  });

  // A reading taken under a filter and one taken over the whole book are answers to
  // different questions, so the second never merges into the first however close behind
  // it the player ran the search.
  it('starts a new reading when the query changes inside one visit', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 300 })], { filter: 'ore' }) });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')).toHaveLength(2);
  });

  it('reads a stored ledger back in the next session', async () => {
    const storage = createFakeStorage();
    seedLedger(storage, { ore: [visit(WALL_CLOCK_MS, 500)] });
    const h = await start({ storage });
    await h.settle();

    expect(keysIn('prices')).toEqual(['ore']);
    expect(figureOf('prices', 'ore')).toContain('5 silver');
  });

  // The question this key exists to answer. A market belongs to a realm, so two of them in one
  // ledger would be two economies averaged into a low that is true of neither. Every character
  // on one realm shares the history; a character on another shares none of it.
  it('keeps another realm apart, and reads it back for the character in play', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    await saved();

    // The same account, logged in on a character somewhere else. The realm rides the
    // hello frame, and the loader's own character key is what this addon reads it from.
    h.inbound({ ...HELLO_FRAME, realm: 'Ashmere' });
    // Nowhere near a counter, which is where a session starts: the page the other realm
    // was showing is not a page of this one's book.
    h.send({ market: null });
    await h.settle();
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 900 })]) });
    await h.settle();
    await saved();

    expect(storedKeys(h)).toEqual([INSTALL_KEY, LEDGER_KEY, 'ledger/pbe/Ashmere'].sort());
    expect(visitsFor(h, 'ore')).toEqual([visit(WALL_CLOCK_MS, 500)]);
    // Nothing of the first realm is on screen: the panel is the market in front of you.
    expect(figureOf('prices', 'ore')).toBe('low 9 silver');
  });

  it('drops a stored reading older than the retention setting', async () => {
    const storage = createFakeStorage();
    seedLedger(storage, { ore: [visit(WALL_CLOCK_MS - 40 * DAY_MS, 500)] });
    const h = await start({ storage, settings: { 'history-days': 30 } });
    await h.settle();

    expect(keysIn('prices')).toEqual([]);
  });
});

// The nearest honest thing to a remaining time, because no wired row carries an expiry.
describe('when a listing was first seen', () => {
  it('stamps the player own listings and writes them down', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', price: 500, mine: true })]) });
    await h.settle();

    expect(storedStamps(h)).toEqual([{ id: 4, price: 500, count: 1, seen: WALL_CLOCK_MS }]);
  });

  it('keeps the first stamp when the same listing is seen again later', async () => {
    const h = await start();
    const row = listing({ id: 4, itemId: 'ore', price: 500, mine: true });
    h.send({ market: page([row]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({ market: page([row], { page: 0 }) });
    await h.settle();

    expect(storedStamps(h)[0]?.seen).toBe(WALL_CLOCK_MS);
  });

  // The id is reused across a server restart, so a stamp kept on the id alone would hand a brand
  // new listing the age of whatever held that number before. The second page carries a second
  // row as well, because the loader's own market signature is an id list: a page whose only
  // difference is a price under a stable id is correctly reported as unchanged.
  it('takes a fresh stamp when a reused id carries a different price', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', price: 500, mine: true })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({
      market: page([
        listing({ id: 4, itemId: 'ore', price: 900, mine: true }),
        listing({ id: 5, itemId: 'cloth', price: 100, mine: true }),
      ]),
    });
    await h.settle();

    const stamp = storedStamps(h).find((entry) => entry.id === 4);
    expect(stamp).toMatchObject({ price: 900, seen: WALL_CLOCK_MS + HOUR_MS });
  });

  it('says the reading is its own record rather than an expiry', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', price: 500, mine: true })]) });
    await h.settle();

    const tip = tipOn('mine', '4');
    expect(tip).toContain('First seen by you');
    // Shorter than it was, and the promise is the same one: no listing carries an expiry, so a
    // stamp presented without saying whose reckoning it is would read as one.
    expect(tip).toContain("by this addon's own reckoning");
  });
});

/**
 * The Merchant's pending sale ledger, which is the one real sold-price record the game keeps and
 * is a queue rather than a table: rows are appended as sales land, the oldest drop past a cap of
 * fifty into `collectionSalesOmitted`, and the WHOLE THING EMPTIES when the player collects.
 *
 * So every case here is about the same question, which is whether a row is the same row. A sale
 * carries no id and no clock, and the page it rides is re-read on every browse, so the only
 * identity available is the position in the queue: row `i` is `collectionSalesOmitted + i` sales
 * into this collection, and that total only rises until a collect resets it.
 *
 * The two failures the cases below have teeth against are the two that destroy a player's record
 * silently. Counting a row twice inflates a series that is supposed to be ground truth, and
 * reading the drain as an authoritative empty deletes everything ever recorded.
 */
describe('what the Merchant says has sold', () => {
  it('records a completed sale of the player own', async () => {
    const h = await start();
    h.send({
      market: page([], {
        collectionCopper: 465,
        collectionSales: [sale({ itemId: 'ore', count: 2, price: 900, proceeds: 837 })],
      }),
    });
    await h.settle();

    // The gross the buyer paid and the net after the cut, both kept: summing the wrong one
    // overstates a player's income by the whole of `cutPct`. The sixth slot is which install
    // drained the row, which is what lets an import replace one device's sales and no other's.
    const rows = salesFor(h, 'ore');
    expect(rows[0]?.slice(0, 5)).toEqual([WALL_CLOCK_MS / 1000, 2, 900, 837, 'Bragg']);
    expect(rows[0]?.[5]).toMatch(/./);
  });

  // The page is re-read on every browse and a row carries no id, so a reading that compared
  // contents would count one sale once per page the player flipped through while it waited.
  it('records a sale once however many times the ledger is read', async () => {
    const h = await start();
    const sold = [sale({ itemId: 'ore', price: 900, proceeds: 837 })];
    h.send({
      market: page([listing({ id: 1 })], { collectionCopper: 837, collectionSales: sold }),
    });
    await h.settle();
    h.send({
      market: page([listing({ id: 2 })], { collectionCopper: 837, collectionSales: sold }),
    });
    await h.settle();
    h.send({
      market: page([listing({ id: 3 })], { collectionCopper: 837, collectionSales: sold }),
    });
    await h.settle();

    expect(salesFor(h, 'ore')).toHaveLength(1);
  });

  // The drain. This is the failure worth the most: the rows vanish at a moment the player chose
  // and nothing announces, so an addon that mirrored the wire would erase its own history the
  // first time its player pressed Collect.
  it('keeps a recorded sale after the player collects and the ledger empties', async () => {
    const h = await start();
    h.send({
      market: page([], { collectionCopper: 837, collectionSales: [sale({ price: 900 })] }),
    });
    await h.settle();
    h.send({ market: page([], { collectionCopper: 0, collectionSales: [] }) });
    await h.settle();

    expect(salesFor(h, 'ore')).toHaveLength(1);
  });

  it('records the next sale after a collect, even one identical to the last', async () => {
    const h = await start();
    h.send({ market: page([], { collectionCopper: 465, collectionSales: [sale()] }) });
    await h.settle();
    h.send({ market: page([], { collectionCopper: 0, collectionSales: [] }) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({ market: page([], { collectionCopper: 465, collectionSales: [sale()] }) });
    await h.settle();

    expect(salesFor(h, 'ore')).toHaveLength(2);
  });

  /**
   * A collect and exactly as many fresh sales between two readings leaves the queue the same
   * LENGTH it was, so a position alone would skip every one of them. The last row read is
   * checked as well, which is what says this is a different queue rather than the same one.
   */
  it('notices a queue it has not read before, even at the length it left off at', async () => {
    const h = await start();
    h.send({
      market: page([], {
        collectionCopper: 930,
        collectionSales: [sale({ price: 500 }), sale({ price: 400 })],
      }),
    });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({
      market: page([], {
        collectionCopper: 1400,
        collectionSales: [sale({ price: 700 }), sale({ price: 800 })],
      }),
    });
    await h.settle();

    expect(salesFor(h, 'ore').map((row) => row[2])).toEqual([500, 400, 700, 800]);
  });

  // The cap is the server's, at fifty rows, and the gold of a dropped row is still in the total
  // the rows are explaining. Saying how many are missing is the only thing that makes the two
  // reconcile; swallowing it presents a short list as a complete one.
  it('counts the sales the Merchant own cap dropped before it could read them', async () => {
    const h = await start();
    h.send({
      market: page([], {
        collectionCopper: 5000,
        collectionSales: [sale({ price: 100 }), sale({ price: 200 })],
        collectionSalesOmitted: 7,
      }),
    });
    await h.settle();

    expect(lostSales(h)).toBe(7);
    expect(salesFor(h, 'ore')).toHaveLength(2);
  });

  /**
   * The server's own counter is not the answer, and this is the case that shows why. It counts
   * what ITS cap dropped, some of which this addon had already read and kept; what a player
   * needs is how many of their sales are missing from THIS record, which is a smaller number
   * and only something holding a position in the queue can work it out.
   */
  it('leaves out the dropped sales it had already written down', async () => {
    const h = await start();
    h.send({
      market: page([], {
        collectionCopper: 930,
        collectionSales: [sale({ price: 500 }), sale({ price: 400 })],
      }),
    });
    await h.settle();
    h.send({
      market: page([], {
        collectionCopper: 9000,
        collectionSales: [sale({ price: 700 }), sale({ price: 800 })],
        collectionSalesOmitted: 14,
      }),
    });
    await h.settle();

    expect(lostSales(h)).toBe(12);
    expect(salesFor(h, 'ore')).toHaveLength(4);
  });

  /**
   * A 1-copper listing against the Merchant's cut nets nothing, and the sale still leaves a row.
   * The game's own Collect tab reads the ledger specifically so that row is not stranded unshown,
   * and a consumer that filtered on `proceeds > 0` would drop the one sale nobody can explain.
   */
  it('records a sale whose proceeds floored to nothing', async () => {
    const h = await start();
    h.send({
      market: page([], {
        collectionCopper: 0,
        collectionSales: [sale({ itemId: 'pebble', count: 1, price: 1, proceeds: 0 })],
      }),
    });
    await h.settle();

    expect(salesFor(h, 'pebble')).toHaveLength(1);
  });

  /**
   * A server predating the ledger sends no field at all, and an absent field is NOT an empty
   * queue. Reading one as the other would reset the position on every page and count every
   * waiting sale again the next time a real ledger arrived.
   */
  it('does not read a missing ledger as a collect', async () => {
    const h = await start();
    const sold = [sale({ price: 900 })];
    h.send({
      market: page([listing({ id: 1 })], { collectionCopper: 837, collectionSales: sold }),
    });
    await h.settle();
    h.send({ market: olderPage([listing({ id: 2 })], { collectionCopper: 837 }) });
    await h.settle();
    h.send({
      market: page([listing({ id: 3 })], { collectionCopper: 837, collectionSales: sold }),
    });
    await h.settle();

    expect(salesFor(h, 'ore')).toHaveLength(1);
  });

  it('keeps recorded sales while the player is nowhere near the Merchant', async () => {
    const h = await start();
    h.send({ market: page([], { collectionCopper: 465, collectionSales: [sale()] }) });
    await h.settle();
    h.send({ market: null });
    await h.settle();

    expect(salesFor(h, 'ore')).toHaveLength(1);
  });

  it('reads a stored sale record back in the next session', async () => {
    const storage = createFakeStorage();
    seedSold(storage, {
      sales: { ore: [[WALL_CLOCK_MS / 1000 - 3600, 1, 900, 837, 'Bragg']] },
      lost: 3,
    });
    const h = await start({ storage });
    openTab('Sold');
    await h.settle();

    expect(keysIn('sold')).toEqual(['ore']);
    expect(lineFor('sold-note')).toContain('3');
  });
});

/**
 * The same record, on screen, where the two things it must not do are blur and swallow.
 *
 * The sold series is kept apart from the browsed one and the panel says which is which,
 * because an ask is what a seller wanted and a sale is what a buyer handed over. And the
 * Merchant's cap means the record is incomplete by a known amount, which is exactly the
 * figure a pane showing a short list has to carry.
 */
describe('what the sale record says', () => {
  it('says how many sales it never saw rather than drawing a list that does not add up', async () => {
    const h = await start();
    h.send({
      market: page([], {
        collectionCopper: 5000,
        collectionSales: [sale()],
        collectionSalesOmitted: 7,
      }),
    });
    await h.settle();
    openTab('Sold');
    await h.settle();

    expect(lineFor('sold-note')).toContain('7');
  });

  /**
   * The separation, which is the whole reason there is a second series at all. A listing price is
   * what a seller ASKED and a sale row is what a buyer PAID, and folding one into the other gives
   * a fuller curve made of two different facts. Neither figure below moves the other.
   */
  it('keeps what was paid out of the series of what was asked', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', count: 1, price: 500 })], {
        collectionCopper: 837,
        collectionSales: [sale({ itemId: 'ore', count: 1, price: 900, proceeds: 837 })],
      }),
    });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')).toEqual([visit(WALL_CLOCK_MS, 500)]);
    expect(salesFor(h, 'ore').map((row) => row[2])).toEqual([900]);
  });

  it('says on a price row what the item actually fetched, labelled as a different fact', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', count: 1, price: 500 })], {
        collectionCopper: 837,
        collectionSales: [sale({ itemId: 'ore', count: 1, price: 900, proceeds: 837 })],
      }),
    });
    await h.settle();

    const tip = tipOn('prices', 'ore');
    expect(tip).toContain('what was PAID rather than asked');
  });

  it('says a sale is stamped when it was read rather than when it happened', async () => {
    const h = await start();
    h.send({ market: page([], { collectionCopper: 465, collectionSales: [sale()] }) });
    await h.settle();
    openTab('Sold');
    await h.settle();

    expect(tipOn('sold', 'ore')).toContain('rather than when it sold');
  });

  // Said ONCE, under the list, rather than on every row's tooltip. It is the one thing a reader
  // could get wrong about this tab and it is true of every row on it, which is exactly the kind
  // of line that belongs in a footer: a tooltip is for what is true of the row being pointed at.
  it('says the record is the player own sales and nobody else', async () => {
    const h = await start();
    h.send({ market: page([], { collectionCopper: 465, collectionSales: [sale()] }) });
    await h.settle();
    openTab('Sold');
    await h.settle();

    expect(lineFor('sold-note')).toContain('your own sales');
  });
});

// One snapshot of `away` after a reconnect is the client clearing its own mirror rather than
// the player walking off. Both sides of the guard are pinned, because a guard that granted grace
// forever would pass the first case and fail the second.
describe('the reconnect blip', () => {
  it('keeps the page on screen for one away snapshot after a reconnect', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', price: 500, mine: true })]) });
    await h.settle();

    h.reconnect();
    h.send({ market: null });
    await h.settle();

    expect(keysIn('mine')).toEqual(['4']);
    expect(statFor('where')).toBe('resyncing');
    expect(lineFor('status-line')).toContain('not being thrown away');
  });

  // The grace has to end on a timer rather than on the next reading, because a watch key fires
  // on a change: a player who is still away sends no second reading, so a guard that waited for
  // one would leave the panel saying "resyncing" for the rest of the session.
  it('gives up on the resync once the client has had time to refill', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', price: 500, mine: true })]) });
    await h.settle();

    h.reconnect();
    h.send({ market: null });
    await h.settle();
    expect(statFor('where')).toBe('resyncing');

    await vi.advanceTimersByTimeAsync(RESYNC_GRACE_MS);
    vi.advanceTimersToNextFrame();
    // The grace expiring asks for a repaint, and the loader's frame loop is what performs one.
    h.frames.tick();
    await flush(MICROTASKS);

    expect(statFor('where')).toBe('no counter');
    expect(lineFor('status-line')).toContain('not at a Merchant');
  });

  it('takes an away with no reconnect behind it at face value', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', price: 500, mine: true })]) });
    await h.settle();

    h.send({ market: null });
    await h.settle();

    expect(statFor('where')).toBe('no counter');
  });

  // The ledger is not the live page: walking away hides what the Merchant is asking now
  // and hides nothing that was already recorded.
  it('keeps the recorded prices on screen after a genuine away', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.send({ market: null });
    await h.settle();

    expect(keysIn('prices')).toEqual(['ore']);
  });
});

// `away` and `unknown` both carry null and differ only in why, and neither is an empty market. A
// pane that drew either as one would tell a player standing in a town that nobody is selling.
describe('what it says when there is no page', () => {
  it('says nothing has decoded yet before the world is up', async () => {
    const h = await start({ world: false });
    await h.settle();

    expect(statFor('where')).toBe('unknown');
    expect(lineFor('status-line')).toContain('Nothing has been read yet');
  });

  // `unknown` and `away` are the two closed arms and they differ only in why. With a
  // world object present and nothing decoded off it, the answer is still not `away`: the
  // server answers nothing both for a player out of range and for a session that has no
  // player at all.
  it('separates nothing decoded from standing nowhere near a counter', async () => {
    const h = await start({ empty: true });
    await h.settle();

    expect(statFor('where')).toBe('unknown');
  });

  it('says the player is not at a Merchant rather than drawing an empty market', async () => {
    const h = await start();
    h.send({ market: null });
    await h.settle();

    expect(lineFor('status-line')).toContain('not an empty market');
    expect(lineFor('status-line')).not.toContain('no listings');
  });

  it('says the ledger is empty and why, rather than drawing an empty list', async () => {
    const h = await start();
    await h.settle();

    expect(keysIn('prices')).toEqual([]);
    expect(lineFor('prices-note')).toContain('Nothing recorded yet');
  });

  it('says how old the held page is once the player has walked away', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', mine: true })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({ market: null });
    await h.settle();

    expect(lineFor('status-line')).toContain('1 hour ago');
  });

  // The sentence is drawn only where the figures above it could be misread. Standing at the
  // counter with no search applied it would say that nothing unusual is going on, which is a
  // line of a HUD panel spent on nothing.
  it('says nothing at all while a whole unfiltered page is being read', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore' })]) });
    await h.settle();

    expect(lineFor('status-line')).toBe('');
  });

  it('says a search is applied, because a fresh join resets it and the window does not', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore' })], { filter: 'ore' }) });
    await h.settle();

    expect(lineFor('status-line')).toContain('ore');
    expect(lineFor('status-line')).toContain('part of the book, not all of it');
  });
});

// `price` is the total buyout for the whole stack, so a series that does not divide by
// the count compares a stack of 20 against a single and calls it a price movement.
describe('the unit price', () => {
  it('divides the total by the stack count', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', count: 20, price: 2000 }),
        listing({ id: 2, itemId: 'ore', count: 1, price: 2000 }),
      ]),
    });
    await h.settle();

    // 100 copper each against 2000 copper each: the same total, ten times apart per item. The
    // row's own figure and its median both carry the per-item basis, which is where a reader
    // meets it; the tooltip no longer reports the dearest ask, which was the top of the SPREAD
    // sitting beside three figures taken over lows and comparable with none of them.
    expect(figureOf('prices', 'ore')).toBe('low 1 silver');
    expect(detailOf('prices', 'ore')).toContain('median 1s');
  });

  // The FIGURE carries this now rather than a paragraph under it. A stack of 20 at 2000 copper
  // is 100 each, and the tooltip saying "Low 1s each" states the per-item basis in the place a
  // reader is already looking; a paragraph explaining that a total divides by a count was the
  // same sentence on every row of every session.
  it('says the figures are per item rather than per listing', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 2000 })]) });
    await h.settle();

    expect(tipOn('prices', 'ore')).toContain('1s each');
  });

  // Copper as the game writes it. Printing every unit turns an ore at forty-four copper into
  // `0g 0s 44c`, which is three leading zeroes per row of a ledger whose content is small prices.
  it('drops a unit of money that is empty', async () => {
    const h = await start();
    // TWO visits, so the tooltip prints its long form and the text renderer is exercised as well
    // as the coin one: a round gold amount is where an empty unit shows up as `1g 0s 0c`.
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 1, price: 10_000 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({
      market: page([
        listing({ id: 2, itemId: 'ore', count: 1, price: 44 }),
        listing({ id: 3, itemId: 'ore', count: 1, price: 20_000 }),
      ]),
    });
    await h.settle();

    expect(tipOn('prices', 'ore')).toContain('median 50s 22c');
    expect(tipOn('prices', 'ore')).not.toContain('0g');
    expect(figureOf('prices', 'ore')).toBe('low 44 copper');
  });

  // One vote per visit. A median over every listing is weighted by how many people happened to
  // be selling, so the trip that found three asks would outvote the two that found one, and the
  // typical price would really be the price on the busiest day.
  it('reports the median over the visits rather than over the listings', async () => {
    const h = await start();
    // Three trips on three days. The first found two asks, which are one vote between
    // them: over listings the median would be 120 rather than 300.
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 100 }),
        listing({ id: 2, itemId: 'ore', price: 120 }),
      ]),
    });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + DAY_MS);
    h.send({ market: page([listing({ id: 11, itemId: 'ore', price: 300 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + 2 * DAY_MS);
    h.send({ market: page([listing({ id: 21, itemId: 'ore', price: 800 })]) });
    await h.settle();

    expect(detailOf('prices', 'ore')).toContain('median 3s');
    expect(detailOf('prices', 'ore')).toContain('3 visits');
  });
});

// A page carries several asks for one item and they all land with the same stamp, so a line
// drawn per listing zigzags between the cheapest and the dearest ask of a single visit at
// whatever amplitude the sellers happened to disagree by. Those two readings are the same moment.
/**
 * What a price row draws behind itself, which is nothing.
 *
 * There was a fill here for one session: where the latest reading sat inside everything the item
 * had ever been seen at. It reads as a magnitude and is not one. A market price mostly does not
 * move (a listing lives 48 sim-hours and a thin book reprices slowly), so the range is empty on
 * nearly every item and the fill lands on the same half-width for every row on screen. Deals and
 * Sold keep theirs because a share of the best profit and a share of what you earned are real
 * shares; a price is not a share of anything.
 */
describe('the price row', () => {
  it('draws no fill, because a price is not a share of anything', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 900 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 100 })]) });
    await h.settle();

    // The kit always paints a fill element; what a price row never does is give it a width.
    expect(fillOf('prices', 'ore')).toBe('0.00%');
  });

  // Four figures saying one number is what a thin book produces, and it was the ordinary case
  // rather than the odd one: most items are read at the same cheapest ask every visit.
  it('says a price that has not moved once rather than four times', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 500 })]) });
    await h.settle();

    const tip = tipOn('prices', 'ore');
    expect(tip).toContain('5s each, unchanged over 2 visits');
    expect(tip).not.toContain('median');
  });

  it('draws the low, the median and the latest once the price has moved', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 900 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 100 })]) });
    await h.settle();

    const tip = tipOn('prices', 'ore');
    expect(tip).toContain('Low 1s each, median 5s, latest 1s');
  });
});

// The server sorts the others section by display name and then by price, so a block is
// contiguous and ascending and its first row is the cheapest competitor. No name table is
// involved anywhere in this.
describe('the undercut check', () => {
  it('says a listing is undercut when a cheaper one leads its block', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 900, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 500, sellerName: 'Rival' }),
        listing({ id: 3, itemId: 'ore', price: 700 }),
      ]),
    });
    await h.settle();

    expect(detailOf('mine', '1')).toContain('undercut');
    expect(tipOn('mine', '1')).toContain('Rival');
  });

  it('says a listing is the cheapest when it leads its block', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 500 }),
      ]),
    });
    await h.settle();

    expect(detailOf('mine', '1')).toContain('cheapest on this page');
  });

  // A row survives for as long as its listing keeps turning up, and the page under it is
  // replaced on every flip, so a tooltip is asked for its content long after the reading that
  // built the row. One that answered from the page it was BUILT with reports a verdict the
  // panel has already stopped drawing: the row here says undercut in its own detail line while
  // its tooltip still names nobody. Keying the list on the listing id makes a row live longer,
  // which makes this worse rather than causing it.
  it('answers a tooltip from the page being read now, not the one that built the row', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 500 }),
      ]),
    });
    await h.settle();
    // The rival LINE is what moves with the page, and it is the assertion for that reason: the
    // verdict word lives on the row, and repeating it in the tooltip was the tooltip restating
    // the thing the player is pointing at.
    expect(tipOn('mine', '1')).toContain('Cheapest competing listing: 5s');

    h.send({
      market: page([
        listing({ id: 2, itemId: 'ore', price: 300, sellerName: 'Rival' }),
        listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
      ]),
    });
    await h.settle();

    expect(keysIn('mine')).toEqual(['1']);
    expect(tipOn('mine', '1')).toContain('Rival');
  });

  // Absence is not evidence. Under a search, most of the book is not on the page.
  it('refuses to call a listing cheapest when its item is not on the page', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'cloth', price: 400, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 500 }),
      ]),
    });
    await h.settle();

    expect(detailOf('mine', '1')).toContain('not on this page');
    expect(tipOn('mine', '1')).toContain('not evidence');
  });

  // A block starting at the very first row of a later page may have started on the page
  // before, so the row shown is not necessarily the block's first.
  it('marks a block that may have started on the previous page as uncertain', async () => {
    const h = await start();
    h.send({
      market: page(
        [
          listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
          listing({ id: 2, itemId: 'ore', price: 500 }),
        ],
        { page: 1, pageCount: 3 },
      ),
    });
    await h.settle();

    expect(detailOf('mine', '1')).toContain('may be undercut');
    expect(tipOn('mine', '1')).toContain('page before this one');
  });

  it('takes the same block at face value on the first page', async () => {
    const h = await start();
    h.send({
      market: page(
        [
          listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
          listing({ id: 2, itemId: 'ore', price: 500 }),
        ],
        { page: 0, pageCount: 3 },
      ),
    });
    await h.settle();

    expect(detailOf('mine', '1')).toContain('cheapest on this page');
  });

  // Game 0.37.1 gave Browse a second order, and a price-sorted book breaks the one assumption
  // this whole check rests on: rows are ascending by price across every ITEM, so an item's
  // listings are no longer contiguous and a cheaper copy of the same thing can sit on any
  // earlier page. The block-start guard cannot see that, because it only ever fires when the
  // block begins at row 0.
  it('refuses to call a listing cheapest on a later price-sorted page', async () => {
    const h = await start();
    h.send({
      market: page(
        [
          listing({ id: 9, itemId: 'cloth', price: 300 }),
          listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
          listing({ id: 2, itemId: 'ore', price: 500 }),
        ],
        { page: 1, pageCount: 3, sort: 'price' },
      ),
    });
    await h.settle();

    expect(detailOf('mine', '1')).toContain('may be undercut');
  });

  // Page 0 of a price-sorted book is the cheapest rows in the WHOLE book, so the first copy of
  // an item there is its cheapest anywhere. That is a stronger reading than the name-sorted
  // page gives, and the check must not throw it away along with the case above.
  it('takes a price-sorted first page at face value', async () => {
    const h = await start();
    h.send({
      market: page(
        [
          listing({ id: 9, itemId: 'cloth', price: 300 }),
          listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
          listing({ id: 2, itemId: 'ore', price: 500 }),
        ],
        { page: 0, pageCount: 3, sort: 'price' },
      ),
    });
    await h.settle();

    expect(detailOf('mine', '1')).toContain('cheapest on this page');
  });

  it('warns once when a listing stops being the cheapest', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 900, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 500 }),
      ]),
    });
    await h.settle();

    expect(document.querySelector('.woc-toast')?.textContent).toContain('no longer the cheapest');
  });

  it('says nothing when the warning is switched off', async () => {
    const h = await start({ settings: { 'undercut-alert': false } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 900, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 500 }),
      ]),
    });
    await h.settle();

    expect(document.querySelector('.woc-toast')).toBeNull();
  });
});

// Both figures ride the payload, so an addon that wrote either down would agree with a
// fixture using the game's own numbers and could never be caught.
describe('the Merchant terms', () => {
  it('reads the cut off the page rather than assuming one', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 1000, mine: true })]) });
    await h.settle();

    // The cut left the header strip: it is a constant a player learns once, and the strip is
    // three figures now rather than five. It is still READ off every page, and still said, in
    // the tooltip the strip carries and on the row where it changes an amount.
    expect(tipOnStrip()).toContain(`${String(CUT_PCT)}%`);
    // 7 percent of 1000 copper is 70, so 930 lands.
    expect(tipOn('mine', '1')).toContain('nets 9s 30c');
  });

  it('reads the listing cap off the page rather than assuming one', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', mine: true }),
        listing({ id: 2, itemId: 'cloth', mine: true }),
      ]),
    });
    await h.settle();

    expect(statFor('cap')).toBe(`2 / ${String(MAX_LISTINGS)}`);
  });
});

// Ungated, so the badge works in the field with the pane closed and in another zone.
describe('the collection badge', () => {
  it('rides the title while the player is nowhere near the Merchant', async () => {
    const h = await start({ state: { collectPending: true } });
    await h.settle();

    expect(frameTitle()).toContain('collect');
    expect(statFor('collect')).toBe('something');
  });

  it('says what is waiting once the page has been read', async () => {
    const h = await start({ state: { collectPending: true } });
    h.send({
      market: page([], { collectionCopper: 2500, collectionItems: [{ itemId: 'ore', count: 1 }] }),
    });
    await h.settle();

    expect(statFor('collect')).toContain('25s');
    expect(statFor('collect')).toContain('1 item');
  });

  it('draws no badge when nothing is waiting', async () => {
    const h = await start();
    await h.settle();

    expect(frameTitle()).not.toContain('collect');
  });
});

// The contract every consumer after satchel copies: subscribe with anySender, ask after
// subscribing, and treat silence as ordinary.
describe('the bus', () => {
  it('draws the raw id with nobody publishing', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();

    expect(labelOf('prices', 'ore')).toBe('ore');
  });

  it('takes a name from a fork rather than only from the official id', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.publish({ id: 'ore', name: 'Copper Ore' }, PUBLISHER);
    await h.settle();

    // The label IS the guarantee. The tooltip used to carry a "Name published by <fqid>" line as
    // well, which was the addon telling the player how it works, once per hover, on every row
    // that worked correctly.
    expect(labelOf('prices', 'ore')).toBe('Copper Ore');
  });

  it('ignores a payload that is not an item record', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.publish({ id: 'ore' }, PUBLISHER);
    await h.settle();

    expect(labelOf('prices', 'ore')).toBe('ore');
  });

  // The batch is what an ask is actually answered with: a publisher holding a whole item table
  // sends it as one message rather than one emit per row, so a consumer subscribed to the
  // single-record topic alone hears the ask answered and takes nothing from it.
  it('takes a batch of names, which is what a catch-up is answered with', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 500 }),
        listing({ id: 2, itemId: 'silk', price: 700 }),
      ]),
    });
    await h.settle();
    h.publishAll([
      { id: 'ore', name: 'Copper Ore' },
      { id: 'silk', name: 'Spider Silk' },
    ]);
    await h.settle();

    expect(labelOf('prices', 'ore')).toBe('Copper Ore');
    expect(labelOf('prices', 'silk')).toBe('Spider Silk');
  });

  it('keeps the good rows of a batch that carries a bad one', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.publishAll([null, { id: 'ore' }, 'copper ore', { id: 'ore', name: 'Copper Ore' }]);
    await h.settle();

    expect(labelOf('prices', 'ore')).toBe('Copper Ore');
  });

  // The second half is the half that bites. A handler that walked a payload without checking
  // it is a list throws, the hub catches the throw, and the label stays the raw id either way:
  // what says the guard is there is that the batch AFTER it still lands.
  it('ignores a batch that is not a list and keeps taking the next one', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.publishAll({ id: 'ore', name: 'Wrong Shape' });
    await h.settle();

    expect(labelOf('prices', 'ore')).toBe('ore');

    h.publishAll([{ id: 'ore', name: 'Copper Ore' }]);
    await h.settle();

    expect(labelOf('prices', 'ore')).toBe('Copper Ore');
  });

  // Delivery is synchronous, so a publisher answers inside the emit call: an addon that asked
  // before subscribing misses its own answer, and that failure looks exactly like a publisher
  // nobody installed. Seeing it needs the bus wired up before the addon is evaluated, which is
  // why this builds the services itself rather than using `start`. The answer is the BATCH,
  // since a stand-in answering with a single record leaves this green while the real pair never
  // exchange a name.
  it('asks for a catch-up after subscribing, so a synchronous answer reaches it', async () => {
    const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
    const state: MarketState = {
      market: page([listing({ id: 1, itemId: 'ore', price: 500 })]),
      collectPending: false,
    };
    const shared = createSharedServices(document, createFakeStorage(), {
      game: Promise.resolve({ world: fakeWorld(state, player, false) }),
    });
    teardown.push(shared.dispose);

    const asks: string[] = [];
    // Straight onto the HUB, standing in for a publisher: an addon's own surface refuses
    // to deliver a message to its sender, and here the sender is the fake publisher.
    teardown.push(
      shared.shared.bus.subscribe({
        from: ANY_SENDER,
        topic: ASK_TOPIC,
        owner: PUBLISHER,
        handler: (message) => {
          asks.push(message.from);
          shared.shared.bus.emit(PUBLISHER, 'items', [{ id: 'ore', name: 'Copper Ore' }]);
        },
        onError: () => undefined,
      }),
    );

    const addon = await loadAddon({ shared: shared.shared, row: installedRow(), source: SOURCE });
    teardown.push(addon.dispose);
    shared.shared.world.watcher.poll();
    await flush(MICROTASKS);
    vi.advanceTimersToNextFrame();
    await flush(MICROTASKS);

    expect(asks).toEqual([FQID]);
    expect(labelOf('prices', 'ore')).toBe('Copper Ore');
  });
});

describe('the panel', () => {
  it('narrows the ledger with the search field', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 500 }),
        listing({ id: 2, itemId: 'cloth', price: 500 }),
      ]),
    });
    await h.settle();

    typeSearch('ore');
    await h.settle();

    expect(keysIn('prices')).toEqual(['ore']);
  });

  it('says how many readings came from more than one search', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore' })], { filter: 'ore' }) });
    await h.settle();
    h.send({ market: page([listing({ id: 2, itemId: 'ore' })], { filter: '' }) });
    await h.settle();

    expect(tipOn('prices', 'ore')).toContain('2 different searches');
  });

  // There was a line here on every listing's tooltip saying the panel cannot cancel or relist.
  // It is gone, and nothing is lost: read-only is enforced by there being no send API at all,
  // disclosed by the manifest's permissions, and evidenced by the panel having no control on it.
  // A sentence repeated on every hover was not what was holding the promise up. What IS worth
  // pinning is that no button ever appears beside a listing.
  it('offers no control on a listing of its own', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', mine: true })]) });
    await h.settle();

    expect(rowIn('mine', '4')?.querySelector('button')).toBe(null);
  });

  it('toggles with its keybind', async () => {
    const h = await start();
    await h.settle();
    const frame = document.querySelector<HTMLElement>('[data-woc-frame="ledger"]');
    expect(frame?.classList.contains('woc-hidden')).toBe(false);

    h.press('Alt+KeyL');
    expect(frame?.classList.contains('woc-hidden')).toBe(true);

    h.press('Alt+KeyL');
    expect(frame?.classList.contains('woc-hidden')).toBe(false);
  });
});

/**
 * The deal scan, which is the one thing here that tells a player to act.
 *
 * Every figure is asserted in COPPER rather than as a discount, because a percentage is the
 * ranking that looks right and is wrong: nine tenths off a three copper item is twenty seven
 * copper and belongs under a four percent shave on a stack worth gold. The suite's cut is 7
 * percent rather than the game's 5, so a resale figure computed against a hardcoded cut fails
 * here rather than agreeing with a fixture that shares its mistake.
 *
 * The item ids are REAL ones, because the vendor floor is read from the shipped table and a
 * made-up id has no floor: `copper_ore` is 4 copper a unit and `iron_ore` is 8, at game 0.35.1.
 *
 * Two of these cases exist because of how the addon is wired rather than because of what it
 * shows. The baseline case pins that a visit is left out of the median it is judged against,
 * which is not a preference: `foldPage` writes the live page into the series BEFORE anything
 * reads it, so the naive median contains the very listing being called cheap and the panel
 * invents a bargain out of one stranger's price. The accumulation case pins that paging does not
 * erase what the last page found, which is the difference between a scanner and a page viewer.
 */
describe('the deal scan', () => {
  it('reports a stack under the vendor floor at what the vendor would clear', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // 20 copper ore for 60 copper the lot. A vendor pays 4 each, so 80 for 20, so 20 clear.
    h.send({ market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })]) });
    await h.settle();

    expect(keysIn('deals')).toEqual(['1']);
    expect(figureOf('deals', '1')).toContain('20 copper');
    expect(detailOf('deals', '1')).toContain('vendor floor');
  });

  // The flag exists to REFUSE a claim. No shipped item carries it beside a sell value today, so
  // the table is replaced here rather than hunting for one: the case this guards is content
  // giving a vendor-refused item a price, and that is exactly what this fixture is.
  it('promises no vendor sale for an item a vendor refuses to buy', async () => {
    const refused = JSON.stringify({
      gameVersion: '0.0.0-test',
      items: [{ id: 'copper_ore', sellValue: 4, noVendorSell: true }],
    });
    const h = await start({ floors: refused, settings: { 'min-profit': 0 } });
    h.send({ market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })]) });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
  });

  // A player whose fetch failed keeps every estimate and loses every certainty. The panel must
  // not quietly fall back to calling an estimate certain, which is the failure that would look
  // like the feature working.
  it('claims nothing certain when the floor table never arrived', async () => {
    const h = await start({ floors: null, settings: { 'min-profit': 0 } });
    h.send({ market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })]) });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
  });

  it('anchors a resale on the next cheapest ask, with the cut taken off', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // The cheapest is 10 iron ore for 200. The next ask is 40 each, so a resale grosses 400 and
    // clears 372 at the suite's 7 percent, so 172 over what the stack cost.
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 }),
        listing({ id: 2, itemId: 'iron_ore', count: 10, price: 400, sellerName: 'Rival' }),
        listing({ id: 3, itemId: 'iron_ore', count: 10, price: 500 }),
      ]),
    });
    await h.settle();

    expect(figureOf('deals', '1')).toContain('1 silver, 72 copper');
    // The count is the confidence, and it is the whole of it: two rivals stand behind the price
    // this was worked out against, which a reader can weigh without learning a grading word.
    expect(detailOf('deals', '1')).toContain('2 rivals');
  });

  // Only the cheapest listing of an item can be one, and it falls out of the arithmetic: to sell
  // you have to be the cheapest, so what you can ask is set by whoever is left after you buy.
  it('offers the cheapest listing of an item and not the ones above it', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 }),
        listing({ id: 2, itemId: 'iron_ore', count: 10, price: 400 }),
        listing({ id: 3, itemId: 'iron_ore', count: 10, price: 500 }),
      ]),
    });
    await h.settle();

    expect(keysIn('deals')).toEqual(['1']);
  });

  // The Merchant's own stock never depletes and never expires, so it is a price the item can be
  // had at forever. Anchoring a resale above one is planning to undercut a counter that will
  // still be open tomorrow.
  it('will not anchor above the standing stock the Merchant always has', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 }),
        listing({ id: 2, itemId: 'iron_ore', count: 10, price: 900, sellerName: 'Rival' }),
        // 25 each forever, which caps the resale at 250 gross, 232 after the cut, 32 clear.
        listing({ id: 3, itemId: 'iron_ore', count: 4, price: 100, house: true }),
      ]),
    });
    await h.settle();

    expect(figureOf('deals', '1')).toContain('32 copper');
  });

  // The cap on an anchor happens to cover most of this already, since a house row's own price
  // is its own ceiling. The rule is separate from the arithmetic and is pinned separately: the
  // stock never depletes, so buying it moves no price and reselling it competes with a counter
  // that is still open tomorrow. The table is replaced to make the guard reachable at all.
  it('never offers the standing stock itself as something to buy', async () => {
    const rich = JSON.stringify({
      gameVersion: '0.0.0-test',
      items: [{ id: 'iron_ore', sellValue: 100 }],
    });
    const h = await start({ floors: rich, settings: { 'min-profit': 0 } });
    h.send({
      market: page([listing({ id: 3, itemId: 'iron_ore', count: 10, price: 100, house: true })]),
    });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
  });

  it('leaves the visit it is recording out of the baseline it judges against', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // Three earlier visits, at 20, 40 and 60 a unit, each its own trip. The SPREAD is what makes
    // this test able to fail: a median over three points absorbs one outlier whatever you do, so
    // a fixture with three equal readings would pass against the bug it is here to catch.
    const earlier = [200, 400, 600];
    await inSeries(earlier.entries(), async ([at, total]) => {
      h.setWallClock(WALL_CLOCK_MS + at * (VISIT_WINDOW_MS + HOUR_MS));
      h.send({ market: page([listing({ id: 9, itemId: 'iron_ore', count: 10, price: total })]) });
      await h.settle();
      h.send({ market: null });
      await h.settle();
    });
    h.setWallClock(WALL_CLOCK_MS + earlier.length * (VISIT_WINDOW_MS + HOUR_MS));

    // Now the only listing in the book is a cheap one, so this visit records a low of 10. The
    // baseline is the median of 20, 40 and 60, which is 40. Counting this visit as well would
    // make it the median of 10, 20, 40 and 60, which is 30, and the row would report 179 instead.
    h.send({ market: page([listing({ id: 1, itemId: 'iron_ore', count: 10, price: 100 })]) });
    await h.settle();

    // 40 each over ten is 400 gross, 372 after the suite's cut, 272 over the 100 the stack cost.
    expect(figureOf('deals', '1')).toContain('2 silver, 72 copper');
    expect(detailOf('deals', '1')).toContain('3 visits');
  });

  it('keeps what an earlier page found while the player reads the next one', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })], {
        page: 0,
        pageCount: 2,
      }),
    });
    await h.settle();
    h.send({
      market: page([listing({ id: 2, itemId: 'iron_ore', count: 20, price: 100 })], {
        page: 1,
        pageCount: 2,
      }),
    });
    await h.settle();

    expect([...keysIn('deals')].sort(byText)).toEqual(['1', '2']);
  });

  // A visit is a scan and walking away ends it. The buffer is a photograph of a book that moves,
  // so carrying it off the counter would present an hour-old page as what is on sale now.
  it('forgets the scan when the player walks away', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({ market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })]) });
    await h.settle();
    h.send({ market: null });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
    expect(lineFor('deals-note')).toContain('standing at the Merchant');
  });

  it('ranks by what a stack clears rather than by how deep the discount is', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        // A tenth of the going rate, and worth 33 copper.
        listing({ id: 1, itemId: 'copper_ore', count: 10, price: 5 }),
        listing({ id: 2, itemId: 'copper_ore', count: 10, price: 50 }),
        // A fifth off, and worth several silver.
        listing({ id: 3, itemId: 'iron_ore', count: 20, price: 800 }),
        listing({ id: 4, itemId: 'iron_ore', count: 20, price: 1000 }),
      ]),
    });
    await h.settle();

    expect(keysIn('deals')).toEqual(['3', '1']);
  });

  it('holds back anything under the profit floor the player set', async () => {
    const h = await start({ settings: { 'min-profit': 1000 } });
    h.send({ market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })]) });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
    expect(lineFor('deals-note')).toContain('clears');
  });

  // The coverage line is the honest limit on everything in the pane, so it says what was read
  // rather than presenting a page as the market.
  it('says how much of the book it has actually read', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })], {
        page: 0,
        pageCount: 9,
      }),
    });
    await h.settle();

    // Under the list rather than in the tooltip: it is true of every row in the pane and it is
    // the honest limit on all of them, so it belongs where it is read without hovering anything.
    expect(lineFor('deals-note')).toContain('1 of 9 pages');
  });
});

/**
 * Staleness in the scan buffer, which is its own describe because the failure it causes is not
 * an absent row but a WRONG one.
 *
 * A resale is priced against the cheapest thing in hand, so a listing that was bought an hour ago
 * and is still in the buffer goes on setting the price the live page is judged against. It makes
 * an ordinary listing look like a bargain, and it beats the correct anchor rather than merely
 * sitting beside it, so nothing on screen says the figure came from a listing that is gone.
 */
describe('the scan buffer over time', () => {
  it('stops anchoring on a listing this trip has not seen for a visit', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // A cheap iron listing, read once and never again.
    h.send({ market: page([listing({ id: 5, itemId: 'iron_ore', count: 10, price: 100 })]) });
    await h.settle();

    // Long enough that one trip through the book has ended, and the book has moved on: the cheap
    // row is gone and two dearer ones are what is there now.
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS + HOUR_MS);
    h.send({
      market: page([
        listing({ id: 6, itemId: 'iron_ore', count: 10, price: 300 }),
        listing({ id: 7, itemId: 'iron_ore', count: 10, price: 600 }),
      ]),
    });
    await h.settle();

    // The 300 stack is anchored on the 600 one beside it: 60 each grosses 600 and clears 558 at
    // the suite's cut, so 258 over. Anchored on the vanished 100 stack it would be a loss and no
    // row at all, and anchoring the OTHER way round is the bug: a buffer still holding the cheap
    // row would price nothing against it, since 10 each is under both.
    expect(keysIn('deals')).toEqual(['6']);
    expect(figureOf('deals', '6')).toContain('2 silver, 58 copper');
    expect(detailOf('deals', '6')).toContain('1 rival');
  });
});

/**
 * Heroic variants, which are the reason a book can show two rows with one name.
 *
 * A heroic upgrade is a separate item id with its own price and its own recorded series, and the
 * game gives the pair one display name. Untagged, the panel draws two rows called the same thing
 * at prices a long way apart, and reads as though it is reporting one item twice and disagreeing
 * with itself. This is a correctness case rather than a cosmetic one: on a deal row the profit is
 * right and the player cannot tell which of the two listings earns it.
 */
describe('two items with one name', () => {
  it('tags the heroic one, so the pair can be told apart', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.publish({ id: 'tuskblade', name: 'Wildheart Tuskblade', source: 'table' });
    h.publish({
      id: 'tuskblade_heroic',
      name: 'Wildheart Tuskblade',
      source: 'table',
      heroicOf: 'tuskblade',
    });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'tuskblade', price: 400 }),
        listing({ id: 2, itemId: 'tuskblade_heroic', price: 9000 }),
      ]),
    });
    await h.settle();

    expect(labelOf('prices', 'tuskblade')).toBe('Wildheart Tuskblade');
    expect(labelOf('prices', 'tuskblade_heroic')).toBe('Wildheart Tuskblade [HEROIC]');
  });

  // Nothing in the loader can separate the pair: `ui.icon.itemArtName` answers one name for both,
  // because they share the art. Without a publisher the rows fall back to the raw ids, which do
  // differ, so the failure is ugly and truthful rather than tidy and wrong.
  it('falls back to ids when nobody has published the pair', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'tuskblade', price: 400 }),
        listing({ id: 2, itemId: 'tuskblade_heroic', price: 9000 }),
      ]),
    });
    await h.settle();

    expect(labelOf('prices', 'tuskblade')).toBe('tuskblade');
    expect(labelOf('prices', 'tuskblade_heroic')).toBe('tuskblade_heroic');
  });
});

/**
 * The filter echo, whose unset value is a WORD rather than a blank.
 *
 * `defaultMarketQuery` in the game's own sim fills the five enum axes with the string `all`, and
 * only `search` is empty when nothing is chosen. Read literally, a player who has filtered
 * nothing gets "Searching all, all, all, all, all" across the top of the panel, and a query
 * signature that is never empty, so the ledger records every reading as having come from a
 * search and no entry ever reports having read the whole book.
 */
describe('an unset filter', () => {
  it('reads the game own word for nothing chosen as nothing chosen', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', price: 500 })], {
        filter: '',
        itemType: 'all',
        subtype: 'all',
        armorClass: 'all',
        primaryStat: 'all',
        rarity: 'all',
      }),
    });
    await h.settle();

    expect(lineFor('status-line')).toBe('');
    expect(tipOnStrip()).toContain('the whole book');
  });

  it('still names the axes a player did choose', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', price: 500 })], {
        filter: 'ore',
        itemType: 'weapon',
        subtype: 'all',
        armorClass: 'all',
        primaryStat: 'all',
        rarity: 'all',
      }),
    });
    await h.settle();

    const said = lineFor('status-line');
    expect(said).toContain('Searching ore, weapon:');
    // The four unset axes are gone. Matched on the repeat rather than on the word, because the
    // sentence legitimately ends by saying this is not all of the book.
    expect(said).not.toContain('all, all');
  });

  // The order is an axis whose unset value is `name` rather than `all`, so reading it the way
  // the five enums are read would put a word on every default reading there has ever been.
  it('says nothing about the order Browse has always used', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })], { sort: 'name' }) });
    await h.settle();
    await saved();

    expect(tipOnStrip()).toContain('the whole book');
    expect(visitsFor(h, 'ore')[0]?.[3]).toBe('');
  });

  // A price-sorted trip and a name-sorted one are two readings of one book, and folding them
  // together would take a median over whichever end the player happened to be looking at.
  it('records a price-sorted reading as its own query', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })], { sort: 'price' }) });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')[0]?.[3]).toContain('price');
    expect(lineFor('status-line')).toContain('cheapest first');
  });
});

/**
 * What a resale can actually fetch, which is the half of a deal that is an estimate.
 *
 * Two failures live here and both overstate, which is the direction that costs a player money.
 * The first is forgetting that the player's OWN listings are competition: a buyer takes the
 * cheapest copy on the counter and does not care whose it is, so a player who has just bought a
 * cheap copy and relisted it must not then be told to buy another and sell it at a price their
 * own listing already undercuts. The second is choosing between two estimates of the same
 * quantity by taking the better one, which systematically believes whichever source is most
 * optimistic: on a thin item that is one stranger's asking price, and it sorts to the top of the
 * list ahead of every well-evidenced row on it.
 */
describe('what a resale is priced against', () => {
  it('counts the player own listing as competition', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        // The player already bought a cheap one and relisted it just under the going rate.
        listing({ id: 1, itemId: 'ore', price: 900, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 1000 }),
        // One stranger asking a wild price, which is the only other listing there is.
        listing({ id: 3, itemId: 'ore', price: 5000 }),
      ]),
    });
    await h.settle();

    // Nothing to do. Buying at 1000 to sell against the player's own 900 is a loss, and the
    // 5000 ask is not reachable while that 900 is on the counter.
    expect(keysIn('deals')).toEqual([]);
  });

  it('never offers a listing of the player own as something to buy', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 100, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 5000 }),
      ]),
    });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
  });

  it('prices a resale at the cheaper of what the page says and what it has recorded', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // Three earlier visits, at 10, 12 and 14 a unit, so the recorded median is 12.
    const earlier = [1000, 1200, 1400];
    await inSeries(earlier.entries(), async ([at, price]) => {
      h.setWallClock(WALL_CLOCK_MS + at * (VISIT_WINDOW_MS + HOUR_MS));
      h.send({ market: page([listing({ id: 90 + at, itemId: 'ore', count: 100, price })]) });
      await h.settle();
      h.send({ market: null });
      await h.settle();
    });
    h.setWallClock(WALL_CLOCK_MS + earlier.length * (VISIT_WINDOW_MS + HOUR_MS));

    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', count: 100, price: 1000 }),
        // One stranger at five times the going rate, and the only rival on the page.
        listing({ id: 2, itemId: 'ore', count: 100, price: 5000 }),
      ]),
    });
    await h.settle();

    // 12 each over 100 grosses 1200 and clears 1116 at the suite's cut, so 116 over the 1000 the
    // stack cost. Believing the lone 5000 ask instead would report 3650, thirty times as much.
    expect(figureOf('deals', '1')).toContain('1 silver, 16 copper');
    expect(detailOf('deals', '1')).toContain('3 visits');
  });
});

/**
 * The one thing this pane can say that no figure on it can: that the listing standing between a
 * resale and a sale belongs to the player.
 *
 * It is the answer to "why is this worth so little", and there is nowhere else to read it: the
 * game's own window shows the player's listing among the rest with nothing to say it is what is
 * holding the price down.
 */
describe('when the competition is your own', () => {
  it('says so, and says what cancelling would leave', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', count: 10, price: 3000, mine: true }),
        listing({ id: 2, itemId: 'ore', count: 10, price: 1000 }),
        listing({ id: 3, itemId: 'ore', count: 10, price: 9000 }),
      ]),
    });
    await h.settle();

    // Buying the 1000 stack and selling against the player's own 3000 clears 1790 at the suite's
    // cut, and the 9000 ask is not reachable while that listing of theirs is up.
    expect(figureOf('deals', '2')).toContain('17 silver, 90 copper');
    expect(tipOn('deals', '2')).toContain('YOUR OWN');
    expect(tipOn('deals', '2')).toContain('Cancelling it');
  });
});

/**
 * A stack posted at one item's price, which is the commonest real underpricing there is and the
 * only one that says nothing about what the item is worth.
 *
 * Measured against the DEAREST estimate rather than the anchor a resale is priced at. Those are
 * different questions: the anchor is deliberately the most cautious price any source will stand
 * behind, and a typo measured against it stops looking like a typo the moment a cheaper source
 * wins, which is exactly when the row most needs to say what happened.
 */
describe('a stack priced as one', () => {
  it('is named even when the resale is anchored somewhere cheaper', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // Three visits at 100 a unit, so the recorded median is well under what the page is asking.
    const earlier = [10_000, 10_000, 10_000];
    await inSeries(earlier.entries(), async ([at, price]) => {
      h.setWallClock(WALL_CLOCK_MS + at * (VISIT_WINDOW_MS + HOUR_MS));
      h.send({ market: page([listing({ id: 90 + at, itemId: 'ore', count: 100, price })]) });
      await h.settle();
      h.send({ market: null });
      await h.settle();
    });
    h.setWallClock(WALL_CLOCK_MS + earlier.length * (VISIT_WINDOW_MS + HOUR_MS));

    h.send({
      market: page([
        // A hundred ore for the price of one, which is what a seller typing the unit price into
        // the total field produces.
        listing({ id: 1, itemId: 'ore', count: 100, price: 300 }),
        listing({ id: 2, itemId: 'ore', count: 100, price: 30_000 }),
      ]),
    });
    await h.settle();

    // The resale is anchored on the recorded 100 each, which is the cheaper of the two, while the
    // typo is judged against the 300 the page is asking for one.
    expect(detailOf('deals', '1')).toContain('stack priced as one');
    expect(detailOf('deals', '1')).toContain('3 visits');
  });
});

/**
 * Carrying a ledger between machines, which is a MERGE and never a replace.
 *
 * Two properties decide whether this is safe to hand a player, and both are about repetition
 * rather than about the happy path. Importing a device's own export must change nothing, because
 * that is what somebody does when they are not sure whether the last import worked. And a file
 * exported mid-trip and imported after more browsing must also change nothing, which is the hard
 * one: `foldVisit` slides a visit's `at` forward as the trip is paged through, so the two copies
 * of that reading disagree about when it happened and only the start they share can match them.
 *
 * The store carries `first` for exactly that, appended to a positional row so a ledger written
 * before it existed reads with no migration pass. Those older readings are the one place the
 * exact match cannot work, and they fall back to the same window rule the live fold applies.
 */
describe('carrying a ledger to another machine', () => {
  it('adds nothing when a device imports its own export', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 500 }),
        listing({ id: 2, itemId: 'hide', price: 900 }),
      ]),
    });
    await h.settle();
    await saved();
    const before = [visitsFor(h, 'ore'), visitsFor(h, 'hide')];

    await importInto(await exportFrom());
    await h.settle();
    await saved();

    expect([visitsFor(h, 'ore'), visitsFor(h, 'hide')]).toEqual(before);
    expect(lastToast()).toContain('nothing new to add');
  });

  // The case a stamp alone cannot survive. The file is written at the top of the trip and the
  // player keeps paging, which slides the visit's `at` forward and widens what it saw.
  it('adds nothing when the file was written mid-trip', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    const file = await exportFrom();

    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 300 })]) });
    await h.settle();
    await saved();

    await importInto(file);
    await h.settle();
    await saved();

    // Still one reading, still holding the whole trip's spread. A second visit here would be the
    // same trip counted twice, which is a second vote in every median drawn from it.
    expect(visitsFor(h, 'ore')).toEqual([
      visit(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2, 300, 500, { first: WALL_CLOCK_MS }),
    ]);
  });

  it('takes readings the other machine has and this one does not', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();

    await importInto({
      ...(await exportFrom()),
      device: 'another-machine',
      ledger: {
        queries: [''],
        items: {
          ore: [[WALL_CLOCK_MS / 1000 - 86_400, 300, 400, 0, WALL_CLOCK_MS / 1000 - 86_400]],
          silk: [[WALL_CLOCK_MS / 1000 - 3600, 70, 90, 0, WALL_CLOCK_MS / 1000 - 3600]],
        },
      },
    });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')).toHaveLength(2);
    expect(visitsFor(h, 'silk')).toHaveLength(1);
    expect(lastToast()).toContain('added 2 readings');
  });

  // A file exported before the player shortened their retention, or simply left in a folder for
  // two months, must not put back what the setting has since dropped.
  it('drops readings the retention setting has already forgotten', async () => {
    const h = await start({ settings: { 'history-days': 1 } });
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();

    await importInto({
      ...(await exportFrom()),
      ledger: {
        queries: [''],
        items: { ore: [[WALL_CLOCK_MS / 1000 - 30 * 86_400, 100, 100, 0, 0]] },
      },
    });
    await h.settle();
    await saved();

    // Not kept, and not CLAIMED either. The prune that follows the merge would drop it from the
    // store whatever happened, so the thing worth pinning is the count the player is told: an
    // import that reports a reading it then threw away is an import nobody can verify.
    expect(visitsFor(h, 'ore')).toHaveLength(1);
    expect(lastToast()).toContain('nothing new to add');
  });
});

/**
 * A ledger written by a build that had never heard of any of this.
 *
 * Both stores grew by APPENDING to a positional row whose reader defaults every slot, so there is
 * no migration pass, no version stamp in the store, and no moment where an upgrade could fail
 * halfway. What there IS is a reading that has to be right: an old visit carries no start, so the
 * only stamp available is one that has been sliding, and an old sale carries no origin, which can
 * only mean this device, since nothing else has ever written to a local store.
 */
describe('a ledger from before any of this', () => {
  it('reads a visit with no start, and gives it the only stamp there is', async () => {
    const storage = createFakeStorage();
    seedLedger(storage, { ore: [legacyVisit(WALL_CLOCK_MS - HOUR_MS, 400, 600)] });
    const h = await start({ storage });

    expect(tipOn('prices', 'ore')).toContain('4s each');
    // Written back in the new shape, with the start filled from the stamp it had.
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 400 })]) });
    await h.settle();
    await saved();
    expect(visitsFor(h, 'ore')[0]).toHaveLength(5);
  });

  /**
   * Two old readings must stay two.
   *
   * The fallback is what stops this: with no start recorded, every legacy visit would share one
   * value, and a merge matching on it would fold the whole of an item's history into whichever
   * reading it happened to find first. That does not shorten the list, which is what makes it
   * dangerous, it WIDENS one row to cover every other and moves its stamp, so the item comes out
   * with a plausible spread that no visit ever saw.
   */
  it('keeps two old readings apart when its own export comes back', async () => {
    const storage = createFakeStorage();
    seedLedger(storage, {
      ore: [
        legacyVisit(WALL_CLOCK_MS - 2 * HOUR_MS, 400, 600),
        legacyVisit(WALL_CLOCK_MS - HOUR_MS, 100, 200),
      ],
    });
    const h = await start({ storage });

    await importInto(await exportFrom());
    await h.settle();
    await saved();

    // Both rows survive, each keeping its own spread and its own stamp, and each written back
    // with a start filled from the stamp it already had. One row covering 100 to 600 is the
    // failure this guards, and it would look like an ordinary reading.
    expect(visitsFor(h, 'ore')).toEqual([
      visit(WALL_CLOCK_MS - 2 * HOUR_MS, 400, 600),
      visit(WALL_CLOCK_MS - HOUR_MS, 100, 200),
    ]);
  });

  // The case the exact match cannot cover, because the stamp it would match on has moved. It
  // falls back to the window rule the live fold uses, so the reading is merged rather than doubled.
  it('does not double an old reading when its own export comes back', async () => {
    const storage = createFakeStorage();
    seedLedger(storage, { ore: [legacyVisit(WALL_CLOCK_MS, 400, 600)] });
    const h = await start({ storage });
    const file = await exportFrom();

    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2);
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 300 })]) });
    await h.settle();
    await importInto(file);
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')).toHaveLength(1);
  });
});

/**
 * What an import refuses, and why each refusal names both sides.
 *
 * A market is per realm and the two channels serve different content, so merging one into another
 * is a corruption that nothing afterwards can find: the prices are plausible, they are simply not
 * this market's. The sale record is gated separately because the Merchant keeps a collection per
 * seller, so it belongs to a character rather than to a realm.
 */
describe('what an import will not take', () => {
  it('refuses a file from another realm, and says which', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();

    await importInto({ ...(await exportFrom()), realm: 'Ashmere' });
    await h.settle();

    expect(lastToast()).toContain('Ashmere');
    expect(lastToast()).toContain('per realm');
  });

  it('refuses a file from another channel', async () => {
    const h = await start();
    await h.settle();

    await importInto({ ...(await exportFrom()), channel: 'live' });
    await h.settle();

    expect(lastToast()).toContain('different content');
  });

  it('refuses a shape it does not know how to read', async () => {
    const h = await start();
    await h.settle();

    await importInto({ file: 'ledgerline', v: 99 });
    await h.settle();

    expect(lastToast()).toContain('version 99');
  });

  // The ledger still merges. Only the sales are left alone, and the report says so rather than
  // reporting a partial success as a whole one.
  it('leaves another character sales alone while taking their prices', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', price: 500 })], {
        collectionCopper: 465,
        collectionSales: [sale()],
      }),
    });
    await h.settle();

    await importInto({ ...(await exportFrom()), character: 'pbe/Someone-Else' });
    await h.settle();

    expect(lastToast()).toContain('belong to another character');
  });
});
