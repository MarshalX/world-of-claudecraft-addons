// @vitest-environment happy-dom

// Satchel, run through the real loader.
//
// Storage cases come first, and every write path is asserted on the store: a pane redrawn from
// memory looks the same whether or not the write happened. The key case is keeping a recorded
// bank on `away`, which the server sends for any counter the player is not at.
//
// The cross-character cases are the product: another character's inventory, a bank you are not
// at, and where your copy of something is, asserted while logged in as somebody else.
//
// Every stored reading carries a wall-clock stamp, pinned against a distant monotonic clock: a
// monotonic stamp read in a later session is wrong.
//
// The grid is checkable without naming an item: one square per pooled cell, art per square, the
// player's placement honoured, the stack count, and id-derived marks. A square whose icon 404s
// must stay a readable occupied cell.
//
// Bus: it draws with nobody publishing, takes answers from a fork's fqid, asks after subscribing,
// and ranks a publisher's name above the art name.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_SENDER } from '../../loader/src/runtime/bus/hub.ts';
import { loadAddon } from '../../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../../loader/src/shared/protocol.ts';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { addonNamespace } from '../../loader/src/shared/storage-keys.ts';
import { type MountInput, mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { choosePicker, pickerOptions as optionsOf } from '../../tests/fakes/controls.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { HELLO_FRAME, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import {
  createSharedServices,
  NOW_MS,
  type SharedHarness,
  WALL_CLOCK_MS,
} from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
import TABLE_TEXT from './bags.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the cooldown-bars suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
const FQID = 'official/satchel';
/**
 * The channel prefix on a record's key. The realm is the shared `HELLO_FRAME`'s, from which the
 * fake world hub derives the character key as the loader does; this suite proves the prefix and
 * the one-record-per-character half are the addon's.
 */
const CHANNEL = 'pbe';
const CHARACTER_KEY = `${CHANNEL}/Claudemoon/Marshal`;
/** The field on the player entity the loader's key derivation reads. */
const PLAYER_NAME_FIELD = 'name';
/** A fork's fqid on purpose: a consumer that named the official one would miss it. */
const PUBLISHER = 'someone/lorebind';
/** The price publisher, a second addon entirely: names and prices are two protocols. */
const PRICER = 'someone/ledgerline';
/** The shared hello frame's realm, which a price record must match. */
const REALM = 'Claudemoon';
const NAMESPACE = addonNamespace(FQID);
const CHARACTER_PREFIX = 'char/';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The shipped pool table; every bag id and material id a case names is one of these. */
const TABLE: {
  backpackSlots: number;
  bags: Array<{ id: string; name: string; slots: number; materialsOnly: boolean }>;
  materials: Array<{ id: string }>;
} = JSON.parse(TABLE_TEXT);

/** The backpack every character has, before a single bag is equipped. */
const BACKPACK_SLOTS = TABLE.backpackSlots;

/** A bag the shipped table has never heard of, for the unknown-bag case. */
const FUTURE_BAG = 'sporebound_carryall';
const FUTURE_BAG_SLOTS = 18;

/** What each fixture bag adds, from the shipped table, so the fake capacity and the addon agree. */
const BAG_SLOTS = new Map<string, number>([
  ...TABLE.bags.map((bag): [string, number] => [bag.id, bag.slots]),
  [FUTURE_BAG, FUTURE_BAG_SLOTS],
]);

/** A general bag, a smaller general bag, and a materials-only satchel, by what they do here. */
const BIG_BAG = 'wayfarers_backpack';
const MID_BAG = 'gravewoven_bag';
const SMALL_BAG = 'linen_pouch';
const REAGENT_BAG = 'burlap_reagent_pouch';
/** A material, the only thing a reagent satchel takes. */
const MATERIAL = 'copper_ore';

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

interface Cell {
  itemId: string;
  count: number;
  /** The recipe that minted it. Absent on nearly all. */
  craftedRecipeId?: string;
  /** The cell the player dragged it into. Absent if never placed by hand. */
  slot?: number;
  /** The per-copy payload, untrimmed only in your own bags and bank: mail arrives projected. */
  instance?: { locked?: boolean };
}

/** `BankInfo` as the game's own world object carries it, under its wire name. */
interface BankPayload {
  slots: Cell[];
  capacity: number;
  purchasedSlots: number;
  bonusSlots: number;
  nextExpansionCost: number | null;
  bonusSources: Array<{ id: string; slots: number; maxSlots: number }>;
  /**
   * Fixtures honour the decoder invariants: general plus materials is `capacity`, used counts sum
   * to `slots.length`.
   */
  socketsUnlocked: number;
  socketBags: (string | null)[];
  nextSocketCost: number | null;
  nextRungClaudiumPrice?: number;
  generalCapacity: number;
  materialsCapacity: number;
  generalUsed: number;
  materialsUsed: number;
}

/** `VaultInfo` as the game's own world object carries it, under its wire name. */
interface VaultPayload {
  stock: Record<string, number>;
  special: Cell[];
  upgrades: number;
  perMaterialCap: number;
  nextUpgradeCost: number | null;
}

interface Letter {
  id: number;
  senderName: string;
  kind: string;
  subject: string;
  body: string;
  copper: number;
  items: Cell[];
  read: boolean;
}

interface MailPayload {
  messages: Letter[];
  totalCount: number;
  unread: number;
  postage: number;
  maxAttachments: number;
  deliverySeconds: number;
}

interface CarryState {
  inventory: Cell[];
  bags: (string | null)[];
  equipment: Record<string, string>;
  copper: number;
  /**
   * The gated reads: null is what the server sends for a player not at the counter. The vault has
   * its own gate, so a null vault beside a live bank is an undecodable vault payload.
   */
  bank: BankPayload | null;
  vault: VaultPayload | null;
  mail: MailPayload | null;
  /** Not gated: readable anywhere. */
  mailUnread: number;
  /**
   * What crafting may draw from the vault here, not banker-gated: a record is allowed, an empty
   * record is allowed with nothing, null is refused here.
   */
  craftVaultStock: Record<string, number> | null;
}

/** One stack as the addon writes it down, which is `InvSlot` unchanged. */
interface StoredStack {
  itemId: string;
  count: number;
  slot?: number;
  /** Flat, where the wire nests it under `instance`. See `parseStack`. */
  locked?: boolean;
}

interface StoredLetter {
  id: string;
  senderName: string;
  subject: string;
  copper: number;
  items: StoredStack[];
  read: boolean;
}

/** One store of one character, as it lands in account-wide storage. */
interface StoredSnapshot {
  at: number;
  used: number;
  total: number;
  stacks: StoredStack[];
  /** The vault's counts, sorted by id on the way in. */
  stock?: Array<{ itemId: string; count: number }>;
  upgrades?: number;
  cap?: number;
  pools?: { general: number; materials: number; generalUsed: number; materialsUsed: number };
  socketBags?: string[];
  unlocked?: number;
  nextSocket?: number | null;
  sockets?: string[];
  bought?: number;
  granted?: number;
  next?: number | null;
  letters?: StoredLetter[];
  unread?: number;
  postage?: number;
  attachments?: number;
  flight?: number;
}

interface StoredRecord {
  key: string;
  name: string;
  copper: number;
  at: number;
  equipped: string[];
  /** The market this character's things are on. */
  realm?: string;
  sources: {
    bags: StoredSnapshot;
    bank: StoredSnapshot;
    mail: StoredSnapshot;
    vault: StoredSnapshot;
  };
}

function bagSlots(itemId: string | null): number {
  if (itemId === null) {
    return 0;
  }
  return BAG_SLOTS.get(itemId) ?? 0;
}

/** The pooling the game does, and the only place in this suite that knows how. */
function pooled(bags: readonly (string | null)[]): number {
  let total = BACKPACK_SLOTS;
  for (const itemId of bags) {
    total += bagSlots(itemId);
  }
  return total;
}

/** `howMany` separate cells of one item, each holding `count`. */
function cells(itemId: string, count: number, howMany = 1): Cell[] {
  return Array.from({ length: howMany }, () => ({ itemId, count }));
}

/** The same stack with the owner's lock, as your own bags send it. */
function lockedCells(itemId: string, count: number, howMany = 1): Cell[] {
  return cells(itemId, count, howMany).map((cell) => ({ ...cell, instance: { locked: true } }));
}

function emptyCarry(): CarryState {
  return {
    inventory: [],
    bags: [null, null, null, null],
    equipment: {},
    copper: 0,
    bank: null,
    vault: null,
    mail: null,
    mailUnread: 0,
    craftVaultStock: null,
  };
}

/**
 * A bank as the server sends one. The split defaults to all general and used counts to `slots`,
 * so the decoder invariants hold without a case saying so.
 */
function bankPayload(patch: Partial<BankPayload> = {}): BankPayload {
  const slots = patch.slots ?? [];
  const capacity = patch.capacity ?? 24;
  return {
    slots,
    capacity,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 1000,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 5000,
    generalCapacity: capacity,
    materialsCapacity: 0,
    generalUsed: slots.length,
    materialsUsed: 0,
    ...patch,
  };
}

/** A stock record from entry pairs, since item-id object keys fail `useNamingConvention`. */
function stockOf(...rows: [string, number][]): Record<string, number> {
  return Object.fromEntries(rows);
}

/** A vault as the server sends one. Locked is `upgrades: 0` with no cap. */
function vaultPayload(patch: Partial<VaultPayload> = {}): VaultPayload {
  return {
    stock: {},
    special: [],
    upgrades: 2,
    perMaterialCap: 400,
    nextUpgradeCost: 25_000,
    ...patch,
  };
}

function letter(patch: Partial<Letter> = {}): Letter {
  return {
    id: 1,
    senderName: 'Alt',
    kind: 'player',
    subject: 'Ore for you',
    body: 'Take what you need.',
    copper: 0,
    items: [],
    read: false,
    ...patch,
  };
}

function mailPayload(patch: Partial<MailPayload> = {}): MailPayload {
  return {
    messages: [],
    totalCount: 0,
    unread: 0,
    postage: 30,
    maxAttachments: 3,
    deliverySeconds: 45,
    ...patch,
  };
}

/** One store of a character a previous session recorded. */
function snapshot(patch: Partial<StoredSnapshot> = {}): StoredSnapshot {
  const merged: StoredSnapshot = { at: WALL_CLOCK_MS, used: 0, total: 0, stacks: [], ...patch };
  merged.used = patch.used ?? merged.stacks.length;
  return merged;
}

/**
 * A character stored by a previous session, on a realm, since every case using one is about
 * somebody not logged in. Bank and mail default to `at: 0`: never visited.
 */
function storedCharacter(name: string, patch: StoredPatch = {}): StoredRecord {
  return {
    key: `${CHANNEL}/Claudemoon/${name}`,
    name,
    copper: 0,
    at: WALL_CLOCK_MS,
    equipped: [],
    realm: REALM,
    ...patch,
    // Merged, so a case naming one store gets the others at their ordinary state.
    sources: {
      bags: snapshot(),
      bank: snapshot({ at: 0 }),
      mail: snapshot({ at: 0 }),
      vault: snapshot({ at: 0 }),
      ...patch.sources,
    },
  };
}

/** Everything a case may override, with the stores taken one at a time. */
type StoredPatch = Omit<Partial<StoredRecord>, 'sources'> & {
  sources?: Partial<StoredRecord['sources']>;
};

function seed(storage: FakeStorage, record: StoredRecord): void {
  storage.remote(NAMESPACE, `${CHARACTER_PREFIX}${record.key}`, record);
}

interface StartOptions {
  settings?: Record<string, unknown>;
  storage?: FakeStorage;
  carry?: Partial<CarryState>;
  /** Leave the world out, where an addon's first line actually runs. */
  world?: boolean;
  /** Leave the pool table unserved: every session's first moment, and a failed read. */
  table?: boolean;
}

interface SatchelHarness extends SharedHarness {
  fqid: string;
  /** Change what the character is carrying, the way a snapshot merge does. */
  carry: (patch: Partial<CarryState>) => void;
  /** Re-read the world and let the addon's queued repaint and stores settle. */
  settle: () => Promise<void>;
  /** Publish an item record as another addon would. */
  publish: (topic: string, payload: unknown, from?: string) => void;
  /** Another tab writing a setting, which is how one changes. */
  settingsChanged: (values: Record<string, unknown>) => void;
  /** Somebody else is playing now, without a page load: the game swaps its HUD, not the page. */
  switchCharacter: (name: string) => void;
}

/**
 * Let every queued microtask run, without an await inside a loop. Start-up is `storage.keys()`
 * plus a `get` per character, too deep for a fixed pair of flushes.
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

/** How far a row's fill runs. */
function fillOf(list: string, key: string): string {
  return rowIn(list, key)?.querySelector<HTMLElement>('.woc-bar-fill')?.style.width ?? '';
}

function labelOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-label');
}

function figureOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-value');
}

/**
 * An amount as the kit announces it: a `{ copper }` value renders as coin discs plus digits, so
 * `textContent` is ambiguous and the `aria-label` is the readable form.
 */
function coinsOf(el: Element | null): string {
  return el?.querySelector('.woc-bar-value')?.getAttribute('aria-label') ?? '';
}

function coinsIn(list: string, key: string): string {
  return coinsOf(rowIn(list, key));
}

/** The same, for a bar that is not in a list: the purse and the account total. */
function coinsAt(role: string): string {
  return coinsOf(barAt(role));
}

function barAt(role: string): HTMLElement | null {
  return document.querySelector(`[data-role="${role}"]`);
}

/** Whether a figure is on screen: a worth of nothing is not drawn as `0c`. */
function shownAt(role: string): boolean {
  const el = barAt(role);
  return el !== null && !el.hidden;
}

/** A computed read, because a `DOMStringMap` is an index signature. */
function dataOf(el: HTMLElement | null, key: string): string {
  return el?.dataset[key] ?? '';
}

/** The chip's label, which follows the figure's meaning. */
function statLabel(role: string): string {
  const chip = document.querySelector(`[data-role="${role}"]`);
  return chip?.querySelector('.woc-satchel-stat-label')?.textContent ?? '';
}

