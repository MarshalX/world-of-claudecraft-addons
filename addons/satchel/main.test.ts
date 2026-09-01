// @vitest-environment happy-dom

// Satchel, run through the real loader.
//
// The storage cases come first because the addon is a record before it is a panel, and the one
// that matters most is `keeps a recorded bank when the player walks away`. The server sends
// nothing for a counter the player is not standing at, so an addon that recorded `away` as an
// empty bank would erase a character's deposit box every time they took three steps. Every
// write path here is asserted on the store rather than on the screen, because a pane redrawn
// from memory looks identical whether or not the write behind it was right.
//
// The cross-character cases are the product. The game's own bag window aggregates your bags, so
// a panel that draws them earns nothing; what the client cannot do is show another character's
// inventory, show a bank you are not standing at, or say where your copy of something is.
// Those three are asserted with the addon logged in as somebody the stored rows are not about.
//
// Age is part of the answer. A bank from three days ago is useful and must never be presented
// as current, so every stored reading carries a stamp and every pane says how old it is. The
// stamp is a wall clock reading and the suite pins that against the monotonic one: the two are
// far apart here on purpose, because a row stored in one session and read in the next is
// exactly the case a monotonic stamp gets silently wrong.
//
// The grid is how one character's store is read, and every claim it makes is checkable without
// an item ever being named: one square per pooled cell, art requested per square from
// `ui.icon.item`, the player's own placement honoured where the game recorded one, the stack
// count in the corner, and the marks derived from ids alone. The art case that matters is the
// failing one: not every item ships a painted file, so a square whose icon 404s has to stay a
// readable occupied cell.
//
// This addon is the first bus consumer in the catalogue, so what it does with a publisher that
// is not there is the contract every consumer after it copies. The cases pin all three rules:
// it draws with nobody publishing, it takes an answer from a fork's fqid rather than only from
// the official one, and its ask goes out after its subscriptions. They also pin the order: a
// publisher outranks the art name, because the art name is provenance for a picture.

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
 * The key a record is filed under: the channel, then what the loader derives.
 *
 * The realm is the one the shared `HELLO_FRAME` carries, which is what the world hub in
 * `tests/fakes` derives the character key from, exactly as `runtime/surfaces.ts` wires it in
 * the loader. What this suite proves is the half that is this addon's: one record per character
 * per deployment, and the loader's half of the key coming from the loader rather than from a
 * second derivation of its own.
 *
 * `pbe/` because that is the channel the shared harness reports, and it is in the key because
 * the account-wide namespace is the one the loader adds nothing to.
 */
const CHANNEL = 'pbe';
const CHARACTER_KEY = `${CHANNEL}/Claudemoon/Marshal`;
/** The field on the player entity the loader's key derivation reads. */
const PLAYER_NAME_FIELD = 'name';
/** A fork's fqid on purpose: a consumer that named the official one would miss it. */
const PUBLISHER = 'someone/lorebind';
/** The price publisher, a second addon entirely: names and prices are two protocols. */
const PRICER = 'someone/ledgerline';
/** The realm the shared hello frame carries, which is what a price record has to match. */
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

/**
 * What each bag in the fixture adds, from the shipped table rather than transcribed, so the fake
 * world's `bagCapacity` and the addon's pool arithmetic read the same bag.
 */
const BAG_SLOTS = new Map<string, number>([
  ...TABLE.bags.map((bag): [string, number] => [bag.id, bag.slots]),
  [FUTURE_BAG, FUTURE_BAG_SLOTS],
]);

/** A general bag, a smaller general bag, and a materials-only satchel, by what they do here. */
const BIG_BAG = 'wayfarers_backpack';
const MID_BAG = 'gravewoven_bag';
const SMALL_BAG = 'linen_pouch';
const REAGENT_BAG = 'burlap_reagent_pouch';
/** An id the game counts as a material, which is the only thing a reagent satchel will take. */
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
  /** The cell the player dragged it into. Absent for anything never placed by hand. */
  slot?: number;
  /**
   * The per-copy payload. Only your own bags and bank carry an untrimmed one, which is why the
   * lock can be read there and nowhere else; a letter's attachments arrive already projected.
   */
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
   * Every fixture honours the two decoder invariants rather than defending against them:
   * general plus materials is `capacity`, and the two used counts sum to `slots.length`.
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
   * The three gated reads, where null is what the server sends: not "an empty bank" and not "no
   * bank", but a payload that is simply absent for a player who is not standing at the counter.
   * The vault is its own gate, so a case can put a null vault beside a live bank, which is what
   * an undecodable vault payload looks like.
   */
  bank: BankPayload | null;
  vault: VaultPayload | null;
  mail: MailPayload | null;
  /** Ungated, so it is a plain number that is readable from anywhere in the world. */
  mailUnread: number;
  /**
   * What crafting may draw from the vault HERE. Not a proximity state and not banker-gated: a
   * record means the draw is allowed, an empty record means allowed with nothing to draw, and
   * null means refused where the player is standing.
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
  /** The vault's counts, sorted by id on the way in so a stored copy is already ordered. */
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
  /** Which market this character's things sit on, which is what a published price applies to. */
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

/** The same stack with the owner's lock on it, as the game sends one from your own bags. */
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
 * A bank as the server sends one, with only the figures a case cares about named. The split
 * defaults to all general and the used counts to `slots`, so a case that says nothing about
 * pools still obeys both decoder invariants.
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

/**
 * A stock record from entry pairs, since an object literal keyed by item ids fails
 * `useNamingConvention`. See STYLE.md.
 */
function stockOf(...rows: [string, number][]): Record<string, number> {
  return Object.fromEntries(rows);
}

/** A vault as the server sends one. Locked is `upgrades: 0` with a cap of nothing. */
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
 * A character stored by a previous session, under the loader's own key shape. On a realm rather
 * than `offline/`, because the point of every case that uses one is that it is somebody the
 * suite is not logged in as. The bank and the mailbox default to `at: 0`, which is the ordinary
 * state: bags are recorded every login and a counter only if the character walked up to one.
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
    // Merged rather than replaced, so a case naming one store gets the other three at their
    // ordinary state.
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
  /** Leave the world out, which is where an addon's first line actually runs. */
  world?: boolean;
  /**
   * Leave the shipped pool table unserved, which is every session's first moment and what a
   * failed read leaves behind.
   */
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
  /** Another tab writing a setting, which is how one actually changes. */
  settingsChanged: (values: Record<string, unknown>) => void;
  /**
   * Somebody else is playing now, without a page load. A real state: the game clones and removes
   * its HUD rather than reloading, so an addon holding a per-character view stays running.
   */
  switchCharacter: (name: string) => void;
}

