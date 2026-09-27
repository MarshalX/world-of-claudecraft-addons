// Ledgerline on the stage: a ledger somebody has been keeping for three days.
//
// The history cannot be walked into, so the scenario states three browses and `stage.elapse`
// puts the first two in the past. Every item id ships painted art in the deployed item manifest.
//
// Names come from `stage.publish` standing in for lorebind, using lorebind's committed table, so
// the picture is the recommended pair rather than raw ids.
//
// Pages are sorted as the server sorts them, by display name then stack total. The undercut check
// reads that order, so any other order is a page the server could not send.

import { inSeries } from '../../loader/src/shared/sequence.ts';
import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import ITEMS from '../lorebind/items.json' with { type: 'json' };
import FLOORS from './floors.json' with { type: 'json' };

const SILVER = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The game's REAL terms. The suite uses other figures on purpose; a photograph wants these. */
const CUT_PCT = 5;
const MAX_LISTINGS = 12;

/** Returned goods waiting to be collected, which drive the badge along with the proceeds. */
const WAITING_ITEMS = [
  { itemId: 'homespun_cloth', count: 4 },
  { itemId: 'boar_hide', count: 1 },
];

/** One completed sale of the player's own, as the Merchant's pending ledger carries it. */
interface Sale {
  itemId: string;
  count: number;
  /** The GROSS buyout the buyer paid for the whole stack. */
  price: number;
  /** The NET copper it added to the collection, after the Merchant's cut. */
  proceeds: number;
  buyerName: string;
}

function sale(itemId: string, count: number, unit: number, buyerName: string): Sale {
  const price = count * unit;
  return {
    itemId,
    count,
    price,
    proceeds: Math.floor(price * (1 - CUT_PCT / 100)),
    buyerName,
  };
}

/**
 * A QUEUE rather than a table: it grows as sales land and empties when the player collects. The
 * collect between the second browse and the third is the point: three sales are gone from the
 * wire by the time the shot is taken and still on screen, which is what the Sold pane is for.
 */
const SOLD: readonly (readonly Sale[])[] = [
  [sale('copper_ore', 20, 50, 'Doradine'), sale('rough_hide', 10, 88, 'Karrek')],
  [
    sale('copper_ore', 20, 50, 'Doradine'),
    sale('rough_hide', 10, 88, 'Karrek'),
    sale('spider_silk', 10, 66, 'Anserra'),
  ],
  [sale('iron_ore', 20, 128, 'Bragg'), sale('copper_ore', 20, 46, 'Vessken')],
];

/** What the Merchant is holding, which is exactly what the rows above add up to. */
function waitingCopper(browse: number): number {
  return (SOLD[browse] ?? []).reduce((total, row) => total + row.proceeds, 0);
}

/** One stack on the counter: how many, and what the seller wants over the going rate. */
interface Stack {
  count: number;
  seller: string;
  /** Copper per item above the day's rate, so one item's block is not two equal rows. */
  over?: number;
  /** The Merchant's own standing stock, which the ledger leaves out by default. */
  house?: boolean;
}

/**
 * `units` is per item and the wire carries the stack TOTAL, which is the arithmetic this addon
 * exists to get right, so the rows are built by multiplying. A browse with no unit price is one
 * where nobody had any: goldleaf runs out, leaving the player the only listing of it.
 */
interface Stall {
  item: string;
  /** The game's display name, which the server sorts by. */
  name: string;
  units: readonly number[];
  stacks: readonly Stack[];
}

/**
 * The book in display-name order: nine items over three days, chosen so the trend has something
 * to say in both directions.
 */
