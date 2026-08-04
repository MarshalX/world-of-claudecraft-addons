// Satchel on the stage: an account somebody has been playing for three days.
//
// The state worth photographing cannot be walked into, which is the same reason ledgerline's
// scenarios are shaped the way they are. Every pane here is drawn from a record this addon wrote
// down while its player was logged in, and the panes that matter are the ones about a character
// who is not logged in now. So a scenario is a sequence of logins: Bruk three days ago, Sena
// yesterday, Marshal now, with `stage.elapse` putting the first two in the past.
//
// The switch is the real one. The game clones and removes its HUD rather than reloading, so a
// character change inside one page load is an ordinary event and `world.characterKey` moves with
// it. Writing a fixture straight into storage would photograph a record shape rather than the
// recorder, which is the half that has actually been wrong before.
//
// Only a reading taken at the counter is recorded, so a scenario that wants an alt's bank has to
// stand that alt at one. Bruk never does, which is the ordinary case and is what the roster's
// per-store ages are there to say.
//
// Every item id ships painted art, taken from the deployed `/ui/items/mapping.json`, so a blank
// square in a shot is a real defect rather than a fixture naming a file that never existed.
// `silverleaf_herb` is in on purpose: its art is filed under "Sheenleaf Herb", one of the 21 ids
// in 303 where the art name and the game's own display name disagree.

