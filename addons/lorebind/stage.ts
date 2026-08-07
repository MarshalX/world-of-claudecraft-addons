// Lorebind on the stage: the codex asked about the den the group is standing in.
//
// The table is the shipped `items.json`, imported rather than restated. It is the whole of what
// this addon is, so a fixture inventing an item would photograph the one thing that cannot be
// wrong.
//
// THE PICTURE IS THE SOURCE RANKING, which is why the search is narrowed to one word rather
// than left open on the whole table. Four of the five rows come from a different source, and
// each says so on its own second line, which is a claim a shot of forty alphabetical table rows
// cannot make.
//
// Sableweb Silk Gland is the row that PROVES the ranking rather than illustrating it. Its id is
// `webwood_silk` and the deployed art manifest files its picture under "Webwood Silk Gland",
// one of the 21 entries in 303 where the art name and the game's own display name disagree. The
// row reads Sableweb Silk Gland because the table beats the art file; an addon that ranked them
// the other way would draw a visibly different word in the same place.
//
// Two ids here are NOT in the shipped table, and that is the only way this addon's second and
// fourth sources can be photographed at all. Every id the deployed art manifest carries is in
// the table too, `backpack` aside, which is the bag bar's implicit slot rather than an item and
// which nothing this addon reads would ever hand it. So a name off a loot roll and an id
// nothing can name are both, structurally, content the file has not caught up with: an item
// that shipped after `generate.mjs` last ran. The scenario states two of them, one being rolled
// on now and one already in the bags, which is what a player meets on patch day.
//
// The corollary, which is worth stating because it reads as a gap: there is no art-file row in
// this picture and there cannot be one. The third source only ever fires for an id the file
// lacks and the art manifest has, and today that set is empty.

import type { Scenario, Stage } from '../../stage/src/stage.ts';
import TABLE from './items.json' with { type: 'json' };

const TABLE_FILE = 'items.json';
const DATA = { [TABLE_FILE]: JSON.stringify(TABLE) };

/** What the player types, and the word the whole fixture is built around. */
const QUERY = 'sable';

/**
 * The drop the group is rolling on, which is where the second source's row comes from.
 *
 * An id the shipped table does not carry. A roll is the only place on the wire where an item is
 * spelled out, so this is the one thing that teaches the codex a name it did not ship with, and
 * it can only ever teach one the file is missing.
 */
const ROLL = {
  rollId: 8814,
  itemId: 'sableweb_wraps',
  itemName: 'Sableweb Wraps',
  quality: 'uncommon',
};

/**
 * An id in the bags that nothing can name, which is the fourth answer and a real one.
 *
 * An item with no name is not the same thing as an item that does not exist, and the row says
 * so in those words rather than being left out of the list.
 */
const UNNAMED = 'sableweb_carapace';

/** What the character is carrying. Every other id here is in the table and is named from it. */
const INVENTORY = [
  { itemId: 'sableweb_cord', count: 1 },
  { itemId: 'webwood_silk', count: 6 },
  { itemId: UNNAMED, count: 2 },
  { itemId: 'healing_potion', count: 5 },
  { itemId: 'copper_ore', count: 20 },
];

const EQUIPMENT = { feet: 'sableweb_slippers', chest: 'mosshide_vest' };

/**
 * The panel, at the size it opens: eight pixels under the addon's own 460 by 660.
 *
 * Seeded rather than left alone because the box is also the POSITION, and a frame the loader
 * placed for itself lands wherever the viewport centred it. The number is a size for every
 * scenario rather than a frame around any one of them: the grid is the only part of the panel
 * that grows, so it takes whatever the record under it leaves, and a scenario that opens a
 * fuller record is fewer rows of squares at the same height. That is why nothing here tries to
 * land the grid on a whole row. It was tuned to once, and game 0.35.0 gave the piece in the
 * preview a set name, a Warfare rating and an honor price, which is three more lines of record
 * and exactly one row of squares fewer.
 */
const PANEL = { box: { x: 120, y: 100, w: 460, h: 652 }, visible: true };

/** How long to wait on something the browser has to do, and how often to look. */
const WAIT_MS = 6000;
const POLL_MS = 50;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait for a fact rather than a delay, but never forever: a stuck fixture must still draw. */
function until(said: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      if (said() || waited >= WAIT_MS) {
        resolve();
        return;
      }
      waited += POLL_MS;
      setTimeout(look, POLL_MS);
    };
    look();
  });
}