const STALLS: readonly Stall[] = [
  {
    item: 'copper_ore',
    name: 'Copper Ore',
    units: [52, 48, 44],
    stacks: [
      { count: 20, seller: 'Bragg' },
      { count: 20, seller: 'Sunna', over: 5 },
    ],
  },
  {
    item: 'ghostly_essence',
    name: 'Ghostly Essence',
    units: [820, 780, 800],
    stacks: [
      { count: 1, seller: 'Karrek' },
      { count: 1, seller: 'Anserra', over: 40 },
    ],
  },
  {
    item: 'goldleaf_herb',
    name: 'Goldleaf Herb',
    units: [340, 330],
    stacks: [
      { count: 5, seller: 'Emberlash' },
      { count: 5, seller: 'Vessken', over: 15 },
    ],
  },
  {
    item: 'healing_potion',
    name: 'Healing Potion',
    units: [260, 250, 245],
    stacks: [
      { count: 5, seller: 'Ilvane' },
      // The Merchant's own shelf: in the undercut check, out of the price series by default.
      { count: 5, seller: 'Merchant', over: 60, house: true },
    ],
  },
  {
    item: 'iron_ore',
    name: 'Iron Ore',
    units: [105, 118, 132],
    stacks: [
      { count: 20, seller: 'Sunna' },
      { count: 20, seller: 'Doradine', over: 6 },
    ],
  },
  {
    item: 'pristine_hide',
    name: 'Pristine Hide',
    units: [1400, 1480, 1520],
    stacks: [
      { count: 1, seller: 'Karrek' },
      { count: 1, seller: 'Bragg', over: 90 },
    ],
  },
  {
    item: 'rough_hide',
    name: 'Rough Hide',
    units: [90, 84, 88],
    stacks: [
      { count: 10, seller: 'Anserra' },
      { count: 10, seller: 'Emberlash', over: 3 },
    ],
  },
  {
    item: 'silverleaf_herb',
    name: 'Sheenleaf Herb',
    units: [110, 108, 112],
    stacks: [
      { count: 10, seller: 'Doradine' },
      { count: 10, seller: 'Ilvane', over: 4 },
    ],
  },
  {
    item: 'spider_silk',
    name: 'Spider Silk',
    units: [70, 64, 58],
    stacks: [
      { count: 10, seller: 'Vessken' },
      { count: 10, seller: 'Sunna', over: 6 },
    ],
  },
];

/**
 * All three verdicts at once. The ore and the silk are beaten on the total AND per item, so
 * neither is arguable; the hides and the iron are under everybody; and the only other goldleaf
 * seller ran out, so that row has nothing to compare against, which is the careful verdict.
 */
const MINE: readonly { id: number; item: string; count: number; price: number }[] = [
  { id: 9001, item: 'copper_ore', count: 20, price: 20 * 45 },
  { id: 9002, item: 'goldleaf_herb', count: 5, price: 5 * 340 },
  { id: 9003, item: 'iron_ore', count: 20, price: 20 * 130 },
  { id: 9004, item: 'pristine_hide', count: 1, price: 1500 },
  { id: 9005, item: 'rough_hide', count: 10, price: 10 * 86 },
  { id: 9006, item: 'spider_silk', count: 10, price: 10 * 62 },
];

/** The browse each page belongs to, and how long before the shot it happened. */
const BROWSES = [3 * DAY_MS, 6 * HOUR_MS, 0];
/** Which browse the player's own listings first appear in. They were posted then. */
const LISTED_ON = 1;

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

function stackRows(stall: Stall, browse: number, base: number): Listing[] {
  const unit = stall.units[browse];
  if (unit === undefined) {
    return [];
  }
  return stall.stacks.map((stack, at) => ({
    id: base + at,
    sellerName: stack.seller,
    itemId: stall.item,
    count: stack.count,
    price: stack.count * (unit + (stack.over ?? 0)),
    mine: false,
    house: stack.house === true,
  }));
}

/** The player's own rows, which the server puts first and keeps on every page. */
function myRows(browse: number): Listing[] {
  if (browse < LISTED_ON) {
    return [];
  }
  return MINE.map((listing) => ({
    id: listing.id,
    sellerName: 'Marshal',
    itemId: listing.item,
    count: listing.count,
    price: listing.price,
    mine: true,
    house: false,
  }));
}

/**
 * By display name then stack total, COMPUTED rather than typed: the undercut check reads that
 * ordering, and a fixture drifting out of it describes a page the server never sends.
 */
function otherRows(browse: number): Listing[] {
  const rows: Listing[] = [];
  for (const [at, stall] of STALLS.entries()) {
    const block = stackRows(stall, browse, (browse + 1) * 1000 + at * 10);
    block.sort((a, b) => a.price - b.price);
    rows.push(...block);
  }
  return rows;
}