/**
 * Let every queued microtask run, without an await inside a loop. The addon reads its stored
 * characters through `storage.keys()` and then one `get` per character, so its start-up is
 * several promise hops deep and a fixed pair of flushes would settle it only by luck.
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

/** How far a row's fill runs, which is the one thing a bar says that its text does not. */
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
 * An amount as the kit announces it, which is the only readable form of a drawn one. A
 * `{ copper }` value is coin discs and bare digits, so its `textContent` is the figures run
 * together with nothing to say which unit each belongs to.
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

/**
 * Whether a figure is on screen at all. A worth of nothing is not drawn as `0c`, so the cases
 * about silence assert on this rather than on the figure.
 */
function shownAt(role: string): boolean {
  const el = barAt(role);
  return el !== null && !el.hidden;
}

/** A computed read, because a `DOMStringMap` is an index signature. See STYLE.md. */
function dataOf(el: HTMLElement | null, key: string): string {
  return el?.dataset[key] ?? '';
}

/** The chip's own word, which changes with what its figure MEANS. */
function statLabel(role: string): string {
  const chip = document.querySelector(`[data-role="${role}"]`);
  return chip?.querySelector('.woc-satchel-stat-label')?.textContent ?? '';
}

/** The urgency on a chip, which is an attribute beside the colour rather than the colour. */
function statTone(role: string): string {
  return dataOf(document.querySelector<HTMLElement>(`[data-role="${role}"]`), 'tone');
}

function detailOf(list: string, key: string): string {
  return partOf(rowIn(list, key), '.woc-bar-detail');
}

/**
 * A row's urgency, which the kit carries as a class; the colour behind it is a stylesheet rule a
 * suite cannot read.
 */
function barTone(list: string, key: string): string {
  const row = rowIn(list, key);
  const found = [...(row?.classList ?? [])].find((one) => one.startsWith('woc-bar-'));
  return found?.slice('woc-bar-'.length) ?? '';
}

function lineFor(role: string): string {
  return document.querySelector(`[data-role="${role}"]`)?.textContent ?? '';
}

/**
 * One figure off a status strip, without the label beside it. Separate from `lineFor` because a
 * chip is a label and a figure in one element: the label is chrome and the figure is the claim.
 * What the chip's full sentence says is pinned through its tooltip instead.
 */
function statFor(role: string): string {
  const chip = document.querySelector(`[data-role="${role}"]`);
  return chip?.querySelector('.woc-satchel-stat-value')?.textContent ?? '';
}

/**
 * Every square in one grid, in the order it is drawn. Scoped by grid, because there are two of
 * them: the bags and the bank are the same widget over different stores, and an unscoped
 * `[data-cell]` would answer about whichever happened to be in the document first.
 */
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
 * Whether the square has an accessible name at all. Separate from `nameAt` on purpose: a tile
 * put back to unnamed carries no `aria-label` and is `aria-hidden`, while a tile named the empty
 * string carries an empty `aria-label` and stays in the accessibility tree announcing nothing.
 * `getAttribute(...) ?? ''` answers `''` for both.
 */
function namedAt(at: number): boolean {
  return cellAt(at)?.hasAttribute('aria-label') ?? false;
}

/** A square with no name is hidden from assistive technology, which is the pair of it. */
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
 * The mark is a corner PIP rather than the cell's border, since the border carries the item's
 * quality tier and the kit lets a tone beat one. Split, spare and carried are annotations
 * rather than urgency, so the tone on a square is the free-slot warning and nothing else.
 */
function markedAt(at: number): boolean {
  return markedIn('bags', at);
}

/** Whether the padlock is drawn on the square, which is a shape rather than a tint. */
function lockedAt(at: number): boolean {
  const mark = cellAt(at)?.querySelector<SVGElement>('[data-satchel-lock]');
  return mark !== null && mark !== undefined && mark.style.display !== 'none';
}

/** Whether the square reads as holding something, art or no art. */
function occupiedAt(at: number): boolean {
  return cellAt(at)?.style.borderStyle === 'solid';
}

/** The confirmation the loader draws, which is a real modal in the document rather than a fake. */
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
 * Where the unread badge lives, because a tab strip is built once and cannot move. The
 * `aria-label` rather than the drawn title, since `setTitle` writes both and the accessible name
 * is the one that survives a bare density having no title bar.
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

/**
 * The character selector, which is how a pane is pointed at somebody else.
 *
 * A dropdown is the loader's own button and menu rather than a native `<select>`, so reading
 * what it offers and choosing from it are both clicks. See tests/fakes/controls.ts.
 */
function picker(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-role="picker"]');
}

/**
 * Open a tab the way a player does. Every pane is in the document at once and the suite reads
 * them all without switching, so this exists for the one thing that depends on WHICH is open:
 * the character selector, which belongs to the three per-character panes.
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

/** The addon's own cap on drawn rows, which is what the sentence under the list is about. */
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
 * Make the item art manifest answer, which the shared fake's never does. `tests/fakes` hands the
 * icon builders a fetch that never settles, so `itemArtName` is permanently null there: the same
 * state the loader is in before the manifest lands. A Map from entry pairs because every key in
 * it is an item id.
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

/**
 * The game's own world object, with the pooled capacity as a getter, because that is what the
 * loader reads through: the suite changes the bags and the capacity moves with them, exactly as
 * it does when a player equips one.
 */
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
    // The wire names, which are what the loader reads off the game's own world
    // object: `bank` and `mail` on the snapshot become these on the client.
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
  // What a real session sends first. The addon reads nothing off it: a record is keyed on
  // `world.characterKey`, which the loader derives from the realm and the player's name, so that
  // a second addon keeping its own per-character record cannot disagree about whose it is.
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
    // A computed key because `liveEntity` hands back a `Record<string, unknown>`, and
    // `noPropertyAccessFromIndexSignature` refuses the dotted form.
    switchCharacter: (name) => {
      player[PLAYER_NAME_FIELD] = name;
    },
  };
}