/** A chip's urgency, an attribute beside the colour. */
function statTone(role: string): string {
  return dataOf(document.querySelector<HTMLElement>(`[data-role="${role}"]`), 'tone');
}

function detailOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-detail');
}

/** A row's urgency class; the colour is a stylesheet rule a suite cannot read. */
function barTone(list: string, key: string): string {
  const row = rowIn(list, key);
  const found = [...(row?.classList ?? [])].find((one) => one.startsWith('woc-bar-'));
  return found?.slice('woc-bar-'.length) ?? '';
}

function lineFor(role: string): string {
  return document.querySelector(`[data-role="${role}"]`)?.textContent ?? '';
}

/**
 * One figure off a status strip, without its label. The chip's full sentence is pinned through
 * its tooltip.
 */
function statFor(role: string): string {
  const chip = document.querySelector(`[data-role="${role}"]`);
  return chip?.querySelector('.woc-satchel-stat-value')?.textContent ?? '';
}

/** Every square in one grid, in draw order. Scoped by grid: bags and bank are the same widget. */
function cellsIn(grid: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-grid="${grid}"] [data-cell]`)];
}

function gridCells(): HTMLElement[] {
  return cellsIn('bags');
}

function gridEl(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-grid="${name}"]`);
}

function listEl(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-list="${name}"]`);
}

function frameEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-woc-frame="bags"]');
}

function cellIn(grid: string, at: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-grid="${grid}"] [data-cell="${at}"]`);
}

function cellAt(at: number): HTMLElement | null {
  return cellIn('bags', at);
}

/** The item id a square holds, which is blank for an empty one. */
function itemsInGrid(): string[] {
  return gridCells().map((el) => el.getAttribute('data-item') ?? '');
}

/** The URL the square asked the game for, raw rather than resolved. */
function artAt(at: number): string {
  return cellAt(at)?.querySelector('img')?.getAttribute('src') ?? '';
}

function artHiddenAt(at: number): boolean {
  return cellAt(at)?.querySelector('img')?.hasAttribute('hidden') ?? false;
}

/** How a square is announced: the label, then the stack count. */
function nameAt(at: number): string {
  return cellAt(at)?.getAttribute('aria-label') ?? '';
}

/**
 * Whether the square has an accessible name. Unnamed means no `aria-label` and `aria-hidden`; a
 * blank name keeps an empty `aria-label` in the tree. `getAttribute(...) ?? ''` cannot tell them
 * apart.
 */
function namedAt(at: number): boolean {
  return cellAt(at)?.hasAttribute('aria-label') ?? false;
}

/** A square with no name is hidden from assistive technology. */
function tileHiddenAt(at: number): boolean {
  return cellAt(at)?.getAttribute('aria-hidden') === 'true';
}

/** The stack count drawn in the corner, which a stack of one does not draw. */
function countAt(at: number): string {
  const count = cellAt(at)?.querySelector<HTMLElement>('.woc-tile-count');
  if (count === null || count === undefined || count.hasAttribute('hidden')) {
    return '';
  }
  return count.textContent ?? '';
}

/** Whether the square is marked: an id in more than one cell, or one also worn. */
function markedIn(grid: string, at: number): boolean {
  const pip = cellIn(grid, at)?.querySelector<HTMLElement>('[data-satchel-mark]');
  return pip !== null && pip !== undefined && pip.style.display !== 'none';
}

/**
 * The mark is a corner pip, since the border carries the tier and the tone is the free-slot
 * warning.
 */
function markedAt(at: number): boolean {
  return markedIn('bags', at);
}

/** Whether the padlock shape is drawn on the square. */
function lockedAt(at: number): boolean {
  const mark = cellAt(at)?.querySelector<SVGElement>('[data-satchel-lock]');
  return mark !== null && mark !== undefined && mark.style.display !== 'none';
}

/** Whether the square reads as holding something, art or no art. */
function occupiedAt(at: number): boolean {
  return cellAt(at)?.style.borderStyle === 'solid';
}

/** The loader's confirmation, a real modal in the document. */
function modalMessage(): string {
  return document.querySelector('.woc-modal-message')?.textContent ?? '';
}

function pressModal(label: string): void {
  const button = [...document.querySelectorAll('.woc-modal-buttons button')].find(
    (el) => el.textContent === label,
  );
  (button as HTMLButtonElement | undefined)?.click();
}

function tipOver(el: Element | null): string {
  el?.dispatchEvent(new Event('pointerenter'));
  return document.getElementById('woc-tooltip')?.textContent ?? '';
}

/**
 * The title's accessible name, where the unread badge lives. `setTitle` writes both, and the
 * `aria-label` survives a bare density having no title bar.
 */
function frameTitle(): string {
  return document.querySelector('[data-woc-frame="bags"]')?.getAttribute('aria-label') ?? '';
}

function capacityValue(): string {
  return statFor('slots');
}

function capacityDetail(): string {
  return `${statFor('free')} free`;
}

function bankValue(): string {
  return statFor('bank-slots');
}

function bankDetail(): string {
  return `${statFor('bank-free')} free`;
}

/** The character selector: the kit's button and menu, so reading and choosing are clicks. */
function picker(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-role="picker"]');
}

/**
 * Open a tab as a player does. Every pane is in the document at once; this matters only for the
 * character selector, which belongs to the per-character panes.
 */
function openTab(label: string): void {
  const button = [...document.querySelectorAll('.woc-tab')].find((el) => el.textContent === label);
  (button as HTMLButtonElement | undefined)?.click();
}

/** Whether an element the addon hides with `ui.show` is on screen. */
function shownIn(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  return el !== null && !el.hidden;
}

function pickerOptions(): string[] {
  return optionsOf(picker() ?? document);
}

function choose(label: string): void {
  choosePicker(picker() ?? document, label);
}

/** The addon's cap on drawn rows. */
const MAX_ITEM_ROWS = 40;

/** As many distinct kinds as a case needs, for the cases about the row cap. */
function manyKinds(count: number): StoredStack[] {
  return Array.from({ length: count }, (_unused, at) => ({
    itemId: `kind_${String(at).padStart(2, '0')}`,
    count: 1,
  }));
}

/** Pick from one of the Items pane's own dropdowns, which are the same kit control. */
function chooseIn(role: string, label: string): void {
  choosePicker(document.querySelector(`[data-role="${role}"]`) ?? document, label);
}

function typeSearch(value: string): void {
  const input = document.querySelector<HTMLInputElement>('[data-role="search"] input');
  if (input !== null) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
}

/**
 * Make the item art manifest answer: the shared fake's fetch never settles, so `itemArtName` is
 * null there, as before the manifest lands. A Map from entry pairs, since every key is an item id.
 */
function artNames(harness: SharedHarness, table: ReadonlyMap<string, string>): void {
  vi.spyOn(harness.shared.kit.icons, 'itemArtName').mockImplementation(
    (itemId) => table.get(itemId) ?? null,
  );
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

/** The game's world object with pooled capacity as a getter, as the loader reads it. */
function fakeWorld(state: CarryState, player: unknown): Record<string, unknown> {
  return {
    entities: new Map([[PLAYER_ID, player]]),
    player,
    known: [],
    get inventory(): Cell[] {
      return state.inventory;
    },
    get bags(): (string | null)[] {
      return state.bags;
    },
    get equipment(): Record<string, string> {
      return state.equipment;
    },
    get copper(): number {
      return state.copper;
    },
    get bagCapacity(): number {
      return pooled(state.bags);
    },
    // The wire names the loader reads off the game's world object.
    get bankInfo(): BankPayload | null {
      return state.bank;
    },
    get vaultInfo(): VaultPayload | null {
      return state.vault;
    },
    get craftVaultStock(): Record<string, number> | null {
      return state.craftVaultStock;
    },
    get mailInfo(): MailPayload | null {
      return state.mail;
    },
    get mailUnread(): number {
      return state.mailUnread;
    },
  };
}

async function start(options: StartOptions = {}): Promise<SatchelHarness> {
  const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
  const state: CarryState = { ...emptyCarry(), ...options.carry };
  const storage = options.storage ?? createFakeStorage();

  const input: MountInput = {
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings: options.settings ?? {},
    storage,
  };
  if (options.table !== false) {
    input.data = { 'bags.json': TABLE_TEXT };
  }
  if (options.world !== false) {
    input.game = Promise.resolve({ world: fakeWorld(state, player) });
  }
  const harness = await mountAddon(input);
  teardown.push(harness.dispose);
  // What a real session sends first; the loader derives `world.characterKey` from its realm.
  harness.inbound(HELLO_FRAME);

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

  return {
    ...harness,
    carry: (patch) => {
      Object.assign(state, patch);
    },
    settle,
    publish: (topic, payload, from = PUBLISHER) => {
      harness.shared.bus.emit(from, topic, payload);
    },
    settingsChanged: (values) => {
      harness.hub.remote(`config:${harness.fqid}`, 'values', values);
    },
    // A computed key: `noPropertyAccessFromIndexSignature` refuses the dotted form.
    switchCharacter: (name) => {
      player[PLAYER_NAME_FIELD] = name;
    },
  };
}

/**
 * One character's record as stored, typed as present: absence cases use `storedKeys`, or `?.`
 * everywhere would pass a case that wrote nothing.
 */
function storedFor(h: SatchelHarness, key = CHARACTER_KEY): StoredRecord {
  return h.hub.dump()[`${NAMESPACE}/${CHARACTER_PREFIX}${key}`] as StoredRecord;
}

function storedKeys(h: SatchelHarness): string[] {
  return Object.keys(h.hub.dump())
    .filter((cell) => cell.startsWith(`${NAMESPACE}/${CHARACTER_PREFIX}`))
    .map((cell) => cell.slice(`${NAMESPACE}/${CHARACTER_PREFIX}`.length));
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  it('asks for the world, the socket, a frame, a cue, a store and a key', () => {
    expect(parseManifest(MANIFEST_TEXT).permissions).toEqual([
      'world.read',
      'net.read',
      'ui',
      'sound',
      'storage',
      'keys',
    ]);
  });
});

// A record before a panel: every case here asserts on the store.
describe('what is written down', () => {
  it('records the bags under the key the loader derives, once the world is up', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 5), copper: 12_345 } });
    await h.settle();

    const record = storedFor(h);
    expect(storedKeys(h)).toEqual([CHARACTER_KEY]);
    expect(record.name).toBe('Marshal');
    expect(record.copper).toBe(12_345);
    expect(record.sources.bags).toMatchObject({ used: 5, total: 16 });
    expect(record.sources.bags.stacks).toHaveLength(5);
  });

  // Before world entry a record would be filed under whoever logs in next.
  it('writes nothing at all before world entry', async () => {
    const h = await start({ world: false });
    await h.settle();

    expect(storedKeys(h)).toEqual([]);
  });

  it('records the bank while the player is standing at one', async () => {
    const h = await start({
      carry: { bank: bankPayload({ slots: cells('ore', 20, 2), capacity: 30, purchasedSlots: 6 }) },
    });
    await h.settle();

    expect(storedFor(h).sources.bank).toMatchObject({ used: 2, total: 30, bought: 6 });
  });

  // `away` is not an empty bank: recording it would wipe the deposit box on every walk-off.
  it('keeps a recorded bank when the player walks away from the banker', async () => {
    const h = await start({ carry: { bank: bankPayload({ slots: cells('ore', 20, 3) }) } });
    await h.settle();
    expect(storedFor(h).sources.bank.stacks).toHaveLength(3);

    h.carry({ bank: null, inventory: cells('cloth', 5) });
    await h.settle();

    expect(storedFor(h).sources.bank.stacks).toHaveLength(3);
    expect(storedFor(h).sources.bags.stacks).toHaveLength(1);
  });

  it('keeps a recorded mailbox when the player walks away from the pillar', async () => {
    const h = await start({
      carry: { mail: mailPayload({ totalCount: 1, messages: [letter({ id: 7 })] }) },
    });
    await h.settle();
    expect(storedFor(h).sources.mail.letters).toHaveLength(1);

    h.carry({ mail: null, inventory: cells('cloth', 5) });
    await h.settle();

    expect(storedFor(h).sources.mail.letters).toHaveLength(1);
  });

  // Written flat and only when true: this store holds every character's bags.
  it('writes down which copies are locked', async () => {
    const h = await start({
      carry: { inventory: [...lockedCells('ore', 20), ...cells('ore', 3)] },
    });
    await h.settle();

    const [first, second] = storedFor(h).sources.bags.stacks;
    expect(first?.locked).toBe(true);
    expect(second?.locked).toBeUndefined();
  });

  // The point is a character you are not logged in as; a stored cell spells the flag flat.
  it('reads a stored lock back on a character who is not playing', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: [{ itemId: 'ore', count: 20, locked: true }] }),
          bank: snapshot({ at: 0 }),
          mail: snapshot({ at: 0 }),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 3) } });
    await h.settle();

    expect(tipOver(rowIn('items', 'ore'))).toContain('20 of 23 locked');
  });

  // Nothing decoded: no reading to record.
  it('records no bank at all for a character who has never stood at one', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1) } });
    await h.settle();

    expect(storedFor(h).sources.bank).toMatchObject({ at: 0, stacks: [] });
  });

  it('flattens every parcel waiting in the mail into the recorded stacks', async () => {
    const h = await start({
      carry: {
        mail: mailPayload({
          totalCount: 2,
          messages: [
            letter({ id: 7, items: cells('ore', 20) }),
            letter({ id: 8, items: cells('cloth', 5) }),
          ],
        }),
      },
    });
    await h.settle();

    expect(storedFor(h).sources.mail.stacks).toEqual([
      { itemId: 'ore', count: 20 },
      { itemId: 'cloth', count: 5 },
    ]);
  });

  // `woc.now()` reads 1234 here and the wall clock a real epoch: a monotonic stamp read back in a
  // later session is a moment in 1970.
  it('stamps every store with the wall clock, so a later session can date it', async () => {
    const h = await start({ carry: { bank: bankPayload({ slots: cells('ore', 20) }) } });
    await h.settle();

    const record = storedFor(h);
    expect(record.sources.bags.at).toBe(WALL_CLOCK_MS);
    expect(record.sources.bank.at).toBe(WALL_CLOCK_MS);
    expect(record.sources.bags.at).not.toBe(NOW_MS);
  });

  it('records what is worn, so a spare is markable on a character not in play', async () => {
    const h = await start({ carry: { equipment: { mainhand: 'axe' } } });
    await h.settle();

    expect(storedFor(h).equipped).toEqual(['axe']);
  });

  it('opens a second record when the character changes without a page load', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();
    expect(storedKeys(h)).toEqual([CHARACTER_KEY]);

    h.switchCharacter('Alt');
    await h.settle();

    expect(storedKeys(h)).toHaveLength(2);
    expect(storedKeys(h)).toContain(CHARACTER_KEY);
    expect(storedKeys(h)).toContain(`${CHANNEL}/Claudemoon/Alt`);
  });

  // A character and its PBE copy share realm and name, so `world.characterKey` cannot tell them
  // apart; the channel prefix does. Asserted on the stored row, since a pane drawn from one merged
  // record looks the same.
  it('records a character and its copy on another channel apart', async () => {
    const storage = createFakeStorage();
    // Same realm and name as the character in play, on the other deployment.
    seed(storage, {
      ...storedCharacter('Marshal', { sources: { bags: snapshot({ stacks: cells('gem', 1) }) } }),
      key: 'live/Claudemoon/Marshal',
      copper: 999,
    });
    const h = await start({ storage, carry: { inventory: cells('ore', 1, 5), copper: 12 } });
    await h.settle();

    expect(storedKeys(h)).toHaveLength(2);
    expect(storedKeys(h)).toContain(CHARACTER_KEY);
    expect(storedKeys(h)).toContain('live/Claudemoon/Marshal');
    // This session wrote its own row and left the other's alone.
    expect(storedFor(h).copper).toBe(12);
    expect(storedFor(h).sources.bags.stacks).toHaveLength(5);
  });

  it('throws every record away when remembering is turned off', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    const h = await start({ storage, carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();
    expect(storedKeys(h)).toHaveLength(2);

    h.settingsChanged({ remember: false });
    await h.settle();

    expect(storedKeys(h)).toEqual([]);
    expect(lineFor('roster-note')).toContain('Remembering is off');
  });

  it('drops a stored row that is not a character', async () => {
    const storage = createFakeStorage();
    storage.remote(NAMESPACE, `${CHARACTER_PREFIX}${CHANNEL}/Claudemoon/Ghost`, { copper: 5 });
    const h = await start({ storage });
    await h.settle();

    expect(keysIn('roster')).toEqual([CHARACTER_KEY]);
  });
});

