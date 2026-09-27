// @vitest-environment happy-dom

// Ledgerline, run through the real loader.
//
// Recording cases come first, and every write path is asserted on the store: a pane redrawn from
// memory looks the same whether or not the write happened.
//
// Only `near` carries a page. Recording `away` would erase the ledger, and drawing it as an empty
// market would misinform. Both are pinned.
//
// The reconnect blip: the client nulls its market mirror on reconnect, so one `away` arrives at the
// counter. `woc.net.state.reconnects` is driven from both sides, and the guard must be a timer,
// since a player who stays away sends no second reading.
//
// Fixtures mix a stack of 20 against a single at the same total, so a total-based series fails.
//
// The undercut check is pinned on what it refuses to say: an item with no block on the page is
// "not on this page", a name-sorted block starting at row 0 of a later page may have begun
// earlier, and price-sorted every later page can hide a cheaper copy while page 0 is certain.
//
// The cut and cap fixtures are not the game's own 5 and 12, so hardcoding either fails here.
//
// Bus: an absent publisher is ordinary, a fork's fqid works like the official one, and the ask
// goes out after the subscription.

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
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function body with no exports.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
const FQID = 'official/ledgerline';
const NAMESPACE = addonNamespace(FQID);
const CHARACTER_NAMESPACE = characterNamespace(FQID);

/**
 * The ledger's key: account-wide, scoped to realm and deployment. Written out, not imported: a key
 * both sides compute the same way proves nothing.
 */
const LEDGER_KEY = 'ledger/pbe/Claudemoon';
/** This install's id: the one account key that is not a ledger. */
const INSTALL_KEY = 'install';

/** The stamps are one character's, so the loader's own per-character key holds them. */
const MINE_KEY = perCharacterKey('pbe', 'Claudemoon/Marshal', 'mine-seen');

/** The sale record, per character: the Merchant keeps a collection per seller. */
const SOLD_KEY = perCharacterKey('pbe', 'Claudemoon/Marshal', 'sold');

/** How long a write is held before it lands, and how long one trip lasts. */
const WRITE_HOLD_MS = 2000;
const VISIT_WINDOW_MS = 10 * 60 * 1000;
/** The ask `woc.bus.follow` derives. The publisher answers both this and `item:ask`. */
const ASK_TOPIC = 'items:ask';
/** A fork's fqid on purpose: a consumer that named the official one would miss it. */
const PUBLISHER = 'someone/lorebind';
/** A computed read, because the reasons map is an index signature. See STYLE.md. */
function reasonFor(reasons: Record<string, string> | undefined, id: string): string {
  return reasons?.[id] ?? '';
}

/** A fork of the addon that CONSUMES what this one publishes, which is satchel's half. */
const SUBSCRIBER = 'someone/satchel';

/** One row as this addon puts it on the bus. See `priceRecord` in `main.js`. */
interface PriceRow {
  id: string;
  realm: string;
  unit: number;
  low: number;
  latest: number;
  at: number;
  visits: number;
  sold?: number;
  sales?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The Merchant's terms, deliberately not the game's own 5 and 12, so a hardcoded value fails. */
const CUT_PCT = 7;
const MAX_LISTINGS = 9;

/** How long the addon holds a page after a reconnect before believing the away. */
const RESYNC_GRACE_MS = 2000;

/**
 * A real listable legendary with a vendor floor of 20000 and no shop price, so a listing can sit
 * above the certain arm and below a recorded median.
 */
const LEGENDARY = 'varkhul_emberward';

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
  /** The total buyout for the whole stack, as the wire carries it. */
  price: number;
  mine: boolean;
  house: boolean;
  /**
   * Present only on a non-fungible copy, trimmed for strangers and possibly empty: the key is the
   * mark.
   */
  instance?: { signer?: string; enchant?: string; rolled?: Record<string, unknown> };
}

/**
 * One completed sale as the pending ledger carries it. No id and no clock: rows are identified
 * by position in a queue that grows until a collect empties it.
 */
interface Sale {
  itemId: string;
  count: number;
  /** Gross buyout the buyer paid for the whole stack. */
  price: number;
  /** Net copper added to the collection, after the cut. */
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
  /** The browse order. An older server sends none. */
  sort?: string;
  /** One row per item id. An older server sends none. */
  collapseLowest?: boolean;
  /**
   * The Sell tab's price reference and the item it was computed for. Both optional together, and
   * read as a pair: the id says whose price this is.
   */
  sellPriceItemId?: string | null;
  sellLowestPrice?: number | null;
  page: number;
  pageCount: number;
  collectionCopper: number;
  collectionItems: Array<{ itemId: string; count: number }>;
  /** Optional: an older server sends neither. */
  collectionSales?: Sale[];
  collectionSalesOmitted?: number;
  cutPct: number;
  maxListings: number;
  myListingCount: number;
}

interface MarketState {
  /** Null is what the server sends for a player not at the counter. */
  market: MarketPayload | null;
  collectPending: boolean;
}

/**
 * One recorded visit as stored: when, cheapest, dearest, query, when the trip began, and kind. An
 * array in seconds to keep the one-value ledger small. `first` is appended (older ledgers lack
 * it) because `at` slides as a trip is paged and cannot identify a visit across copies.
 */
type StoredVisit = [number, number, number, string, number?, number?];

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
 * One drained sale as stored: when, count, gross, net, buyer, and draining install. The origin is
 * appended; an empty one can only be this device. It lets an import replace one device's rows.
 */
type StoredSale = [number, number, number, number, string, string?];

