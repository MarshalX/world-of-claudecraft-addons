// Satchel on the stage: an account somebody has been playing for three days.
//
// Every pane is drawn from a record this addon wrote while its player was logged in, and the
// panes that matter are about a character who is NOT logged in now, so a scenario is a sequence
// of logins with `stage.elapse` putting the first two in the past. The switch is the real one:
// writing a fixture straight into storage would photograph a record shape rather than the
// recorder, which is the half that can actually be wrong.
//
// Only a reading taken AT the counter is recorded, so a scenario wanting an alt's bank has to
// stand that alt at one. Bruk never does, which is the ordinary case and what the roster's
// per-store ages are there to say.
//
// Every id ships painted art, from the deployed `/ui/items/mapping.json`, so a blank square in a
// shot is a real defect rather than a fixture naming a file that never existed.
// `silverleaf_herb` is in on purpose: its art is filed under "Sheenleaf Herb".

import { inSeries } from '../../loader/src/shared/sequence.ts';
import type { FrameState, Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { choosePicker } from '../../tests/fakes/controls.ts';
import { HELLO_FRAME } from '../../tests/fakes/frames.ts';
import { WALL_CLOCK_MS } from '../../tests/fakes/shared-services.ts';
import ITEMS from '../lorebind/items.json' with { type: 'json' };
import BAGS from './bags.json' with { type: 'json' };

/**
 * The shipped bag table, on EVERY scenario: without it the panel falls back to the pooled free
 * figure, the `Materials` chip goes, and a preview photographs the fallback with nothing on
 * screen looking wrong.
 */
const BAG_DATA = { 'bags.json': JSON.stringify(BAGS) };

const SILVER = 100;
const GOLD = 100 * SILVER;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A vault's stock from entry pairs, since an object literal keyed by item ids fails
 * `useNamingConvention`. See STYLE.md.
 */
function stockOf(rows: [string, number][]): Record<string, number> {
  return Object.fromEntries(rows);
}

/**
 * One reading behind both `vault.stock` and `craftVaultStock`, so the pane and the line under
 * it cannot drift apart.
 */
const MARSHAL_STOCK = stockOf([
  ['copper_ore', 400],
  ['iron_ore', 265],
  ['silverleaf_herb', 180],
  ['goldleaf_herb', 92],
  ['rough_hide', 340],
  ['spider_silk', 55],
  ['homespun_cloth', 210],
  ['arcane_dust', 34],
]);

/** One stack as the game hands it over: `InvSlot`, with the placement hint. */
interface Stack {
  itemId: string;
  count: number;
  /** The cell the player dragged it into. Absent for anything never moved by hand. */
  slot?: number;
  /**
   * The per-copy payload, which only your OWN bags and bank carry untrimmed. The lock inside it
   * is the one thing in a bag the player set by hand, so a picture of a bag is honest only if
   * some cell in it can be locked.
   */
  instance?: { locked?: boolean };
}

/** One letter in a mailbox, under the game's own field names. */
interface Letter {
  id: number;
  senderName: string;
  kind: string;
  subject: string;
  body: string;
  copper: number;
  items: Stack[];
  read: boolean;
}

/** A whole session: who was playing, what they had, and what they were standing at. */
interface Session {
  name: string;
  /** The class, which is what the game files skill art under. */
  templateId: string;
  copper: number;
  /** The four sockets, with null for one that is empty. */
  bags: (string | null)[];
  /** The pooled total the game hands over as one number. Read, never derived. */
  bagCapacity: number;
  inventory: Stack[];
  equipment: Record<string, string>;
  bank?: {
    slots: Stack[];
    capacity: number;
    purchasedSlots: number;
    bonusSlots: number;
    nextExpansionCost: number | null;
    bonusSources: Array<{ id: string; slots: number; maxSlots: number }>;
  };
  mail?: {
    messages: Letter[];
    totalCount: number;
    unread: number;
    postage: number;
    maxAttachments: number;
    deliverySeconds: number;
  };
  mailUnread: number;
  /**
   * The Materials Vault, read at the same bursar the bank is. Its own field rather than derived
   * from `bank`: the gates are separate and a scenario can put one without the other.
   */
  vault?: {
    stock: Record<string, number>;
    special: Stack[];
    upgrades: number;
    perMaterialCap: number;
    nextUpgradeCost: number | null;
  };
  /**
   * What crafting may draw from the vault where this character is STANDING, which is not gated
   * on a bursar at all: a record anywhere in the open world, null inside an instance.
   */
  craftVaultStock?: Record<string, number> | null;
}

/**
 * Bruk, three days ago: a bank mule with no bank. The ordinary case, and the one the roster's
 * per-store ages exist to report. A character's bags are recorded every time they are played and
 * a counter is recorded only if they walked up to one.
 */
const BRUK: Session = {
  name: 'Bruk',
  templateId: 'warrior',
  copper: 8 * GOLD + 12 * SILVER,
  bags: ['travelers_knapsack', 'linen_pouch', null, null],
  bagCapacity: 38,
  inventory: [
    { itemId: 'copper_ore', count: 20, slot: 0 },
    { itemId: 'copper_ore', count: 20, slot: 1 },
    { itemId: 'copper_ore', count: 14, slot: 2 },
    { itemId: 'iron_ore', count: 20, slot: 3, instance: { locked: true } },
    { itemId: 'rough_hide', count: 10 },
    { itemId: 'boar_hide', count: 7 },
    { itemId: 'game_meat', count: 12 },
    { itemId: 'healing_potion', count: 5 },
    { itemId: 'homespun_cloth', count: 16 },
    { itemId: 'homespun_cloth', count: 9 },
  ],
  equipment: { chest: 'mosshide_vest' },
  mailUnread: 0,
};

/**
 * The alt who banks. Her bank is the pane the game cannot draw once she is logged out, and it is
 * recorded only because this session stands her at one.
 */
const SENA: Session = {
  name: 'Sena',
  templateId: 'mage',
  copper: 214 * GOLD + 5 * SILVER + 60,
  bags: ['silkspun_satchel', 'linen_pouch', 'linen_pouch', null],
  bagCapacity: 44,
  inventory: [
    { itemId: 'arcane_dust', count: 20, slot: 0 },
    { itemId: 'arcane_dust', count: 11, slot: 1 },
    { itemId: 'arcane_essence', count: 6, slot: 2 },
    { itemId: 'mana_potion', count: 5 },
    { itemId: 'mana_potion', count: 5 },
    { itemId: 'silverleaf_herb', count: 18 },
    { itemId: 'goldleaf_herb', count: 4 },
    { itemId: 'spider_silk', count: 12 },
    { itemId: 'ghostly_essence', count: 2 },
  ],
  equipment: { chest: 'marshcloth_robe' },
  bank: {
    slots: [
      { itemId: 'copper_ore', count: 20 },
      { itemId: 'copper_ore', count: 20 },
      { itemId: 'iron_ore', count: 20 },
      { itemId: 'pristine_silk', count: 8 },
      { itemId: 'arcanite_bar', count: 3 },
      { itemId: 'runed_bone_shard', count: 5 },
      { itemId: 'silverleaf_herb', count: 20 },
      { itemId: 'goldleaf_herb', count: 16 },
      { itemId: 'healing_potion', count: 5 },
    ],
    capacity: 32,
    purchasedSlots: 8,
    bonusSlots: 0,
    nextExpansionCost: 40 * GOLD,
    bonusSources: [],
  },
  vault: {
    stock: stockOf([
      ['arcane_dust', 148],
      ['silverleaf_herb', 96],
      ['spider_silk', 40],
    ]),
    special: [],
    upgrades: 1,
    perMaterialCap: 200,
    nextUpgradeCost: 60 * GOLD,
  },
  mailUnread: 0,
};

/**
 * Two unread, which is what the title badge counts, and two parcels: an attachment is an item the
 * character owns and cannot see, so the index counts it like a bag cell.
 */
const LETTERS: Letter[] = [
  {
    id: 41,
    senderName: 'Sena',
    kind: 'player',
    subject: 'Ore for the smith',
    body: 'Took the rest to the bank. This lot is yours.',
    copper: 0,
    items: [
      { itemId: 'copper_ore', count: 20 },
      { itemId: 'iron_ore', count: 12 },
    ],
    read: false,
  },
  {
    id: 42,
    senderName: 'Auction House',
    kind: 'system',
    subject: 'Your sale: Pristine Hide',
    body: 'Your listing sold. The proceeds are attached.',
    copper: 14 * GOLD + 25 * SILVER,
    items: [],
    read: false,
  },
  {
    id: 43,
    senderName: 'Bruk',
    kind: 'player',
    subject: 'Herbs',
    body: 'Found these on the ridge, no use to me.',
    copper: 0,
    items: [{ itemId: 'silverleaf_herb', count: 9 }],
    read: true,
  },
  {
    id: 44,
    senderName: 'Emberlash',
    kind: 'player',
    subject: 'Thanks for the run',
    body: 'Same time next week?',
    copper: 0,
    items: [],
    read: true,
  },
];

/**
 * The character in play, at a banker and a mailbox at once, which puts a live reading behind all
 * three detail panes. The vest is worn and carried (spare), the ores are split across cells
 * (split), and the bank holds ore the bags hold too (carried). All three come from ids alone.
 */
const MARSHAL: Session = {
  name: 'Marshal',
  templateId: 'hunter',
  copper: 1462 * GOLD + 38 * SILVER + 4,
  bags: ['travelers_knapsack', 'wolfhide_satchel', 'linen_pouch', 'gravewoven_bag'],
  bagCapacity: 52,
  inventory: [
    { itemId: 'copper_ore', count: 20, slot: 0 },
    { itemId: 'copper_ore', count: 20, slot: 1 },
    { itemId: 'copper_ore', count: 7, slot: 2 },
    { itemId: 'iron_ore', count: 20, slot: 3, instance: { locked: true } },
    { itemId: 'iron_ore', count: 16, slot: 4 },
    { itemId: 'healing_potion', count: 5, slot: 8 },
    { itemId: 'healing_potion', count: 5, slot: 9 },
    { itemId: 'lesser_healing_potion', count: 12, slot: 10 },
    { itemId: 'mana_potion', count: 3, slot: 11 },
    { itemId: 'silverleaf_herb', count: 14, slot: 16 },
    { itemId: 'goldleaf_herb', count: 6, slot: 17 },
    { itemId: 'game_meat', count: 18, slot: 18 },
    { itemId: 'herbed_marsh_pike', count: 4, slot: 19 },
    { itemId: 'rough_hide', count: 10 },
    { itemId: 'boar_hide', count: 9 },
    { itemId: 'pristine_hide', count: 2 },
    { itemId: 'spider_silk', count: 11 },
    { itemId: 'homespun_cloth', count: 20 },
    { itemId: 'arcane_dust', count: 4 },
    { itemId: 'ghostly_essence', count: 1 },
    { itemId: 'mosshide_vest', count: 1 },
    { itemId: 'inert_storm_shard', count: 1 },
    { itemId: 'meltwater_flask', count: 2 },
    { itemId: 'chunk_of_ore', count: 6 },
  ],
  equipment: {
    chest: 'mosshide_vest',
    head: 'ashstalker_cowl',
    hands: 'shardfang_grips',
    waist: 'silk_sash',
  },
  bank: {
    slots: [
      { itemId: 'copper_ore', count: 20 },
      { itemId: 'iron_ore', count: 20 },
      { itemId: 'iron_ore', count: 20 },
      { itemId: 'arcanite_bar', count: 6 },
      { itemId: 'pristine_hide', count: 4 },
      { itemId: 'pristine_silk', count: 12 },
      { itemId: 'ghostly_essence', count: 3 },
      { itemId: 'runed_bone_shard', count: 2 },
      { itemId: 'goldleaf_herb', count: 20 },
      { itemId: 'goldleaf_herb', count: 20 },
      { itemId: 'silverleaf_herb', count: 20 },
      { itemId: 'healing_potion', count: 5 },
      { itemId: 'kazzix_heartshard', count: 1 },
      { itemId: 'sanctum_key_shard', count: 3 },
    ],
    capacity: 40,
    purchasedSlots: 16,
    bonusSlots: 8,
    nextExpansionCost: 120 * GOLD,
    bonusSources: [
      { id: 'guild', slots: 4, maxSlots: 8 },
      { id: 'quest', slots: 4, maxSlots: 4 },
    ],
  },
  mail: {
    messages: LETTERS,
    totalCount: LETTERS.length,
    unread: 2,
    postage: 30,
    maxAttachments: 3,
    deliverySeconds: 45,
  },
  mailUnread: 2,
  /**
   * One material AT the cap, since the full row is what the pane is for, and `resonant_steel`
   * in `special` because a crafted stack keeps an identity and cannot collapse into a count.
   */
  vault: {
    stock: MARSHAL_STOCK,
    special: [{ itemId: 'resonant_steel', count: 4 }],
    upgrades: 2,
    perMaterialCap: 400,
    nextUpgradeCost: 250 * GOLD,
  },
  // In the open world at a bursar, so the draw is allowed and reaches everything above.
  craftVaultStock: MARSHAL_STOCK,
};

/**
 * A general pool with nothing left in it and a reagent satchel seven cells open beside it. 16
 * backpack plus a 6 cell Linen Pouch is 22 general, a 20 cell Necromancer's Reagent Satchel is
 * 20 materials, 42 pooled; of the 35 cells in use, 13 are materials and pack into the satchel,
 * and the other 22 fill the general pool exactly, so the strip reads 35 of 42 with nothing free
 * and a `Materials` chip of seven.
 *
 * NOT a preview: the satchel is a game 0.41.0 id the stage's default channel can lack. Nothing
 * here draws its art, so the picture is right on either channel, but a committed artifact must
 * not depend on the id.
 */
const HAULING: Session = {
  name: 'Marshal',
  templateId: 'hunter',
  copper: 1462 * GOLD + 38 * SILVER + 4,
  bags: ['linen_pouch', 'necromancers_reagent_satchel', null, null],
  bagCapacity: 42,
  inventory: [
    // 13 cells the game counts as materials, which is what the satchel will take.
    { itemId: 'copper_ore', count: 20, slot: 0 },
    { itemId: 'copper_ore', count: 20, slot: 1 },
    { itemId: 'copper_ore', count: 7, slot: 2 },
    { itemId: 'iron_ore', count: 20, slot: 3, instance: { locked: true } },
    { itemId: 'iron_ore', count: 16, slot: 4 },
    { itemId: 'silverleaf_herb', count: 20, slot: 5 },
    { itemId: 'silverleaf_herb', count: 14, slot: 6 },
    { itemId: 'goldleaf_herb', count: 6, slot: 7 },
    { itemId: 'rough_hide', count: 20, slot: 8 },
    { itemId: 'rough_hide', count: 10, slot: 9 },
    { itemId: 'spider_silk', count: 11, slot: 10 },
    { itemId: 'homespun_cloth', count: 20, slot: 11 },
    { itemId: 'arcane_dust', count: 4, slot: 12 },
    // 22 cells nothing but the general pool will take, which is exactly what it has.
    { itemId: 'healing_potion', count: 5 },
    { itemId: 'healing_potion', count: 5 },
    { itemId: 'healing_potion', count: 5 },
    { itemId: 'healing_potion', count: 2 },
    { itemId: 'lesser_healing_potion', count: 12 },
    { itemId: 'lesser_healing_potion', count: 12 },
    { itemId: 'lesser_healing_potion', count: 4 },
    { itemId: 'mana_potion', count: 5 },
    { itemId: 'mana_potion', count: 5 },
    { itemId: 'mana_potion', count: 3 },
    { itemId: 'herbed_marsh_pike', count: 4 },
    { itemId: 'herbed_marsh_pike', count: 4 },
    { itemId: 'ghostly_essence', count: 3 },
    { itemId: 'ghostly_essence', count: 1 },
    { itemId: 'boar_hide', count: 20 },
    { itemId: 'boar_hide', count: 20 },
    { itemId: 'boar_hide', count: 9 },
    { itemId: 'chunk_of_ore', count: 20 },
    { itemId: 'chunk_of_ore', count: 6 },
    { itemId: 'meltwater_flask', count: 2 },
    { itemId: 'inert_storm_shard', count: 1 },
    { itemId: 'mosshide_vest', count: 1 },
  ],
  equipment: {
    chest: 'mosshide_vest',
    head: 'ashstalker_cowl',
    hands: 'shardfang_grips',
    waist: 'silk_sash',
  },
  mailUnread: 0,
};

/** Stand a session's character in the world, counters and all. */
function beThem(draft: WorldDraft, who: Session): void {
  const { world, player } = draft;
  draft.set(player, 'name', who.name);
  draft.set(player, 'templateId', who.templateId);
  draft.set(world, 'inventory', who.inventory);
  draft.set(world, 'bags', who.bags);
  draft.set(world, 'bagCapacity', who.bagCapacity);
  draft.set(world, 'copper', who.copper);
  draft.set(world, 'equipment', who.equipment);
  draft.set(world, 'bankInfo', who.bank ?? null);
  draft.set(world, 'vaultInfo', who.vault ?? null);
  draft.set(world, 'mailInfo', who.mail ?? null);
  draft.set(world, 'mailUnread', who.mailUnread);
  draft.set(world, 'craftVaultStock', who.craftVaultStock ?? null);
}

/**
 * Point the character selector at somebody through the real control: the picker is the kit's
 * button and menu rather than a `<select>`, and a selector that matches nothing fails silently.
 */
function choosePicked(name: string): void {
  choosePicker(document.querySelector('[data-role="picker"]') ?? document, name);
}

/**
 * Walk away from a counter, which is a null payload and NOT an empty store. The vault is its
 * own `set`, so a scenario can leave one without the other.
 */
function leaveCounters(draft: WorldDraft): void {
  draft.set(draft.world, 'bankInfo', null);
  draft.set(draft.world, 'vaultInfo', null);
  draft.set(draft.world, 'mailInfo', null);
}

const SETTLE_MS = 80;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Let the addon's storage round trip and its queued repaint land.
 *
 * A real timer rather than a turn count: the records are read with one `storage.keys()` and a
 * `get` per character, so start-up is several promise hops deep.
 */
async function drawn(stage: Stage): Promise<void> {
  stage.poll();
  await pause(SETTLE_MS);
  // The repaint rides `woc.paint`, which runs on the loader's own frame loop, and on the stage
  // that loop is driven by hand rather than by the browser. Without this the panel holds
  // everything it read and draws none of it.
  stage.frame();
}

/** How long to let a session's art finish before the next one paints over it. */
const IMAGES_MS = 8000;
const IMAGES_POLL_MS = 60;

/**
 * Hold a switch until this character's art has loaded. A bag cell is REUSED, so logging in as
 * somebody else reassigns `src` and the cancelled request lands as `net::ERR_ABORTED`, which
 * `pnpm shots` is right to refuse to photograph: a transport failure and an item with no art
 * produce the same collapsed slot. A player switching characters leaves a beat too.
 */
function imagesSettled(): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      const images = [...document.querySelectorAll<HTMLImageElement>('#woc-addons img')];
      if (images.every((img) => img.complete) || waited >= IMAGES_MS) {
        resolve();
        return;
      }
      waited += IMAGES_POLL_MS;
      setTimeout(look, IMAGES_POLL_MS);
    };
    look();
  });
}