// Only the logged-in character exists on the client, so an alt's bags are reachable only here.
describe('reading another character', () => {
  it('offers every recorded character in the selector, this one first', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    seed(storage, storedCharacter('Bank Mule'));
    const h = await start({ storage });
    await h.settle();

    expect(pickerOptions()).toEqual(['Marshal (here)', 'Alt', 'Bank Mule']);
  });

  it("draws an alt's bags, the way that alt arranged them", async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        copper: 900,
        sources: {
          // 16 backpack plus the socketed 12-cell bag; a mismatched total reads as a stale table.
          bags: snapshot({
            total: 28,
            stacks: [{ itemId: 'ore', count: 20, slot: 5 }, ...cells('cloth', 5)],
            sockets: [MID_BAG, '', '', ''],
            at: WALL_CLOCK_MS - 3 * DAY_MS,
          }),
          bank: snapshot(),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('elixir', 1) } });
    await h.settle();

    choose('Alt');
    await h.settle();

    expect(gridCells()).toHaveLength(28);
    expect(itemsInGrid()[5]).toBe('ore');
    expect(itemsInGrid()[0]).toBe('cloth');
    expect(capacityValue()).toBe('2 / 28');
    expect(lineFor('bags-age')).toBe('Alt: Last read 3 days ago.');
    expect(coinsAt('purse')).toBe('9 silver');
    expect(statFor('sockets')).toBe('1 / 4');
  });

  it("draws an alt's bank, which the game can never show at all", async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot(),
          bank: snapshot({
            total: 30,
            stacks: cells('ore', 20, 4),
            at: WALL_CLOCK_MS - 2 * HOUR_MS,
            bought: 6,
            next: 50_000,
          }),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage });
    await h.settle();

    choose('Alt');
    await h.settle();

    expect(cellsIn('bank')).toHaveLength(30);
    expect(bankValue()).toBe('4 / 30');
    expect(lineFor('bank-age')).toBe('Alt: Last read 2 hours ago.');
    expect(statFor('bank-terms')).toBe('6 bought, next 5g');
  });

  it('says nothing is recorded for a character with no reading of that store', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    const h = await start({ storage });
    await h.settle();

    choose('Alt');
    await h.settle();

    expect(lineFor('bank-note')).toBe(
      'No bank reading yet. Stand at a banker once and it is recorded.',
    );
    expect(cellsIn('bank')).toEqual([]);
  });

  // The picker follows the character in play unless deliberately pointed elsewhere.
  it('follows the character in play across a switch until it is pointed somewhere', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    const h = await start({ storage, carry: { inventory: cells('ore', 1, 3) } });
    await h.settle();
    expect(lineFor('bags-age')).toBe('Live.');

    h.switchCharacter('Second');
    await h.settle();
    expect(lineFor('bags-age')).toBe('Live.');

    choose('Alt');
    await h.settle();
    expect(lineFor('bags-age')).toContain('Alt:');
  });
});

// The gated read the game refuses away from the counter, answered from the recording.
describe('the bank pane', () => {
  it('draws the slots and the budget while the player is at a banker', async () => {
    const h = await start({
      carry: {
        bank: bankPayload({
          slots: [...cells('ore', 20, 3), ...cells('cloth', 5)],
          capacity: 30,
          purchasedSlots: 6,
        }),
      },
    });
    await h.settle();

    expect(bankValue()).toBe('4 / 30');
    expect(bankDetail()).toBe('26 free');
    expect(cellsIn('bank')).toHaveLength(30);
    expect(cellIn('bank', 0)?.getAttribute('data-item')).toBe('ore');
    expect(lineFor('bank-note')).toBe('');
    expect(lineFor('bank-age')).toBe('Live.');
  });

  // The client itself draws nothing here once away.
  it('keeps drawing the last reading once the player walks away, and dates it', async () => {
    const h = await start({ carry: { bank: bankPayload({ slots: cells('ore', 20, 2) }) } });
    await h.settle();
    expect(cellsIn('bank')).toHaveLength(24);

    h.carry({ bank: null });
    await h.settle();

    expect(cellsIn('bank')).toHaveLength(24);
    expect(cellIn('bank', 0)?.getAttribute('data-item')).toBe('ore');
    expect(lineFor('bank-note')).toBe('Not at a banker: this is the last reading, not a live one.');
    expect(lineFor('bank-age')).toBe('Last read moments ago.');
  });

  it('says the world is not up rather than saying anything about a bank', async () => {
    await start({ world: false });

    expect(lineFor('bank-note')).toBe('Not in the world yet.');
    expect(cellsIn('bank')).toEqual([]);
    expect(lineFor('mail-age')).toBe('Not in the world yet.');
    expect(frameTitle()).toBe('Satchel');
  });

  it('reads the expansion price off the payload rather than knowing one', async () => {
    const h = await start({
      carry: {
        bank: bankPayload({ purchasedSlots: 12, bonusSlots: 4, nextExpansionCost: 50_000 }),
      },
    });
    await h.settle();

    expect(statFor('bank-terms')).toBe('12 bought, 4 granted, next 5g');
  });

  it('says so when every expansion has been bought', async () => {
    const h = await start({ carry: { bank: bankPayload({ nextExpansionCost: null }) } });
    await h.settle();

    expect(statFor('bank-terms')).toBe('all bought');
  });

  // From ids alone, and one-directional: the bags do not mark what is banked, since that reading
  // comes and goes.
  it('marks a banked stack the character is also carrying', async () => {
    const h = await start({
      carry: { inventory: cells('ore', 20), bank: bankPayload({ slots: cells('ore', 20) }) },
    });
    await h.settle();

    expect(markedIn('bank', 0)).toBe(true);
    expect(statFor('bank-marks')).toBe('1 carried');
    expect(markedAt(0)).toBe(false);
  });
});

// Where is my copy of this: the question nothing in the game answers.
describe('the index across every character', () => {
  // Summed, the opposite of the capacity count: six cells over two stores and characters is one
  // row with the total, and still six cells to the Bags pane.
  it('folds every stack of an item into one row carrying the total', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 20, 2) }),
          bank: snapshot({ stacks: cells('ore', 7) }),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 20, 3) } });
    await h.settle();

    expect(keysIn('items')).toEqual(['ore']);
    expect(figureOf('items', 'ore')).toBe('107');
    expect(statFor('items-shown')).toBe('1');
    expect(statFor('items-held')).toBe('107');
    // The same cells, counted as cells by the Bags pane.
    expect(itemsInGrid().filter((held) => held === 'ore')).toHaveLength(3);
  });

  // A row names each character once; the tooltip splits by store.
  it('names each character once on the row and each store once in the tooltip', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 12) }),
          bank: snapshot({ stacks: cells('ore', 20, 2) }),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 5) } });
    await h.settle();

    expect(detailOf('items', 'ore')).toBe('Marshal 5, Alt 52');

    const said = tipOver(rowIn('items', 'ore'));

    expect(said).toContain('57 in all, across 2 characters');
    expect(said).toContain('Alt, bags: 12 in 1 cell');
    expect(said).toContain('Alt, bank: 40 in 2 cells');
  });

  it('names the character and the store holding each copy', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 12) }),
          bank: snapshot({ stacks: cells('ore', 20, 2) }),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 5) } });
    await h.settle();

    expect(keysIn('items')).toEqual(['ore']);
    // 5 carried here, 12 in the alt's bags, 40 in the alt's bank.
    expect(figureOf('items', 'ore')).toBe('57');
    expect(detailOf('items', 'ore')).toBe('Marshal 5, Alt 52');
  });

  it('spells every place out under the pointer, with how old each reading is', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot(),
          bank: snapshot({ stacks: cells('ore', 20, 2), at: WALL_CLOCK_MS - 5 * DAY_MS }),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 5) } });
    await h.settle();

    const said = tipOver(rowIn('items', 'ore'));

    expect(said).toContain('Marshal, bags: 5 in 1 cell, read moments ago');
    expect(said).toContain('Alt, bank: 40 in 2 cells, read 5 days ago');
    expect(said).toContain('Nothing here can move, mail or sell an item');
  });

  it('counts a parcel still sitting in the mail', async () => {
    const h = await start({
      carry: {
        mail: mailPayload({ totalCount: 1, messages: [letter({ id: 7, items: cells('ore', 3) })] }),
      },
    });
    await h.settle();

    expect(figureOf('items', 'ore')).toBe('3');
    // The store, not the name: with one character, the name would only restate the figure.
    expect(detailOf('items', 'ore')).toBe('mail 3');
  });

  it('names the characters instead once a second one is recorded', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 20, 2) }),
          bank: snapshot(),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 5) } });
    await h.settle();

    expect(detailOf('items', 'ore')).toBe('Marshal 5, Alt 40');
  });

  it('narrows to what the search matches, by published name as well as by id', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 5)] },
    });
    h.publish('item', { id: 'ore', name: 'Copper Ore' });
    await h.settle();
    expect(keysIn('items')).toEqual(['cloth', 'ore']);

    typeSearch('copper');
    await h.settle();

    expect(keysIn('items')).toEqual(['ore']);
    expect(labelOf('items', 'ore')).toBe('Copper Ore');
  });

  it('says so when the search matches nothing anywhere', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    typeSearch('nothing at all');
    await h.settle();

    expect(keysIn('items')).toEqual([]);
    expect(lineFor('items-note')).toBe('No item on any character matches that.');
  });

  it('says nothing has been recorded yet before anybody has logged in', async () => {
    await start({ world: false });

    expect(lineFor('items-note')).toContain('Nothing recorded yet');
  });
});

// With one character recorded the selector would offer a single option, so it is hidden.
describe('the character selector', () => {
  it('stays off the panel while there is only one character', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();
    openTab('Bags');
    await h.settle();

    expect(shownIn('.woc-satchel-picker')).toBe(false);
  });

  it('comes back the moment a second character is recorded', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    const h = await start({ storage, carry: { inventory: cells('ore', 20) } });
    await h.settle();
    openTab('Bags');
    await h.settle();

    expect(shownIn('.woc-satchel-picker')).toBe(true);
    expect(pickerOptions()).toEqual(['Marshal (here)', 'Alt']);
  });
});

/**
 * Both vault keys are delta-omitted, so a snapshot without the vault means unchanged. The loader
 * holds the last reading; these cases prove the addon does not discard it.
 */