/**
 * One character's record as it landed in the store. Typed as present rather than optional, and
 * the cases that are about absence go through `storedKeys` instead: a suite that reached for `?.`
 * on every field would pass a case that wrote nothing at all.
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

// The addon is a record before it is a panel, and every case here asserts on the
// STORE rather than on the screen: a pane redrawn from memory looks identical whether
// or not the write behind it was right.
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

  // There is nobody to file a record under before world entry, so one written there
  // would be attributed to whoever logged in next.
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

  // The case this feature lives or dies on. The server sends nothing for a counter the player is
  // not standing at, so `away` is not an empty bank: recording it as one would wipe a
  // character's deposit box every time they took three steps.
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

  // Written flat rather than under a nested payload of one boolean, and written only when it is
  // true: this store holds every character's bags, and the shape has to stay cheap.
  it('writes down which copies are locked', async () => {
    const h = await start({
      carry: { inventory: [...lockedCells('ore', 20), ...cells('ore', 3)] },
    });
    await h.settle();

    const [first, second] = storedFor(h).sources.bags.stacks;
    expect(first?.locked).toBe(true);
    expect(second?.locked).toBeUndefined();
  });

  // The whole reason to record it is the character you are NOT logged in as: you cannot log in
  // as somebody else to find out whether the stack you were about to salvage is the one they
  // protected. A stored cell spells the flag flat, so reading one back is its own case.
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

  // The other closed arm. Nothing has decoded, so there is no reading to record and
  // no claim to make about one.
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

  // A wall clock stamp, not a monotonic one, and the two are far apart in this suite on purpose:
  // `woc.now()` reads 1234 here and the wall clock reads a real epoch. A record is stored in one
  // session and read back in the next, where a monotonic reading renders as a moment in 1970.
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

  // A character and its PBE copy have the same realm and the same name, so `world.characterKey`
  // cannot tell them apart: that string is what the loader puts inside
  // `perCharacterKey(channel, ...)` for the two namespaces it owns, and this addon files under
  // the account-wide one. Without the channel here the two share a record, whichever was played
  // last overwrites the other, and every pane goes on stamping it with the time it was read.
  //
  // The stored row is what this asserts on, not the screen: a pane redrawn from one merged
  // record looks exactly like a pane redrawn from the right one.
  it('records a character and its copy on another channel apart', async () => {
    const storage = createFakeStorage();
    // The same realm and the same name as the character in play, on the other
    // deployment. A PBE copy is how a player ends up holding both.
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
    // This session wrote its own row and left the other deployment's alone.
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

// The product. Only the character you are logged in as exists on the client, so an
// alt's bags are unreachable to the game and reachable here.
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
          // 16 backpack plus the 12 cell bag socketed; a total that did not add up reads as a
          // stale table on the line this case asserts.
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

  // The picker follows the character in play unless the player has deliberately
  // pointed it somewhere, because a panel still showing the character you just logged
  // out of is answering a question nobody asked.
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

// The one gated read the game refuses you when you step away, answered from what was
// recorded when you were there.
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

  // The improvement the whole rework is for: the previous version drew a blank pane
  // here, which is the one thing the client already does.
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

  // Computable from ids alone, like the other two marks, and one-directional on
  // purpose: the bags do not mark what is banked, because that reading comes and goes.
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

// The question a player with alts actually asks, and the one nothing in the game can
// answer: where is my copy of this.
describe('the index across every character', () => {
  // The aggregation, which is the opposite arithmetic to the capacity bar's and must
  // never share it. Six cells of ore over two stores and two characters is ONE row
  // reading the total; the same six cells are six cells to the Bags pane.
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
    // The same six cells, counted as cells, by the pane whose question that is.
    expect(itemsInGrid().filter((held) => held === 'ore')).toHaveLength(3);
  });

  // A row is one line, so the fold goes one level further than the tooltip's: a
  // character holding some in their bags and some in their bank is one name and one
  // figure there, and two lines under the pointer.
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
    // The STORE rather than the name: one character is recorded, so naming them on every row
    // would restate the figure beside it and leave which of the three stores holds it unsaid.
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

// The selector is a labelled full-width row on three of the five tabs, and with one character
// recorded it offers one option: a control asking a question that has one answer, on a pane
// whose own age line already names whose reading it is drawing.
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
 * Both vault keys are delta-omitted, so a snapshot that leaves the vault out means UNCHANGED
 * rather than gone; the loader holds the last reading, and these cases prove the addon does not
 * throw it away on its own.
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

  // The record round-trips through the server's database and comes back re-ordered, so it is
  // sorted on the way in and the stored copy is ordered too.
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

  // An undecodable vault payload is dropped to null and arrives as 'away' while an undecodable
  // bank payload leaves the previous one standing, so a null vault beside a live bank is real.
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

  // The bank is deliberately unchanged between the two settles, so only the vault's own key
  // could have driven the repaint.
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

  // The one field that tells two identity-bearing rows of the same item id apart.
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

/**
 * Three states: an empty record means the draw is allowed and the vault is empty, and null
 * means it is refused where the player is standing.
 */
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

// An item's total spans everything owned, so a stockpile outside bags and bank makes it short.
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

  // `stacksIn` records the largest stack it sees and the Bags pane merges against that maximum,
  // and a vault count of 240 is not evidence that a 240 stack can exist.
  it('does not learn a stack maximum from a pooled vault count', async () => {
    const h = await start({
      carry: {
        inventory: cells('copper_ore', 20, 3),
        vault: vaultPayload({ stock: stockOf(['copper_ore', 240]) }),
      },
    });
    await h.settle();

    // Three cells of twenty against a maximum of twenty frees nothing; a maximum of 240 would
    // offer to merge them into one.
    const said = tipOver(cellAt(0));

    expect(said).toContain('Merging them would free nothing');
  });
});