/** One page of the book, as the server echoes it back. */
function pageFor(browse: number): Record<string, unknown> {
  const listings = [...myRows(browse), ...otherRows(browse)];
  return {
    listings,
    totalCount: listings.length,
    filter: '',
    itemType: '',
    subtype: '',
    armorClass: '',
    primaryStat: '',
    rarity: '',
    // Browse's default order, which groups the book by name.
    sort: 'name',
    page: 0,
    pageCount: 1,
    collectionCopper: waitingCopper(browse),
    collectionItems: WAITING_ITEMS,
    collectionSales: SOLD[browse] ?? [],
    collectionSalesOmitted: 0,
    cutPct: CUT_PCT,
    maxListings: MAX_LISTINGS,
    myListingCount: listings.filter((row) => row.mine).length,
  };
}

/** Stand at the Merchant, reading a page. The wire name, which is what the loader reads. */
function atCounter(draft: WorldDraft, browse: number): void {
  draft.set(draft.world, 'marketInfo', pageFor(browse));
}

/** How many sales the Merchant's own cap dropped out of the ledger in `overCapped`. */
const OVER_CAP = 14;

/**
 * More sold than the Merchant will itemize. The two rows are sales the third browse had not
 * seen, which is what an omission MEANS: fourteen landed behind the recorded two and pushed them
 * out. The dropped gold rides the collection total, as the game does it, and that total is also
 * what moves the page. The pane says twelve rather than fourteen, because two of the dropped
 * rows were read before they went, and only a kept position can work that out.
 */
function overCapped(draft: WorldDraft): void {
  const rows = [
    sale('ghostly_essence', 1, 810, 'Emberlash'),
    sale('healing_potion', 5, 255, 'Ilvane'),
  ];
  // Everything the Merchant is holding: what the third browse already showed, then the sales
  // that dropped out unread, then the two rows still on the wire. A dropped row's gold stays
  // in the total, so the rows and the total deliberately do not reconcile.
  const unread = (OVER_CAP - (SOLD[2]?.length ?? 0)) * 4 * SILVER;
  const showing = rows.reduce((total, row) => total + row.proceeds, 0);
  draft.set(draft.world, 'marketInfo', {
    ...pageFor(2),
    collectionCopper: waitingCopper(2) + unread + showing,
    collectionSales: rows,
    collectionSalesOmitted: OVER_CAP,
  });
}

/**
 * What a scan finds on top of the recorded book. Each row is a real underpricing against the
 * shipped floor table, one per kind the panel distinguishes:
 *
 *   Iron is the fat-finger: twenty ore posted at the price of one.
 *   Potions are where the vendor shelf caps the resale at the 170 a vendor charges.
 *   The hide is a firm undercut (three visits behind the median).
 *   The silk is the same with two visits, so it is called thin.
 */
const UNDERPRICED: readonly Listing[] = [
  {
    id: 7001,
    sellerName: 'Torvald',
    itemId: 'iron_ore',
    count: 20,
    price: 132,
    mine: false,
    house: false,
  },
  {
    id: 7002,
    sellerName: 'Nessa',
    itemId: 'healing_potion',
    count: 5,
    price: 100,
    mine: false,
    house: false,
  },
  {
    id: 7003,
    sellerName: 'Grimmet',
    itemId: 'pristine_hide',
    count: 1,
    price: 700,
    mine: false,
    house: false,
  },
  {
    id: 7004,
    sellerName: 'Ilvane',
    itemId: 'spider_silk',
    count: 10,
    price: 40,
    mine: false,
    house: false,
  },
  {
    id: 7005,
    sellerName: 'Doradine',
    itemId: 'rough_hide',
    count: 10,
    price: 300,
    mine: false,
    house: false,
  },
  {
    id: 7006,
    sellerName: 'Vessken',
    itemId: 'ghostly_essence',
    count: 1,
    price: 200,
    mine: false,
    house: false,
  },
];

/** The wire field a page carries its rows under, so reading it needs no literal key. */
const LISTINGS_FIELD = 'listings';

/** The computed access `noPropertyAccessFromIndexSignature` asks for. */
function rowsOn(payload: Record<string, unknown>, field: string): Listing[] {
  return (payload[field] ?? []) as Listing[];
}

