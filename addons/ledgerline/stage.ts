// Ledgerline on the stage: a ledger somebody has been keeping for three days.
//
// The state worth photographing cannot be walked into. The server keeps no price history, so the
// only history that exists is the one this addon wrote down while its player browsed, and a
// panel with anything in it belongs to somebody who has stood at the Merchant on several
// different days. A scenario states those days: three browses, with `stage.elapse` putting the
// first two in the past.
//
// Every item id here ships painted art, taken from the deployed `/ui/items/mapping.json`, so a
// missing icon in a shot is a real defect rather than a fixture naming a file that never
// existed. `silverleaf_herb` is in the list on purpose: its art is filed under "Sheenleaf Herb",
// one of the 21 ids in 303 where the art name and the game's own display name disagree, and it
// is the case the label under every row is hedging about.
//
// The others section is sorted the way the server sorts it, by display name and then by the
// stack's total price. The undercut check reads exactly that ordering to find the cheapest
// competing listing without knowing what anything is called, so a fixture in any other order
// would be a page the server could not have sent.
//
// The three verdicts are all on screen at once, which is the point of the Yours panel. The
// copper ore is undercut by both readings, total and per item; the pristine hide is the cheapest
// on the page; and nobody else is selling goldleaf on the page that was read, which reads as
// "not on this page" rather than as "you are the cheapest".

import { inSeries } from '../../loader/src/shared/sequence.ts';
import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

const SILVER = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The Merchant's own terms, which are the game's real ones. The suite deliberately uses figures
 * that are not these, so that an addon which wrote either down could not agree with its fixture
 * by accident. A photograph wants the opposite: what a player actually reads at the counter.
 */
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
 * The pending sale ledger, browse by browse, which is a QUEUE rather than a table: it grows as
 * sales land and empties the moment the player collects.
 *
 * The collect between the second browse and the third is what makes this fixture worth having.
 * The first three sales are gone from the wire by the time the shot is taken and are still on
 * screen, which is the only state that shows what the Sold pane is for: a record that survives a
 * drain nothing announces. Two of them are copper ore, so that pane has a line to draw as well.
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
 * One item as the market carried it, browse by browse.
 *
 * `units` is a price per item and the wire carries the stack total, which is the arithmetic this
 * addon exists to get right: the rows below are built by multiplying, exactly as a seller does.
 *
 * A browse with no unit price is a browse where nobody had any: `goldleaf_herb` runs out before
 * the last one, which leaves the player holding the only listing of it.
 */
interface Stall {
  item: string;
  /** The art name, which is what this fixture sorts by. See the header. */
  name: string;
  units: readonly number[];
  stacks: readonly Stack[];
}

/**
 * The book, in display-name order.
 *
 * Nine items over three days, chosen so the trend column has something to say: copper
 * ore and spider silk are falling, iron ore and pristine hide are climbing, and the
 * herbs are roughly where they were.
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
 * What this player is selling, posted six hours before the shot.
 *
 * All three verdicts at once, which is what makes the Yours panel worth photographing.
 * The ore and the silk are beaten on the total AND on the price per item, so neither row
 * is arguable; the two hides and the iron are under everybody; and the only other
 * goldleaf seller ran out, so the page carries nothing at all to compare that one
 * against, which is the verdict this addon is careful about.
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
 * Everyone else's rows, in the order the server sends them.
 *
 * By display name and then by the stack's total, computed rather than typed, because
 * the undercut check reads that ordering and a fixture that drifted out of it would
 * quietly describe a page the server never sends.
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
 * The same counter after more has sold than the Merchant will itemize.
 *
 * The two rows are sales the third browse had not seen, because that is what an omission
 * MEANS: fourteen sales landed behind the two already recorded and pushed them out, so the
 * rows still on the wire are the newest and not the ones already written down. The dropped
 * gold rides the collection total, which is both what the game does (a dropped row never
 * drops its copper) and what makes the page move at all, since the loader's market signature
 * reads that total and not the ledger behind it.
 *
 * The pane says twelve rather than fourteen, and that is the point of the scenario. Two of
 * the fourteen the server dropped were read before they went, so the number worth showing a
 * player is how many sales of theirs are missing from THIS record, which is a figure only
 * something keeping its own position in the queue can work out.
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

/** Walk away, which is a null page and NOT an empty market. */
function noCounter(draft: WorldDraft): void {
  draft.set(draft.world, 'marketInfo', null);
}

/**
 * The session as it stood before the addon ran a line: at the counter, three days ago.
 *
 * In `world` rather than in `run` because a player who logs in at the Merchant is
 * reading a page before this addon has drawn anything, and the first thing it does with
 * its stored ledger is fold that page into it.
 */