/**
 * The bank's split is sent rather than derived; `capacity` stays one pooled number the game's
 * own source says is never a fit answer.
 */
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

    // 20 of 40 in use and every free cell is materials-only, so the pooled twenty is zero for
    // anything else.
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

  // Unlocking a socket adds no slots, so this chip is the only figure that reports the purchase.
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

  // A socket unlock moves no other figure, so a signature that leaves it out never notices one.
  it('writes the record down for a socket unlock that moves nothing else', async () => {
    const h = await start({ carry: { bank: bankPayload({ socketsUnlocked: 1 }) } });
    await h.settle();
    expect(storedFor(h).sources.bank.unlocked).toBe(1);

    h.carry({ bank: bankPayload({ socketsUnlocked: 2 }) });
    await h.settle();

    expect(storedFor(h).sources.bank.unlocked).toBe(2);
    expect(statFor('bank-sockets')).toBe('2 / 4');
  });

  // Absent rather than null on the wire, and absent means the gold price is the only one to
  // show, not that the rung is unavailable.
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

  // The class and the level ride the player entity and were not being written down, so a roster
  // could only say what its characters were called. A record from before this reads as neither
  // and draws the same row it always did rather than a guess.
  it('says what class and level a character is once one has been recorded', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();

    expect(detailOf('roster', CHARACTER_KEY)).toContain('20 Hunter');
  });

  // ONE meaning per bar. The fill has been wrong twice: first the share that was FREE, which
  // inverts on sight, then the share of the account's COIN, which fixed the inversion by
  // changing the quantity rather than the direction and left length and colour measuring two
  // unrelated things with a label for neither. It is how full that character is, and the tone
  // is the same fact escalating.
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

  // The coin is DRAWN at the end of the row and the bar no longer measures it, so the one
  // thing that has to be true is that a rich character with room does not draw a long bar.
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
    // Asserted BEFORE the button is pressed: without it the case passes on an addon that
    // forgets from the click and never asks, since pressing a button that is not there is
    // indistinguishable from pressing one that is.
    expect(keysIn('roster')).toHaveLength(2);
    expect(modalMessage()).toContain('1 character will be dropped');
    pressModal('Forget them');
    await h.settle();

    expect(keysIn('roster')).toEqual([CHARACTER_KEY]);
    expect(storedKeys(h)).toEqual([CHARACTER_KEY]);
  });

  // There is no undo and no second copy: a record comes back only by playing that character
  // again, and its bank only by walking them to one. One click used to be the whole gesture.
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

  // A list of characters cannot answer "how much of anything do I have", which is the
  // question having alts creates. The arithmetic is stated in each case before it is
  // asserted, the way the free-slot cases state theirs.
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

  // The totals are sums over readings taken at different times and no total can say
  // so, which is why the oldest of them is named where the sum is explained.
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

  // The totals do not replace this: one character summed is one character, and the
  // line that says so is what tells a new player the tab is not broken.
  it('keeps saying there is only this character while there is', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 5) } });
    await h.settle();

    expect(statFor('roster-characters')).toBe('1');
    expect(lineFor('roster-note')).toContain('Only this character so far');
  });
});

// The figures in each pane are chips, and nothing was dropped on the way: each case here pins
// the sentence a chip replaced, at the hover it moved to. The two that stayed sentences on
// screen are the panel's honesty rather than its arithmetic, and they are pinned in the age and
// note cases above.
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

  // The apostrophe is the proof the name was read from the shipped table rather than
  // title-cased from the id.
  it('names what is in each bag socket under the pointer', async () => {
    const h = await start({ carry: { bags: [BIG_BAG, null, null, null] } });
    await h.settle();

    const said = tipOver(document.querySelector('[data-role="sockets"]'));

    expect(said).toContain("Socket 1: Wayfarer's Backpack");
    expect(said).toContain('Socket 2: empty');
  });
});

// The one figure a player checks against the game's own bag window. Every case here
// states its arithmetic before it asserts it.
describe('the free-slot count', () => {
  it('pools the backpack and every equipped bag, and an empty socket adds nothing', async () => {
    // 16 backpack + 16 + 0 (empty socket) + 12 + 6 = 50 cells.
    const h = await start({
      carry: {
        bags: [BIG_BAG, null, MID_BAG, SMALL_BAG],
        // 10 cells of ore and 27 of cloth is 37 cells in use.
        inventory: [...cells('ore', 20, 10), ...cells('cloth', 4, 27)],
      },
    });
    await h.settle();

    expect(capacityValue()).toBe('37 / 50');
    expect(capacityDetail()).toBe('13 free');
  });

  // One entry is one cell whatever the stack holds, so three stacks of twenty is three cells and
  // not sixty: summing the counts would report a 16 cell backpack as 44 slots overdrawn while
  // the player has 13 free.
  it('counts a stack as one cell however much is in it', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 3) } });
    await h.settle();

    expect(capacityValue()).toBe('3 / 16');
    expect(capacityDetail()).toBe('13 free');
  });

  // `bagCapacity` is read straight through and has no watch key of its own, so an
  // addon that waited for one would never notice a bag being equipped.
  it('follows a bag being put into an empty socket', async () => {
    const h = await start({ carry: { inventory: cells('ore', 1, 4) } });
    expect(capacityValue()).toBe('4 / 16');

    h.carry({ bags: [MID_BAG, null, null, null] });
    await h.settle();

    expect(capacityValue()).toBe('4 / 28');
    expect(capacityDetail()).toBe('24 free');
  });

  it('never reports a negative free count', async () => {
    // A bag being unequipped with its contents still in the pool is the shape this
    // guards: 20 cells against a 16 cell backpack.
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
 * The arithmetic is the game's own (src/sim/bag_pools.ts): materials pack into the materials
 * pool first and spill into the general one, so `Free` is the general headroom and what only a
 * material can reach is its own chip beside it.
 */
describe('the two carried pools', () => {
  it('does not offer reagent-satchel room to a non-material', async () => {
    // 16 backpack + 6 general = 22 general, plus an 8 cell reagent satchel = 30 pooled. 22
    // swords fill the general pool exactly, so the pooled reading says 8 free and the honest
    // answer is that nothing but a material fits at all.
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
    // The same 22 general and 8 materials, holding 20 swords and 2 stacks of ore. The ore packs
    // into the satchel first, so the general pool is 20 of 22 rather than 22 of 22.
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

  // A bag the table knows whose slot count the game changed: only the derived budget disagreeing
  // with the world's can catch it, and which bag moved is not knowable.
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

    // 21 of 22 general cells in use with the satchel empty: one free, under the two asked for,
    // where the pooled reading says nine.
    h.carry({ inventory: cells('sword', 1, 21) });
    await h.settle();

    expect(played).toHaveBeenCalledTimes(1);
    expect(statTone('free')).toBe('warn');
  });
});

// Everything here holds with nobody having named a single item, which is the whole
// reason a store is drawn as a grid.
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

  // The one thing an item id CAN be turned into. There is no name behind it and there
  // is art, which is what the grid is built on.
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

  // Not every item ships a painted file, so this is an ordinary outcome rather than a
  // fault. The kit hides its own image slot; what has to survive is the square still
  // reading as a cell with something in it.
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

  // `InvSlot.slot` is where the player dragged it, and it is absent for anything never
  // moved by hand, so a hinted stack takes its cell and the rest flow in.
  it('honours the cell a stack was dragged into', async () => {
    const h = await start({
      carry: { inventory: [{ itemId: 'ore', count: 20, slot: 5 }, ...cells('cloth', 5)] },
    });
    await h.settle();

    expect(itemsInGrid()[5]).toBe('ore');
    expect(itemsInGrid()[0]).toBe('cloth');
  });

  it('ignores a placement hint pointing outside the bags it has', async () => {
    // Slot 40 is a cell a 16 slot backpack does not have: a hint left over from a
    // larger bag that has since come off would otherwise place the stack nowhere.
    const h = await start({
      carry: { inventory: [{ itemId: 'ore', count: 20, slot: 40 }] },
    });
    await h.settle();

    expect(itemsInGrid()[0]).toBe('ore');
    expect(gridCells()).toHaveLength(16);
  });

  // A tile's accessible name is otherwise only ever written, so a square reused from an occupied
  // one announces the item it last held. Asserted on the ATTRIBUTE rather than its value:
  // `label: null` is unnamed, `label: ''` is a name that is blank, and both read as `''`
  // through `getAttribute(...) ?? ''`.
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

  // The cells are positional and are never reordered, so a repaint reuses the element
  // that is already in that square: one removed and re-inserted loses whatever the
  // browser was tracking on it, hover included.
  it('keeps the same element in a square across a repaint', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();
    const before = cellAt(0);

    h.carry({ inventory: [...cells('ore', 20), ...cells('cloth', 5)] });
    await h.settle();

    expect(cellAt(0)).toBe(before);
  });
});

