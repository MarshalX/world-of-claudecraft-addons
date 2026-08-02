// @vitest-environment happy-dom

// Ledgerline, run through the real loader.
//
// THE RECORDING CASES COME FIRST, because the addon is a ledger before it is a panel
// and the screen can be right while nothing was saved. Every write path here is
// asserted on the STORE: a pane redrawn from memory looks identical whether or not the
// write behind it happened at all.
//
// THE THREE-STATE READ IS THE FIRST SUBJECT. `world.market` answers `near`, `away` or
// `unknown`, and only the first carries a page. Recording on `away` would erase the
// ledger the moment the player walked three paces from the Merchant, and drawing `away`
// as an empty market would tell a player standing in a town that nobody is selling
// anything. Both are pinned.
//
// THE RECONNECT BLIP IS THE CASE THAT CANNOT BE SEEN FROM THE STATE. The online client
// force-nulls its own market mirror on reconnect, so one snapshot of `away` arrives
// while the player is still standing at the Merchant. The guard is
// `woc.net.state.reconnects`, and the suite drives it from both sides: a bumped count
// holds the page, and an unbumped one is believed at once. The third case is the one
// that decides the SHAPE of the guard. A watch key fires on a change, so a player who
// stays away sends no second reading, and a guard that waited for one to end the grace
// would leave the panel saying "resyncing" for the rest of the session. Only a timer
// satisfies all three, and all three are here so that it stays one.
//
// THE UNIT PRICE IS THE ARITHMETIC WORTH PINNING. `price` is the total buyout for the
// whole stack, so a series that compares totals is comparing stack sizes. The fixtures
// deliberately mix a stack of 20 against a single at the same total, which is the pair
// that reads identically to a total-based series and ten times apart to a correct one.
//
// THE UNDERCUT CHECK IS PINNED ON WHAT IT REFUSES TO SAY. The server sorts the others
// section by display name and then by price, so a block is contiguous and ascending and
// its first row is the cheapest competitor. Two answers are therefore NOT available and
// the cases are about those: an item with no block on the page reads as "not on this
// page" rather than as being uncontested, and a block that begins at the very first row
// of a page after the first may have started on the page before, which reads as
// uncertain rather than as cheapest.
//
// THE CUT AND THE CAP ARE READ, so the fixtures use figures that are NOT the game's own
// 5 percent and 12 listings: an addon that hardcoded either would pass against a
// fixture that agreed with it and fail here.
//
// THE BUS CONTRACT. A publisher that is not installed is an ordinary state, a fork's
// fqid answers as readily as the official one, and the ask goes out after the
// subscription so that a synchronous answer reaches a handler that already exists.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_SENDER } from '../../loader/src/runtime/bus/hub.ts';
import { loadAddon } from '../../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../../loader/src/shared/protocol.ts';
import { validateManifest } from '../../loader/src/shared/schema.ts';
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
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the satchel suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
const FQID = 'official/ledgerline';
const NAMESPACE = addonNamespace(FQID);
const CHARACTER_NAMESPACE = characterNamespace(FQID);

/**
 * The ledger's key, which is the answer to what a price history is OF.
 *
 * Account-wide, so every character shares it, and scoped to the market: the realm off
 * the hello frame and the deployment the shared fake reports. Written out rather than
 * imported from the addon, because the addon is a function body with no exports and
 * because a key derivation both sides computed the same way would prove nothing.
 */
const LEDGER_KEY = 'ledger/pbe/Claudemoon';

/** The stamps are one character's, so the loader's own per-character key holds them. */
const MINE_KEY = perCharacterKey('pbe', 'Claudemoon/Marshal', 'mine-seen');

/** How long a write is held before it lands, and how long one trip lasts. */
const WRITE_HOLD_MS = 2000;
const VISIT_WINDOW_MS = 10 * 60 * 1000;
const ASK_TOPIC = 'item:ask';
/** A fork's fqid on purpose: a consumer that named the official one would miss it. */
const PUBLISHER = 'someone/lorebind';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The Merchant's terms, deliberately NOT the game's own 5 and 12.
 *
 * Both ride the payload, so an addon that wrote either down would agree with a fixture
 * that used the real ones and could never be caught. These cannot be agreed with by
 * accident.
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