/** How far `playedForDays` moves the clock, which is the age of the oldest session in it. */
const PLAYED_MS = 3 * DAY_MS;

/** The sessions behind the shot, in the order they happened, and how long ago. */
const HISTORY: readonly (readonly [Session, number])[] = [
  [BRUK, PLAYED_MS],
  [SENA, 20 * HOUR_MS],
  [MARSHAL, 0],
];

/**
 * Play the account forward: three characters, three days. Bruk is already in the world when the
 * addon starts, so the loop below picks up at Sena. The clock is moved between logins, which is
 * what puts the readings at different ages: every stamp this addon keeps is a `woc.wallClock()`
 * reading.
 */
async function playedForDays(stage: Stage): Promise<void> {
  await drawn(stage);
  await imagesSettled();
  await inSeries(HISTORY.slice(1).entries(), async ([step, [who, ago]]) => {
    const previous = HISTORY[step] as readonly [Session, number];
    stage.elapse(previous[1] - ago);
    beThem(stage, who);
    await drawn(stage);
    await imagesSettled();
  });
  await artLanded(stage);
}

/** How long to wait for the item art manifest, which every label on screen comes from. */
const ART_MS = 5000;
const ART_POLL_MS = 50;

/**
 * The one label that PROVES the manifest landed: `silverleaf_herb` files its art under "Sheenleaf
 * Herb", so it reads differently either way where every other row reads the same.
 */