// The panel has to survive being dragged to a size the author never saw, and every
// case here is about that rather than about what is drawn. They are asserted on the
// INLINE styles the addon writes, never on a stylesheet rule: a `.css` import resolves
// to the empty string under vitest, so a suite cannot read a selector at all.
describe('its layout', () => {
  // `setShown` must not write `display: flex` whenever it shows anything: the bag grid goes
  // through it, so a helper written that way lays 72 squares out in one row and stretches the
  // content-sized frame to about 1800 pixels.
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

  // A hidden grid is hidden BOTH ways, and the two halves answer different readers: `hidden`
  // is what takes it out of the accessibility tree, and the class is what takes it off the
  // screen. `hidden` alone cannot do the second job, since it is a UA rule at the lowest
  // priority there is and this grid carries an inline `display: grid` that beats it outright.
  // The class is the loader's `woc-hidden`, which carries !important for that exact reason;
  // a suite cannot read the rule, so what is checked here is that both marks are on.
  it('hides a grid there is nothing to draw in', async () => {
    await start({ world: false });

    expect(gridEl('bags')?.classList.contains('woc-hidden')).toBe(true);
    expect(gridEl('bags')?.hidden).toBe(true);
  });

  // A wrapping track list rather than a column count, so the squares follow the frame
  // as it is dragged with no measurement and no resize handler in the addon at all.
  //
  // The 42 is `woc.ui.itemCell`, the game's own bag cell, written out rather than read
  // from the loader: the number is what a player sees, so a change to it has to fail
  // here and send somebody to re-capture the preview rather than passing silently.
  it('fits as many squares across as the frame is wide', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    expect(gridEl('bags')?.style.gridTemplateColumns).toBe('repeat(auto-fill, 42px)');
  });

  // A frame states no size bounds and takes the size it OPENED at as its floor, so
  // these are what make it draggable smaller than its first paint at all.
  it('is resizable, and the loader therefore writes it a box', async () => {
    const h = await start();
    await h.settle();

    expect(frameEl()?.style.width).not.toBe('');
    expect(frameEl()?.style.height).not.toBe('');
  });

  // Comfortable is the game's own desktop scale, and this panel sits open beside the game's
  // windows rather than being glanced at mid-fight. The two size constants above are measured
  // against this density, so moving to compact means re-measuring them.
  it('draws at the game’s own scale rather than tighter than it', async () => {
    await start();

    expect(frameEl()?.className).toContain('woc-density-comfortable');
    expect(frameEl()?.className).not.toContain('woc-density-compact');
  });

  // The list is what scrolls, not the pane above it: a tab strip that scrolls away is
  // one the player has to scroll back to before they can leave the tab.
  it('scrolls the list in each pane and leaves the tab strip alone', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    expect(gridEl('bags')?.style.overflowY).toBe('auto');
    expect(listEl('items')?.style.overflowY).toBe('auto');
    expect(listEl('mail')?.style.overflowY).toBe('auto');
    expect(listEl('roster')?.style.overflowY).toBe('auto');
    expect(document.querySelector<HTMLElement>('.woc-tabs')?.style.overflowY).toBe('');
  });

  // A flex column SHRINKS its children to fit before it will scroll, so without this
  // forty rows in a list half that tall are forty rows squashed to half a line each,
  // clipped by the bar's own `overflow: hidden`, with no scrollbar to say what
  // happened. happy-dom lays nothing out, so the shrink factor is what is checkable
  // here; the shot on the stage is what shows it.
  it('refuses to shrink the rows in a scrolling list', async () => {
    const h = await start({ carry: { inventory: [...cells('ore', 20), ...cells('cloth', 5)] } });
    await h.settle();

    expect(rowIn('items', 'ore')?.style.flexShrink).toBe('0');
    expect(rowIn('items', 'cloth')?.style.flexShrink).toBe('0');
  });

  // The loader's own sheet fills a WINDOW's body and gives a frame's `flex: 0 1 auto`,
  // because a frame is normally sized by what it draws. This one states a height and is
  // draggable, so without asking it keeps its panes at the top and leaves the height
  // the player dragged out as dead space underneath.
  it('asks its body to fill the height the frame was given', async () => {
    const h = await start();
    await h.settle();

    expect(document.querySelector<HTMLElement>('.woc-frame-body')?.style.flex).toBe('1 1 auto');
  });

  // `setShown` restores what an element was built as rather than writing one display for
  // everything it is pointed at. The purse is the case that catches it: a kit bar shown as a
  // flex line puts its own detail beside its figure instead of under it, and nothing raises. A
  // bar is the kit's, so the right assertion is that this addon has written no display onto it.
  it('gives an element it did not lay out back its own display', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    const purse = document.querySelector<HTMLElement>('.woc-satchel-purse');
    expect(purse?.hidden).toBe(false);
    expect(purse?.style.display).toBe('');
    expect(gridEl('bags')?.style.display).toBe('grid');
  });
});