interface StoredSold {
  sales: Record<string, StoredSale[]>;
  /** How far into the current pending ledger the addon has read. */
  read: number;
  /** The last row read, so an unseen queue is not mistaken for it. */
  anchor: string;
  /** Sales dropped before the addon could read them. */
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

/** A page carrying the pending sale ledger even when it is empty. */
function page(rows: Listing[], patch: Partial<MarketPayload> = {}): MarketPayload {
  return marketPayload({
    ...pageOf(rows),
    collectionSales: [],
    collectionSalesOmitted: 0,
    ...patch,
  });
}

/**
 * The same page from a server predating the ledger, with neither key present. Built without them,
 * since a key holding undefined differs from an absent key under `in`.
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
  /** Leave the world out, where an addon's first line actually runs. */
  world?: boolean;
  /** Start with no entity decoded, which is what `unknown` is. */
  empty?: boolean;
  /** `null` is a failed floor fetch. Anything else replaces the real table. */
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
  /** Every `price` row this addon has put on the bus, in the order it emitted them. */
  prices: PriceRow[];
  /** Send the ask a follower sends, and answer with whatever this addon publishes. */
  askPrices: () => PriceRow[] | null;
  /** The socket came back, which the away blip rides on. */
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
 * Let every queued microtask run, without an await inside a loop. Start-up is `storage.keys()`
 * plus a `get` per item, too deep for a fixed pair of flushes.
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
 * The figure at the end of a row, as announced. Coins render as discs plus numbers, so the text
 * reads `low44`; the kit's `aria-label` is the readable assertion.
 */
function figureOf(list: string, key: string): string {
  const value = rowIn(list, key)?.querySelector('.woc-bar-value');
  return value?.getAttribute('aria-label') ?? partOf(rowIn(list, key), '.woc-bar-value');
}

function detailOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-detail');
}

/** The width the kit painted a row's fill at. */
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

/** The status strip's tooltip, which carries the page number and the cut. */
function tipOnStrip(): string {
  return tipOver(document.querySelector('[data-role="status"]'));
}

function frameTitle(): string {
  return document.querySelector('[data-woc-frame="ledger"]')?.getAttribute('aria-label') ?? '';
}

/** The game's world object with the market as a getter, as the loader reads it. */
function fakeWorld(state: MarketState, player: unknown, empty: boolean): Record<string, unknown> {
  const entities = new Map<number, unknown>();
  if (!empty) {
    entities.set(PLAYER_ID, player);
  }
  return {
    entities,
    player,
    known: [],
    // The wire name, which the loader reads off the game's world object.
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
    // The real table by default. `floors: null` is a failed fetch: estimates work, nothing is
    // certain.
    data: floorsFor(options.floors),
  };
  if (options.world !== false) {
    input.game = Promise.resolve({ world: fakeWorld(state, player, options.empty === true) });
  }
  const harness = await mountAddon(input);
  teardown.push(harness.dispose);
  harness.inbound(HELLO_FRAME);

  // Straight onto the hub: an addon's own surface never delivers a message to its sender.
  const prices: PriceRow[] = [];
  teardown.push(
    harness.shared.bus.subscribe({
      from: ANY_SENDER,
      topic: 'price',
      owner: SUBSCRIBER,
      handler: (message) => {
        prices.push(message.payload as PriceRow);
      },
      onError: () => undefined,
    }),
  );
  let answered: PriceRow[] | null = null;
  teardown.push(
    harness.shared.bus.subscribe({
      from: ANY_SENDER,
      topic: 'prices',
      owner: SUBSCRIBER,
      handler: (message) => {
        answered = message.payload as PriceRow[] | null;
      },
      onError: () => undefined,
    }),
  );

  const settle = async (): Promise<void> => {
    harness.shared.world.watcher.poll();
    await flush(MICROTASKS);
    vi.advanceTimersToNextFrame();
    // `woc.paint` runs on the loader's frame loop, so a settle steps it as well as the clock. One
    // tick is one frame, however many repaints were asked for.
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
    prices,
    askPrices: () => {
      answered = null;
      harness.shared.bus.emit(SUBSCRIBER, 'prices:ask', undefined);
      return answered;
    },
    reconnect: () => {
      reconnects.count += 1;
      harness.netState({ reconnects: reconnects.count });
    },
  };
}

/** The most recent toast on screen, where an import reports what it did. */
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
 * Press Export and read back what it wrote, through the real button and blob: an encoder called
 * directly would pass while the button wrote nothing.
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
 * Press Import and hand it a file. The handler builds and clicks an input; the fake intercepts
 * the click, defines `files` and dispatches `change`, as a real pick does.
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

/** Every key this addon owns. */
function storedKeys(h: LedgerHarness): string[] {
  return Object.keys(h.hub.dump())
    .filter((key) => key.startsWith(`${NAMESPACE}/`))
    .map((key) => key.slice(`${NAMESPACE}/`.length))
    .sort();
}

function storedStamps(h: LedgerHarness): StoredStamp[] {
  return (h.hub.dump()[`${CHARACTER_NAMESPACE}/${MINE_KEY}`] as StoredStamp[] | undefined) ?? [];
}

/** Nothing written, in the same shape as every reading below. */
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
 * One stored visit in stored units (seconds, copper per item). The stamps are an object for
 * readability.
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

/** A Sell tab reading as stored: one price and a sixth slot giving its kind. */
function floorVisit(at: number, unit: number, said: VisitSaid = {}): StoredVisit {
  return [
    Math.round(at / 1000),
    unit,
    unit,
    said.query ?? '',
    Math.round((said.first ?? at) / 1000),
    1,
  ];
}

/** The same visit as a ledger from before `first` holds it: four slots. */
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

  // `woc.data` refuses any file the manifest does not declare.
  it('declares the vendor floor table it ships', () => {
    expect(parseManifest(MANIFEST_TEXT).data).toEqual(['floors.json']);
  });

  // This addon consumes names from lorebind and publishes prices to satchel. Neither is required.
  it('names both companions and says what each one is for', () => {
    const manifest = parseManifest(MANIFEST_TEXT);

    expect(manifest.companions).toEqual(['lorebind', 'satchel']);
    expect(reasonFor(manifest.companionReasons, 'satchel')).toContain('publishes');
  });
});