describe('the vault', () => {
  it('records the vault while the player is standing at a bursar', async () => {
    const h = await start({
      carry: {
        bank: bankPayload(),
        vault: vaultPayload({ stock: stockOf(['copper_ore', 240], ['silverleaf_herb', 60]) }),
      },
    });
    await h.settle();

    const stored = storedFor(h).sources.vault;
    expect(stored.at).toBe(WALL_CLOCK_MS);
    expect(stored.stock).toEqual([
      { itemId: 'copper_ore', count: 240 },
      { itemId: 'silverleaf_herb', count: 60 },
    ]);
    expect(stored.cap).toBe(400);
    expect(stored.upgrades).toBe(2);
  });

  // The server returns the record reordered, so it is sorted on the way in.
  it('sorts the stock by id rather than trusting the order it arrived in', async () => {
    const h = await start({
      carry: {
        vault: vaultPayload({
          stock: stockOf(['thorium_ore', 5], ['arcane_dust', 9], ['iron_ore', 7]),
        }),
      },
    });
    await h.settle();

    expect(storedFor(h).sources.vault.stock?.map((row) => row.itemId)).toEqual([
      'arcane_dust',
      'iron_ore',
      'thorium_ore',
    ]);
    expect(keysIn('vault')).toEqual(['arcane_dust', 'iron_ore', 'thorium_ore']);
  });

  it('keeps a recorded vault when the player walks away from the bursar', async () => {
    const h = await start({
      carry: { vault: vaultPayload({ stock: stockOf(['copper_ore', 240]) }) },
    });
    await h.settle();
    expect(storedFor(h).sources.vault.stock).toHaveLength(1);

    h.carry({ vault: null });
    await h.settle();

    expect(storedFor(h).sources.vault.stock).toEqual([{ itemId: 'copper_ore', count: 240 }]);
    expect(detailOf('vault', 'copper_ore')).toBe('240 / 400');
  });

  // An undecodable vault arrives as `away` while the bank stays live, so this combination is real.
  it('does not record an empty vault because the bank beside it is readable', async () => {
    const h = await start({
      carry: { bank: bankPayload(), vault: vaultPayload({ stock: stockOf(['copper_ore', 240]) }) },
    });
    await h.settle();

    h.carry({ bank: bankPayload({ slots: cells('cloth', 5) }), vault: null });
    await h.settle();

    expect(storedFor(h).sources.bank.stacks).toHaveLength(1);
    expect(storedFor(h).sources.vault.stock).toEqual([{ itemId: 'copper_ore', count: 240 }]);
  });

  // The bank is unchanged between settles, so only the vault's key could drive the repaint.
  it('repaints and records off the vault key alone', async () => {
    const h = await start({
      carry: { bank: bankPayload(), vault: vaultPayload({ stock: stockOf(['copper_ore', 10]) }) },
    });
    await h.settle();
    expect(detailOf('vault', 'copper_ore')).toBe('10 / 400');

    h.carry({ vault: vaultPayload({ stock: stockOf(['copper_ore', 250], ['iron_ore', 8]) }) });
    await h.settle();

    expect(detailOf('vault', 'copper_ore')).toBe('250 / 400');
    expect(keysIn('vault')).toEqual(['copper_ore', 'iron_ore']);
    expect(storedFor(h).sources.vault.stock).toHaveLength(2);
  });

  it('says the vault has never been read rather than drawing an empty one', async () => {
    const h = await start();
    await h.settle();

    expect(lineFor('vault-note')).toContain('No vault reading yet');
    expect(statFor('vault-cap')).toBe('');
  });

  it('draws each material against the cap they all share', async () => {
    const h = await start({
      carry: {
        vault: vaultPayload({
          perMaterialCap: 400,
          stock: stockOf(['copper_ore', 100], ['iron_ore', 400]),
        }),
      },
    });
    await h.settle();

    expect(fillOf('vault', 'copper_ore')).toBe('25.00%');
    expect(detailOf('vault', 'iron_ore')).toBe('400 / 400');
    expect(statFor('vault-cap')).toBe('400');
  });

  it('marks a material at its cap and leaves the rest alone', async () => {
    const h = await start({
      carry: {
        vault: vaultPayload({
          perMaterialCap: 400,
          stock: stockOf(['copper_ore', 400], ['iron_ore', 12]),
        }),
      },
    });
    await h.settle();

    expect(barTone('vault', 'copper_ore')).toBe('danger');
    expect(barTone('vault', 'iron_ore')).toBe('default');
  });

  it('draws an identity-bearing stack as a square rather than folding it into a count', async () => {
    const h = await start({
      carry: {
        vault: vaultPayload({
          stock: stockOf(['copper_ore', 40]),
          special: [{ itemId: 'resonant_steel', count: 3 }],
        }),
      },
    });
    await h.settle();

    expect(keysIn('vault')).toEqual(['copper_ore']);
    expect(cellsIn('vault').map((el) => el.getAttribute('data-item'))).toEqual(['resonant_steel']);
    expect(statFor('vault-kinds')).toBe('2');
    expect(statFor('vault-held')).toBe('43');
  });

  // The field that tells two identity-bearing rows of one item id apart.
  it('names what crafted an identity-bearing row', async () => {
    const h = await start({
      carry: {
        vault: vaultPayload({
          special: [
            { itemId: 'resonant_steel', count: 4, craftedRecipeId: 'resonant_alloy' },
            { itemId: 'resonant_steel', count: 2 },
          ],
        }),
      },
    });
    await h.settle();

    expect(tipOver(cellIn('vault', 0))).toContain('Crafted from Resonant Alloy');
    expect(tipOver(cellIn('vault', 1))).not.toContain('Crafted from');
  });

  it("draws an alt's vault, read once and remembered", async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot(),
          bank: snapshot({ at: 0 }),
          mail: snapshot({ at: 0 }),
          vault: snapshot({
            at: WALL_CLOCK_MS - 3 * DAY_MS,
            stock: [{ itemId: 'copper_ore', count: 380 }],
            cap: 400,
            upgrades: 2,
          }),
        },
      }),
    );
    const h = await start({ storage });
    await h.settle();

    openTab('Vault');
    choose('Alt');
    await h.settle();

    expect(detailOf('vault', 'copper_ore')).toBe('380 / 400');
    expect(lineFor('vault-age')).toBe('Alt: Last read 3 days ago.');
  });
});

/** An empty record means allowed and empty; null means refused where the player stands. */
describe('the crafting draw', () => {
  it('says the draw is refused where it is refused', async () => {
    const h = await start({ carry: { craftVaultStock: null } });
    await h.settle();

    expect(lineFor('vault-draw')).toContain('cannot draw');
    expect(lineFor('vault-draw')).toContain('dungeon');
  });

  it('tells an empty vault apart from a place the draw is refused', async () => {
    const h = await start({ carry: { craftVaultStock: {} } });
    await h.settle();

    const said = lineFor('vault-draw');

    expect(said).toContain('can draw');
    expect(said).toContain('nothing in it');
  });

  it('counts what the draw reaches where it is allowed', async () => {
    const h = await start({
      carry: { craftVaultStock: stockOf(['copper_ore', 240], ['iron_ore', 8]) },
    });
    await h.settle();

    expect(lineFor('vault-draw')).toBe('Crafting can draw 2 materials from the vault here.');
  });
});

// An item's total spans everything owned, the vault included.
describe('the Items pane and the vault', () => {
  it('adds the vault into an item total rather than leaving it out', async () => {
    const h = await start({
      carry: {
        inventory: cells('copper_ore', 20, 2),
        bank: bankPayload({ slots: cells('copper_ore', 20) }),
        vault: vaultPayload({ stock: stockOf(['copper_ore', 240]) }),
      },
    });
    await h.settle();

    // 40 in the bags, 20 in the bank, 240 in the vault.
    expect(figureOf('items', 'copper_ore')).toBe('300');
    expect(statFor('items-held')).toBe('300');
  });

  // The total counts the vault and the cells do not, on the same row.
  it('spends no cell for what is in the vault', async () => {
    const h = await start({
      carry: {
        inventory: cells('copper_ore', 20, 2),
        vault: vaultPayload({ stock: stockOf(['copper_ore', 240]) }),
      },
    });
    await h.settle();

    chooseIn('sort', 'Cells');
    await h.settle();

    expect(detailOf('items', 'copper_ore')).toBe('280 in 2 cells');
  });

  it('names the vault under the row, without a cell clause it has no answer for', async () => {
    const h = await start({
      carry: {
        inventory: cells('copper_ore', 20),
        vault: vaultPayload({ stock: stockOf(['copper_ore', 240]) }),
      },
    });
    await h.settle();

    const said = tipOver(rowIn('items', 'copper_ore'));

    expect(said).toContain('vault: 240 held');
    expect(said).toContain('bags: 20 in 1 cell');
    expect(said).not.toContain('in 0 cells');
  });

  // A vault count of 240 is not evidence that a 240 stack can exist.
  it('does not learn a stack maximum from a pooled vault count', async () => {
    const h = await start({
      carry: {
        inventory: cells('copper_ore', 20, 3),
        vault: vaultPayload({ stock: stockOf(['copper_ore', 240]) }),
      },
    });
    await h.settle();

    // Three cells of twenty against a maximum of twenty frees nothing; 240 would offer a merge.
    const said = tipOver(cellAt(0));

    expect(said).toContain('Merging them would free nothing');
  });
});

/** The bank's split is sent, not derived; `capacity` alone is never a fit answer. */
describe('the bank pools and sockets', () => {
  it('reports what will fit rather than the pooled subtraction', async () => {
    const h = await start({
      carry: {
        bank: bankPayload({
          slots: cells('cloth', 5, 20),
          capacity: 40,
          generalCapacity: 20,
          materialsCapacity: 20,
          generalUsed: 20,
          materialsUsed: 0,
        }),
      },
    });
    await h.settle();

    // 20 of 40 used and every free cell materials-only, so nothing else fits.
    expect(bankValue()).toBe('20 / 40');
    expect(statFor('bank-free')).toBe('0');
    expect(statTone('bank-free')).toBe('danger');
    expect(statFor('bank-materials')).toBe('20');
  });

  it('draws no materials chip for a bank with no materials pool', async () => {
    const h = await start({ carry: { bank: bankPayload({ slots: cells('cloth', 5, 4) }) } });
    await h.settle();

    expect(statFor('bank-free')).toBe('20');
    expect(statFor('bank-materials')).toBe('');
  });

  // Unlocking a socket adds no slots, so only this chip reports it.
  it('reports the open sockets, which the slot budget never shows', async () => {
    const h = await start({
      carry: {
        bank: bankPayload({
          socketsUnlocked: 2,
          socketBags: ['gravewoven_bag', null, null, null],
        }),
      },
    });
    await h.settle();

    expect(statFor('bank-sockets')).toBe('2 / 4');
    expect(cellsIn('bank-sockets').map((el) => el.getAttribute('data-item'))).toEqual([
      'gravewoven_bag',
      '',
      '',
      '',
    ]);
  });

  // A socket unlock moves nothing else, so the signature must include it.
  it('writes the record down for a socket unlock that moves nothing else', async () => {
    const h = await start({ carry: { bank: bankPayload({ socketsUnlocked: 1 }) } });
    await h.settle();
    expect(storedFor(h).sources.bank.unlocked).toBe(1);

    h.carry({ bank: bankPayload({ socketsUnlocked: 2 }) });
    await h.settle();

    expect(storedFor(h).sources.bank.unlocked).toBe(2);
    expect(statFor('bank-sockets')).toBe('2 / 4');
  });

  // Absent on the wire means show gold only, not that the rung is unavailable.
  it('shows a Claudium price beside the gold one where the game has one', async () => {
    const h = await start({
      carry: { bank: bankPayload({ nextExpansionCost: 1000, nextRungClaudiumPrice: 40 }) },
    });
    await h.settle();

    expect(tipOver(document.querySelector('[data-role="bank-terms"]'))).toContain('or 40 Claudium');
  });

  it('says only the gold price where the Claudium one is absent', async () => {
    const h = await start({ carry: { bank: bankPayload({ nextExpansionCost: 1000 }) } });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="bank-terms"]'));

    expect(said).toContain('The next expansion costs');
    expect(said).not.toContain('Claudium');
  });

  // Every socket, locked ones included: the index is the socket number.
  it('draws four squares whatever the sockets hold', async () => {
    const h = await start({
      carry: {
        bank: bankPayload({
          socketsUnlocked: 4,
          socketBags: [null, 'linen_pouch', null, 'burlap_reagent_pouch'],
        }),
      },
    });
    await h.settle();

    expect(cellsIn('bank-sockets').map((el) => el.getAttribute('data-item'))).toEqual([
      '',
      'linen_pouch',
      '',
      'burlap_reagent_pouch',
    ]);
  });
});

