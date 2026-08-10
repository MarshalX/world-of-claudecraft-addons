// Ledgerline on the stage: a ledger somebody has been keeping for three days.
//
// The state worth photographing cannot be walked into, since the only history that exists is
// what this addon wrote down while its player browsed. So the scenario states three browses,
// with `stage.elapse` putting the first two in the past.
//
// Every id here ships painted art, from the deployed `/ui/items/mapping.json`, so a missing icon
// in a shot is a real defect rather than a fixture naming a file that never existed.
// `silverleaf_herb` is in on purpose: its art is filed under "Sheenleaf Herb", which is the case
// the label under every row is hedging about.
//
// The others section is sorted the way the SERVER sorts it, by display name then stack total.
// The undercut check reads exactly that ordering, so a fixture in any other order would be a
// page the server could not have sent. All three verdicts are on screen at once, which is the
// point of the Yours panel.

import { inSeries } from '../../loader/src/shared/sequence.ts';
import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
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
  /** The art name, which is what this fixture sorts by. See the header. */
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
      // The Merchant's own shelf, which competes with the player for a buyer and is
      // therefore in the undercut check, and is priced by a formula rather than by
      // anybody's judgement, and is therefore out of the price series by default.
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
 * What a scan finds, on top of the book the three browses already recorded.
 *
 * Every row here is a REAL underpricing of one of the four kinds the panel can tell apart, and
 * each is priced against the shipped floor table at game 0.35.1 rather than against a figure
 * chosen to look good:
 *
 *   The iron is the fat-finger: twenty ore posted for the price of ONE, which is what happens
 *   when a seller types the unit price into the total field. It is the top row because it clears
 *   the most, and the panel names the cause rather than calling it a bargain.
 *   The potions are the case where two answers disagree and the smaller one is the true one: a
 *   vendor pays 32 each whatever happens, and the resale looks like 245 each until the Merchant's
 *   own shelf caps it at the 170 a vendor charges for one.
 *   The hide is an ordinary undercut, firm because three visits stand behind the median.
 *   The silk is the same shape with two visits behind it, so it is drawn and called thin.
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

/** The computed access `noPropertyAccessFromIndexSignature` asks for. See STYLE.md. */
function rowsOn(payload: Record<string, unknown>, field: string): Listing[] {
  return (payload[field] ?? []) as Listing[];
}

/**
 * The page a scan is looking at: the third browse's book with the underpriced rows folded in and
 * re-sorted, because the server sorts by display name then stack total and a fixture in any other
 * order is a page it could not have sent.
 */
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
 * In `world` rather than `run`: a player who logs in at the Merchant is reading a page before
 * this addon has drawn anything, and folding that page in is the first thing it does.
 */
function atTheMerchant(draft: WorldDraft): void {
  draft.set(draft.world, 'marketCollectPending', true);
  atCounter(draft, 0);
}

/**
 * The shipped floor table, on EVERY scenario rather than only the one that draws a deal.
 *
 * A scenario without it is a player whose fetch failed, which is a real state and is not the one
 * any of these picture: the two certain signals go quiet, and the panel that results looks like
 * the ordinary one with a couple of rows missing.
 */
const FLOOR_DATA = { 'floors.json': JSON.stringify(FLOORS) };

const SETTLE_MS = 60;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Let the addon's storage round trip and its queued repaint land.
 *
 * A real timer rather than a count of microtasks: the ledger is read back with one
 * `storage.keys()` and then a `get` per item, so its start-up is several promise hops
 * deep, and the repaint that follows rides a real animation frame here.
 */
async function drawn(stage: Stage): Promise<void> {
  stage.poll();
  await pause(SETTLE_MS);
  // The repaint rides `woc.paint`, which runs on the loader's own frame loop, and on the stage
  // that loop is driven by hand rather than by the browser. Without this the panel holds what
  // it read and draws none of it.
  stage.frame();
}

/** How long to wait for the item art manifest, which every label on screen comes from. */
const ART_MS = 5000;
const ART_POLL_MS = 50;

/**
 * Hold the shot until the art manifest has landed. `ui.icon.item` is optimistic and
 * `ui.icon.itemArtName` answers null until the manifest is read, so a picture taken before it
 * lands is a panel of raw item ids: honest about what the addon does when nothing has published
 * a name, and not what it looks like on a machine that has finished loading. Waited on the fact
 * rather than on a delay, and the first row is enough because one manifest answers for every row.
 */