// The addon is a ledger before it is a panel: every case here asserts on the store.
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
    // Cheapest and dearest per item at the wall clock. The cloth is four for 800: 200 each.
    expect(visitsFor(h, 'ore')).toEqual([visit(WALL_CLOCK_MS, 500)]);
    expect(visitsFor(h, 'cloth')).toEqual([visit(WALL_CLOCK_MS, 200)]);
  });

  // A key per item costs a scan of the whole store, a round trip each and a watcher each. However
  // much a player browses, the ledger is one key.
  it('keeps the whole ledger in one key however many items are on the page', async () => {
    const h = await start();
    const rows = Array.from({ length: 40 }, (_unused, at) =>
      listing({ id: at + 1, itemId: `item_${String(at)}`, price: 100 + at }),
    );
    h.send({ market: page(rows) });
    await h.settle();
    await saved();

    // The install id is the only other key.
    expect(storedItems(h)).toHaveLength(40);
    expect(storedKeys(h)).toEqual([INSTALL_KEY, LEDGER_KEY]);
  });

  // One page's spread is one moment, and a second look within the window is the same trip.
  it('reads several pages of one visit as a single reading', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 300 })]) });
    await h.settle();
    await saved();

    // One reading for the trip, stamped when the player finished (`at`) and started (`first`).
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

  // The server sends nothing for an absent counter; recording that would erase the ledger.
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

  // The player's own ask is not a reading of the market.
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

  // The clocks are far apart on purpose: a monotonic stamp read in a later session is wrong.
  it('stamps a recording with the wall clock rather than the monotonic one', async () => {
    const h = await start();
    h.setWallClock(WALL_CLOCK_MS + DAY_MS);
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')[0]?.[0]).toBe((WALL_CLOCK_MS + DAY_MS) / 1000);
  });

  // A fresh join resets the server query while the controls survive; only the echo shows it.
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

  // A filtered reading and a whole-book reading answer different questions, so they never merge.
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

  // A market belongs to a realm: characters on one realm share a history, another realm shares
  // none.
  it('keeps another realm apart, and reads it back for the character in play', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    await saved();

    // Another character on another realm; the realm rides the hello frame.
    h.inbound({ ...HELLO_FRAME, realm: 'Ashmere' });
    // Nowhere near a counter, as a session starts.
    h.send({ market: null });
    await h.settle();
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 900 })]) });
    await h.settle();
    await saved();

    expect(storedKeys(h)).toEqual([INSTALL_KEY, LEDGER_KEY, 'ledger/pbe/Ashmere'].sort());
    expect(visitsFor(h, 'ore')).toEqual([visit(WALL_CLOCK_MS, 500)]);
    // Nothing of the first realm is on screen.
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

// The nearest honest thing to a remaining time: no row carries an expiry.
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

  // Ids are reused after a restart, so a stamp keyed on the id alone would be inherited. The
  // second row is needed because the loader's market signature is an id list.
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
    // No listing carries an expiry, so the stamp must say whose reckoning it is.
    expect(tip).toContain("by this addon's own reckoning");
  });
});

/**
 * The Merchant's pending sale ledger: rows are appended, the oldest drop past a cap of fifty into
 * `collectionSalesOmitted`, and a collect empties it. A sale has no id and no clock, so its only
 * identity is its position. The cases have teeth against the two silent failures: counting a row
 * twice, and reading the drain as an empty record.
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

    // Gross and net both kept: summing the wrong one overstates income by `cutPct`. The sixth slot
    // is the draining install.
    const rows = salesFor(h, 'ore');
    expect(rows[0]?.slice(0, 5)).toEqual([WALL_CLOCK_MS / 1000, 2, 900, 837, 'Bragg']);
    expect(rows[0]?.[5]).toMatch(/./);
  });

  // The page is re-read every browse and a row has no id, so comparing contents counts it per page.
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

  // The rows vanish on Collect with nothing announced; mirroring the wire would erase the history.
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
   * A collect plus as many new sales leaves the queue the same length, so position alone skips
   * them. The anchor row says this is a different queue.
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

  // The server caps at fifty and a dropped row's gold stays in the total, so the gap must be said.
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
   * The server's counter includes drops this addon already read. What is missing from this record
   * is smaller, and only a queue position can work it out.
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

  /** A 1-copper listing nets nothing after the cut and is still a sale. */
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
   * An older server sends no field, which is not an empty queue: reading it as a collect would
   * recount every waiting sale when a real ledger arrived.
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
 * The sale record on screen: kept apart from the asks and labelled, and carrying how incomplete
 * the Merchant's cap made it.
 */
describe('what the sale record says', () => {
  it('says how many sales it never saw', async () => {
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
   * An ask is what a seller wanted and a sale what a buyer paid; neither figure moves the other.
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

  it('says on a price row what the item actually fetched, labelled apart', async () => {
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

  // Said once under the list: it is true of every row.
  it('says the record is the player own sales and nobody else', async () => {
    const h = await start();
    h.send({ market: page([], { collectionCopper: 465, collectionSales: [sale()] }) });
    await h.settle();
    openTab('Sold');
    await h.settle();

    expect(lineFor('sold-note')).toContain('your own sales');
  });
});

// One `away` after a reconnect is the client clearing its mirror. Both sides of the guard are
// pinned, since unending grace would pass the first case.
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

  // A timer, since a still-away player sends no second reading.
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
    // The expiring grace asks for a repaint, which the frame loop performs.
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

  // Walking away hides the live page, never the recorded ledger.
  it('keeps the recorded prices on screen after a genuine away', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.send({ market: null });
    await h.settle();

    expect(keysIn('prices')).toEqual(['ore']);
  });
});

// `away` and `unknown` both carry null and neither is an empty market.
describe('what it says when there is no page', () => {
  it('says nothing has decoded yet before the world is up', async () => {
    const h = await start({ world: false });
    await h.settle();

    expect(statFor('where')).toBe('unknown');
    expect(lineFor('status-line')).toContain('Nothing has been read yet');
  });

  // With a world object and nothing decoded, the answer is `unknown`, not `away`.
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

  // Drawn only where the figures could be misread, so a whole unfiltered page gets no sentence.
  it('says nothing at all while a whole unfiltered page is being read', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore' })]) });
    await h.settle();

    expect(lineFor('status-line')).toBe('');
  });

  it('says a search is applied', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore' })], { filter: 'ore' }) });
    await h.settle();

    expect(lineFor('status-line')).toContain('ore');
    expect(lineFor('status-line')).toContain('part of the book, not all of it');
  });
});