function lineFor(role: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-role="${role}"]`);
}

/**
 * Hold the shot until the item art manifest has landed.
 *
 * `ui.icon.item` is optimistic until it does, so every id counts as having a picture and the
 * addon holds its own art count back rather than reporting a figure nobody measured. Waited on
 * that line changing, which is the addon saying the measurement is in.
 */
function artCounted(): Promise<void> {
  return until(() => lineFor('art')?.textContent?.startsWith('Reading') === false);
}

/**
 * Type into the search field the way a player does, at the DOM.
 *
 * The field is the loader's own `ui.field.text`, which listens for `input` rather than
 * `change`, so this is the same path a keystroke takes. Missing is a throw rather than a
 * shrug: a silent no-op would photograph the whole table under a caption about a search.
 */
function typeSearch(text: string): void {
  const input = document.querySelector<HTMLInputElement>('[data-role="search"] input');
  if (input === null) {
    throw new Error('the codex has no search field, so there is nothing to type into');
  }
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** How many squares are on screen, which is what a repaint is waited on. */
function rowCount(): number {
  return document.querySelectorAll('.woc-lorebind-grid [data-item]').length;
}

/** Press one of the quality chips, the way a player picks a tier to look at. */
function pressQuality(quality: string): void {
  const chip = document.querySelector<HTMLButtonElement>(`[data-quality="${quality}"]`);
  if (chip === null) {
    throw new Error(`the codex has no ${quality} chip to press`);
  }
  chip.click();
}

/** Open one of the kind tabs, the way a player picks a shelf. */
function openTab(label: string): void {
  const tab = [...document.querySelectorAll('#woc-addons .woc-tab')].find(
    (el) => el.textContent === label,
  );
  if (tab === undefined) {
    throw new Error(`the codex has no ${label} tab`);
  }
  (tab as HTMLButtonElement).click();
}

/** Click one square, which is what fills the record under the grid. */
function pick(itemId: string): void {
  const cell = document.querySelector<HTMLElement>(`.woc-lorebind-grid [data-item="${itemId}"]`);
  if (cell === null) {
    throw new Error(`no square for ${itemId} to pick`);
  }
  cell.click();
}

/**
 * Let the table land and the first list draw.
 *
 * The addon reads its file, publishes what it learned and then repaints on an animation frame,
 * so start-up is several promise hops and one real frame deep. Waited on the rows appearing
 * rather than on a count of microtask turns, since the file is eight hundred-odd rows of real JSON.
 */
async function drawn(stage: Stage): Promise<void> {
  stage.poll();
  await until(() => rowCount() > 0);
  await artCounted();
}

/**
 * The controls, pressed BEFORE the table has landed, so the first grid ever drawn is the narrow
 * one.
 *
 * Not an impatient player: it is what keeps the shot free of a cancelled request. Every icon is
 * optimistic until the art manifest is read, so a window that opened on the whole table starts
 * a hundred and twenty image loads and then drops the ones the manifest says do not exist,
 * cancelling whatever is still in flight. On screen that is invisible and right; to `pnpm shots`
 * it is a failed request, and that tool refuses to photograph one, because a transport failure
 * and an item the game ships no art for produce the same empty square. A shelf whose every item
 * ships art cannot produce one. The controls are built on the addon's first line, so there is
 * something to press well before there is anything to filter.
 */
async function narrowed(stage: Stage, press: () => void, want: number): Promise<void> {
  press();
  await until(() => rowCount() === want);
  await drawn(stage);
  // One more beat: the squares are placed on the repaint that adds them, and their art, their
  // quality borders and the record under them are written in the same pass.
  await pause(POLL_MS);
}

/** How many squares each scenario settles on, so a wait is on the answer rather than on a delay. */
const EPIC_ARMOR = 120;
const SABLE_HITS = 5;

/** The piece whose record is open in the preview. Worn by this character, so it is also seen. */
const PICKED = 'ashstalker_cowl';

const BROWSE_ALT =
  "the Lorebind window browsing every epic piece of armor in the game. Under the title a row of tabs reads All, Armor, Weapon, Food, Quest, Other, with Armor open. Under that, six quality chips, each written in the game's own colour for its tier: grey Poor, white Common, green Uncommon, blue Rare, purple Epic and orange Legendary, with Epic alone lit in its own colour and outlined in it, and the other five dimmed. Then three labelled controls, Search, Slot and Sort: a search box reading name, id, kind or slot, and two dropdowns of the loader's own reading Any slot and Name, with an unticked box reading Only what I have seen under them. The body of the window is the game's own item art in a grid nine squares across and three and a bit rows deep, scrolling, every square edged in the purple the game paints an epic item with and carrying the same soft purple glow it gives that tier in a bag: rings, hoods, gauntlets, breastplates, legguards, boots, belts and helms. The third square of the first row, a hood, is ringed in gold, and the record under the grid is its: a larger copy of the same art beside Ashstalker Cowl written in that same purple, then a column of facts one to a line, the way the game's own item tooltip reads: Epic leather armor, helmet; 168 Armor; plus 8 Agility, plus 8 Stamina and plus 18 Warfare in green; Item level 31; Requires level 20; Ashstalker Kit; Soulbound; Honor price 900; and last, quieter than the rest, ashstalker_cowl and from the table. Two lines close the panel: Showing 120 of 156 items, narrow it to see the rest; and 831 named from the table, 1 from a roll, 1 by nothing, Seen 8.";

const SABLE_ALT =
  'the Lorebind window with sable typed in its search box, holding five squares. Three carry the game own art and two carry two letters in place of it, because the game ships no picture for either. The record under the grid reads Sableweb Wraps in green, then Uncommon and nothing else, then sableweb_wraps and from a loot roll: an item the shipped table has never heard of, spelled out by the roll the group is answering, which is why it has a name and a tier and not one number. The counting line under it reads 831 named from the table, 1 from a roll, 1 by nothing.';

const SCENARIOS: readonly Scenario[] = [
  {
    // What the window is FOR: every epic piece of armor in the game, in the game's own colours,
    // with one of them open. Nothing here is a search: three controls and a click.
    id: 'browse',
    label: 'Browsing every epic in the game',
    preview: true,
    alt: BROWSE_ALT,
    data: DATA,
    frames: { codex: PANEL },
    world: (draft) => {
      draft.set(draft.player, 'templateId', 'hunter');
      draft.set(draft.world, 'inventory', INVENTORY);
      draft.set(draft.world, 'equipment', EQUIPMENT);
      draft.set(draft.world, 'lootRollPrompts', [ROLL]);
    },
    run: async (stage) => {
      await narrowed(
        stage,
        () => {
          openTab('Armor');
          pressQuality('epic');
        },
        EPIC_ARMOR,
      );
      pick(PICKED);
      await pause(POLL_MS);
    },
  },
  {
    // The attribution, which is the half of this addon a grid cannot show on its own: three of
    // these five squares are named by the table, one by a roll the group is answering and one by
    // nothing at all, and the record says which for whichever is open.
    id: 'sable',
    label: 'Searched, with every source on screen',
    alt: SABLE_ALT,
    data: DATA,
    frames: { codex: PANEL },
    world: (draft) => {
      draft.set(draft.player, 'templateId', 'hunter');
      draft.set(draft.world, 'inventory', INVENTORY);
      draft.set(draft.world, 'equipment', EQUIPMENT);
      // The prompt YOU were asked, which is one of the two places a roll is carried. The other
      // is `lootRollGroupStatus`, and the addon reads both because they overlap rather than
      // nest: a roll you were never a candidate for is only in the second.
      draft.set(draft.world, 'lootRollPrompts', [ROLL]);
    },
    run: async (stage) => {
      await narrowed(stage, () => typeSearch(QUERY), SABLE_HITS);
      pick(ROLL.itemId);
      await pause(POLL_MS);
    },
  },
  {
    // The one filter that is about the player rather than about the game: what this character
    // has actually laid eyes on, which is the closest thing the codex has to a collection.
    id: 'seen',
    label: 'Only what this character has seen',
    data: DATA,
    frames: { codex: PANEL },
    world: (draft) => {
      draft.set(draft.world, 'inventory', INVENTORY);
      draft.set(draft.world, 'equipment', EQUIPMENT);
    },
    run: async (stage) => {
      await drawn(stage);
      const box = document.querySelector<HTMLInputElement>('[data-role="seen"] input');
      box?.click();
      await pause(POLL_MS);
    },
  },
  {
    // The whole table, which is what the window opens holding. A hundred and twenty squares is
    // the setting's default rather than the answer, and the line under the grid says so.
    id: 'codex',
    label: 'The whole table, unfiltered',
    data: DATA,
    frames: { codex: PANEL },
    world: (draft) => {
      draft.set(draft.world, 'inventory', INVENTORY);
    },
    run: drawn,
  },
  {
    // A word in nothing. An empty grid is never a measurement, so it says which word it was
    // rather than drawing an empty box under a search field.
    id: 'nothing',
    label: 'A search that matches nothing',
    data: DATA,
    frames: { codex: PANEL },
    world: (draft) => {
      draft.set(draft.world, 'inventory', INVENTORY);
    },
    run: (stage) => narrowed(stage, () => typeSearch('thunderfury'), 0),
  },
  {
    // No table at all, which is what a failed install or a stripped copy of this addon looks
    // like. Everything it knows is then what it has seen in the world, and it says so rather
    // than sitting empty: an id with no name is still an id that exists.
    id: 'unnamed',
    label: 'With no table to read',
    frames: { codex: PANEL },
    world: (draft) => {
      draft.set(draft.world, 'inventory', INVENTORY);
      draft.set(draft.world, 'equipment', EQUIPMENT);
      draft.set(draft.world, 'lootRollPrompts', [ROLL]);
    },
    run: drawn,
  },
];

export { SCENARIOS };