/** The third browse's book with the scan rows folded in, re-sorted into server order. */
function scanPage(): Record<string, unknown> {
  const base = pageFor(2);
  const listings = [...rowsOn(base, LISTINGS_FIELD), ...UNDERPRICED];
  listings.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.price - b.price);
  return { ...base, listings, totalCount: listings.length };
}

/** Walk away, which is a null page and NOT an empty market. */
function noCounter(draft: WorldDraft): void {
  draft.set(draft.world, 'marketInfo', null);
}

/**
 * The book under "lowest price only": the fixture collapsed to the cheapest row per item id,
 * the player's own rows included, as the server does it.
 */
function collapsedPage(): Record<string, unknown> {
  const base = pageFor(2);
  const cheapest = new Map<string, Listing>();
  for (const row of rowsOn(base, LISTINGS_FIELD)) {
    const held = cheapest.get(row.itemId);
    if (held === undefined || row.price / row.count < held.price / held.count) {
      cheapest.set(row.itemId, row);
    }
  }
  const listings = [...cheapest.values()];
  return {
    ...base,
    listings,
    collapseLowest: true,
    // Both counts are over the COLLAPSED rows, as the server counts them.
    totalCount: listings.length,
    // Every listing the player has anywhere: the only figure that sees the ones collapsed away.
    myListingCount: rowsOn(base, LISTINGS_FIELD).filter((row) => row.mine).length,
  };
}

/** `spider_silk`: the player lists at 62 each against a floor of 58, so someone is under them. */
function stagingToSell(draft: WorldDraft): void {
  // Over the scanned page: a player staging a sale has already read the rest of the book.
  draft.set(draft.world, 'marketInfo', {
    ...scanPage(),
    sellPriceItemId: 'spider_silk',
    sellLowestPrice: 58,
  });
}

/** In `world`, since a player logging in at the Merchant is reading a page before first draw. */
function atTheMerchant(draft: WorldDraft): void {
  draft.set(draft.world, 'marketCollectPending', true);
  atCounter(draft, 0);
}

/**
 * The shipped floor table, on every scenario. Without it the panel shows a failed fetch, which
 * looks like the ordinary panel with rows missing.
 */
const FLOOR_DATA = { 'floors.json': JSON.stringify(FLOORS) };

/** What a running lorebind answers an `items` ask with, for the ids this fixture uses. */
const LOREBIND_FQID = 'official/lorebind';
const ITEMS_TOPIC = 'items';

/** The companion, standing in, with lorebind's own rows narrowed to the ids this fixture uses. */
function lorebindSpeaks(stage: Stage): void {
  const wanted = new Set([
    ...STALLS.map((stall) => stall.item),
    ...WAITING_ITEMS.map((row) => row.itemId),
    'ghostly_essence',
  ]);
  const rows = ITEMS.items.filter((item) => wanted.has(item.id));
  stage.publish(LOREBIND_FQID, ITEMS_TOPIC, rows);
}

const SETTLE_MS = 60;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Let the storage round trip and the queued repaint land. A real timer, since start-up is one
 * `storage.keys()` plus a `get` per item, several promise hops deep.
 */
async function drawn(stage: Stage): Promise<void> {
  stage.poll();
  await pause(SETTLE_MS);
  // `woc.paint` runs on the loader's frame loop, which the stage drives by hand.
  stage.frame();
}

/** How long to wait for the item art manifest, which every label on screen comes from. */
const ART_MS = 5000;
const ART_POLL_MS = 50;

/**
 * Hold the shot until the art manifest lands: `ui.icon.itemArtName` answers null until then, so
 * an early shot is a panel of raw ids. The first row is enough, one manifest answers for all.
 */
function artLanded(
  stage: Stage,
  list = 'prices',
  wanted = (STALLS[0] as Stall).name,
): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      // A frame per look: the manifest landing asks for a repaint the stage only runs on demand.
      stage.frame();
      const label = document.querySelector(`[data-list="${list}"] .woc-bar-label`)?.textContent;
      if (label === wanted || waited >= ART_MS) {
        resolve();
        return;
      }
      waited += ART_POLL_MS;
      setTimeout(look, ART_POLL_MS);
    };
    look();
  });
}