describe('the roster', () => {
  it('lists every character with what they are carrying, this one marked', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        copper: 900,
        sources: {
          bags: snapshot({ total: 34, stacks: cells('ore', 1, 30) }),
          bank: snapshot(),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();

    expect(keysIn('roster')).toEqual([CHARACTER_KEY, `${CHANNEL}/Claudemoon/Alt`]);
    expect(labelOf('roster', CHARACTER_KEY)).toBe('Marshal (here)');
    expect(coinsIn('roster', `${CHANNEL}/Claudemoon/Alt`)).toBe('9 silver');
    expect(detailOf('roster', `${CHANNEL}/Claudemoon/Alt`)).toBe('30 / 34 cells, seen moments ago');
  });

  // Class and level ride the player entity. An older record reads as neither and draws as before.
  it('says what class and level a character is once one has been recorded', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();

    expect(detailOf('roster', CHARACTER_KEY)).toContain('20 Hunter');
  });

  // One meaning per bar: how full that character is, with the tone escalating the same fact. Not
  // the free share (inverts) and not a share of coin.
  it('draws each row as how full that character bags are', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        copper: 3000,
        sources: {
          bags: snapshot({ total: 40, stacks: cells('ore', 1, 30) }),
          bank: snapshot({ at: 0 }),
          mail: snapshot({ at: 0 }),
        },
      }),
    );
    const h = await start({ storage, carry: { copper: 1000, inventory: cells('ore', 1, 4) } });
    await h.settle();

    expect(fillOf('roster', CHARACTER_KEY)).toBe('25.00%');
    expect(fillOf('roster', `${CHANNEL}/Claudemoon/Alt`)).toBe('75.00%');
  });

  // Coin is drawn at the end of the row, so a rich character with room must not draw a long bar.
  it('does not let the coin move the bar', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt', { copper: 999_999 }));
    const h = await start({ storage, carry: { copper: 1 } });
    await h.settle();

    expect(fillOf('roster', `${CHANNEL}/Claudemoon/Alt`)).toBe('0.00%');
  });

  it('says what the bar measures under the pointer', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 4) } });
    await h.settle();

    expect(tipOver(rowIn('roster', CHARACTER_KEY))).toContain(
      'The bar is how full their bags are: 4 of 16 cells.',
    );
  });

  it('says how old each of a character stores is, under the pointer', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 1, 3), at: WALL_CLOCK_MS - 2 * DAY_MS }),
          bank: snapshot({ at: 0 }),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage });
    await h.settle();

    const said = tipOver(rowIn('roster', `${CHANNEL}/Claudemoon/Alt`));

    expect(said).toContain('bags: 3 stacks, read 2 days ago');
    expect(said).toContain('bank: never read');
  });

  it('forgets every other character on request and keeps this one', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    const h = await start({ storage, carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();
    expect(keysIn('roster')).toHaveLength(2);

    document.querySelector<HTMLElement>('[data-role="forget"]')?.click();
    await h.settle();
    // Asserted before pressing: otherwise an addon that forgets on click without asking passes.
    expect(keysIn('roster')).toHaveLength(2);
    expect(modalMessage()).toContain('1 character will be dropped');
    pressModal('Forget them');
    await h.settle();

    expect(keysIn('roster')).toEqual([CHARACTER_KEY]);
    expect(storedKeys(h)).toEqual([CHARACTER_KEY]);
  });

  // No undo: a record returns only by playing that character again.
  it('keeps every record when the confirmation is dismissed', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    const h = await start({ storage, carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();

    document.querySelector<HTMLElement>('[data-role="forget"]')?.click();
    await h.settle();
    expect(modalMessage()).toContain('1 character will be dropped');
    pressModal('Keep them');
    await h.settle();

    expect(keysIn('roster')).toHaveLength(2);
    expect(storedKeys(h)).toHaveLength(2);
  });

  // Alts create the question "how much do I have"; each case states its arithmetic first.
  it('adds every character up: how many, how many cells, and how much money', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        copper: 900,
        sources: {
          bags: snapshot({ total: 34, stacks: cells('ore', 1, 30) }),
          bank: snapshot(),
          mail: snapshot(),
        },
      }),
    );
    // 5 of this character's 16 in use and 30 of the alt's 34, which is 35 of 50.
    const h = await start({ storage, carry: { inventory: cells('ore', 1, 5), copper: 12_345 } });
    await h.settle();

    expect(statFor('roster-characters')).toBe('2');
    expect(statFor('roster-slots')).toBe('35 / 50');
    expect(statFor('roster-free')).toBe('15');
    expect(coinsAt('account')).toBe('1 gold, 32 silver, 45 copper');
  });

  // Totals span readings of different ages, so the oldest is named.
  it('says how old the oldest reading behind the totals is', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 1, 3), at: WALL_CLOCK_MS - 4 * DAY_MS }),
          bank: snapshot({ at: 0 }),
          mail: snapshot({ at: 0 }),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 1) } });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="roster-strip"]'));

    expect(said).toContain('4 days ago');
    expect(said).toContain('Bags only');
  });

  // With one character the line says so, which tells a new player the tab is not broken.
  it('keeps saying there is only this character while there is', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();

    expect(statFor('roster-characters')).toBe('1');
    expect(lineFor('roster-note')).toContain('Only this character so far');
  });
});

// Figures are chips; each case pins the sentence a chip carries at its hover. The two on-screen
// sentences (age and notes) are pinned above.
describe('the status strip', () => {
  it('spells the marks out under the pointer, and says it cannot act on them', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('ore', 3, 2), ...cells('axe', 1)] },
      // Worn as well as carried, so the spare mark is in the same reading.
    });
    h.carry({ equipment: { mainhand: 'axe' } });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="marks"]'));

    expect(said).toContain('1 item here is in more than one cell');
    expect(said).toContain('Merging them by hand would free 1 cell');
    expect(said).toContain('1 item here is also equipped');
    expect(said).toContain('Nothing here can move, merge or sell an item');
  });

  it('spells the bank budget out under the pointer', async () => {
    const h = await start({
      carry: {
        bank: bankPayload({ purchasedSlots: 12, bonusSlots: 4, nextExpansionCost: 50_000 }),
      },
    });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="bank-terms"]'));

    expect(said).toContain('12 cells bought and 4 cells granted');
    expect(said).toContain('The next expansion costs 5g');
    expect(said).toContain('Nothing here can buy one');
  });

  it('says what the mail figures are the terms for', async () => {
    const h = await start({ carry: { mail: mailPayload() } });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="mail-postage"]'));

    expect(said).toContain('Postage is 30c, up to 3 items a letter, 45s in flight.');
    expect(said).toContain('Nothing here can send one');
  });

  // The apostrophe proves the name came from the shipped table, not title-cased from the id.
  it('names what is in each bag socket under the pointer', async () => {
    const h = await start({ carry: { bags: [BIG_BAG, null, null, null] } });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="sockets"]'));

    expect(said).toContain("Socket 1: Wayfarer's Backpack");
    expect(said).toContain('Socket 2: empty');
  });
});

// The figure a player checks against the game's bag window. Each case states its arithmetic first.
describe('the free-slot count', () => {
  it('pools the backpack and every equipped bag, and an empty socket adds nothing', async () => {
    // 16 backpack + 16 + 0 (empty socket) + 12 + 6 = 50 cells.
    const h = await start({
      carry: {
        bags: [BIG_BAG, null, MID_BAG, SMALL_BAG],
        // 10 cells of ore and 27 of cloth: 37 cells in use.
        inventory: [...cells('ore', 20, 10), ...cells('cloth', 4, 27)],
      },
    });
    await h.settle();

    expect(capacityValue()).toBe('37 / 50');
    expect(capacityDetail()).toBe('13 free');
  });

  // One entry is one cell whatever it holds; summing counts would report a backpack overdrawn.
  it('counts a stack as one cell however much is in it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 3) } });
    await h.settle();

    expect(capacityValue()).toBe('3 / 16');
    expect(capacityDetail()).toBe('13 free');
  });

  // `bagCapacity` has no watch key, so it must be followed through the inventory.
  it('follows a bag being put into an empty socket', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 4) } });
    expect(capacityValue()).toBe('4 / 16');

    h.carry({ bags: [MID_BAG, null, null, null] });
    await h.settle();

    expect(capacityValue()).toBe('4 / 28');
    expect(capacityDetail()).toBe('24 free');
  });

  it('never reports a negative free count', async () => {
    // A bag unequipped with its contents still in the pool: 20 cells against a 16-cell backpack.
    const h = await start({ carry: { inventory: cells('ore', 1, 20) } });
    await h.settle();

    expect(capacityDetail()).toBe('0 free');
  });

  it('says the world is not up rather than drawing a figure', async () => {
    await start({ world: false });

    expect(lineFor('bags-note')).toBe('Not in the world yet.');
    expect(statFor('slots')).toBe('');
    expect(statFor('free')).toBe('');
  });

  it('counts the filled sockets rather than guessing what they hold', async () => {
    const h = await start({ carry: { bags: [BIG_BAG, null, SMALL_BAG, null] } });
    await h.settle();

    expect(statFor('sockets')).toBe('2 / 4');
  });
});

/**
 * The game's arithmetic (src/sim/bag_pools.ts): materials fill the materials pool first and spill
 * into general. `Free` is general headroom; materials-only room is its own chip.
 */
describe('the two carried pools', () => {
  it('does not offer reagent-satchel room to a non-material', async () => {
    // 16 backpack + 6 general = 22 general, plus an 8-cell reagent satchel = 30 pooled. 22 swords
    // fill general, so the pooled reading says 8 free while only a material fits.
    const h = await start({
      carry: {
        bags: [SMALL_BAG, REAGENT_BAG, null, null],
        inventory: cells('sword', 1, 22),
      },
    });
    await h.settle();

    expect(capacityValue()).toBe('22 / 30');
    expect(statFor('free')).toBe('0');
    expect(statTone('free')).toBe('danger');
    expect(statFor('materials')).toBe('8');
  });

  it('spends a material out of the reagent pool rather than the general one', async () => {
    // 22 general and 8 materials, holding 20 swords and 2 ore stacks. The ore packs into the
    // satchel, so general is 20 of 22.
    const h = await start({
      carry: {
        bags: [SMALL_BAG, REAGENT_BAG, null, null],
        inventory: [...cells('sword', 1, 20), ...cells(MATERIAL, 20, 2)],
      },
    });
    await h.settle();

    expect(capacityValue()).toBe('22 / 30');
    expect(statFor('free')).toBe('2');
    expect(statFor('materials')).toBe('6');
  });

  it('draws no materials chip for a character carrying no reagent satchel', async () => {
    const h = await start({
      carry: { bags: [SMALL_BAG, null, null, null], inventory: cells('sword', 1, 10) },
    });
    await h.settle();

    expect(statFor('free')).toBe('12');
    expect(statFor('materials')).toBe('');
  });

  it('falls back to the pooled figure and says so for a bag it does not recognise', async () => {
    // 16 backpack + 18 unrecognised = 34 pooled, 30 cells in use.
    const h = await start({
      carry: { bags: [FUTURE_BAG, null, null, null], inventory: cells('sword', 1, 30) },
    });
    await h.settle();

    expect(capacityValue()).toBe('30 / 34');
    expect(statFor('free')).toBe('4');
    expect(statFor('materials')).toBe('');
    expect(lineFor('bags-age')).toContain('not recognised');
  });

  // A known bag whose slot count changed: only a budget mismatch catches it, and which bag is
  // unknowable.
  it('gives up the split when its own budget disagrees with the world', async () => {
    const h = await start({
      carry: { bags: [REAGENT_BAG, null, null, null], inventory: cells('sword', 1, 22) },
    });

    // The world reports 32 pooled where the table accounts for 30.
    const was = BAG_SLOTS.get(SMALL_BAG) ?? 0;
    BAG_SLOTS.set(SMALL_BAG, was + 2);
    teardown.push(() => BAG_SLOTS.set(SMALL_BAG, was));
    h.carry({ bags: [SMALL_BAG, REAGENT_BAG, null, null] });
    await h.settle();

    expect(capacityValue()).toBe('22 / 32');
    expect(statFor('free')).toBe('10');
    expect(statFor('materials')).toBe('');
    expect(lineFor('bags-age')).toContain('a different number of cells');
  });

  it('falls back the same way before the shipped table has been read', async () => {
    const h = await start({
      table: false,
      carry: {
        bags: [SMALL_BAG, REAGENT_BAG, null, null],
        inventory: cells('sword', 1, 22),
      },
    });
    await h.settle();

    expect(statFor('free')).toBe('8');
    expect(statFor('materials')).toBe('');
  });

  it('warns off the general pool rather than the pooled total', async () => {
    const h = await start({
      settings: { 'warn-free': 2 },
      carry: { bags: [SMALL_BAG, REAGENT_BAG, null, null] },
    });
    const played = vi.spyOn(h.shared.sound, 'play');

    // 21 of 22 general in use with the satchel empty: one free, under the two asked for; pooled
    // says nine.
    h.carry({ inventory: cells('sword', 1, 21) });
    await h.settle();

    expect(played).toHaveBeenCalledTimes(1);
    expect(statTone('free')).toBe('warn');
  });
});

// Everything here holds with no item named, which is why a store is drawn as a grid.
describe('the bag grid', () => {
  it('draws one square per pooled cell, and grows when a bag is socketed', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 3) } });
    await h.settle();
    expect(gridCells()).toHaveLength(16);

    h.carry({ bags: [MID_BAG, null, null, null] });
    await h.settle();

    expect(gridCells()).toHaveLength(28);
  });

  it('draws no squares at all before the world can say how many there are', async () => {
    await start({ world: false });

    expect(gridCells()).toEqual([]);
  });

  // An item id has art but no name, and the grid is built on the art.
  it('asks the game for art per square, by item id', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 5)] },
    });
    await h.settle();

    expect(artAt(0)).toBe('/ui/items/ore.webp');
    expect(artAt(1)).toBe('/ui/items/cloth.webp');
    expect(artAt(2)).toBe('');
  });

  it('puts the stack count in the corner, and draws none for a stack of one', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('axe', 1)] },
    });
    await h.settle();

    expect(countAt(0)).toBe('20');
    expect(countAt(1)).toBe('');
  });

  // Missing art is ordinary. The kit hides its image slot; the square must still read as occupied.
  it('leaves a readable occupied square when the art fails to load', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    cellAt(0)?.querySelector('img')?.dispatchEvent(new Event('error'));

    expect(artHiddenAt(0)).toBe(true);
    expect(occupiedAt(0)).toBe(true);
    expect(countAt(0)).toBe('20');
    expect(nameAt(0)).toBe('Ore, 20');
    expect(occupiedAt(1)).toBe(false);
  });

  // `InvSlot.slot` is absent for anything never moved by hand: hinted stacks take their cell, the
  // rest flow in.
  it('honours the cell a stack was dragged into', async () => {
    const h = await start({
      carry: { inventory: [{ itemId: 'ore', count: 20, slot: 5 }, ...cells('cloth', 5)] },
    });
    await h.settle();

    expect(itemsInGrid()[5]).toBe('ore');
    expect(itemsInGrid()[0]).toBe('cloth');
  });

  it('ignores a placement hint pointing outside the bags it has', async () => {
    // Slot 40 is outside a 16-slot backpack: a leftover hint from a removed bag.
    const h = await start({
      carry: { inventory: [{ itemId: 'ore', count: 20, slot: 40 }] },
    });
    await h.settle();

    expect(itemsInGrid()[0]).toBe('ore');
    expect(gridCells()).toHaveLength(16);
  });

  // A reused square must not announce its previous item. Asserted on the attribute: `null` and ''
  // both read as '' through `getAttribute(...) ?? ''`.
  it('takes the name off a square a stack has left rather than blanking it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();
    expect(namedAt(1)).toBe(true);
    expect(nameAt(1)).toBe('Ore, 20');

    h.carry({ inventory: cells('ore', 20) });
    await h.settle();

    expect(namedAt(1)).toBe(false);
    expect(tileHiddenAt(1)).toBe(true);
    expect(occupiedAt(1)).toBe(false);
  });

  // Cells are positional, so a repaint reuses the element in each square and keeps its hover.
  it('keeps the same element in a square across a repaint', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();
    const before = cellAt(0);

    h.carry({ inventory: [...cells('ore', 20), ...cells('cloth', 5)] });
    await h.settle();

    expect(cellAt(0)).toBe(before);
  });
});