// Every mark is computable from IDS ALONE, which is what makes them the things this
// panel can highlight with nobody having named anything.
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

  // The lock is the one thing in a bag the PLAYER set, and the alt case is the whole reason to
  // record it: you cannot log in as somebody else to check whether the stack you were about to
  // salvage is the protected one.
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

  // A cell is reused as the grid repaints, so a mark left behind reports the lock of whatever
  // the square used to hold.
  it('takes the padlock off a square that emptied', async () => {
    const h = await start({ carry: { inventory: lockedCells('ore', 20) } });
    await h.settle();

    h.carry({ inventory: [] });
    await h.settle();

    expect(lockedAt(0)).toBe(false);
  });

  // A tile is announced as one image, so the only place the fact can go is its name.
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

  // 20 + 3 + 3 is 26 held over 3 cells, and the largest stack seen is 20, so two cells
  // could hold it and one would come back.
  it('says how many cells merging would free, measured against a stack it has seen', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('ore', 3, 2)] },
    });
    await h.settle();

    expect(statFor('marks')).toBe('1 split, 1 to free');
  });

  // Two full stacks cannot be merged into one, and nothing published says how big a full stack
  // is: the answer measured from what has been seen is zero, which is the safe direction to be
  // wrong in.
  it('claims no reclaim when no stack is bigger than one already seen', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();

    expect(statFor('marks')).toBe('1 split');
  });

  // The maximum is learned from every store the addon reads, the stored ones included,
  // so the estimate does not reset on every page load.
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

// The capacity figure is a chip on the strip rather than a whole `ui.bar` row, so the urgency
// it used to carry as a fill and a band is carried in TWO places instead: the figure itself,
// which is always on screen, and the empty squares in the grid, which are what the player is
// looking at when they wonder whether the next thing they pick up will fit.
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

  // Every free square rather than the last few: with three left, three coloured squares is the
  // whole answer, and picking a subset of identical empties would claim one of them is the last.
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

// A cue on the CROSSING, not on the state: every loot taken while already full would
// otherwise chime, which is the version of this feature players switch off.
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

// The contract this addon sets for every consumer after it. Every display is complete
// without a single one of these answers, and an answer enriches it.
describe('the bus contract', () => {
  it('draws the whole grid with nothing publishing at all', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    await h.settle();

    expect(itemsInGrid().slice(0, 2)).toEqual(['ore', 'ore']);
    expect(nameAt(0)).toBe('Ore, 20');
  });

  // From a FORK's fqid. A consumer that subscribed to `official/lorebind` would hear
  // nothing here, and nothing would report that it had stopped working.
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

  // Silence is an ordinary state: nothing waits, nothing times out, and nothing tells
  // the player anything is wrong. Two silences, and the line reports both without
  // either reading as a fault.
  it('says nobody is publishing without calling it a fault', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    const said = tipOver(cellAt(0));

    expect(said).toContain('Its art file carries no name');
    expect(said).toContain('nothing is publishing names over the bus');
    expect(said).not.toContain('error');
  });
});

// What a vendor pays is published by the same addon that publishes the names, and nothing on
// the addon API answers it, so every case here is about a total that is PARTIAL by construction:
// what matters is that the panel never presents one as complete and never counts an item nobody
// priced as worth nothing.
describe('what it is all worth', () => {
  it('totals the bags from published prices', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(statFor('bags-worth')).toBe('10s');
    expect(tipOver(barAt('bags-worth'))).toContain('1 of 1 kinds priced');
  });

  // The half that keeps the figure honest. An item nobody priced is left OUT of the sum rather
  // than added at nothing, and the count beside the figure is what says so: a total that quietly
  // skipped half a bag and looked complete is worse than no total.
  it('leaves an unpriced item out of the sum and says how many kinds it could price', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 4)] },
    });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(statFor('bags-worth')).toBe('5s');
    expect(tipOver(barAt('bags-worth'))).toContain('1 of 2 kinds priced');
  });

  // Nobody publishing is the ordinary state, and a `0c` row is a claim that the bags are worth
  // nothing. There is no row at all instead.
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

  // The account figure counts every store of every character, which is the opposite of what the
  // slot total beside it does: slots are bags only, because a bank is recorded only for a visit
  // to one. Money owned is money owned wherever it was last seen.
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

  // The pane that DRAWS the bag was the one that could not say what was in it: the price
  // reached the Items row and stopped there, so a player with the pointer over a stack of ore
  // got its id, its count and its kind and no figure at all.
  it('prices the square under the pointer, each and for the cell', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 });
    await h.settle();

    expect(tipOver(cellAt(0))).toContain('A vendor pays 25c each, 5s for this cell.');
  });

  // One of a thing has no "each" to give, and a line saying `25c each, 25c for this cell` is
  // two figures for one fact.
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

  // A price is a number off another addon, so it is checked like every other field of the
  // payload: a string that looks like one is not one, and a zero is a real answer the
  // publisher's own rule says it will never send.
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