// `price` is the stack total, so a series must divide by count.
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

    // 100 copper each against 2000 each: same total, ten times apart per item.
    expect(figureOf('prices', 'ore')).toBe('low 1 silver');
    expect(detailOf('prices', 'ore')).toContain('median 1s');
  });

  // The figure itself says "each".
  it('says the figures are per item rather than per listing', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 2000 })]) });
    await h.settle();

    expect(tipOn('prices', 'ore')).toContain('1s each');
  });

  // Printed as the game writes it, never `0g 0s 44c`.
  it('drops a unit of money that is empty', async () => {
    const h = await start();
    // Two visits, so the tooltip's long text form is exercised too; a round gold amount is where an
    // empty unit would show.
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

  // One vote per visit, or the busiest day decides the typical price.
  it('reports the median over the visits rather than over the listings', async () => {
    const h = await start();
    // Three trips; the first found two asks, one vote between them (per listing it would be 120).
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

/**
 * A price row draws no fill: one item's price is not a share of anything, and a position in its
 * own range is the same half width on nearly every row.
 */
describe('the price row', () => {
  it('draws no fill, because a price is not a share of anything', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 900 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({ market: page([listing({ id: 2, itemId: 'ore', price: 100 })]) });
    await h.settle();

    // The kit always paints a fill element; a price row never gives it a width.
    expect(fillOf('prices', 'ore')).toBe('0.00%');
  });

  // In a thin book the low, median and latest are usually one number.
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

// Name-sorted, a block is contiguous and ascending, so its first row is the cheapest competitor.
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

  // A tooltip is read long after its row was built, so it must answer from the live page, or it
  // disagrees with the verdict on the row.
  it('answers a tooltip from the live page, not the one that built the row', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 400, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 500 }),
      ]),
    });
    await h.settle();
    // The rival line is what moves with the page; the verdict word lives on the row.
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

  // Absence is not evidence: under a search, most of the book is off the page.
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

  // A block starting at row 0 of a later page may have begun on the page before.
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

  // Price-sorted, an item's rows are not contiguous, so a cheaper copy can sit on any earlier
  // page; the block-start guard cannot see that.
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

  // Page 0 price-sorted holds the cheapest rows of the whole book, so it is certain.
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

/**
 * Browse's "lowest price only": the server collapses the matched book to one row per item, yours
 * included, before paging and counting. A listing of yours on the page has not been undercut, and
 * a missing one has. `myListingCount` sees the missing ones, but only with no filter, since it
 * spans the whole book.
 */
describe('the lowest-price-only toggle', () => {
  it('warns about a listing of yours the collapse dropped', async () => {
    const h = await start();
    h.send({
      market: page(
        [
          listing({ id: 1, itemId: 'ore', price: 500, mine: true }),
          listing({ id: 2, itemId: 'cloth', price: 300 }),
        ],
        { collapseLowest: true, myListingCount: 3 },
      ),
    });
    await h.settle();

    // Three listings, one still cheapest, so two are undercut.
    expect(lastToast()).toContain('2 listings');
    expect(lastToast()).toContain('no longer the cheapest');
  });

  it('will not count the dropped ones while a filter is narrowing the page', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', price: 500, mine: true })], {
        collapseLowest: true,
        myListingCount: 3,
        filter: 'ore',
      }),
    });
    await h.settle();

    // Under a filter, "not ore" and "undercut" cannot be separated, so nothing is counted.
    expect(lastToast()).toBe('');
    expect(lineFor('mine-note')).toContain('cannot be counted');
  });

  it('says a listing of yours that survived is the cheapest anywhere', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', price: 500, mine: true })], {
        collapseLowest: true,
      }),
    });
    await h.settle();

    // The collapse spans the whole matched book, so this is the strongest claim the pane makes.
    expect(detailOf('mine', '1')).toContain('cheapest anywhere');
  });

  it('keeps a page of floors out of the visit that read the listings', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2);
    h.send({
      market: page([listing({ id: 2, itemId: 'ore', price: 300 })], { collapseLowest: true }),
    });
    await h.settle();
    await saved();

    // Same trip, still two readings: folding a collapsed price into asks widens the spread.
    expect(visitsFor(h, 'ore')).toHaveLength(2);
  });

  it('does not report the toggle as a search that narrowed the book', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', price: 500 })], { collapseLowest: true }),
    });
    await h.settle();

    // The collapse leaves the match whole, so the status does not claim a partial book.
    expect(lineFor('status-line')).toContain('Reading the book');
    expect(lineFor('status-line')).not.toContain('Searching');
  });

  it('says what the toggle costs the scan', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 })], {
        collapseLowest: true,
      }),
    });
    await h.settle();

    // Collapsed, there is no second-cheapest, so the note says the scan had nothing to compare.
    expect(lineFor('deals-note')).toContain('With lowest price only on');
  });
});

/**
 * The Sell tab's answer, the one market-wide price the game states, present only while something
 * is staged and read as an (id, price) pair. It counts every listing, house and own included, so
 * it caps a resale anchor, never joins the median, and an undercut of it checks whose floor it is.
 */