// Surviving arbitrary resizes, asserted on the inline styles the addon writes: a `.css` import
// resolves to '' under vitest.
describe('its layout', () => {
  // `setShown` must not write `display: flex`: the bag grid goes through it, and 72 squares in one
  // row would stretch the frame to about 1800 pixels.
  it('leaves the bag grid a grid when the pane shows it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 3) } });
    await h.settle();

    expect(gridEl('bags')?.style.display).toBe('grid');
    expect(gridEl('bags')?.hidden).toBe(false);
  });

  it('leaves the bank grid a grid too', async () => {
    const h = await start({ carry: { bank: bankPayload({ slots: cells('ore', 20, 2) }) } });
    await h.settle();

    expect(gridEl('bank')?.style.display).toBe('grid');
  });

  // Hidden both ways: `hidden` removes it from the accessibility tree, and the loader's
  // `woc-hidden` (with !important) beats the inline `display: grid` that `hidden` cannot. A suite
  // cannot read the rule, so both marks are checked.
  it('hides a grid there is nothing to draw in', async () => {
    await start({ world: false });

    expect(gridEl('bags')?.classList.contains('woc-hidden')).toBe(true);
    expect(gridEl('bags')?.hidden).toBe(true);
  });

  // A wrapping track list follows the frame with no resize handler. The 42 is `woc.ui.itemCell`,
  // written out so a change fails here and prompts a preview re-capture.
  it('fits as many squares across as the frame is wide', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    expect(gridEl('bags')?.style.gridTemplateColumns).toBe('repeat(auto-fill, 42px)');
  });

  // Without stated bounds a frame's floor is its opening size.
  it('is resizable, and the loader therefore writes it a box', async () => {
    const h = await start();
    await h.settle();

    expect(frameEl()?.style.width).not.toBe('');
    expect(frameEl()?.style.height).not.toBe('');
  });

  // Comfortable: this panel sits beside the game's windows. The size constants are measured at this
  // density, so moving to compact means re-measuring them.
  it('draws at the game’s own scale rather than tighter than it', async () => {
    await start();

    expect(frameEl()?.className).toContain('woc-density-comfortable');
    expect(frameEl()?.className).not.toContain('woc-density-compact');
  });

  // The list scrolls, not the pane, so the tab strip never scrolls away.
  it('scrolls the list in each pane and leaves the tab strip alone', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    expect(gridEl('bags')?.style.overflowY).toBe('auto');
    expect(listEl('items')?.style.overflowY).toBe('auto');
    expect(listEl('mail')?.style.overflowY).toBe('auto');
    expect(listEl('roster')?.style.overflowY).toBe('auto');
    expect(document.querySelector<HTMLElement>('.woc-tabs')?.style.overflowY).toBe('');
  });

  // A flex column shrinks children before scrolling, clipping rows with no scrollbar. happy-dom
  // lays
  // nothing out, so the shrink factor is what is checkable; the stage shows the rest.
  it('refuses to shrink the rows in a scrolling list', async () => {
    const h = await start({ carry: { inventory: [...cells('ore', 20), ...cells('cloth', 5)] } });
    await h.settle();

    expect(rowIn('items', 'ore')?.style.flexShrink).toBe('0');
    expect(rowIn('items', 'cloth')?.style.flexShrink).toBe('0');
  });

  // The loader fills only a window's body; a resizable frame must ask, or its dragged-out height is
  // dead space.
  it('asks its body to fill the height the frame was given', async () => {
    const h = await start();
    await h.settle();

    expect(document.querySelector<HTMLElement>('.woc-frame-body')?.style.flex).toBe('1 1 auto');
  });

  // `setShown` restores an element's own display. The purse is the catch: a kit bar shown as flex
  // puts its detail beside its figure, silently. So this addon must write no display onto it.
  it('gives an element it did not lay out back its own display', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    const purse = document.querySelector<HTMLElement>('.woc-satchel-purse');
    expect(purse?.hidden).toBe(false);
    expect(purse?.style.display).toBe('');
    expect(gridEl('bags')?.style.display).toBe('grid');
  });
});

// Every mark is computable from ids alone.
describe('what the grid marks', () => {
  it('marks every square holding an id that sits in more than one cell', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20, 2), ...cells('cloth', 5)] },
    });
    await h.settle();

    expect(markedAt(0)).toBe(true);
    expect(markedAt(1)).toBe(true);
    expect(markedAt(2)).toBe(false);
    expect(markedAt(3)).toBe(false);
  });

  // The lock is the one thing the player set; the alt case is why it is recorded.
  it('draws a padlock on a locked square', async () => {
    const h = await start({
      carry: { inventory: [...lockedCells('ore', 20), ...cells('cloth', 5)] },
    });
    await h.settle();

    expect(lockedAt(0)).toBe(true);
    expect(lockedAt(1)).toBe(false);
  });

  it('takes the padlock off a square that was unlocked', async () => {
    const h = await start({ carry: { inventory: lockedCells('ore', 20) } });
    await h.settle();
    expect(lockedAt(0)).toBe(true);

    h.carry({ inventory: cells('ore', 20) });
    await h.settle();

    expect(lockedAt(0)).toBe(false);
  });

  // A reused cell must not keep the padlock of its previous item.
  it('takes the padlock off a square that emptied', async () => {
    const h = await start({ carry: { inventory: lockedCells('ore', 20) } });
    await h.settle();

    h.carry({ inventory: [] });
    await h.settle();

    expect(lockedAt(0)).toBe(false);
  });

  // A tile is announced as one image, so the fact goes in its name.
  it('says a square is locked in the name it announces', async () => {
    const h = await start({ carry: { inventory: lockedCells('ore', 20) } });
    await h.settle();

    expect(cellAt(0)?.getAttribute('aria-label')).toContain('locked');
  });

  it('stops marking a square once the duplicate has gone', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();
    expect(markedAt(0)).toBe(true);

    h.carry({ inventory: cells('ore', 20) });
    await h.settle();

    expect(markedAt(0)).toBe(false);
  });

  it('marks a spare of something the character is wearing', async () => {
    const h = await start({
      carry: { inventory: cells('axe', 1), equipment: { mainhand: 'axe' } },
    });
    await h.settle();

    expect(markedAt(0)).toBe(true);
    expect(statFor('marks')).toBe('1 worn');
  });

  // 20 + 3 + 3 = 26 over 3 cells with a largest stack of 20, so two cells hold it and one frees.
  it('says how many cells merging would free, measured against a stack it has seen', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('ore', 3, 2)] },
    });
    await h.settle();

    expect(statFor('marks')).toBe('1 split, 1 to free');
  });

  // No published stack maximum, so two full stacks free zero: the safe direction to be wrong.
  it('claims no reclaim when no stack is bigger than one already seen', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();

    expect(statFor('marks')).toBe('1 split');
  });

  // Stored records feed the maximum too, so it survives a page load.
  it('learns a stack maximum out of a record it read back from storage', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 20) }),
          bank: snapshot(),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 3, 2) } });
    await h.settle();

    expect(statFor('marks')).toBe('1 split, 1 to free');
  });

  it('says nothing at all when nothing is doubled up', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 5)] },
    });
    await h.settle();

    expect(document.querySelector<HTMLElement>('[data-role="marks"]')?.hidden).toBe(true);
  });

  it('spells the marks out under the pointer, and says it cannot act on them', async () => {
    const h = await start({ carry: { inventory: [...cells('ore', 20), ...cells('ore', 3, 2)] } });
    await h.settle();

    const said = tipOver(cellAt(0));

    expect(said).toContain('3 cells, 26 held');
    expect(said).toContain('Merging them by hand would free 1 cell');
    expect(said).toContain('Nothing here can move, merge or sell an item');
  });

  it('says an empty square is empty rather than describing the last thing in it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    expect(tipOver(cellAt(3))).toContain('Room for one more stack');
  });
});

// The capacity chip carries urgency in two places: the figure, and the empty grid squares.
describe('the free-slot warning', () => {
  it('leaves the figure alone while there is room', async () => {
    const h = await start({
      settings: { 'warn-free': 4 },
      carry: { bags: [BIG_BAG, null, MID_BAG, SMALL_BAG] },
    });
    await h.settle();

    expect(statTone('free')).toBe('default');
    expect(cellAt(0)?.classList.contains('woc-tile-warn')).toBe(false);
  });

  it('goes warm once the free count is inside the threshold', async () => {
    const h = await start({
      settings: { 'warn-free': 4 },
      carry: { inventory: cells('ore', 1, 13) },
    });
    await h.settle();

    expect(statTone('free')).toBe('warn');
  });

  // Every free square, not a subset: no particular empty square is the last.
  it('colours the squares that are left, and none that are full', async () => {
    const h = await start({
      settings: { 'warn-free': 4 },
      carry: { inventory: cells('ore', 1, 13) },
    });
    await h.settle();

    expect(cellAt(0)?.classList.contains('woc-tile-warn')).toBe(false);
    expect(cellAt(13)?.classList.contains('woc-tile-warn')).toBe(true);
  });

  it('goes loud with nothing left at all', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 16) } });
    await h.settle();

    expect(statTone('free')).toBe('danger');
  });
});

// On the crossing, not the state, or every loot while full would chime.
describe('the warning cue', () => {
  it('sounds as the bags get tight and stays quiet while they stay tight', async () => {
    const h = await start({ settings: { 'warn-free': 4 } });
    const played = vi.spyOn(h.shared.sound, 'play');

    h.carry({ inventory: cells('ore', 1, 13) });
    await h.settle();
    h.carry({ inventory: cells('ore', 1, 14) });
    await h.settle();

    expect(played).toHaveBeenCalledTimes(1);
  });

  it('sounds again once room has been made and lost a second time', async () => {
    const h = await start({ settings: { 'warn-free': 4 } });
    const played = vi.spyOn(h.shared.sound, 'play');

    h.carry({ inventory: cells('ore', 1, 13) });
    await h.settle();
    h.carry({ inventory: cells('ore', 1, 2) });
    await h.settle();
    h.carry({ inventory: cells('ore', 1, 13) });
    await h.settle();

    expect(played).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the cue is switched off', async () => {
    const h = await start({ settings: { 'warn-free': 4, 'warn-cue': false } });
    const played = vi.spyOn(h.shared.sound, 'play');

    h.carry({ inventory: cells('ore', 1, 13) });
    await h.settle();

    expect(played).not.toHaveBeenCalled();
    expect(statTone('free')).toBe('warn');
  });
});

// Every display is complete without an answer, and an answer enriches it.
describe('the bus contract', () => {
  it('draws the whole grid with nothing publishing at all', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();

    expect(itemsInGrid().slice(0, 2)).toEqual(['ore', 'ore']);
    expect(nameAt(0)).toBe('Ore, 20');
  });

  // From a fork's fqid: subscribing to the official id alone would silently hear nothing.
  it('upgrades a square when a publisher answers later, whoever the publisher is', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();
    expect(nameAt(0)).toBe('Ore, 20');

    h.publish('item', { id: 'ore', name: 'Copper Ore', kind: 'trade', quality: 'common' });
    await h.settle();

    expect(nameAt(0)).toBe('Copper Ore, 20');
    expect(tipOver(cellAt(0))).toContain('trade, common');
  });

  it('takes a batch on the items topic', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('elixir', 1)] },
    });

    h.publish('items', [
      { id: 'ore', name: 'Copper Ore', kind: 'trade' },
      { id: 'elixir', name: 'Elixir of Bark', kind: 'consumable' },
    ]);
    await h.settle();

    expect(nameAt(0)).toBe('Copper Ore, 20');
    expect(nameAt(1)).toBe('Elixir of Bark');
  });

  it('ignores a payload that is not an item record and keeps drawing', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });

    h.publish('item', { id: 'ore' });
    h.publish('item', 'copper ore');
    h.publish('item', null);
    await h.settle();

    expect(nameAt(0)).toBe('Ore, 20');
  });

  it('credits whoever answered', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore' });
    await h.settle();

    expect(tipOver(cellAt(0))).toContain(`Named by ${PUBLISHER}`);
  });

  // Silence is ordinary: nothing waits or times out, and neither silence reads as a fault.
  it('says nobody is publishing without calling it a fault', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    const said = tipOver(cellAt(0));

    expect(said).toContain('Its art file carries no name');
    expect(said).toContain('nothing is publishing names over the bus');
    expect(said).not.toContain('error');
  });
});

// Vendor prices come only from a publisher, so every total is partial by construction: never
// presented as complete, and an unpriced item never counts as worth nothing.
describe('what it is all worth', () => {
  it('totals the bags from published prices', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(statFor('bags-worth')).toBe('10s');
    expect(tipOver(barAt('bags-worth'))).toContain('1 of 1 kinds priced');
  });

  // Unpriced items are left out and the count says so; a silently partial total is worse than none.
  it('leaves an unpriced item out of the sum and says how many kinds it could price', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 4)] },
    });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(statFor('bags-worth')).toBe('5s');
    expect(tipOver(barAt('bags-worth'))).toContain('1 of 2 kinds priced');
  });

  // With nobody publishing, `0c` would be a claim; there is no row instead.
  it('draws no worth at all while nothing has published a price', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore' });
    await h.settle();

    expect(nameAt(0)).toBe('Copper Ore, 20');
    expect(shownAt('bags-worth')).toBe(false);
  });

  it('totals the bank the same way, from the same prices', async () => {
    const h = await start({
      carry: { bank: bankPayload({ slots: cells('ore', 20, 3) }) },
    });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(statFor('bank-worth')).toBe('15s');
  });

  // Every store of every character, unlike the bags-only slot total.
  it('totals every store of every character on the account', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: cells('ore', 20) }),
          bank: snapshot({ stacks: cells('ore', 20, 2) }),
          mail: snapshot(),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 10) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    // 10 here, 20 in the alt's bags, 40 in the alt's bank: 70 at 25 copper.
    expect(statFor('account-worth')).toBe('17s 50c');
  });

  it('follows the search on the items strip', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 10)] },
    });
    h.publish('items', [
      { id: 'ore', name: 'Copper Ore', sellValue: 25 },
      { id: 'cloth', name: 'Linen Cloth', sellValue: 10 },
    ]);
    await h.settle();

    expect(statFor('items-worth')).toBe('6s');

    typeSearch('copper');
    await h.settle();

    expect(statFor('items-worth')).toBe('5s');
  });

  it('says a vendor price is not a market price, and that it cannot sell anything', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="bags-worth"]'));

    expect(said).toContain('what a vendor pays');
    expect(said).toContain('1 of 1 kinds priced');
    expect(said).toContain('left out rather than counted at nothing');
    expect(said).toContain('Nothing here can sell an item.');
  });

  it('prices one row under the pointer, each and for the pile', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(tipOver(rowIn('items', 'ore'))).toContain('A vendor pays 25c each, 10s for all 40');
  });

  // The grid pane must price the square under the pointer, not only the Items row.
  it('prices the square under the pointer, each and for the cell', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(tipOver(cellAt(0))).toContain('A vendor pays 25c each, 5s for this cell.');
  });

  // A single item has no separate "each".
  it('gives a single item one figure rather than the same one twice', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(tipOver(cellAt(0))).toContain('A vendor pays 25c.');
  });

  it('says nothing about a price nobody has published', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore' });
    await h.settle();

    expect(tipOver(cellAt(0))).not.toContain('A vendor pays');
  });

  // A price is checked like any payload field: a numeric string is not a number, and zero is never
  // sent.
  it('ignores a price that is not a positive number', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: '25' });
    await h.settle();

    expect(shownAt('bags-worth')).toBe(false);

    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(shownAt('bags-worth')).toBe(true);
  });
});