function atTheMerchant(draft: WorldDraft): void {
  draft.set(draft.world, 'marketCollectPending', true);
  atCounter(draft, 0);
}

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
function artLanded(): Promise<void> {
  const wanted = (STALLS[0] as Stall).name;
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      const label = document.querySelector('[data-list="prices"] .woc-bar-label')?.textContent;
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
  await artLanded();
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
 * The panel as a player who has widened it holds it. The addon opens at 400 by 480, which spends
 * nearly half its height on chrome that cannot scroll: the tab strip, the status strip, the
 * sentence under it, the search field and the note. A shot at the opening size is four rows of
 * ledger under all of that. This is a size the frame is genuinely draggable to.
 *
 * The width is also what makes three panes fit in one picture. `pnpm shots` lays a sheet out in a
 * 1440px viewport and each pane carries 24px of its own on each side with 16px between them, so
 * three of these come to 1424 and a wider box is silently cropped at the right edge. Found by
 * looking at the capture: the third panel's prices were simply not in it.
 */
const WIDENED = { x: 80, y: 140, w: 416, h: 620 };

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'prices',
    label: 'The ledger, three days in',
    preview: true,
    caption: 'The ledger',
    alt: "the Prices tab of a panel headed Ledgerline (to collect), with a strip over the list reading at the Merchant, page 1 of 1, a 5 percent cut, 6 of 12 listing slots used and 33 silver 6 copper and 2 items waiting to be collected. Under a search field, seven item rows fenced off by a rule at each end, each carrying the game's own art, its price as coins (a disc per unit, gold, silver or copper, with the empty units left out) and a chart across the bottom of the row: Copper Ore, low 44 copper over a median of 48 and 3 visits; Ghostly Essence, low 7 silver 80; Healing Potion, low 2 silver 45; Iron Ore, low 1 silver 5; Pristine Hide, low 14 silver; Rough Hide, low 84 copper; and Sheenleaf Herb, low 1 silver 8, its chart cut off by the scrolling list. Every figure is one vote per visit to the counter rather than one per listing, and each chart has one point per visit: copper ore falls across the three days and iron ore and pristine hide climb. A footer reads 9 items recorded, keeping 30 days.",
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: browsedForDays,
  },
  {
    id: 'mine',
    label: 'Your own listings',
    preview: true,
    caption: 'Your listings',
    alt: "the Yours tab of the same panel, with the same strip over six listings of the player's own, each asking a price in the game's own coins. Copper Ore asking 9 silver and Spider Silk asking 6 silver 20 are washed red and read undercut, because a cheaper listing of each leads its block on the page that was read. Goldleaf Herb asking 17 silver reads not on this page, which is the panel refusing to call it uncontested: nobody else was selling any, and an item missing from a page is not an item nobody is selling. Iron Ore at 26 silver, Pristine Hide at 15 silver and Rough Hide at 8 silver 60 read cheapest on this page. Every row also gives the price per item, carries that item's own price chart across the bottom of it, and says the listing was first seen by you 6 hours ago, which is this addon's own record rather than an expiry, since no listing on the wire carries one. Under a rule, a footer reads that the verdicts are judged from the page you are reading now, which is not the whole market.",
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      openTab('Yours');
      await pause(SETTLE_MS);
    },
  },
  {
    id: 'sold',
    label: 'What it actually sold for',
    preview: true,
    caption: 'What sold',
    alt: "the Sold tab of the same panel, over the same strip, listing four items the player has actually sold. Each row gives what a buyer paid per item, in the game's own coins, over a chart of the same: Copper Ore paid 48 copper, over 2 sales, 40 sold and 18 silver 24 copper after the cut, last read moments ago, and it is the only row carrying a chart, because two sales are the fewest that can be a line; Iron Ore paid 1 silver 28, 1 sale of 20 and 24 silver 32 after the cut, last read moments ago; Spider Silk paid 66 copper, 1 sale of 10 and 6 silver 27 after the cut, last read 6 hours ago; and Rough Hide paid 88 copper, 1 sale of 10 and 8 silver 36 after the cut, last read 3 days ago. Three of those five sales were collected before the picture was taken and are gone from the Merchant entirely, which is the state this pane exists for: the ledger it reads is emptied the moment a player collects, so a sale is only ever recorded once and never read back. None of these figures is on the Prices tab, because what was paid and what is being asked are two series and neither is folded into the other. A footer reads 4 items sold, keeping 30 days.",
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      openTab('Sold');
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
    frames: { ledger: { box: WIDENED, visible: true } },
    world: atTheMerchant,
    run: async (stage) => {
      await browsedForDays(stage);
      overCapped(stage);
      await drawn(stage);
      openTab('Sold');
      await pause(SETTLE_MS);
    },
  },
  {
    // Away from the counter, holding the last page it read: the state most of a session is spent
    // in, and the one the whole three-state read exists for. An empty market and a player
    // standing in a town are different facts and the panel says which.
    id: 'away',
    label: 'Walked away from the Merchant',
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