// A tier is what a player picks an item out of a grid by before reading a word, and it was
// arriving on the bus already: `quality` was received, kept, and spent on one word in a
// tooltip. The BORDER is the kit's own axis for it, and it was being spent on this addon's
// three marks instead, which the kit lets a tone win because a tone is urgency. None of split,
// spare and carried is urgent, so they moved to a corner pip and the border is the tier's.
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

  // A publisher's `quality` is another addon's string. The kit colours nothing for a value
  // outside its six, so passing one through and passing null are the same picture and only one
  // of them is a decision this addon made.
  it('refuses a tier the kit does not know', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', quality: 'mythic' });
    await h.settle();

    expect(cellAt(0)?.className).not.toContain('woc-tile-quality');
  });

  // The two axes on one square, which is the case the move was made for: before it, a stack
  // split across two cells took the border and the tier could never be drawn.
  it('draws the mark and the tier at once', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20, 2) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', quality: 'uncommon' });
    await h.settle();

    expect(markedAt(0)).toBe(true);
    expect(cellAt(0)?.classList.contains('woc-tile-quality-uncommon')).toBe(true);
  });
});

// The loader can name SOME items, and what it has is not the item's name: the
// manifest's name is provenance for the art FILE, and 21 of the 303 it carries
// disagree with the game's own display name. So it ranks under a publisher and over
// the raw id, and anything drawn from one says where the name came from.
describe('the name on a square', () => {
  it('falls back to the art file when nobody is publishing, and says so', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    artNames(h, new Map([['ore', 'Copper Ore']]));
    // A change, because the manifest landing is not itself a world change: the addon
    // repaints for one, and this stands in for the repaint it schedules.
    h.carry({ inventory: [...cells('ore', 20), ...cells('cloth', 5)] });
    await h.settle();

    expect(nameAt(0)).toBe('Copper Ore, 20');
    expect(nameAt(1)).toBe('Cloth, 5');
    expect(tipOver(cellAt(0))).toContain('Named from its art file');
  });

  // The ordering, and the reason for it. A publisher layers an embedded table and
  // names learned from loot rolls on top of the same manifest, so where the two
  // disagree the publisher is the one that can be right.
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

  // Both art answers are provisional until the manifest lands: the icon is a hopeful URL and the
  // art name is null. So the addon asks for it and repaints rather than living with the reading
  // its first frame happened to get. Built from the shared services directly, because the spy
  // has to exist before the addon's first line.
  it('reads the art manifest once, then repaints with what it learned', async () => {
    const player = liveEntity({ set: { name: PLAYER_ENTITY.name, templateId: 'hunter' } });
    const state: CarryState = { ...emptyCarry(), inventory: cells('ore', 20) };
    const shared = createSharedServices(document, createFakeStorage(), {
      game: Promise.resolve({ world: fakeWorld(state, player) }),
    });
    // Annotated, or `noUnnecessaryConditions` reads the initializer as the literal type `false`
    // and reports every later test of it as a condition that cannot vary.
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

// The other half of rule 2, and the reason the ask is emitted last: delivery is
// synchronous, so a publisher already running answers INSIDE the ask, and a
// subscription registered afterwards would miss its own answer.
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
      // `items:ask`, which `woc.bus.follow` derives from the topic it follows, rather than the
      // `item:ask` this protocol shipped with. The publisher answers both.
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

// The two moments the game narrates itself. The line is the game's own composed text,
// which names the item that an inventory entry cannot.
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

  // The narration is about the player, so it is dropped the moment the panes are
  // pointed at somebody else: a loot line under an alt's bags would read as that alt
  // having just picked something up.
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

// The badge and the pane are two different reads and neither is derived from the
// other. `mailUnread` streams with no proximity gate at all, which is exactly what a
// badge is for: it exists for the moment the player is NOT at the mailbox.
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

  // Unread is the only thing a letter has that a fill can mean. It is a mark rather
  // than a measurement, which is why an unread row is full and a read one is empty.
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

  // Same improvement the bank pane got, and the same rule behind it: what is drawn is
  // the last reading taken AT the pillar, and the badge keeps streaming beside it.
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

// The SECOND bus protocol. What a vendor pays is a floor and it is small: a whole bag of ore
// comes to a few silver against a purse of a thousand gold, so as the only figure on the strip
// it was a true fact nobody could act on. What the counter goes for is the number a player
// decides anything with, and one addon in the catalogue keeps a history of it.
//
// It is a separate topic and never a field on an `item` record, because a record here is
// replaced wholesale by id: a second publisher on that topic would overwrite the name and the
// tier the catalogue publisher owns, and that publisher has no way to answer for a price anyway.
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

  // The vendor figure does not go away. It moves to the tooltip beside the market one, where
  // being the CERTAIN one is worth stating: a vendor pays that today whatever the counter does.
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

  // The realm test is the whole reason a price record carries one. The ledger publishing these
  // is a history of ONE market, and an alt's stock on another realm is worth what that realm
  // pays, which nothing here knows. Silence rather than the wrong figure.
  it('refuses to spend another realm price on this character stock', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('item', { id: 'ore', name: 'Copper Ore', sellValue: 25 }, PUBLISHER);
    h.publish('price', priceRow({ realm: 'Emberfall' }), PRICER);
    await h.settle();

    expect(statLabel('bags-worth')).toBe('Worth');
    expect(statFor('bags-worth')).toBe('5s');
  });

  // A row without one is refused rather than accepted as applying everywhere, which is the only
  // other thing it could mean and is never true. Guarded twice on purpose, at the parse and at
  // the lookup: the first keeps a record that cannot mean anything out of the map at all.
  it('refuses a price record that names no realm', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    h.publish('price', { id: 'ore', unit: 400, at: WALL_CLOCK_MS }, PRICER);
    await h.settle();

    expect(shownAt('bags-worth')).toBe(false);
  });

  // The other side of the same test: a character recorded before this addon wrote realms down
  // has none, and a price that named a real one must not be spent on them either. Two blanks
  // are not a match.
  it('refuses to price a character recorded before realms were written down', async () => {
    const storage = createFakeStorage();
    // The key ABSENT rather than undefined, which is what a record written before the field
    // existed actually looks like. Destructured off rather than deleted, because Biome refuses
    // `delete` and `exactOptionalPropertyTypes` refuses the `= undefined` it offers instead.
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

  // Both figures on one square, labelled, never merged. A number made of a vendor floor and a
  // market median is true of neither, which is the rule the publisher holds itself to as well.
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

  // Two ages are on screen at once and they answer different questions: the store stamp says
  // when the bags were read and this says when the counter was.
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

  // A single thin reading is IN the total and disclosed, rather than silently dropped or
  // silently folded in. The count is what says the figure below it rests on one person's day.
  it('discloses how many kinds rest on a single reading', async () => {
    const h = await start({
      carry: { inventory: [...cells('ore', 20), ...cells('cloth', 10)] },
    });
    h.publish('prices', [priceRow(), priceRow({ id: 'cloth', visits: 1 })], PRICER);
    await h.settle();

    expect(tipOver(barAt('bags-worth'))).toContain('1 of 2 rest on a single reading');
  });

  // A row pools every character on the account and they are not all on one realm, so the row
  // total is the wrong multiplier. Priced against the copies the figure applies to, and the
  // rest counted rather than quietly folded in.
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

// The pane the addon exists for had one control on it, a search box, so the only question it
// could answer was "where is my X" and only if you could spell X. Worse, `MAX_ITEM_ROWS`
// truncates whatever order it is given: alphabetically that showed A through G on a large
// account and asked the player to narrow it, which is what a cap over an arbitrary order can
// honestly say. A cap over a sorted list is a top-40 and a real answer.
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

  // The question the Bags tab makes a player ask and cannot answer: 60 ore in three cells is
  // cheaper to carry than two herbs in two.
  it('ranks by how many cells a kind is spending', async () => {
    const h = await start({ carry: threeKinds });
    await h.settle();
    chooseIn('sort', 'Cells');
    await h.settle();

    expect(keysIn('items').slice(0, 2)).toEqual(['ore', 'herb']);
  });

  // The prices are picked so the worth order DIFFERS from the alphabetical one. Ore is
  // published as "Copper Ore", so by name the three read Cloth, Copper Ore, Herb, and a case
  // whose expected worth order happened to match that would pass against no sorting at all.
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

  // Never a MIXTURE of the two sources. A market median and a vendor floor differ by a factor
  // of tens, so a list ordered on whichever each row happened to have would rank a browsed
  // piece of junk over an unbrowsed valuable and still read as a ranking by worth.
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

    // Ore is 60 at 40s on the counter. Cloth has a vendor floor and no market figure, so on
    // the market ranking it is worth nothing here and says so.
    expect(keysIn('items')).toEqual(['ore', 'cloth', 'herb']);
    expect(detailOf('items', 'cloth')).toBe('no recorded price');
  });

  // A list ordered by worth whose rows read `Marshal 87, Bruk 54` has been reshuffled rather
  // than sorted: the figure the order was taken on is the one thing not on screen.
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

// Pooling across characters is the addon's whole premise and there was no way to un-pool it.
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

  // The FIGURES follow it too. A player asking about Alt means Alt's copies, not every row
  // Alt happens to hold one of counted across the account.
  it('counts that character copies rather than the account', async () => {
    const h = await start({ storage: withAlt(), carry: { inventory: cells('ore', 9) } });
    await h.settle();
    expect(figureOf('items', 'ore')).toBe('49');

    chooseIn('who', 'Alt');
    await h.settle();

    expect(figureOf('items', 'ore')).toBe('40');
    expect(statFor('items-held')).toBe('47');
  });

  // The roster's own account total reads the same index on the same paint, so a filter that
  // narrowed the index in place would make the roster report one character worth as everyone's.
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

  // One character is not a choice, exactly as on the Bags selector.
  it('stays off the panel while there is only one character', async () => {
    const h = await start({ carry: { inventory: cells('ore', 20) } });
    await h.settle();

    expect(shownIn('[data-role="who"]')).toBe(false);
  });
});