// A tier borders the square, the kit's axis for it. The three marks sit on a pip, since the kit
// lets a tone beat a tier and none of them is urgent.
describe('the tier on a square', () => {
  it('borders a cell by the tier a publisher gave it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', quality: 'epic' });
    await h.settle();

    expect(cellAt(0)?.classList.contains('woc-tile-quality-epic')).toBe(true);
  });

  it('colours the name on an index row by the same tier', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', quality: 'rare' });
    await h.settle();

    expect(rowIn('items', 'ore')?.classList.contains('woc-bar-quality-rare')).toBe(true);
  });

  // The kit colours nothing outside its six, so an unknown tier is passed as null by decision.
  it('refuses a tier the kit does not know', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', quality: 'mythic' });
    await h.settle();

    expect(cellAt(0)?.className).not.toContain('woc-tile-quality');
  });

  // Mark and tier on one square: a split stack must not take the border.
  it('draws the mark and the tier at once', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', quality: 'uncommon' });
    await h.settle();

    expect(markedAt(0)).toBe(true);
    expect(cellAt(0)?.classList.contains('woc-tile-quality-uncommon')).toBe(true);
  });
});

// The loader's name for an item names the art file and can differ from the game's display name,
// so it ranks under a publisher and over the raw id, and says where it came from.
describe('the name on a square', () => {
  it('falls back to the art file when nobody is publishing, and says so', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    artNames(h, new Map([['ore', 'Copper Ore']]));
    // The manifest landing is not a world change; this stands in for the repaint it schedules.
    h.carry({ inventory: [...cells('ore', 20), ...cells('cloth', 5)] });
    await h.settle();

    expect(nameAt(0)).toBe('Copper Ore, 20');
    expect(nameAt(1)).toBe('Cloth, 5');
    expect(tipOver(cellAt(0))).toContain('Named from its art file');
  });

  // A publisher layers better sources over the same manifest, so it wins where they disagree.
  it('lets a publisher outrank the art file', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    artNames(h, new Map([['ore', 'Coppery Ore']]));
    h.publish('item', { id: 'ore', name: 'Copper Ore' });
    await h.settle();

    const said = tipOver(cellAt(0));

    expect(nameAt(0)).toBe('Copper Ore, 20');
    expect(said).toContain(`Named by ${PUBLISHER}`);
    expect(said).not.toContain('Named from its art file');
  });

  // Art answers are provisional until the manifest lands, so the addon asks and repaints. Built
  // from the shared services directly: the spy must exist before the addon's first line.
  it('reads the art manifest once, then repaints with what it learned', async () => {
    const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
    const state: CarryState = { ...emptyCarry(), inventory: cells('ore', 20) };
    const shared = createSharedServices(document, createFakeStorage(), {
      game: Promise.resolve({ world: fakeWorld(state, player) }),
    });
    // Annotated, or `noUnnecessaryConditions` reads the literal `false` as a constant condition.
    const read: { on: boolean } = { on: false };
    const preload = vi.spyOn(shared.shared.kit.icons, 'preloadItems').mockImplementation(() => {
      read.on = true;
      return Promise.resolve();
    });
    vi.spyOn(shared.shared.kit.icons, 'itemArtName').mockImplementation(() => {
      if (read.on) {
        return 'Copper Ore';
      }
      return null;
    });

    const addon = await loadAddon({ shared: shared.shared, row: installedRow(), source: SOURCE });
    teardown.push(() => {
      addon.dispose();
      shared.dispose();
    });
    shared.shared.world.watcher.poll();
    await flush(MICROTASKS);
    vi.advanceTimersToNextFrame();
    shared.frames.tick();
    await flush(MICROTASKS);

    expect(preload).toHaveBeenCalledTimes(1);
    expect(nameAt(0)).toBe('Copper Ore, 20');
  });
});

// The ask is emitted last: delivery is synchronous, so a running publisher answers inside it.
describe('asking to be caught up', () => {
  it('asks once at start and takes the answer given inside the ask', async () => {
    const storage = createFakeStorage();
    const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
    const state: CarryState = { ...emptyCarry(), inventory: cells('ore', 20, 2) };
    const shared = createSharedServices(document, storage, {
      game: Promise.resolve({ world: fakeWorld(state, player) }),
    });
    const asks: string[] = [];
    const off = shared.shared.bus.subscribe({
      from: ANY_SENDER,
      // What `woc.bus.follow` derives. The publisher also answers `item:ask`.
      topic: 'items:ask',
      owner: PUBLISHER,
      handler: (message) => {
        asks.push(message.from);
        shared.shared.bus.emit(PUBLISHER, 'items', [{ id: 'ore', name: 'Copper Ore' }]);
      },
      onError: () => undefined,
    });

    const addon = await loadAddon({ shared: shared.shared, row: installedRow(), source: SOURCE });
    teardown.push(() => {
      off();
      addon.dispose();
      shared.dispose();
    });
    shared.shared.world.watcher.poll();
    await flush(MICROTASKS);
    vi.advanceTimersToNextFrame();
    shared.frames.tick();

    expect(asks).toEqual([FQID]);
    expect(nameAt(0)).toBe('Copper Ore, 20');
  });
});

// The game's own narration, which names the item an inventory entry cannot.
describe('what the game says came in and went out', () => {
  it('shows the loot line verbatim', async () => {
    const h = await start();

    h.inbound({ t: 'events', list: [{ type: 'loot', text: 'You receive loot: Copper Ore x3.' }] });
    await h.settle();

    expect(lineFor('recent')).toBe('You receive loot: Copper Ore x3.');
  });

  it('names the item a vendor line carries, or says nothing more than the action', async () => {
    const h = await start();

    h.inbound({ t: 'events', list: [{ type: 'vendor', action: 'sell', itemId: 'ore' }] });
    await h.settle();
    expect(lineFor('recent')).toBe('Vendor: sell Ore');

    h.inbound({ t: 'events', list: [{ type: 'vendor', action: 'sell' }] });
    await h.settle();
    expect(lineFor('recent')).toBe('Vendor: sell');
  });

  // The narration is about the player, so it is dropped while an alt is shown.
  it('drops the narration while the panes are showing another character', async () => {
    const storage = createFakeStorage();
    seed(storage, storedCharacter('Alt'));
    const h = await start({ storage });
    h.inbound({ t: 'events', list: [{ type: 'loot', text: 'You receive loot: Copper Ore x3.' }] });
    await h.settle();
    expect(lineFor('recent')).toContain('Copper Ore');

    choose('Alt');
    await h.settle();

    expect(lineFor('recent')).toBe('');
  });
});

// Badge and pane are separate reads: `mailUnread` is not gated, so the badge works away from the
// mailbox.
describe('the mailbox', () => {
  it('puts the unread count in the title from anywhere in the world', async () => {
    const h = await start({ carry: { mail: null, mailUnread: 2 } });
    await h.settle();

    expect(frameTitle()).toBe('Satchel (2 unread)');
    expect(lineFor('mail-state')).toContain('2 unread letters.');
    expect(lineFor('mail-state')).toContain('Not at a mailbox');
  });

  it('takes the badge off the title again when the box is read', async () => {
    const h = await start({ carry: { mailUnread: 2 } });
    await h.settle();
    expect(frameTitle()).toBe('Satchel (2 unread)');

    h.carry({ mailUnread: 0 });
    await h.settle();

    expect(frameTitle()).toBe('Satchel');
  });

  it('lists the letters while the player is at a pillar', async () => {
    const h = await start({
      carry: {
        mailUnread: 1,
        mail: mailPayload({
          totalCount: 2,
          unread: 1,
          messages: [
            letter({ id: 7, subject: 'Ore for you', copper: 500, items: cells('ore', 20) }),
            letter({ id: 3, senderName: 'Auctioneer', subject: 'Sold', read: true }),
          ],
        }),
      },
    });
    await h.settle();

    expect(keysIn('mail')).toEqual(['7', '3']);
    expect(labelOf('mail', '7')).toBe('Ore for you');
    expect(figureOf('mail', '7')).toBe('Alt');
    expect(detailOf('mail', '7')).toBe('Attached: 5s, 1 item');
    expect(lineFor('mail-state')).toBe('1 unread letter. 2 letters in the box.');
    expect(lineFor('mail-age')).toBe('Live.');
  });

  // Unread is a mark, not a measurement: full fill for unread, none for read.
  it('draws an unread letter warm and a read one plain', async () => {
    const h = await start({
      carry: {
        mail: mailPayload({
          totalCount: 2,
          messages: [letter({ id: 7 }), letter({ id: 3, read: true })],
        }),
      },
    });
    await h.settle();

    expect(rowIn('mail', '7')?.classList.contains('woc-bar-warn')).toBe(true);
    expect(rowIn('mail', '3')?.classList.contains('woc-bar-warn')).toBe(false);
  });

  it('names a parcel by the best name each id has, and says it cannot take it', async () => {
    const h = await start({
      carry: {
        mail: mailPayload({ totalCount: 1, messages: [letter({ id: 7, items: cells('ore', 3) })] }),
      },
    });
    h.publish('item', { id: 'ore', name: 'Copper Ore' });
    await h.settle();

    const said = tipOver(rowIn('mail', '7'));

    expect(said).toContain('Copper Ore x3');
    expect(said).toContain('Nothing here can open a letter or take what is in it');
  });

  it('reads the postage off the payload rather than knowing it', async () => {
    const h = await start({ carry: { mail: mailPayload() } });
    await h.settle();

    expect(statFor('mail-postage')).toBe('30c');
    expect(statFor('mail-attachments')).toBe('3 items');
    expect(statFor('mail-flight')).toBe('45s');
  });

  // Drawn from the last reading at the pillar, while the badge keeps streaming.
  it('keeps the letters on screen once the player walks away, and dates them', async () => {
    const h = await start({
      carry: { mailUnread: 1, mail: mailPayload({ totalCount: 1, messages: [letter({ id: 7 })] }) },
    });
    await h.settle();
    expect(keysIn('mail')).toEqual(['7']);

    h.carry({ mail: null });
    await h.settle();

    expect(keysIn('mail')).toEqual(['7']);
    expect(frameTitle()).toBe('Satchel (1 unread)');
    expect(lineFor('mail-state')).toContain('Not at a mailbox');
    expect(lineFor('mail-age')).toBe('Last read moments ago.');
  });
});

describe('its keybind', () => {
  it('takes the panel off screen and brings it back', async () => {
    const h = await start();
    const el = document.querySelector('[data-woc-frame="bags"]');

    h.press('Alt+KeyB');
    expect(el?.classList.contains('woc-hidden')).toBe(true);

    h.press('Alt+KeyB');
    expect(el?.classList.contains('woc-hidden')).toBe(false);
  });
});

describe('disabling it', () => {
  it('leaves no frame, no keybind and no repaint behind', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('[data-woc-frame="bags"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => vi.advanceTimersToNextFrame()).not.toThrow();
  });
});