const ART_PROOF = 'Sheenleaf Herb';

/**
 * Hold the shot until the art manifest has landed. `ui.icon.item` is optimistic and
 * `ui.icon.itemArtName` answers null until the manifest is read, so a picture taken before it
 * lands is a panel of ids read back as words.
 */
function artLanded(stage: Stage): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      // A frame per look, for the reason `drawn` runs one: the manifest landing asks for a
      // repaint and nothing on the stage performs one unless a scenario says so.
      stage.frame();
      const labels = [...document.querySelectorAll('[data-list="items"] .woc-bar-label')];
      if (labels.some((el) => el.textContent === ART_PROOF) || waited >= ART_MS) {
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
 * Open one of the panel's tabs, the way a player does. Clicked at the DOM rather than reached for
 * through the stage: the strip is the loader's `ui.tabs`, so a click is the same path a player
 * takes and a stage helper would be a second way in that only scenarios use.
 */
function openTab(label: string): void {
  const button = [...document.querySelectorAll('#woc-addons .woc-tab')].find(
    (el) => el.textContent === label,
  );
  (button as HTMLButtonElement | undefined)?.click();
}

async function onTab(stage: Stage, label: string): Promise<void> {
  await playedForDays(stage);
  openTab(label);
  stage.frame();
  await pause(SETTLE_MS);
}

/** A size the frame is genuinely draggable to: at its opening 380 by 460 the shot is chrome. */
const WIDENED = { x: 80, y: 120, w: 420, h: 560 };

/**
 * ONE height for both preview panels: a sheet centres its panes against each other, so two of
 * different heights read as one that has slipped. Matched on the GRID's, since a list pane is
 * full at any height and a bag grid is only as tall as its cell ceiling. The height is the
 * frame's own, which lands the grid on exactly five whole rows: a bag ending on a half row of
 * empty sockets is the one thing in this shot that reads as the panel having been cut off.
 */
const SHEET_BOX = { x: 80, y: 120, w: 420, h: 460 };

function framed(box: typeof WIDENED = WIDENED): Record<string, FrameState> {
  return { bags: { box, visible: true } };
}

/** Bruk's session, which is the world the addon body wakes up in. See the header. */
function asBruk(draft: WorldDraft): void {
  beThem(draft, BRUK);
}

/**
 * The hello frame, which is where the REALM comes from.
 *
 * Without it `world.characterKey` reads `offline/<name>` and this addon records no realm for
 * anybody, so a published market price matches nothing and the panel silently falls back to the
 * vendor floor. That is a real state, a player who has not entered the world, and it is not the
 * state any of these scenarios are of.
 */
function joined(stage: Stage): void {
  stage.inbound(HELLO_FRAME);
}

/** What a running lorebind answers an `items` ask with, out of its own committed table. */
const LOREBIND_FQID = 'official/lorebind';
const ITEMS_TOPIC = 'items';

/** The other companion, which is the only thing that knows what anything GOES FOR. */
const LEDGERLINE_FQID = 'official/ledgerline';
const PRICES_TOPIC = 'prices';
/** The realm the shared world fixture is on, which every price has to name to be spent. */
const REALM = 'Claudemoon';

/**
 * A handful of prices, at what a ledger three days old would carry: a multiple of the vendor
 * floor rather than a figure invented here, since the point of the pair is the GAP between the
 * two. `visits` is what says how much is behind each, and the herb at one is deliberate: a
 * single reading is one seller's asking price and the panel discloses that it counted one.
 */
const ASKING: readonly (readonly [string, number, number])[] = [
  ['copper_ore', 420, 6],
  ['iron_ore', 900, 4],
  ['boar_hide', 260, 3],
  ['rough_hide', 180, 5],
  ['healing_potion', 1100, 7],
  ['silverleaf_herb', 640, 1],
  ['goldleaf_herb', 1500, 4],
  ['homespun_cloth', 310, 6],
  ['spider_silk', 2200, 3],
  ['arcane_dust', 1750, 5],
];

/**
 * The companions, standing in.
 *
 * This addon names two and neither was ever in a picture. Until this existed every shot was the
 * unpaired panel: no worth figure, no tier on a square, no price under the pointer, and the
 * label on half the rows an id read back as words. So the state the manifest RECOMMENDS was
 * invisible in every artifact this repository ships, the committed preview a player reads in
 * Browse included. Ledgerline's stage has stood lorebind in for the same reason since it was
 * written.
 *
 * BOTH PREVIEW PANELS use it, rather than a scenario of its own beside them, for the reason
 * ledgerline's does: a thumbnail should picture what a player gets when they take the addon's
 * own advice. The six scenarios below it stay unpaired, which is where the other honest state
 * is still there to look at.
 *
 * lorebind's whole table rather than the ids this fixture names: the panel pools three
 * characters' bags, banks and mailboxes, and narrowing it to a list would be a list to keep in
 * step.
 */
function lorebindSpeaks(stage: Stage): void {
  stage.publish(LOREBIND_FQID, ITEMS_TOPIC, ITEMS.items);
}

/** What a running ledgerline answers a `prices` ask with, for the ids this fixture holds. */
function ledgerlineSpeaks(stage: Stage): void {
  const rows = ASKING.map(([id, unit, visits]) => ({
    id,
    realm: REALM,
    unit,
    low: Math.round(unit * 0.9),
    latest: unit,
    // Four hours ago, on the clock the three logins left behind: `playedForDays` elapses the
    // whole of `HISTORY`, so a stamp taken from the raw start would read as three days old and
    // the panel would say so, which is a different picture from the one this scenario is of.
    at: WALL_CLOCK_MS + PLAYED_MS - 4 * HOUR_MS,
    visits,
  }));
  stage.publish(LEDGERLINE_FQID, PRICES_TOPIC, rows);
}

/** The pair, on the tab a scenario has already opened. See `lorebindSpeaks`. */
async function paired(stage: Stage, label: string): Promise<void> {
  joined(stage);
  await onTab(stage, label);
  lorebindSpeaks(stage);
  ledgerlineSpeaks(stage);
  stage.frame();
  await pause(SETTLE_MS);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'items',
    label: 'Every item on the account',
    data: BAG_DATA,
    preview: true,
    caption: 'Everything you own',
    alt: 'one row an item, pooled across every character and searchable, sortable and filterable by who holds it, each name coloured by its tier, with what the whole list goes for at the Merchant along the bottom',
    frames: framed(SHEET_BOX),
    world: asBruk,
    run: (stage) => paired(stage, 'Items'),
  },
  {
    id: 'bags',
    label: 'The bags, live',
    data: BAG_DATA,
    preview: true,
    caption: 'One character, live',
    alt: 'the bags of the character in play, as a grid of squares bordered by item tier, one of them padlocked',
    frames: framed(SHEET_BOX),
    world: asBruk,
    run: (stage) => paired(stage, 'Bags'),
  },
  {
    id: 'bank',
    label: 'The bank, standing at one',
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: (stage) => onTab(stage, 'Bank'),
  },
  {
    id: 'mail',
    label: 'The mailbox, two unread',
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: (stage) => onTab(stage, 'Mail'),
  },
  {
    id: 'roster',
    label: 'Three characters',
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: (stage) => onTab(stage, 'Roster'),
  },
  {
    // The pair on the pane that pools every character, which is where a price crosses realms
    // and has to say what it left out. Not a preview: the two above already picture the pair.
    id: 'priced-roster',
    label: 'The roster, with both companions',
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: (stage) => paired(stage, 'Roster'),
  },
  {
    // An alt's bank, read while logged in as somebody else. The pane the client cannot
    // draw at all, and the whole reason this addon keeps a record.
    id: 'alt-bank',
    label: "An alt's bank, from another character",
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: async (stage) => {
      await onTab(stage, 'Bank');
      choosePicked('Sena');
      stage.frame();
      await pause(SETTLE_MS);
    },
  },
  {
    // Walked away from both counters, holding the last reading of each. The state most
    // of a session is spent in, and the one the three-state read exists for.
    id: 'away',
    label: 'Walked away from the counters',
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: async (stage) => {
      await onTab(stage, 'Bank');
      leaveCounters(stage);
      await drawn(stage);
    },
  },
  {
    // The vault at a bursar, live: one material at the cap and one crafted stack as a square.
    id: 'vault',
    label: 'The vault, at a bursar',
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: (stage) => paired(stage, 'Vault'),
  },
  {
    // An alt's vault, drawn while logged in as somebody else and nowhere near a bursar.
    id: 'alt-vault',
    label: "An alt's vault, from another character",
    data: BAG_DATA,
    frames: framed(),
    world: asBruk,
    run: async (stage) => {
      await onTab(stage, 'Vault');
      lorebindSpeaks(stage);
      leaveCounters(stage);
      choosePicked('Sena');
      await drawn(stage);
    },
  },
  {
    // A full general pool with a reagent satchel open beside it. See `HAULING`.
    id: 'pools',
    label: 'Full bags with a reagent satchel open',
    data: BAG_DATA,
    frames: framed(),
    world: (draft) => {
      beThem(draft, HAULING);
      leaveCounters(draft);
    },
    run: drawn,
  },
  {
    // The day the addon is installed: one character recorded, nothing else played yet, and
    // nowhere near a counter. The state nobody thinks to photograph.
    id: 'fresh',
    label: 'The day you install it',
    data: BAG_DATA,
    frames: framed(),
    world: (draft) => {
      beThem(draft, MARSHAL);
      leaveCounters(draft);
    },
    run: drawn,
  },
];

export { SCENARIOS };