describe('what the Sell tab was told', () => {
  it('records the floor under the item it was computed for', async () => {
    const h = await start();
    h.send({
      market: page([], { sellPriceItemId: 'ore', sellLowestPrice: 400 }),
    });
    await h.settle();
    await saved();

    // One price, no spread, and the sixth slot gives the kind.
    expect(visitsFor(h, 'ore')).toEqual([floorVisit(WALL_CLOCK_MS, 400, { query: 'sell' })]);
  });

  it('records the same floor again on a later trip', async () => {
    const h = await start();
    const staged = { sellPriceItemId: 'ore', sellLowestPrice: 400 };
    h.send({ market: page([], staged) });
    await h.settle();
    h.send({ market: null });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS + HOUR_MS);
    h.send({ market: page([], staged) });
    await h.settle();
    await saved();

    // The same answer an hour later is a second reading: the floor held.
    expect(visitsFor(h, 'ore')).toHaveLength(2);
  });

  it('records nothing for a staged item nobody is selling', async () => {
    const h = await start();
    h.send({ market: page([], { sellPriceItemId: 'ore', sellLowestPrice: null }) });
    await h.settle();

    expect(storedItems(h)).toEqual([]);
    expect(lineFor('sell-line')).toContain('nobody is selling');
  });

  it('keeps the floor out of what a resale is priced against', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // Two ordinary readings, then a Sell floor. A median hides one extra point, so the evidence
    // count
    // is where counting the floor would show.
    const earlier = [0, 1];
    await inSeries(earlier.entries(), async ([at]) => {
      h.setWallClock(WALL_CLOCK_MS + at * (VISIT_WINDOW_MS + HOUR_MS));
      h.send({
        market: page([listing({ id: 90 + at, itemId: 'iron_ore', count: 10, price: 400 })]),
      });
      await h.settle();
      h.send({ market: null });
      await h.settle();
    });
    h.setWallClock(WALL_CLOCK_MS + 2 * (VISIT_WINDOW_MS + HOUR_MS));
    h.send({ market: page([], { sellPriceItemId: 'iron_ore', sellLowestPrice: 4000 }) });
    await h.settle();
    h.send({
      market: page([listing({ id: 7, itemId: 'iron_ore', count: 10, price: 100 })]),
    });
    await h.settle();

    // 40 a unit over ten, less the suite's 7 percent cut, less the 100 the stack cost: 272.
    expect(figureOf('deals', '7')).toContain('2 silver, 72 copper');
    // Two readings, not three: the floor includes the player's own listing and house stock.
    expect(detailOf('deals', '7')).toContain('2 visits');
  });

  it('suggests an ask a copper under the floor, and what it nets', async () => {
    const h = await start();
    h.send({ market: page([], { sellPriceItemId: 'ore', sellLowestPrice: 400 }) });
    await h.settle();

    // The server rounds per-unit up, so 399 is under. 399 less 7 percent is 371.
    expect(lineFor('sell-line')).toContain('ask 3s 99c');
    expect(lineFor('sell-line')).toContain('netting 3s 71c');
  });

  it('will not suggest undercutting a listing of your own', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', count: 2, price: 800, mine: true })], {
        sellPriceItemId: 'ore',
        sellLowestPrice: 400,
      }),
    });
    await h.settle();

    // The floor counts the player's own rows, so the cheapest copy is theirs.
    expect(lineFor('sell-line')).toContain('your own');
    expect(lineFor('sell-line')).not.toContain('ask 3s 99c');
  });

  it('will not suggest an ask a vendor would beat', async () => {
    const h = await start();
    // A vendor pays 4 each for copper ore, so undercutting a 4 copper floor loses money for
    // certain.
    h.send({ market: page([], { sellPriceItemId: 'copper_ore', sellLowestPrice: 4 }) });
    await h.settle();

    expect(lineFor('sell-line')).toContain('vendor');
  });

  it('says nothing at all while nothing is staged', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();

    expect(lineFor('sell-line')).toBe('');
  });
});

// Both figures ride the payload; a hardcoded one would agree with a fixture using the real numbers.
describe('the Merchant terms', () => {
  it('reads the cut off the page rather than assuming one', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 1000, mine: true })]) });
    await h.settle();

    // The cut is read off every page and said in the strip tooltip and where it changes an amount.
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

// Not gated on proximity: the badge works with the pane closed and in another zone.
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

// Subscribe with anySender, ask after subscribing, and treat silence as ordinary.
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

    // The label is the guarantee; the tooltip does not repeat who published it.
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

  // A catch-up arrives as one batch, so a consumer of the single-record topic alone takes nothing.
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

  // The hub catches a throw, so the proof of the guard is that the next batch still lands.
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

  // Delivery is synchronous, so asking before subscribing misses the answer and looks like no
  // publisher. The bus is wired before the addon is evaluated, so this builds its own services.
  // The stand-in answers with the batch, as the real publisher does.
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
    // Straight onto the hub: an addon's own surface never delivers to its sender.
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

  // Read-only is enforced by there being no send API; what is pinned is that no control appears.
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
 * The deal scan, the one thing here that tells a player to act. Figures are in copper, never as a
 * discount: a deep discount on a cheap item is worth less than a small one on a valuable stack.
 * The cut is 7 percent so a hardcoded 5 fails. Item ids are real, since floors come from the
 * shipped table (`copper_ore` is 4 a unit, `iron_ore` 8). The baseline case pins that a visit is
 * excluded from its own median; the accumulation case pins that paging keeps earlier finds.
 */