interface MarketPayload {
  listings: Listing[];
  totalCount: number;
  filter: string;
  itemType: string;
  subtype: string;
  armorClass: string;
  primaryStat: string;
  rarity: string;
  page: number;
  pageCount: number;
  collectionCopper: number;
  collectionItems: Array<{ itemId: string; count: number }>;
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
 * One recorded visit, as it lands in storage: when, cheapest, dearest, query.
 *
 * An array rather than an object because the ledger is ONE value holding every item a
 * player has browsed, and field names repeated per visit would be most of the file. The
 * time is in seconds for the same reason, nothing on screen being finer than a minute.
 */
type StoredVisit = [number, number, number, string];

interface StoredLedger {
  items: Record<string, StoredVisit[]>;
}

interface StoredStamp {
  id: number;
  price: number;
  count: number;
  seen: number;
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

/** A page with the given rows, with the server's own myListingCount kept in step. */
function page(rows: Listing[], patch: Partial<MarketPayload> = {}): MarketPayload {
  return marketPayload({
    listings: rows,
    totalCount: rows.length,
    myListingCount: rows.filter((row) => row.mine).length,
    ...patch,
  });
}

interface StartOptions {
  settings?: Record<string, unknown>;
  storage?: FakeStorage;
  state?: Partial<MarketState>;
  /** Leave the world out, which is where an addon's first line actually runs. */
  world?: boolean;
  /** Start with no entity decoded, which is what `unknown` actually is. */
  empty?: boolean;
}

interface LedgerHarness extends SharedHarness {
  fqid: string;
  /** Change what the Merchant is sending, the way a snapshot merge does. */
  send: (patch: Partial<MarketState>) => void;
  /** Re-read the world and let the addon's queued repaint and writes settle. */
  settle: () => Promise<void>;
  /** Publish an item record as another addon would. */
  publish: (payload: unknown, from?: string) => void;
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
 * Let every queued microtask run, without an await inside a loop.
 *
 * The addon reads its stored ledger through `storage.keys()` and then one `get` per
 * item, so its start-up is several promise hops deep and a fixed pair of flushes would
 * settle it only by luck.
 */
function flush(times: number): Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  for (let step = 0; step < times; step += 1) {
    chain = chain.then(() => undefined);
  }
  return chain;
}

const MICROTASKS = 24;

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
 * The figure at the end of a row, as it is ANNOUNCED.
 *
 * A price is drawn as coins now: discs carrying the units and bare numbers beside
 * them, so the text content of that slot is `low44` and says nothing about what unit
 * anything is in. The kit puts the whole figure in an `aria-label` in words, which is
 * both what a screen reader gets and the only readable assertion to make here.
 */
function figureOf(list: string, key: string): string {
  const value = rowIn(list, key)?.querySelector('.woc-bar-value');
  return value?.getAttribute('aria-label') ?? partOf(rowIn(list, key), '.woc-bar-value');
}

function detailOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-detail');
}

/**
 * The trend line's points, as pairs, or none where the line is not drawn.
 *
 * Read off the polyline rather than off a count on screen, because the line is the only
 * place the addon says what its series looks like over time and a hidden one is a real
 * answer: two readings is the fewest that can be a line.
 */
function sparkPoints(list: string, key: string): string[] {
  const spark = rowIn(list, key)?.querySelector('.woc-ledgerline-spark polyline');
  const points = spark?.getAttribute('points') ?? '';
  if (points === '') {
    return [];
  }
  return points.split(' ');
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

function frameTitle(): string {
  return document.querySelector('[data-woc-frame="ledger"]')?.getAttribute('aria-label') ?? '';
}

/**
 * The game's own world object, with the market as a GETTER.
 *
 * A getter rather than a value because that is what the loader reads through: the suite
 * changes what the Merchant is sending and the read moves with it, exactly as it does
 * when a player walks up to the counter.
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
    reconnect: () => {
      reconnects.count += 1;
      harness.netState({ reconnects: reconnects.count });
    },
  };
}

/**
 * Let a held write land.
 *
 * The ledger is one value, so writes are coalesced behind a timer rather than made per
 * page: a player flipping through a book would otherwise rewrite the whole thing on
 * every flip. Every assertion on the STORE goes through this, and one that forgot would
 * read the state before the page it just delivered.
 */
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

function seedLedger(storage: FakeStorage, items: Record<string, StoredVisit[]>): void {
  storage.remote(NAMESPACE, LEDGER_KEY, { items });
}

/** One stored visit, in the units the store holds: seconds, and copper per item. */
function visit(at: number, low: number, high = low, query = ''): StoredVisit {
  return [Math.round(at / 1000), low, high, query];
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  it('asks for the world, the socket, a frame, a store and a key', () => {
    expect(parseManifest(MANIFEST_TEXT).permissions).toEqual([
      'world.read',
      'net.read',
      'ui',
      'storage',
      'keys',
    ]);
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

  // A namespace is a PREFIX on one flat store shared by every addon, so a key per item
  // cost a scan of everything the loader holds, a bridge round trip per item on the way
  // in, and a cross-tab watcher left behind for each. This is the guard on the whole
  // storage model: however much a player browses, it is one key.
  it('keeps the whole ledger in one key however many items are on the page', async () => {
    const h = await start();
    const rows = Array.from({ length: 40 }, (_unused, at) =>
      listing({ id: at + 1, itemId: `item_${String(at)}`, price: 100 + at }),
    );
    h.send({ market: page(rows) });
    await h.settle();
    await saved();

    expect(storedItems(h)).toHaveLength(40);
    expect(storedKeys(h)).toEqual([LEDGER_KEY]);
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

    // One reading, holding the cheapest and the dearest ask of the whole trip, stamped
    // when the player finished looking.
    expect(visitsFor(h, 'ore')).toEqual([visit(WALL_CLOCK_MS + VISIT_WINDOW_MS / 2, 300, 500)]);
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

  // The rule this whole feature turns on. The server sends nothing for a counter the
  // player is not standing at, and recording that as an empty market would erase the
  // ledger the moment they walked away from it.
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

  // The stamp is a WALL clock reading, pinned against the monotonic one: the two are far
  // apart here on purpose, because a row stored in one session and read in the next is
  // exactly the case a monotonic stamp gets silently wrong.
  it('stamps a recording with the wall clock rather than the monotonic one', async () => {
    const h = await start();
    h.setWallClock(WALL_CLOCK_MS + DAY_MS);
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    await saved();

    expect(visitsFor(h, 'ore')[0]?.[0]).toBe((WALL_CLOCK_MS + DAY_MS) / 1000);
  });

  // The echo is the only thing that can see a fresh join reset the server-side query
  // while the window's own controls survive, so a series that dropped it would mix a
  // filtered reading with an unfiltered one and never be able to say which was which.
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

  // The question this key exists to answer. A market belongs to a REALM, so two of them
  // in one ledger would be two economies averaged into a low that is true of neither,
  // and the player has no way to tell afterwards. Every character on one realm shares
  // the history; a character on another shares none of it.
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

    expect(storedKeys(h)).toEqual([LEDGER_KEY, 'ledger/pbe/Ashmere'].sort());
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

  // The id is reused across a server restart, so a stamp kept on the id alone would hand
  // a brand new listing the age of whatever held that number before. The second page
  // carries a second row as well, because the loader's own market signature is an id
  // list: a page whose only difference is a price under a stable id is a page the world
  // watcher correctly reports as unchanged, since a live listing cannot be edited.
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
    expect(tip).toContain('no listing carries an expiry');
  });
});

// One snapshot of `away` after a reconnect is the client clearing its own mirror, not
// the player walking off. Both sides of the guard are pinned, because a guard that
// granted grace forever would pass the first case and fail the second.
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

  // The grace has to END on a timer rather than on the next reading, because a watch key
  // fires on a CHANGE: a player who is still away sends no second reading, so a guard
  // that waited for one would leave the panel saying "resyncing" for the rest of the
  // session. This is the case that catches that, and only the timer satisfies both it
  // and the one above.
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

// `away` and `unknown` both carry null and differ only in why, and neither is an empty
// market. A pane that drew either as one would tell a player standing in a town that
// nobody is selling anything.
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

  // The sentence is drawn only where the figures above it could be misread. Standing at
  // the counter with no search applied it says that nothing unusual is going on, which
  // is a line of a HUD panel spent on nothing, and the list is what the room is for.
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
    expect(lineFor('status-line')).toContain('rather than all of it');
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

    // 100 copper each against 2000 copper each: the same total, ten times apart per item.
    expect(figureOf('prices', 'ore')).toBe('low 1 silver');
    expect(tipOn('prices', 'ore')).toContain('high 20s');
  });