// The market price protocol. A vendor floor is too small to act on; the counter price decides.
// A separate topic, never a field on `item`: a second publisher there would replace the
// catalogue's record.
describe('what things go for', () => {
  const priceRow = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'ore',
    realm: REALM,
    unit: 400,
    at: WALL_CLOCK_MS,
    visits: 6,
    ...patch,
  });

  it('draws the market total where one has been published, and says which it is', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('price', priceRow(), PRICER);
    await h.settle();

    expect(statFor('bags-worth')).toBe('80s');
    expect(statLabel('bags-worth')).toBe('Market');
  });

  // The vendor figure moves to the tooltip, as the certain one.
  it('keeps the vendor floor beside it rather than replacing it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 }, PUBLISHER);
    h.publish('price', priceRow(), PRICER);
    await h.settle();

    const said = tipOver(barAt('bags-worth'));

    expect(said).toContain('A vendor would pay 5s');
    expect(said).toContain('only certain figure');
  });

  it('falls back to the vendor figure when nobody has published a price', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 }, PUBLISHER);
    await h.settle();

    expect(statFor('bags-worth')).toBe('5s');
    expect(statLabel('bags-worth')).toBe('Worth');
  });

  // A price is about one market; an alt on another realm gets silence, not a wrong figure.
  it('refuses to spend another realm price on this character stock', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 }, PUBLISHER);
    h.publish('price', priceRow({ realm: 'Emberfall' }), PRICER);
    await h.settle();

    expect(statLabel('bags-worth')).toBe('Worth');
    expect(statFor('bags-worth')).toBe('5s');
  });

  // A realmless record is refused, guarded at both the parse and the lookup.
  it('refuses a price record that names no realm', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('price', { id: 'ore', unit: 400, at: WALL_CLOCK_MS }, PRICER);
    await h.settle();

    expect(shownAt('bags-worth')).toBe(false);
  });

  // A character recorded before realms has none; two blanks are not a match.
  it('refuses to price a character recorded before realms were written down', async () => {
    const storage = createFakeStorage();
    // The key absent, as an old record has it. Destructured off: Biome refuses `delete` and
    // `exactOptionalPropertyTypes` refuses `= undefined`.
    const { realm: _dropped, ...before } = storedCharacter('Alt', { copper: 10 });
    seed(storage, before);
    const h = await start({ storage });
    h.publish('price', priceRow({ id: 'ore' }), PRICER);
    await h.settle();
    choose('Alt');
    await h.settle();

    expect(shownAt('bags-worth')).toBe(false);
  });

  it('takes the batch an ask is answered with', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('prices', [priceRow()], PRICER);
    await h.settle();

    expect(statFor('bags-worth')).toBe('80s');
  });

  it('ignores a batch that is not one, the way it does for names', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('prices', null, PRICER);
    await h.settle();

    expect(shownAt('bags-worth')).toBe(false);
  });

  // Both figures on one square, labelled, never merged.
  it('prices a square from both sources at once', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 }, PUBLISHER);
    h.publish('price', priceRow(), PRICER);
    await h.settle();

    const said = tipOver(cellAt(0));

    expect(said).toContain('A vendor pays 25c each, 5s for this cell.');
    expect(said).toContain('The counter: 4s each, 80s for this cell.');
    expect(said).toContain('6 readings, newest moments ago');
  });

  // The store stamp says when the bags were read; this says when the counter was.
  it('says how old a price is and how much is behind it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('price', priceRow({ visits: 1, at: WALL_CLOCK_MS - 3 * DAY_MS }), PRICER);
    await h.settle();

    const said = tipOver(cellAt(0));

    expect(said).toContain('1 reading, newest 3 days ago');
    expect(said).toContain("one seller's asking price on one day");
  });

  it('carries what was paid beside the ask rather than inside it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('price', priceRow({ sold: 350, sales: 4 }), PRICER);
    await h.settle();

    const said = tipOver(cellAt(0));

    expect(said).toContain('The counter: 4s each');
    expect(said).toContain('paid a median of 3s 50c each over 4 sales');
  });

  // A single-reading figure is included and disclosed.
  it('discloses how many kinds rest on a single reading', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 10)] },
    });
    h.publish('prices', [priceRow(), priceRow({ id: 'cloth', visits: 1 })], PRICER);
    await h.settle();

    expect(tipOver(barAt('bags-worth'))).toContain('1 of 2 rest on a single reading');
  });

  // A row pools realms, so only the copies on the price's realm are priced; the rest are counted.
  it('prices only the copies sitting on the realm the price is about', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        realm: 'Emberfall',
        sources: {
          bags: snapshot({ stacks: cells('ore', 30) }),
          bank: snapshot({ at: 0 }),
          mail: snapshot({ at: 0 }),
        },
      }),
    );
    const h = await start({ storage, carry: { inventory: cells('ore', 20) } });
    h.publish('price', priceRow(), PRICER);
    await h.settle();

    const said = tipOver(rowIn('items', 'ore'));

    expect(said).toContain('The counter: 4s each, 80s for all 20.');
    expect(said).toContain('30 of these are on another realm');
  });
});

// `MAX_ITEM_ROWS` truncates whatever order it is given, so a sorted list gives a real top 40 where
// alphabetical gives an arbitrary slice.
describe('reading the index in an order', () => {
  const threeKinds = {
    inventory: [...cells('ore', 20, 3), ...cells('cloth', 5), ...cells('herb', 1, 2)],
  };

  it('is alphabetical until the player says otherwise', async () => {
    const h = await start({ carry: threeKinds });
    await h.settle();

    expect(keysIn('items')).toEqual(['cloth', 'herb', 'ore']);
  });

  it('ranks by how many copies there are', async () => {
    const h = await start({ carry: threeKinds });
    await h.settle();
    chooseIn('sort', 'Copies');
    await h.settle();

    expect(keysIn('items')).toEqual(['ore', 'cloth', 'herb']);
  });

  // 60 ore in three cells is cheaper to carry than two herbs in two.
  it('ranks by how many cells a kind is spending', async () => {
    const h = await start({ carry: threeKinds });
    await h.settle();
    chooseIn('sort', 'Cells');
    await h.settle();

    expect(keysIn('items').slice(0, 2)).toEqual(['ore', 'herb']);
  });

  // Prices chosen so worth order differs from name order (Cloth, Copper Ore, Herb), or the case
  // would pass with no sorting.
  it('ranks by what each kind is worth', async () => {
    const h = await start({ carry: threeKinds });
    h.publish('items', [
      { id: 'ore', name: 'Copper Ore', sellValue: 100 },
      { id: 'cloth', name: 'Cloth', sellValue: 500 },
    ]);
    await h.settle();
    chooseIn('sort', 'Worth');
    await h.settle();

    // Ore: 60 at 100 is 60s. Cloth: 5 at 500 is 25s. Herb is unpriced and sinks.
    expect(keysIn('items')).toEqual(['ore', 'cloth', 'herb']);
  });

  // Never a mixture of sources: market and vendor figures differ by tens.
  it('ranks on the market figure once the pane is drawing one', async () => {
    const h = await start({ carry: threeKinds });
    h.publish('items', [
      { id: 'ore', name: 'Copper Ore', sellValue: 10 },
      { id: 'cloth', name: 'Cloth', sellValue: 500 },
    ]);
    h.publish('price', { id: 'ore', realm: REALM, unit: 4000, at: WALL_CLOCK_MS }, PRICER);
    await h.settle();
    chooseIn('sort', 'Worth');
    await h.settle();

    // Ore is 60 at 40s on the counter. Cloth has only a vendor floor, so it ranks as nothing here.
    expect(keysIn('items')).toEqual(['ore', 'cloth', 'herb']);
    expect(detailOf('items', 'cloth')).toBe('no recorded price');
  });

  // The figure the order was taken on must be on screen under each row.
  it('puts the figure it sorted on under each row', async () => {
    const h = await start({ carry: threeKinds });
    h.publish('items', [{ id: 'ore', name: 'Copper Ore', sellValue: 10 }]);
    await h.settle();

    expect(detailOf('items', 'ore')).toBe('bags 60');

    chooseIn('sort', 'Worth');
    await h.settle();
    expect(detailOf('items', 'ore')).toBe('6s');

    chooseIn('sort', 'Cells');
    await h.settle();
    expect(detailOf('items', 'ore')).toBe('60 in 3 cells');

    chooseIn('sort', 'Last seen');
    await h.settle();
    expect(detailOf('items', 'ore')).toBe('last read moments ago');
  });

  it('names the order in the sentence about the cap', async () => {
    const h = await start({ carry: { inventory: manyKinds(MAX_ITEM_ROWS + 3) } });
    await h.settle();
    chooseIn('sort', 'Copies');
    await h.settle();

    expect(lineFor('items-note')).toBe(
      'The first 40 by copies. Search or pick a character for the rest.',
    );
  });
});

// Un-pooling the index to one character.
describe('narrowing the index to one character', () => {
  const withAlt = (): FakeStorage => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        sources: {
          bags: snapshot({ stacks: [...cells('ore', 20, 2), ...cells('silk', 7)] }),
          bank: snapshot({ at: 0 }),
          mail: snapshot({ at: 0 }),
        },
      }),
    );
    return storage;
  };

  it('drops the rows that character holds none of', async () => {
    const h = await start({ storage: withAlt(), carry: { inventory: cells('cloth', 5) } });
    await h.settle();
    expect(keysIn('items')).toEqual(['cloth', 'ore', 'silk']);

    chooseIn('who', 'Alt');
    await h.settle();

    expect(keysIn('items')).toEqual(['ore', 'silk']);
  });

  // The figures follow the filter: Alt's copies, not the account's.
  it('counts that character copies rather than the account', async () => {
    const h = await start({ storage: withAlt(), carry: { inventory: cells('ore', 9) } });
    await h.settle();
    expect(figureOf('items', 'ore')).toBe('49');

    chooseIn('who', 'Alt');
    await h.settle();

    expect(figureOf('items', 'ore')).toBe('40');
    expect(statFor('items-held')).toBe('47');
  });

  // The roster total reads the same index on the same paint, so the filter must not narrow it in
  // place.
  it('leaves the roster account total alone', async () => {
    const h = await start({ storage: withAlt(), carry: { inventory: cells('ore', 9) } });
    h.publish('items', [{ id: 'ore', name: 'Copper Ore', sellValue: 100 }]);
    await h.settle();
    const before = statFor('account-worth');

    chooseIn('who', 'Alt');
    await h.settle();

    expect(statFor('account-worth')).toBe(before);
    expect(statFor('items-worth')).not.toBe(before);
  });

  it('says whose list is empty when a search matches nothing under the filter', async () => {
    const h = await start({ storage: withAlt(), carry: { inventory: cells('cloth', 5) } });
    await h.settle();
    chooseIn('who', 'Alt');
    typeSearch('cloth');
    await h.settle();

    expect(lineFor('items-note')).toBe('Nothing on Alt matches that.');
  });

  // One character is not a choice, as on the Bags selector.
  it('stays off the panel while there is only one character', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    expect(shownIn('[data-role="who"]')).toBe(false);
  });
});

// The fill measures what the list is ordered on: fill, second line and order are one fact.
describe('what a row fill measures', () => {
  // Herb is three to a cell, so its copy and cell counts differ and the cells order is testable.
  const mixed = {
    inventory: [...cells('ore', 20, 3), ...cells('cloth', 5), ...cells('herb', 3, 2)],
  };

  it('is the copy count while the list is alphabetical', async () => {
    const h = await start({ carry: mixed });
    await h.settle();

    expect(fillOf('items', 'ore')).toBe('100.00%');
    expect(fillOf('items', 'cloth')).toBe('8.33%');
  });

  it('follows a worth order rather than staying on copies', async () => {
    const h = await start({ carry: mixed });
    h.publish('items', [
      { id: 'ore', name: 'Copper Ore', sellValue: 1 },
      { id: 'cloth', name: 'Cloth', sellValue: 500 },
    ]);
    await h.settle();
    chooseIn('sort', 'Worth');
    await h.settle();

    // Cloth is 25s against ore's 60c, so the sixty ore draw the short bar.
    expect(fillOf('items', 'cloth')).toBe('100.00%');
    expect(fillOf('items', 'ore')).toBe('2.40%');
  });

  it('follows a cells order', async () => {
    const h = await start({ carry: mixed });
    await h.settle();
    chooseIn('sort', 'Cells');
    await h.settle();

    expect(fillOf('items', 'ore')).toBe('100.00%');
    expect(fillOf('items', 'herb')).toBe('66.67%');
  });

  // An age has no zero point, so every bar would be nearly full.
  it('draws none at all under an order that has no zero', async () => {
    const h = await start({ carry: mixed });
    await h.settle();
    chooseIn('sort', 'Last seen');
    await h.settle();

    expect(fillOf('items', 'ore')).toBe('0.00%');
  });

  // The denominator is everything matched, so the row cap cannot rescale the pane. Only name order
  // shows this: every other order is descending, so the largest row is always drawn.
  it('is not rescaled by the row cap', async () => {
    const h = await start({
      carry: { inventory: [...manyKinds(MAX_ITEM_ROWS + 3), ...cells('zzz_big', 20, 5)] },
    });
    await h.settle();

    // The biggest pile is past row 40 and still sets the scale.
    expect(keysIn('items')).not.toContain('zzz_big');
    expect(fillOf('items', 'kind_00')).toBe('1.00%');
  });
});

// Copper waiting in letters, counted by the totals.
describe('money in the post', () => {
  const withPost = (copper: number): Partial<CarryState> => ({
    mail: mailPayload({
      totalCount: 1,
      messages: [letter({ id: 7, copper, items: [] })],
    }),
  });

  it('totals what the letters in a mailbox are carrying', async () => {
    const h = await start({ carry: withPost(14_025) });
    await h.settle();

    expect(statFor('mail-post')).toBe('1g 40s 25c');
  });

  it('counts it across every character on the roster strip', async () => {
    const h = await start({ carry: withPost(14_025) });
    await h.settle();

    expect(statFor('account-post')).toBe('1g 40s 25c');
  });

  // Beside the carried total, not added in: an attachment is carried by nobody.
  it('keeps it out of the carried figure and says where it went', async () => {
    const h = await start({ carry: { copper: 5000, ...withPost(14_025) } });
    await h.settle();

    expect(coinsAt('account')).toBe('50 silver');
    expect(tipOver(barAt('account'))).toContain('attached to letters in a recorded mailbox');
  });

  it('draws no figure at all for a mailbox holding no coin', async () => {
    const h = await start({ carry: withPost(0) });
    await h.settle();

    expect(shownAt('mail-post')).toBe(false);
    expect(shownAt('account-post')).toBe(false);
  });
});

// The two panes that can show another character say whose money they are showing.
describe('whose money a pane is about', () => {
  it('names it on the bank pane', async () => {
    const h = await start({ carry: { copper: 5000, bank: bankPayload({}) } });
    await h.settle();

    expect(statFor('bank-purse')).toBe('50s');
  });

  it('names it on the mail pane', async () => {
    const h = await start({ carry: { copper: 5000, mail: mailPayload({ totalCount: 0 }) } });
    await h.settle();

    expect(statFor('mail-purse')).toBe('50s');
  });

  it('follows the character the pane is pointed at', async () => {
    const storage = createFakeStorage();
    seed(
      storage,
      storedCharacter('Alt', {
        copper: 900,
        sources: {
          bags: snapshot(),
          bank: snapshot({ stacks: cells('ore', 20) }),
          mail: snapshot({ at: 0 }),
        },
      }),
    );
    const h = await start({ storage, carry: { copper: 5000 } });
    await h.settle();
    choose('Alt');
    await h.settle();

    expect(statFor('bank-purse')).toBe('9s');
  });
});