// A bar is read before the figure beside it, so a bar measuring something other than the thing
// the list is ordered on is worse than no bar at all: under a worth order a nearly worthless
// row could draw the longest one. The fill, the second line and the row order are one fact now.
describe('what a row fill measures', () => {
  // Herb is THREE to a cell, so its copy count and its cell count differ. At one apiece the
  // two were the same number and a case about the cells order passed against a fill still
  // measuring copies.
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

    // Cloth is 25s against ore's 60c, so the sixty ore draw the SHORT bar here.
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

  // A share needs a zero point and a wall-clock stamp has none: every bar would draw at very
  // nearly full width and say nothing at all.
  it('draws none at all under an order that has no zero', async () => {
    const h = await start({ carry: mixed });
    await h.settle();
    chooseIn('sort', 'Last seen');
    await h.settle();

    expect(fillOf('items', 'ore')).toBe('0.00%');
  });

  // The denominator is everything the filters matched rather than the forty rows drawn, so the
  // cap cannot silently rescale the pane.
  //
  // ONLY THE NAME ORDER CAN SHOW THIS, and the reason is worth keeping: every other order is
  // descending, so the largest row is row one and is always drawn. Alphabetically it can be
  // anywhere, and here the hundred-copy pile sorts last and falls off the end of the cap.
  it('is not rescaled by the row cap', async () => {
    const h = await start({
      carry: { inventory: [...manyKinds(MAX_ITEM_ROWS + 3), ...cells('zzz_big', 20, 5)] },
    });
    await h.settle();

    // The biggest pile is past the fortieth row and still sets the scale: one copy against a
    // hundred is a hair of a bar, where the largest DRAWN row would have made it a full one.
    expect(keysIn('items')).not.toContain('zzz_big');
    expect(fillOf('items', 'kind_00')).toBe('1.00%');
  });
});

// Money is the one thing a mailbox holds that a bank does not, and nothing ever counted it.
// A letter carries copper, the panel has always drawn it per letter, and every total left it
// out, so an account with sale proceeds waiting at a mailbox read low in the panel's own
// headline figure using a number it was already holding.
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

  // BESIDE the carried total rather than added into it. The bar says `Every character` and
  // draws the sum of their purses, and a letter's attachment is carried by nobody.
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

// The purse was on the Bags pane alone, so the two panes that can be pointed at somebody else
// could not say whose money they were showing. It bites hardest on an alt's bank, which is the
// pane this addon exists for.
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