  it('says the figures are per item rather than per listing', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', count: 20, price: 2000 })]) });
    await h.settle();

    expect(tipOn('prices', 'ore')).toContain('divides by the count');
  });

  // Copper as the game writes it. The version that printed every unit turned an ore at
  // forty-four copper into `0g 0s 44c`, which is three leading zeroes per row of a
  // ledger whose whole content is small prices.
  it('drops a unit of money that is empty', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', count: 1, price: 44 }),
        listing({ id: 2, itemId: 'ore', count: 1, price: 10_000 }),
      ]),
    });
    await h.settle();

    expect(figureOf('prices', 'ore')).toBe('low 44 copper');
    expect(tipOn('prices', 'ore')).toContain('high 1g');
  });

  // ONE VOTE PER VISIT. A median over every listing is weighted by how many people
  // happened to be selling, so the trip that found three asks would outvote the two
  // that found one, and the typical price would really be the price on the busiest day.
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

// A page carries several asks for one item and they all land with the same stamp, so a
// line drawn per LISTING zigzags between the cheapest and the dearest ask of a single
// visit at whatever amplitude the sellers happened to disagree by. Nothing changed
// between those two readings: they are the same moment.
describe('the trend line', () => {
  it('draws nothing from a single visit, however many asks were on the counter', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 100 }),
        listing({ id: 2, itemId: 'ore', price: 400 }),
        listing({ id: 3, itemId: 'ore', price: 900 }),
      ]),
    });
    await h.settle();

    expect(sparkPoints('prices', 'ore')).toEqual([]);
  });

  it('draws one point per visit, at the cheapest ask of each', async () => {
    const h = await start();
    h.send({
      market: page([
        listing({ id: 1, itemId: 'ore', price: 100 }),
        listing({ id: 2, itemId: 'ore', price: 400 }),
      ]),
    });
    await h.settle();
    h.setWallClock(WALL_CLOCK_MS + HOUR_MS);
    h.send({
      market: page([
        listing({ id: 3, itemId: 'ore', price: 300 }),
        listing({ id: 4, itemId: 'ore', price: 800 }),
      ]),
    });
    await h.settle();

    // Four readings, two visits, so two points: 100 then 300. A line per listing would
    // be four, and would fall between the two visits it is meant to show rising.
    expect(sparkPoints('prices', 'ore')).toHaveLength(2);
    expect(tipOn('prices', 'ore')).toContain('2 visits');
    expect(tipOn('prices', 'ore')).toContain('Latest 3s');
  });
});