describe('the deal scan', () => {
  it('reports a stack under the vendor floor at what the vendor would clear', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // 20 copper ore for 60. A vendor pays 4 each, 80 for 20, so 20 clear.
    h.send({ market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })]) });
    await h.settle();

    expect(keysIn('deals')).toEqual(['1']);
    expect(figureOf('deals', '1')).toContain('20 copper');
    expect(detailOf('deals', '1')).toContain('vendor floor');
  });

  // The flag refuses a claim. No shipped item has it beside a sell value, so the table is replaced.
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

  // A failed fetch keeps estimates and loses certainties; it must not call an estimate certain.
  it('claims nothing certain when the floor table never arrived', async () => {
    const h = await start({ floors: null, settings: { 'min-profit': 0 } });
    h.send({ market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })]) });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
  });

  it('anchors a resale on the next cheapest ask, with the cut taken off', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // 10 iron ore for 200; the next ask is 40 each, so 400 gross, 372 after 7 percent, 172 clear.
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 }),
        listing({ id: 2, itemId: 'iron_ore', count: 10, price: 400, sellerName: 'Rival' }),
        listing({ id: 3, itemId: 'iron_ore', count: 10, price: 500 }),
      ]),
    });
    await h.settle();

    expect(figureOf('deals', '1')).toContain('1 silver, 72 copper');
    // The count is the confidence: two rivals stand behind the price.
    expect(detailOf('deals', '1')).toContain('2 rivals');
  });

  // To sell you must be the cheapest, so only the cheapest listing can be a buy.
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

  // House stock never depletes, so an anchor above it plans to undercut a counter open tomorrow.
  it('will not anchor above the standing stock the Merchant always has', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 }),
        listing({ id: 2, itemId: 'iron_ore', count: 10, price: 900, sellerName: 'Rival' }),
        // 25 each forever: caps the resale at 250 gross, 232 after the cut, 32 clear.
        listing({ id: 3, itemId: 'iron_ore', count: 4, price: 100, house: true }),
      ]),
    });
    await h.settle();

    expect(figureOf('deals', '1')).toContain('32 copper');
  });

  // Mostly covered by the anchor cap, but pinned separately as its own rule. The table is replaced
  // to
  // make the guard reachable.
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
    // Three earlier visits at 20, 40 and 60 a unit. The spread is what lets this fail: three equal
    // readings would absorb the bug.
    const earlier = [200, 400, 600];
    await inSeries(earlier.entries(), async ([at, total]) => {
      h.setWallClock(WALL_CLOCK_MS + at * (VISIT_WINDOW_MS + HOUR_MS));
      h.send({ market: page([listing({ id: 9, itemId: 'iron_ore', count: 10, price: total })]) });
      await h.settle();
      h.send({ market: null });
      await h.settle();
    });
    h.setWallClock(WALL_CLOCK_MS + earlier.length * (VISIT_WINDOW_MS + HOUR_MS));

    // This visit's low is 10. The baseline is median(20, 40, 60) = 40; including this visit gives
    // 30, and the row would report 179.
    h.send({ market: page([listing({ id: 1, itemId: 'iron_ore', count: 10, price: 100 })]) });
    await h.settle();

    // 40 each over ten is 400 gross, 372 after the cut, 272 over the 100 cost.
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

  // Walking away ends the scan; carrying it off would present an old page as current.
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
        // A tenth of the going rate, worth 33 copper.
        listing({ id: 1, itemId: 'copper_ore', count: 10, price: 5 }),
        listing({ id: 2, itemId: 'copper_ore', count: 10, price: 50 }),
        // A fifth off, worth several silver.
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

  // The coverage line is the honest limit on the pane.
  it('says how much of the book it has actually read', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([listing({ id: 1, itemId: 'copper_ore', count: 20, price: 60 })], {
        page: 0,
        pageCount: 9,
      }),
    });
    await h.settle();

    // Under the list, since it applies to every row.
    expect(lineFor('deals-note')).toContain('1 of 9 pages');
  });
});

/**
 * Staleness in the scan buffer: a gone listing left in the buffer keeps setting the anchor, making
 * an ordinary listing look like a bargain with nothing on screen to say so.
 */
describe('the scan buffer over time', () => {
  it('stops anchoring on a listing this trip has not seen for a visit', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // A cheap iron listing, read once.
    h.send({ market: page([listing({ id: 5, itemId: 'iron_ore', count: 10, price: 100 })]) });
    await h.settle();

    // Past one trip: the cheap row is gone and two dearer ones remain.
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS + HOUR_MS);
    h.send({
      market: page([
        listing({ id: 6, itemId: 'iron_ore', count: 10, price: 300 }),
        listing({ id: 7, itemId: 'iron_ore', count: 10, price: 600 }),
      ]),
    });
    await h.settle();

    // The 300 stack anchors on the 600 one: 600 gross, 558 after the cut, 258 over. Anchored on
    // the vanished 100 stack it would be a loss and no row.
    expect(keysIn('deals')).toEqual(['6']);
    expect(figureOf('deals', '6')).toContain('2 silver, 58 copper');
    expect(detailOf('deals', '6')).toContain('1 rival');
  });
});

/**
 * Heroic variants: a separate id and series under the same display name. Untagged, two rows share
 * a name at very different prices, and on a deal row the player cannot tell which earns the profit.
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

  // `ui.icon.itemArtName` has one name for both, so without a publisher the rows fall back to ids.
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
 * The filter echo's unset value is the word `all` (`defaultMarketQuery`), only `search` is empty.
 * Read literally, the panel says "Searching all, all, all, all, all" and every reading records as a
 * search.
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
    // Matched on the repeat: the sentence legitimately says this is not all of the book.
    expect(said).not.toContain('all, all');
  });

  // The order's unset value is `name`, not `all`; reading it like the enums would tag every
  // reading.
  it('says nothing about the order Browse has always used', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })], { sort: 'name' }) });
    await h.settle();
    await saved();

    expect(tipOnStrip()).toContain('the whole book');
    expect(visitsFor(h, 'ore')[0]?.[3]).toBe('');
  });

  // Folding the two orders would take a median over whichever end of the book was in view.
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
 * What a resale can fetch. Both failures here overstate: forgetting the player's own listings are
 * competition, and taking the richer of two estimates, which on a thin item believes one
 * stranger's ask and sorts it to the top.
 */
describe('what a resale is priced against', () => {
  it('counts the player own listing as competition', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        // The player bought a cheap one and relisted it under the going rate.
        listing({ id: 1, itemId: 'ore', price: 900, mine: true }),
        listing({ id: 2, itemId: 'ore', price: 1000 }),
        // One stranger asking a wild price, the only other listing.
        listing({ id: 3, itemId: 'ore', price: 5000 }),
      ]),
    });
    await h.settle();

    // Buying at 1000 against the player's own 900 loses, and 5000 is unreachable behind it.
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

  it('prices a resale at the cheaper of the page and the recorded median', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // Three earlier visits at 10, 12 and 14 a unit: median 12.
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
        // One stranger at five times the going rate, the only rival on the page.
        listing({ id: 2, itemId: 'ore', count: 100, price: 5000 }),
      ]),
    });
    await h.settle();

    // 12 each over 100 is 1200 gross, 1116 after the cut, 116 over cost. The lone 5000 ask would
    // report 3650.
    expect(figureOf('deals', '1')).toContain('1 silver, 16 copper');
    expect(detailOf('deals', '1')).toContain('3 visits');
  });
});