function artLanded(
  stage: Stage,
  list = 'prices',
  wanted = (STALLS[0] as Stall).name,
): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      // A frame per look, for the reason `drawn` runs one: the manifest landing asks for a
      // repaint and nothing on the stage performs one unless a scenario says so.
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

/**
 * Three days of browsing, in the order they happened. The clock is moved between them, which is
 * what puts the readings at different ages and gives the trend line something to draw: every
 * stamp this addon keeps comes from `woc.wallClock()`.
 */
async function browsedForDays(stage: Stage): Promise<void> {
  await drawn(stage);
  await inSeries(BROWSES.slice(1).entries(), async ([step, ago]) => {
    const at = step + 1;
    stage.elapse((BROWSES[step] as number) - ago);
    atCounter(stage, at);
    await drawn(stage);
  });
}

/**
 * Open one of the panel's tabs, the way a player does. Clicked at the DOM rather than reached
 * for through the stage: the tab strip is the loader's `ui.tabs`, so a click is the same path a
 * player takes and a stage helper would be a second way in that only scenarios use.
 */
function openTab(label: string): void {
  const button = [...document.querySelectorAll('#woc-addons .woc-tab')].find(
    (el) => el.textContent === label,
  );
  (button as HTMLButtonElement | undefined)?.click();
}

/**
 * A size the frame is genuinely draggable to. The WIDTH is what fits three panes in one sheet:
 * the capture viewport is 1440 and each pane carries 24px a side with 16px between, so three of
 * these come to 1424 and anything wider is silently cropped at the right edge.
 *
 * The HEIGHT came down from 620 when the rows lost the 16px lane they were each carrying for a
 * trend line. A box is not allowed to shrink to fit a thin fixture, since the picture has to be
 * the panel a player gets on install, but a box sized around rows half this tall is a panel with
 * a third of itself empty, which reads as an addon that found nothing. It is set by the FULLEST
 * pane rather than the emptiest: the ledger is nine rows over a search field, and a box that
 * clips the ninth reads as broken in a Browse thumbnail, where a little air under six deal rows
 * does not.
 */
const WIDENED = { x: 80, y: 140, w: 416, h: 515 };

/**
 * THREE panes fit the sheet and a fourth does not: the capture viewport is 1440, each pane
 * carries 24px a side and they sit 16px apart, so `3 * (416 + 48) + 2 * 16` is 1424 and a fourth
 * would be cropped at the right edge with nothing to report it. Deals took the third slot from
 * Sold, because what a player decides on in Browse is whether an addon will find them money.
 */
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
      // The scan itself, which is a page read AFTER the history exists: a deal is a listing
      // judged against everything already written down, so a scenario that showed one with no
      // ledger behind it would be picturing a state the panel cannot reason from.
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
      // ASKED for, because the panel opens on Deals while the player is at a counter. Without
      // this the scenario photographs the Deals pane under a caption that says The ledger.
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
      // The TAB first, then the art wait on the list that tab shows. Waiting on Prices from here
      // costs the whole five second timeout, because the panel opens on Deals at a counter and a
      // pane it has switched away from is not what this shot is of.
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
    // The Merchant's own ledger holds fifty rows and counts what it dropped past that, and their
    // gold is still inside the total those rows are explaining. So a record read off it is
    // incomplete by a known amount, and the pane says by how much rather than presenting a short
    // list as a whole one. Worth looking at rather than photographing: the normal state is none.
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
    // Away from the counter, holding the last page it read: the state most of a session is spent
    // in, and the one the whole three-state read exists for. An empty market and a player
    // standing in a town are different facts and the panel says which.
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
    // Nothing recorded and nowhere near a Merchant, which is what a player meets on the
    // day they install this and is the state nobody thinks to photograph.
    id: 'empty',
    label: 'Before the first page is read',
    data: FLOOR_DATA,
    frames: { ledger: { box: WIDENED, visible: true } },
    world: noCounter,
    run: drawn,
  },
  {
    // The reconnect blip: the client force-nulls its own market mirror for one snapshot after a
    // reconnect, so a player standing at the counter reads away. The panel holds the page and
    // says it is resyncing. It lasts two seconds by design, so this scenario is worth looking at
    // rather than photographing.
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