import { inSeries } from '../../loader/src/shared/sequence.ts';
import type { FrameState, Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';

const SILVER = 100;
const GOLD = 100 * SILVER;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** One stack as the game hands it over: `InvSlot`, with the placement hint. */
interface Stack {
  itemId: string;
  count: number;
  /** The cell the player dragged it into. Absent for anything never moved by hand. */
  slot?: number;
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
    { itemId: 'iron_ore', count: 20, slot: 3 },
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
 * Sena, yesterday: the alt who actually banks.
 *
 * Her bank is the pane the game cannot draw at all once she is logged out, and it is
 * recorded because this session stands her at a banker.
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
  mailUnread: 0,
};

/**
 * The mailbox Marshal is standing at. Two unread, which is what the title badge counts, and two
 * of the letters carry a parcel: an attachment is an item the character owns and cannot see, so
 * the index counts it exactly like a bag cell.
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
 * Marshal, now: the character in play, at a banker and a mailbox at once. Not a state a player is
 * often in, and it is the one worth photographing: it puts a live reading behind all three detail
 * panes at the same time.
 *
 * `mosshide_vest` is worn and in the bags, which is the spare mark; the ores are split across
 * cells, which is the split mark; and the bank holds copper ore the bags hold too, which is the
 * carried mark. All three come from ids alone.
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
    { itemId: 'iron_ore', count: 20, slot: 3 },
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
  draft.set(world, 'mailInfo', who.mail ?? null);
  draft.set(world, 'mailUnread', who.mailUnread);
}

/** Walk away from a counter, which is a null payload and NOT an empty store. */
function leaveCounters(draft: WorldDraft): void {
  draft.set(draft.world, 'bankInfo', null);
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
 * A real timer rather than a count of microtasks: the records are read back with one
 * `storage.keys()` and then a `get` per character, so start-up is several promise hops
 * deep, and every repaint after it rides a real animation frame here.
 */
async function drawn(stage: Stage): Promise<void> {
  stage.poll();
  await pause(SETTLE_MS);
}

/** How long to let a session's art finish before the next one paints over it. */
const IMAGES_MS = 8000;
const IMAGES_POLL_MS = 60;

/**
 * Hold a character switch until this character's art has finished loading.
 *
 * A bag cell is reused rather than rebuilt, so logging in as somebody else points the same square
 * at a different item: `src` is reassigned, the browser cancels the request in flight, and the
 * abandoned request lands as `net::ERR_ABORTED`. On screen that is invisible and correct. To
 * `pnpm shots` it is a failed request, and that tool is right to refuse to photograph one: a
 * transport failure and an item the game ships no art for produce the same collapsed slot.
 *
 * So the scenario waits rather than the tool relaxing. A player switching characters genuinely
 * does leave a beat between logins.
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

/** The sessions behind the shot, in the order they happened, and how long ago. */
const HISTORY: readonly (readonly [Session, number])[] = [
  [BRUK, 3 * DAY_MS],
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
  await artLanded();
}

/** How long to wait for the item art manifest, which every label on screen comes from. */
const ART_MS = 5000;
const ART_POLL_MS = 50;

/**
 * The one label in this fixture that proves the manifest landed. `silverleaf_herb` files its art
 * under "Sheenleaf Herb", one of the 21 ids in 303 where the art name and the game's display name
 * disagree. That divergence is what makes it usable as a signal: every other row reads the same
 * either way, so waiting on a label that merely looks like a name would resolve immediately.
 */
const ART_PROOF = 'Sheenleaf Herb';

/**
 * Hold the shot until the art manifest has landed. `ui.icon.item` is optimistic and
 * `ui.icon.itemArtName` answers null until the manifest is read, so a picture taken before it
 * lands is a panel of ids read back as words.
 */
function artLanded(): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
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
  await pause(SETTLE_MS);
}

/**
 * The panel as a player who has widened it holds it. The addon opens at 340 by 420, which is a
 * bag grid six squares across under five tabs: a picture of the chrome. This is a size the frame
 * is genuinely draggable to.
 */
const WIDENED = { x: 80, y: 120, w: 420, h: 560 };

/**
 * The box both preview panels are seeded with, which is shorter than the one above. One height
 * rather than two: a sheet lays its panes out in a row and centres them against each other, so
 * two panels of different heights read as one that has slipped. The height to match on is the
 * grid's, since a list pane is full at any height and a bag grid is only as tall as its cell
 * ceiling.
 */
const SHEET_BOX = { x: 80, y: 120, w: 420, h: 440 };

function framed(box: typeof WIDENED = WIDENED): Record<string, FrameState> {
  return { bags: { box, visible: true } };
}

/** Bruk's session, which is the world the addon body wakes up in. See the header. */
function asBruk(draft: WorldDraft): void {
  beThem(draft, BRUK);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'items',
    label: 'Every item on the account',
    preview: true,
    caption: 'Everything you own',
    alt: "the Items tab of a panel headed Satchel (2 unread), over a search field reading every character, every store. Nine rows, one per item rather than one per stack, each with the game's own art, a total on the right and a faint line under it naming who holds them: Bristly Boar Hide 16, Marshal 9, Bruk 7; Chime Dust 35, Marshal 4, Sena 31; Chime Essence 6, Sena 6; Chunk Of Ore 6, Marshal 6; Copper Ore 181, Marshal 87, Bruk 54, +1 more; Game Meat 30, Marshal 18, Bruk 12; Ghostly Essence 6, Marshal 4, Sena 2; Glyphsteel Bar 9, Marshal 6, Sena 3; and Goldleaf Herb 66, Marshal 46, Sena 20, the last of them cut off by the scrolling list. Each row is washed to a width that is its share of the largest pile, so Copper Ore fills its row and Chime Essence is a stub. Marshal's 87 copper ore is three stacks in the bags and one in the bank counted as one figure, and Sena and Bruk are not logged in: their rows come from what was recorded the last time they were played. A footer reads KINDS 26, COPIES 747.",
    frames: framed(SHEET_BOX),
    world: asBruk,
    run: (stage) => onTab(stage, 'Items'),
  },
  {
    id: 'bags',
    label: 'The bags, live',
    preview: true,
    caption: 'One character, live',
    alt: "the Bags tab of the same panel, showing the character who is logged in. A selector reads Marshal (here), a slot bar reads 24 / 52 with 28 free, and a strip under it reads Live, MARKED 3 split 1 worn, SOCKETS 4 / 4, over a Carrying row drawn in the game's own coins: 1462 gold, 38 silver, 4 copper. Below that a grid of 52 squares eleven across, 24 of them holding the game's item art with a stack count in the corner (three of copper ore at 20, 20 and 7, two of iron ore at 20 and 16, hides, potions, herbs, cloth and meat) and the remaining 28 drawn as faint dashed outlines. Four squares are outlined warm: the three copper ore stacks, which are one item split over more than one cell, and a spare of the vest the character is wearing.",
    frames: framed(SHEET_BOX),
    world: asBruk,
    run: (stage) => onTab(stage, 'Bags'),
  },
  {
    id: 'bank',
    label: 'The bank, standing at one',
    frames: framed(),
    world: asBruk,
    run: (stage) => onTab(stage, 'Bank'),
  },
  {
    id: 'mail',
    label: 'The mailbox, two unread',
    frames: framed(),
    world: asBruk,
    run: (stage) => onTab(stage, 'Mail'),
  },
  {
    id: 'roster',
    label: 'Three characters',
    frames: framed(),
    world: asBruk,
    run: (stage) => onTab(stage, 'Roster'),
  },
  {
    // An alt's bank, read while logged in as somebody else. The pane the client cannot
    // draw at all, and the whole reason this addon keeps a record.
    id: 'alt-bank',
    label: "An alt's bank, from another character",
    frames: framed(),
    world: asBruk,
    run: async (stage) => {
      await onTab(stage, 'Bank');
      const picker = document.querySelector<HTMLSelectElement>('[data-role="picker"] select');
      if (picker !== null) {
        picker.value = 'Sena';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await pause(SETTLE_MS);
    },
  },
  {
    // Walked away from both counters, holding the last reading of each. The state most
    // of a session is spent in, and the one the three-state read exists for.
    id: 'away',
    label: 'Walked away from the counters',
    frames: framed(),
    world: asBruk,
    run: async (stage) => {
      await onTab(stage, 'Bank');
      leaveCounters(stage);
      await drawn(stage);
    },
  },
  {
    // The day the addon is installed: one character recorded, nothing else played yet, and
    // nowhere near a counter. The state nobody thinks to photograph.
    id: 'fresh',
    label: 'The day you install it',
    frames: framed(),
    world: (draft) => {
      beThem(draft, MARSHAL);
      leaveCounters(draft);
    },
    run: drawn,
  },
];

export { SCENARIOS };