/**
 * The thinnest series: a legendary, posted a handful of times a month. Binding on the Crucible
 * tier moves between releases, so it is pinned by id in both directions, never by count. The
 * flipping items are `ignivar_loot.ts` boss drops; the raid legendaries live in
 * `ignivar_drops.ts` and bind independently, so the pin names one of each.
 */
describe('a legendary, and a series too thin to be one', () => {
  it('carries the listable legendaries and none of the bound Crucible items', () => {
    const rows = (JSON.parse(FLOORS_TEXT) as { items: { id: string }[] }).items;
    const ids = new Set(rows.map((row) => row.id));

    expect(ids.has(LEGENDARY)).toBe(true);
    // A class-set piece and a sigil: bound.
    for (const bound of ['emberscreed_helmet', 'sigil_ember_helmet']) {
      expect(ids.has(bound)).toBe(false);
    }
    // The raid legendary (`ignivar_drops.ts`): bound. Listing it means the legendaries were
    // unbound.
    expect(ids.has('varkhul_forgebreaker')).toBe(false);
    // The off-set weapon whose binding flips with the `ignivar_loot.ts` tier: currently listable.
    expect(ids.has('forgefathers_warhammer')).toBe(true);
    // A Zone 3 legendary, outside the tier's binding rule.
    expect(ids.has('voidsong_dirk')).toBe(true);
    expect(ids.has('kingsbane_last_oath')).toBe(true);
  });

  // No row: a figure with nothing behind it would sort among measured rows.
  it('will not price a resale against a single earlier reading', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({ market: page([listing({ id: 80, itemId: LEGENDARY, price: 60_000 })]) });
    await h.settle();
    h.send({ market: null });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + VISIT_WINDOW_MS + HOUR_MS);

    // Alone on the page, and 3 gold is over the 2 a vendor pays, so neither other arm fires.
    h.send({ market: page([listing({ id: 1, itemId: LEGENDARY, price: 30_000 })]) });
    await h.settle();

    expect(keysIn('deals')).toEqual([]);
  });

  // On the row, not in the tooltip: a ranked list is read by scanning.
  it('names the two readings a thin median rests on', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    const earlier = [60_000, 50_000];
    await inSeries(earlier.entries(), async ([at, price]) => {
      h.setWallClock(WALL_CLOCK_MS + at * (VISIT_WINDOW_MS + HOUR_MS));
      h.send({ market: page([listing({ id: 80 + at, itemId: LEGENDARY, price })]) });
      await h.settle();
      h.send({ market: null });
      await h.settle();
    });
    h.setWallClock(WALL_CLOCK_MS + earlier.length * (VISIT_WINDOW_MS + HOUR_MS));

    h.send({ market: page([listing({ id: 1, itemId: LEGENDARY, price: 30_000 })]) });
    await h.settle();

    // Median 5g 50s, 5g 11s 50c after the cut, 2g 11s 50c over the 3 gold cost.
    expect(figureOf('deals', '1')).toContain('2 gold, 11 silver, 50 copper');
    expect(detailOf('deals', '1')).toContain('2 visits');
  });
});

/**
 * The one thing no figure says: the listing standing between a resale and a sale is the player's.
 * The game's window gives no hint of it.
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

    // Against the player's own 3000: 1790 after the cut; the 9000 ask is unreachable behind it.
    expect(figureOf('deals', '2')).toContain('17 silver, 90 copper');
    expect(tipOn('deals', '2')).toContain('YOUR OWN');
    expect(tipOn('deals', '2')).toContain('Cancelling it');
  });
});

/**
 * An enchanted, masterwork or signed copy is a different good under the same id (the server's
 * collapse keeps each distinct). A premium never enters the plain series, and a plain price never
 * judges a premium copy. The mark is the key's presence: the trimmed payload may be empty.
 */
describe('an instanced copy', () => {
  it('leaves the premium out of the plain item price series', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 }),
        listing({
          id: 2,
          itemId: 'iron_ore',
          count: 1,
          price: 5000,
          instance: { enchant: 'keen' },
        }),
      ]),
    });
    await h.settle();
    await saved();

    // 20 a unit twice, not 20 to 5000: the second row is an enchanted copy.
    expect(visitsFor(h, 'iron_ore')).toEqual([visit(WALL_CLOCK_MS, 20)]);
  });

  it('does not price a plain listing against an enchanted one', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 10, price: 200 }),
        listing({ id: 2, itemId: 'iron_ore', count: 10, price: 4000, instance: {} }),
      ]),
    });
    await h.settle();

    // Anchoring plain ore on the enchanted copy would invent a resale nobody would pay.
    expect(keysIn('deals')).toEqual([]);
  });

  it('still offers one under the vendor floor, which pays no premium either', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // A vendor pays `sellValue` whatever is on the copy, so the vendor arm survives.
    h.send({
      market: page([
        listing({
          id: 1,
          itemId: 'ashwood_axe',
          count: 1,
          price: 10,
          instance: { enchant: 'keen' },
        }),
      ]),
    });
    await h.settle();

    expect(keysIn('deals')).toEqual(['1']);
    expect(detailOf('deals', '1')).toContain('vendor floor');
  });

  it('does not call a copy of yours undercut by a plain listing', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'iron_ore', count: 1, price: 4000, mine: true, instance: {} }),
        listing({ id: 2, itemId: 'iron_ore', count: 10, price: 200 }),
      ]),
    });
    await h.settle();

    // Plain ore does not compete with it, so no undercut is reported.
    expect(detailOf('mine', '1')).not.toContain('undercut');
    expect(detailOf('mine', '1')).toContain('its own');
    expect(lastToast()).toBe('');
  });
});