// The server sorts the others section by display name and then by price, so a block is
// contiguous and ascending and its first row is the cheapest competitor. No name table
// is involved anywhere in this.
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

    expect(statFor('cut')).toBe(`${String(CUT_PCT)}%`);
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

    expect(labelOf('prices', 'ore')).toBe('Copper Ore');
    expect(tipOn('prices', 'ore')).toContain(PUBLISHER);
  });

  it('ignores a payload that is not an item record', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 1, itemId: 'ore', price: 500 })]) });
    await h.settle();
    h.publish({ id: 'ore' }, PUBLISHER);
    await h.settle();

    expect(labelOf('prices', 'ore')).toBe('ore');
  });

  // Delivery is synchronous, so a publisher answering the ask does so INSIDE the emit
  // call. An addon that asked before subscribing would therefore miss its own answer,
  // and nothing about that failure is visible from the outside: it looks exactly like a
  // publisher that was not installed. The only way to see it is to stand in for the
  // publisher and answer the ask, which needs the bus wired up before the addon is
  // evaluated, so this case builds the services itself rather than using `start`.
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
          shared.shared.bus.emit(PUBLISHER, 'item', { id: 'ore', name: 'Copper Ore' });
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

  it('says nothing here can act on a listing', async () => {
    const h = await start();
    h.send({ market: page([listing({ id: 4, itemId: 'ore', mine: true })]) });
    await h.settle();

    expect(tipOn('mine', '4')).toContain('not a control');
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
