// Lorebind on the stage: the codex asked about the den the group is standing in.
//
// The table is the shipped `items.json`, imported rather than restated, so no fixture can invent
// an item. `webwood_silk` PROVES the ranking rather than illustrating it: the art manifest files
// its picture under "Webwood Silk Gland" and the row reads Sableweb Silk Gland, so an addon
// ranking the two the other way would draw a visibly different word in the same place.
//
// Two ids here are deliberately NOT in the table, which is the only way the roll-sourced and
// unnamed rows can be photographed: every id the art manifest carries is in the table too, so
// both are structurally content the file has not caught up with. For the same reason there is no
// art-sourced row in this picture and there cannot be one.

import type { Scenario, Stage } from '../../stage/src/stage.ts';
import TABLE from './items.json' with { type: 'json' };

const TABLE_FILE = 'items.json';
const DATA = { [TABLE_FILE]: JSON.stringify(TABLE) };

/** What the player types, and the word the whole fixture is built around. */
const QUERY = 'sable';

/**
 * An id the table does not carry. A roll is the only place the wire spells an item out, so it can
 * only ever teach a name the file is missing.
 */
const ROLL = {
  rollId: 8814,
  itemId: 'sableweb_wraps',
  itemName: 'Sableweb Wraps',
  quality: 'uncommon',
};

/** An id nothing can name, which is a real answer rather than an item that does not exist. */
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
 * Seeded because the box is also the POSITION, and a frame the loader placed lands wherever the
 * viewport centred it. Nothing here tries to land the grid on a whole row: the grid takes what
 * the record leaves, so a fuller record is fewer squares at the same height.
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

/**
 * Wait for a fact rather than a delay, but never forever: a stuck fixture must still draw. A
 * frame of the loader's loop runs on every look, since `woc.paint` rides that loop and the stage
 * drives it by hand: a fixture that only slept would sit six seconds over an empty grid.
 */
function until(stage: Stage, said: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const look = (): void => {
      stage.frame();
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
 * Hold the shot until the art manifest lands: `ui.icon.item` is optimistic until it does, and the
 * addon holds its own count back rather than reporting a figure nobody measured.
 */
function artCounted(stage: Stage): Promise<void> {
  return until(stage, () => lineFor('art')?.textContent?.startsWith('Reading') === false);
}

/**
 * `input` rather than `change`, which is the path a keystroke takes. A throw rather than a shrug:
 * a silent no-op photographs the whole table under a caption about a search.
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

/** Waited on the rows appearing rather than on a turn count: the file is real JSON. */
async function drawn(stage: Stage): Promise<void> {
  stage.poll();
  await until(stage, () => rowCount() > 0);
  await artCounted(stage);
}

/**
 * Pressed BEFORE the table lands, so the first grid drawn is the narrow one. A window opening on
 * the whole table starts 120 optimistic image loads and cancels the ones the manifest denies,
 * and `pnpm shots` refuses to photograph a failed request. The controls exist from line one.
 */
async function narrowed(stage: Stage, press: () => void, want: number): Promise<void> {
  press();
  await until(stage, () => rowCount() === want);
  await drawn(stage);
  // One more beat: art, quality borders and the record are written in the pass that adds a square.
  await pause(POLL_MS);
}

/** How many squares each scenario settles on, so a wait is on the answer rather than on a delay. */
const EPIC_ARMOR = 120;
const SABLE_HITS = 5;

/** The piece whose record is open in the preview. Worn by this character, so it is also seen. */
const PICKED = 'ashstalker_cowl';

const BROWSE_ALT =
  "the Lorebind window browsing the game's epic armor: a grid of item art, each square edged in the game's own colour for its tier, with one item's record open under it";

const SABLE_ALT =
  'the Lorebind window with sable typed in its search box, holding five squares. Three carry the game own art and two carry two letters in place of it, because the game ships no picture for either. The record under the grid reads Sableweb Wraps in green, then Uncommon and nothing else, then sableweb_wraps and from a loot roll: an item the shipped table has never heard of, spelled out by the roll the group is answering, which is why it has a name and a tier and not one number. The counting line under it reads 831 named from the table, 1 from a roll, 1 by nothing.';

const SCENARIOS: readonly Scenario[] = [
  {
    // What the window is FOR: a shelf in the game's own colours, with one item open.
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
      // The click asks for a repaint and the loader's loop is what performs one, so the record
      // under the grid is still the first square's until a frame runs. See `until`.
      stage.frame();
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
      stage.frame();
      await pause(POLL_MS);
    },
  },
  {
    // The one filter about the player: what this character has laid eyes on.
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
      stage.frame();
      await pause(POLL_MS);
    },
  },
  {
    // What the window opens holding. 120 squares is the setting's default rather than the
    // answer, and the line under the grid says so.
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
    // An empty grid is never a measurement, so it says which word found nothing.
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
    // No table at all: everything it knows is then what it has seen, and an id with no name is
    // still an id that exists.
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