/**
 * A stack posted at one item's price, the commonest real underpricing. Judged against the dearest
 * estimate, since against the cautious anchor a typo stops looking like one when a cheaper source
 * wins.
 */
describe('a stack priced as one', () => {
  it('is named even when the resale is anchored somewhere cheaper', async () => {
    const h = await start({ settings: { 'min-profit': 0 } });
    // Three visits at 100 a unit: the median is well under the page's asks.
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
        // A hundred ore for the price of one: the unit price typed into the total field.
        listing({ id: 1, itemId: 'ore', count: 100, price: 300 }),
        listing({ id: 2, itemId: 'ore', count: 100, price: 30_000 }),
      ]),
    });
    await h.settle();

    // The resale uses the cheaper recorded 100; the typo is judged against the page's 300.
    expect(detailOf('deals', '1')).toContain('stack priced as one');
    expect(detailOf('deals', '1')).toContain('3 visits');
  });
});

/**
 * Carrying a ledger between machines is a merge, never a replace. Re-importing a device's own
 * export changes nothing, and neither does a file written mid-trip, whose `at` has since slid:
 * only the shared `first` matches it. Older readings without `first` fall back to the live fold's
 * window rule.
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

  // Written at the top of the trip; more paging slides `at` and widens the spread.
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

    // Still one reading with the whole trip's spread: a second would be a second vote.
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

  // An old file must not restore what the retention setting has dropped.
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

    // The prune would drop it anyway; what is pinned is that the report does not claim it.
    expect(visitsFor(h, 'ore')).toHaveLength(1);
    expect(lastToast()).toContain('nothing new to add');
  });
});

/**
 * A ledger from a build before `first` and origins. Slots are appended and defaulted, so there is
 * no migration pass. An old visit's only stamp has been sliding; an old sale's missing origin can
 * only mean this device.
 */
describe('a ledger from before any of this', () => {
  it('reads a visit with no start, and gives it the only stamp there is', async () => {
    const storage = createFakeStorage();
    seedLedger(storage, { ore: [legacyVisit(WALL_CLOCK_MS - HOUR_MS, 400, 600)] });
    const h = await start({ storage });

    expect(tipOn('prices', 'ore')).toContain('4s each');
    // Written back in the new shape, the start filled from the stamp.
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 400 })]) });
    await h.settle();
    await saved();
    expect(visitsFor(h, 'ore')[0]).toHaveLength(5);
  });

  /**
   * Two old readings must stay two: matching on a shared missing start would widen one row over
   * the item's whole history, a plausible spread no visit saw.
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

    // Both rows survive with their own spread and stamp, each start filled from its stamp.
    expect(visitsFor(h, 'ore')).toEqual([
      visit(WALL_CLOCK_MS - 2 * HOUR_MS, 400, 600),
      visit(WALL_CLOCK_MS - HOUR_MS, 100, 200),
    ]);
  });

  // The stamp has moved, so the window rule merges it rather than doubling it.
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
 * What an import refuses, naming both sides. Realm and channel gate the ledger, since cross-market
 * prices are plausible and undetectably wrong. The character gates the sales.
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

  // The ledger merges, the sales do not, and the report says so.
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

// Prices out, in the same shapes consumed (`price`/`prices` against `item`/`items`). Never a field
// on `item`: a second publisher there would replace the catalogue's record.
describe('publishing what things go for', () => {
  it('puts a page it has just read on the bus', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 4000 })]) });
    await h.settle();

    expect(h.prices).toHaveLength(1);
    expect(h.prices[0]).toMatchObject({ id: 'ore', realm: 'Claudemoon', unit: 200, visits: 1 });
  });

  // The same page arrives at snapshot rate and `foldPage` reports a sliding stamp as a move, so the
  // gate is the figure. The ore is unchanged and must stay quiet; the new cloth is the control.
  it('says nothing about an item whose figure has not moved', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 4000 })]) });
    await h.settle();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', count: 20, price: 4000 }),
        listing({ id: 2, itemId: 'cloth', count: 10, price: 500 }),
      ]),
    });
    await h.settle();

    expect(h.prices.map((row) => row.id)).toEqual(['ore', 'cloth']);
  });

  it('speaks again once the price behind the figure has moved', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 4000 })]) });
    await h.settle();
    h.send({ market: page([listing({ id: 2, itemId: 'ore', count: 20, price: 2000 })]) });
    await h.settle();

    expect(h.prices).toHaveLength(2);
    expect(h.prices.at(-1)?.unit).toBe(100);
  });

  // A publisher with nothing at registration answers the whole ledger once it has one.
  it('answers an ask with everything in the ledger', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', count: 20, price: 4000 }),
        listing({ id: 2, itemId: 'cloth', count: 10, price: 500 }),
      ]),
    });
    await h.settle();

    const rows = h.askPrices();

    expect(rows?.map((row) => row.id).sort()).toEqual(['cloth', 'ore']);
  });

  // Null, not an empty array: nothing yet and nothing to say are the same ordinary answer.
  it('answers an empty ledger with nothing at all', async () => {
    const h = await start();
    await h.settle();

    expect(h.askPrices()).toBeNull();
  });

  // Paid and asked are separate series, never folded, on the bus as on screen.
  it('carries what was paid beside the ask rather than inside it', async () => {
    const h = await start();
    h.send({
      market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 4000 })], {
        collectionSales: [
          { itemId: 'ore', count: 10, price: 3000, proceeds: 2850, buyerName: 'Someone' },
        ],
      }),
    });
    await h.settle();

    expect(h.prices.at(-1)).toMatchObject({ unit: 200, sold: 300, sales: 1 });
  });

  // Required: a consumer pooling across characters holds items on markets this ledger never saw.
  it('names the realm every figure is about', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 4000 })]) });
    await h.settle();

    expect(h.prices.at(-1)?.realm).toBe('Claudemoon');
  });
});