/** Three days of browsing, with the clock moved between them so the readings differ in age. */
async function browsedForDays(stage: Stage): Promise<void> {
  // Before the first paint: a row learns its name once.
  lorebindSpeaks(stage);
  await drawn(stage);
  await inSeries(BROWSES.slice(1).entries(), async ([step, ago]) => {
    const at = step + 1;
    stage.elapse((BROWSES[step] as number) - ago);
    atCounter(stage, at);
    await drawn(stage);
  });
}

/** Open one of the panel's tabs by clicking it, the same path a player takes. */
function openTab(label: string): void {
  const button = [...document.querySelectorAll('#woc-addons .woc-tab')].find(
    (el) => el.textContent === label,
  );
  (button as HTMLButtonElement | undefined)?.click();
}

/**
 * The width fits three panes in the 1440 capture viewport: `3 * (416 + 48) + 2 * 16` is 1424, and
 * wider is silently cropped. The height is set by the fullest pane, the ledger's nine rows plus
 * the Export and Import row, since a clipped last row reads as broken in a thumbnail.
 */
const WIDENED = { x: 80, y: 140, w: 416, h: 560 };

/** At most three `preview` scenarios: a fourth pane is silently cropped. See `WIDENED`. */
const SCENARIOS: readonly Scenario[] = [
  {
    id: 'deals',
    label: 'A scan that found something',
    preview: true,
    caption: 'What to buy',
    alt: 'underpriced listings ranked by what each clears',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      // After the history exists: a deal is judged against what is already recorded.
      stage.set(stage.world, 'marketInfo', scanPage());
      await drawn(stage);
      await artLanded(stage, 'deals', 'Iron Ore x20');
    },
  },
  {
    id: 'prices',
    label: 'The ledger, three days in',
    preview: true,
    caption: 'The ledger',
    alt: 'every price recorded, each against its own range',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      // Asked for, because the panel opens on Deals while at a counter.
      openTab('Prices');
      await artLanded(stage);
    },
  },
  {
    id: 'mine',
    label: 'Your own listings',
    preview: true,
    caption: 'Your listings',
    alt: 'undercuts washed red',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      // The tab first: the panel opens on Deals at a counter, and waiting on Prices would time out.
      openTab('Yours');
      await artLanded(stage, 'mine');
      stage.frame();
      await pause(SETTLE_MS);
    },
  },
  {
    id: 'sold',
    label: 'What it actually sold for',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      openTab('Sold');
      await artLanded(stage, 'sold');
      stage.frame();
      await pause(SETTLE_MS);
    },
  },
  {
    // The Merchant itemizes fifty sales and counts the rest, whose gold stays in the total. The
    // pane says how many are missing. Not a preview: the normal state is none.
    id: 'omitted',
    label: 'More sold than the Merchant will itemize',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      overCapped(stage);
      await drawn(stage);
      openTab('Sold');
      stage.frame();
      await pause(SETTLE_MS);
    },
  },
  {
    // Away from the counter, holding the last page read. Away is not an empty market.
    id: 'away',
    label: 'Walked away from the Merchant',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      noCounter(stage);
      await drawn(stage);
    },
  },
  {
    // Nothing recorded and no Merchant nearby: the first-install state.
    id: 'empty',
    label: 'Before the first page is read',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: noCounter,
    run: drawn,
  },
  {
    // "Lowest price only": a listing of the player's that is here has not been undercut, and the
    // undercut ones are not on the page. The two sentences under the lists are the feature.
    id: 'collapsed',
    label: 'Browsing the lowest price of each',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      stage.set(stage.world, 'marketInfo', collapsedPage());
      await drawn(stage);
      openTab('Yours');
      await artLanded(stage, 'mine');
      stage.frame();
      await pause(SETTLE_MS);
    },
  },
  {
    // Part-way through listing, the only moment the game states a market-wide price.
    id: 'selling',
    label: 'Staging an item on the Sell tab',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      stagingToSell(stage);
      await drawn(stage);
      await artLanded(stage, 'deals', 'Iron Ore x20');
    },
  },
  {
    // The reconnect blip: the client nulls its market mirror for one snapshot, so the panel holds
    // the page and says it is resyncing. Not a preview: it lasts two seconds.
    id: 'resync',
    label: 'The reconnect blip',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      stage.netState({ reconnects: 1 });
      noCounter(stage);
      await drawn(stage);
    },
  },
];

export { SCENARIOS };
