// @vitest-environment happy-dom

// The Cooldown Bars example, run through the real loader. The subscription reports the SET of
// running cooldowns changing and the numbers move in a frame loop; these cases keep the two apart.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { perCharacterKey, uiNamespace } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the dev-harness suite.
import SOURCE from './main.js?raw';

const FQID = 'official/cooldown-bars';
/** What tests/fakes/shared-services.ts says the player is called. */
const CHARACTER = 'Claudemoon/Marshal';

interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** One tap-target square: the strip's icon size, and its floor on both axes. */
const TILE_FLOOR = 40;
/** A bar's natural height, which the column opens at. */
const BAR_HEIGHT = 23;
/** The gap between two timers. */
const ROW_GAP = 3;
/** How narrow the column may be dragged, well under the width it opens at. */
const MIN_COLUMN_WIDTH = 120;
/** How thin one row may be dragged, which is also the column's own height floor. */
const MIN_BAR_HEIGHT = 14;

/**
 * What a budget of rows works out to. These numbers are transcribed from the addon rather
 * than derived from it, so the suite fails when the addon changes one.
 */
function stack(height: number, rows: number): number {
  return rows * height + (rows - 1) * ROW_GAP;
}
/** A box saved narrower and shorter than the strip has any business being. */
const CRAMPED: FrameBox = { x: 20, y: 20, w: 90, h: 20 };

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
/**
 * Long enough to clear the global-cooldown floor, and also `bestial_wrath`'s published length,
 * so most cases read the same whether the total was published or observed.
 */
const LONG = 120;
/** `arcane_shot`'s published length. */
const FELL_SHOT = 6;
/**
 * The size of `arcane_shot`'s charge pool as the spellbook resolves it, after the talent that
 * grants it. The content table gives the ability no pool at all.
 */
const POOL = 2;
/**
 * Enough cooldowns to fill the default budget of eight. None is in the fake spellbook, so
 * each raises a MEASURED row.
 */
const CROWD = [
  'multi_shot',
  'counter_shot',
  'rapid_fire',
  'aimed_shot',
  'concussive_shot',
  'freezing_trap',
  'disengage',
  'feign_death',
];

const teardown: Array<() => void> = [];

// Vitest's fake timers cover requestAnimationFrame, which is what makes the frame loop drivable.
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

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

interface BarsHarness extends SharedHarness {
  /** Put an ability on cooldown, or move what is left on it. */
  cooldown: (abilityId: string, seconds: number) => void;
  /**
   * Set a charge pool the way a snapshot would. `maxCharges` is the zero the client actually
   * holds, so a reading that took the pool size from here would draw "1 of 0" and be caught.
   */
  charges: (abilityId: string, pool: { charges: number; recharge: number; length: number }) => void;
  /** Re-read the world, which is what turns a set change into a handler call. */
  poll: () => void;
  /** Run the addon's frame loop once. */
  frame: () => void;
  /** The ability ids with a bar up, in the order they are drawn. */
  drawn: () => string[];
  /** One bar's fill width, as the style string the addon wrote. */
  fillOf: (abilityId: string) => string;
  /** One bar's remaining figure. */
  leftOf: (abilityId: string) => string;
  /** One bar's icon URL, or '' when the slot is empty. */
  iconOf: (abilityId: string) => string;
}

/** Let the async frame restore land before reading what it did. */
async function settleFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function barFor(abilityId: string): Element | null {
  return document.querySelector(`[data-ability="${abilityId}"]`);
}

/**
 * Start the addon with settings seeded before it loads, since the layout is decided while it
 * builds its first frame. This returns before the overlay has come up; nearly every case wants
 * `run`, and this is for cases about the window before the stored frame state lands.
 */
async function start(
  settings: Record<string, unknown> = {},
  frames: Record<string, { box: FrameBox; visible: boolean }> = {},
): Promise<BarsHarness> {
  const storage = createFakeStorage();
  await Promise.all(
    Object.entries(frames).map(([frameId, state]) =>
      storage.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, frameId), state),
    ),
  );
  const cooldowns = new Map<string, number>();
  const abilityCharges: Record<string, unknown> = {};
  // `templateId` on a player is the CLASS, which is the directory skill icons are filed under.
  const player = liveEntity({ set: { cooldowns, abilityCharges, templateId: 'hunter' } });
  // The spellbook in the game's own shape: the only source of a display name and a resolved
  // length. Both names differ from what their ids suggest, on purpose. Every other id used here
  // is deliberately absent, `system_unstuck` (the game's anti-relog timer, a real key of its
  // cooldown map and not an ability) first among them.
  const known = [
    {
      def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
      rank: 3,
      cost: 55,
      castTime: 0,
      cooldown: FELL_SHOT,
      charges: POOL,
    },
    {
      def: { id: 'bestial_wrath', name: 'Howling Rage', school: 'physical', requiresTarget: true },
      rank: 1,
      cost: 30,
      castTime: 0,
      cooldown: LONG,
    },
  ];
  const world = { entities: new Map([[PLAYER_ID, player]]), player, known };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    storage,
    settings,
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  return {
    ...harness,
    cooldown: (abilityId, seconds) => {
      cooldowns.set(abilityId, seconds);
    },
    charges: (abilityId, pool) => {
      abilityCharges[abilityId] = {
        charges: pool.charges,
        maxCharges: 0,
        recharge: pool.recharge,
        rechargeLength: pool.length,
      };
    },
    poll: () => harness.shared.world.watcher.poll(),
    frame: () => vi.advanceTimersToNextFrame(),
    // The attribute, not the dataset: the linter wants dot access on an index signature and
    // the compiler forbids it.
    drawn: () =>
      [...document.querySelectorAll('[data-ability]')].map(
        (el) => el.getAttribute('data-ability') ?? '',
      ),
    fillOf: (abilityId) =>
      (barFor(abilityId)?.querySelector('.woc-bar-fill') as HTMLElement | null)?.style.width ?? '',
    leftOf: (abilityId) => barFor(abilityId)?.querySelector('.woc-bar-value')?.textContent ?? '',
    iconOf: (abilityId) =>
      barFor(abilityId)?.querySelector('.woc-bar-icon')?.getAttribute('src') ?? '',
  };
}

/**
 * `start`, plus the wait for the overlay to come up. A saved frame starts hidden until its
 * per-character state arrives, which takes a watcher sample and then a storage read.
 */
async function run(
  settings: Record<string, unknown> = {},
  frames: Record<string, { box: FrameBox; visible: boolean }> = {},
): Promise<BarsHarness> {
  const harness = await start(settings, frames);
  harness.poll();
  await settleFrames();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // It never touches the socket, so it must not ask for it.
  it('asks for no network permission', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'keys']);
  });
});

describe('which bars are up', () => {
  it('starts with none', async () => {
    const h = await run();

    expect(h.drawn()).toEqual([]);
  });

  it('raises a bar when a cooldown starts', async () => {
    const h = await run();

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(h.drawn()).toEqual(['bestial_wrath']);
  });

  it('drops the bar when the cooldown finishes', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    h.cooldown('bestial_wrath', 0);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('hides a cooldown shorter than the global cooldown', async () => {
    const h = await run();

    h.cooldown('shoot', 1);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('draws the soonest ready at the top', async () => {
    const h = await run();

    h.cooldown('system_unstuck', 180);
    h.cooldown('bestial_wrath', LONG);
    h.cooldown('multi_shot', 10);
    h.poll();

    expect(h.drawn()).toEqual(['multi_shot', 'bestial_wrath', 'system_unstuck']);
  });

  // The cooldown map is keyed by id, and ids and display names have diverged.
  it('calls an ability what the game calls it, not what its id suggests', async () => {
    const h = await run();

    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(barFor('arcane_shot')?.textContent).toContain('Fell Shot');
    expect(barFor('arcane_shot')?.textContent).not.toContain('Arcane Shot');
  });

  // An id the spellbook does not carry may not be an ability at all. The mark is foretell's,
  // because the two addons hedge the same fact.
  it('marks a name it worked out from the id', async () => {
    const h = await run();

    h.cooldown('system_unstuck', LONG);
    h.poll();

    expect(barFor('system_unstuck')?.textContent).toContain('System Unstuck?');
  });

  it('leaves a name off the spellbook unmarked', async () => {
    const h = await run();

    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(barFor('arcane_shot')?.textContent).toContain('Fell Shot');
    expect(barFor('arcane_shot')?.textContent).not.toContain('Fell Shot?');
  });

  // A tile draws no label, so the mark has to reach the accessible name.
  it('marks the name on a tile too', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('system_unstuck', LONG);
    h.poll();

    expect(barFor('system_unstuck')?.getAttribute('aria-label')).toContain('System Unstuck?');
  });

  it('falls back to the id for a cooldown outside the spellbook', async () => {
    const h = await run();

    h.cooldown('system_unstuck', LONG);
    h.poll();

    expect(barFor('system_unstuck')?.textContent).toContain('System Unstuck');
  });
});

describe('the drain', () => {
  it('starts full', async () => {
    const h = await run();

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(h.fillOf('bestial_wrath')).toBe('100.00%');
  });

  // The subscription does not move the number: nothing is polled here, only a frame passes.
  it('follows the cooldown down without another set change', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    h.cooldown('bestial_wrath', LONG / 2);
    h.frame();

    expect(h.fillOf('bestial_wrath')).toBe('50.00%');
    expect(h.leftOf('bestial_wrath')).toBe('60.0s');
  });

  // Found half spent, drawn half full on its first frame. The measured rule would open it full.
  it('fills an ability you know against its published length', async () => {
    const h = await run();

    h.cooldown('arcane_shot', FELL_SHOT / 2);
    h.poll();

    expect(h.fillOf('arcane_shot')).toBe('50.00%');
  });

  // The pool size comes from this ability's own entry, which carries no `charges`, so a reading
  // taken from the spellbook as a whole would draw "1/2" here.
  it('draws a bare count for a known ability whose entry carries no pool', async () => {
    const h = await run();

    h.charges('bestial_wrath', { charges: 1, recharge: 6, length: LONG });
    h.frame();

    expect(h.leftOf('bestial_wrath')).toBe('6.0s (1)');
  });

  // With no published length, the bar is filled against what it was found at.
  it('treats what it first saw as full for an ability outside your spellbook', async () => {
    const h = await run();

    h.cooldown('system_unstuck', 60);
    h.poll();
    h.cooldown('system_unstuck', 30);
    h.frame();

    expect(h.fillOf('system_unstuck')).toBe('50.00%');
  });

  it('keeps its fill when an unrelated cooldown starts', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();
    h.cooldown('bestial_wrath', LONG / 2);
    h.frame();

    h.cooldown('system_unstuck', 180);
    h.poll();

    expect(h.fillOf('bestial_wrath')).toBe('50.00%');
  });
});

describe('disabling it', () => {
  it('leaves no frame, no keybind, and no frame loop behind', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('[data-woc-frame="bars"]')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.frame()).not.toThrow();
  });
});

// Three shapes: `clearCooldowns` deletes an entry, a shave lowers it while it runs, and a shared
// cooldown re-arms a running entry (one shaman shock resets every shock). A re-arm changes no id,
// so only a measured row can go wrong, and the re-learning cases use abilities off the spellbook.
describe('a cooldown that is reset or re-armed', () => {
  it('drops the bar when another ability clears the cooldown outright', async () => {
    const h = await run();
    h.cooldown('system_unstuck', 180);
    h.poll();

    // What `clearCooldowns` does: the entry is deleted, not set to zero.
    h.cooldown('system_unstuck', 0);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('follows a cooldown that was shortened while running', async () => {
    const h = await run();
    h.cooldown('combustion', 60);
    h.poll();

    h.cooldown('combustion', 30);
    h.frame();

    expect(h.fillOf('combustion')).toBe('50.00%');
    expect(h.leftOf('combustion')).toBe('30.0s');
  });

  // A measured row first seen part-way down and then re-armed has to take the new total.
  it('rebaselines when the remaining time goes back up', async () => {
    const h = await run();
    h.cooldown('earth_shock', 2);
    h.poll();

    // Casting another shock re-arms this one to the full six seconds.
    h.cooldown('earth_shock', 6);
    h.frame();
    expect(h.fillOf('earth_shock')).toBe('100.00%');

    // And from there it drains against the SIX, not against the two.
    h.cooldown('earth_shock', 3);
    h.frame();

    expect(h.fillOf('earth_shock')).toBe('50.00%');
  });

  // UNDETECTABLE: a re-press onto a shorter cooldown below the old remaining (30, 15, 10) looks
  // like draining. It reads low unless a frame catches the gap at zero.
  it('reads a shorter re-press as a drain, which is all it can do', async () => {
    const h = await run();
    h.cooldown('system_unstuck', 30);
    h.poll();
    h.cooldown('system_unstuck', 15);
    h.frame();

    h.cooldown('system_unstuck', 10);
    h.frame();

    expect(h.fillOf('system_unstuck')).toBe('33.33%');
  });

  it('rebuilds from the new length when a frame catches the reset', async () => {
    const h = await run();
    h.cooldown('system_unstuck', 30);
    h.poll();

    h.cooldown('system_unstuck', 0);
    h.poll();
    h.cooldown('system_unstuck', 10);
    h.poll();

    expect(h.fillOf('system_unstuck')).toBe('100.00%');
  });

  it('reads a shorter re-press correctly for an ability you know', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();
    h.cooldown('bestial_wrath', 60);
    h.frame();

    h.cooldown('bestial_wrath', 40);
    h.frame();

    expect(h.fillOf('bestial_wrath')).toBe('33.33%');
  });

  // A row past the budget is hidden, not dropped, so it still sees a re-arm. Both the re-arm and
  // the drain happen while it is cut, so a row that only caught up on its way back fails.
  it('keeps following a cooldown that is past the bar budget', async () => {
    const h = await run();
    // Eight soonest, none of them in the fake spellbook, so every row here is measured.
    for (const [at, abilityId] of CROWD.entries()) {
      h.cooldown(abilityId, 10 + at);
    }
    h.cooldown('system_unstuck', 100);
    h.poll();
    expect(h.drawn()).toHaveLength(CROWD.length);
    expect(h.drawn()).not.toContain('system_unstuck');

    // Re-armed and then drained again, both while it is cut.
    h.cooldown('system_unstuck', 180);
    h.frame();
    h.cooldown('system_unstuck', 170);
    h.frame();

    // The crowd finishes, so the row comes back into view.
    for (const abilityId of CROWD) {
      h.cooldown(abilityId, 0);
    }
    h.poll();

    expect(h.drawn()).toEqual(['system_unstuck']);
    expect(h.fillOf('system_unstuck')).toBe('94.44%');
  });
});

// `rechargeLength` rides the charge pool, so these rows are exact from their first frame; the
// pool SIZE comes only from the spellbook, since `maxCharges` is zero-filled. A charge returning
// changes no cooldown id, so only the frame loop can raise or drop the row.
describe('an ability regenerating a charge', () => {
  it('raises a bar from the frame loop, with no cooldown set change', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.drawn()).toEqual(['arcane_shot']);
  });

  it('fills against the published length rather than against what it first saw', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.fillOf('arcane_shot')).toBe('50.00%');
  });

  it('shows how many uses are left out of how many there are', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.leftOf('arcane_shot')).toBe(`6.0s (1/${String(POOL)})`);
  });

  it('draws a bare count for a pool the spellbook does not carry', async () => {
    const h = await run();

    h.charges('double_charge', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.leftOf('double_charge')).toBe('6.0s (1)');
  });

  it('drops the row once the pool is full again', async () => {
    const h = await run();
    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    h.charges('arcane_shot', { charges: 2, recharge: 0, length: 12 });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // An emptied pool is also on the cooldown wire; the charge reading wins, having a real total.
  it('does not draw the same ability twice when the pool is empty', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 0, recharge: 9, length: 12 });
    h.cooldown('arcane_shot', 9);
    h.poll();

    expect(h.drawn()).toEqual(['arcane_shot']);
    expect(h.fillOf('arcane_shot')).toBe('75.00%');
  });

  it('does not re-baseline off a published length', async () => {
    const h = await run();
    h.charges('arcane_shot', { charges: 1, recharge: 3, length: 12 });
    h.frame();

    h.charges('arcane_shot', { charges: 0, recharge: 12, length: 12 });
    h.frame();
    h.charges('arcane_shot', { charges: 0, recharge: 6, length: 12 });
    h.frame();

    expect(h.fillOf('arcane_shot')).toBe('50.00%');
  });

  it('costs nothing for a player with no charge abilities', async () => {
    const h = await run();

    h.frame();

    expect(h.drawn()).toEqual([]);
  });
});

// The layout is chosen when a row is built, so a settings change tears the rows down.
describe('the tile layout', () => {
  function tileFor(abilityId: string): HTMLElement | null {
    return document.querySelector(`.woc-tile[data-ability="${abilityId}"]`);
  }

  function sweepOf(abilityId: string): string {
    const wedge = tileFor(abilityId)?.querySelector<HTMLElement>('.woc-tile-sweep');
    return wedge?.style.getPropertyValue('--woc-tile-sweep') ?? '';
  }

  it('draws squares rather than rows when it is picked', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(tileFor('bestial_wrath')).not.toBeNull();
    expect(document.querySelector('.woc-bar')).toBeNull();
  });

  it('lays the strip out across rather than down', async () => {
    await run({ layout: 'tiles' });

    const list = document.querySelector<HTMLElement>('.woc-cd-list');

    expect(list?.style.flexDirection).toBe('row');
  });

  // The sweep is the ELAPSED share; half spent is what tells that from an inverted one.
  it('sweeps the square as the cooldown runs down', async () => {
    const h = await run({ layout: 'tiles' });
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    h.cooldown('bestial_wrath', LONG / 2);
    h.frame();

    expect(sweepOf('bestial_wrath')).toBe('50.00%');
  });

  it.each([
    [4.2, '5'],
    [30, '30'],
    [180, '3m'],
  ])('reads %ss left as "%s"', async (remaining, shown) => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('bestial_wrath', remaining);
    h.poll();

    expect(tileFor('bestial_wrath')?.querySelector('.woc-tile-value')?.textContent).toBe(shown);
  });

  it('puts a charge count in the corner instead of in the countdown', async () => {
    const h = await run({ layout: 'tiles' });

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(tileFor('arcane_shot')?.querySelector('.woc-tile-count')?.textContent).toBe('1');
    expect(tileFor('arcane_shot')?.querySelector('.woc-tile-value')?.textContent).toBe('6');
  });

  it('keeps the soonest ready first', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('system_unstuck', 180);
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(h.drawn()).toEqual(['bestial_wrath', 'system_unstuck']);
  });

  it('announces the ability it cannot draw a name for', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(tileFor('arcane_shot')?.getAttribute('aria-label')).toContain('Fell Shot');
  });

  // A remote storage write is how the manager's setting change reaches a running addon.
  it('swaps every row when the setting changes under it', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();
    expect(document.querySelectorAll('.woc-bar')).toHaveLength(1);

    h.hub.remote(`config:${FQID}`, 'values', { layout: 'tiles' });

    expect(document.querySelectorAll('.woc-bar')).toHaveLength(0);
    expect(tileFor('bestial_wrath')).not.toBeNull();
  });

  // A destroyed row left in the map would be appended back into the strip next frame.
  it('leaves no orphan behind when it swaps', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    h.hub.remote(`config:${FQID}`, 'values', { layout: 'tiles' });
    h.frame();

    expect(h.drawn()).toEqual(['bestial_wrath']);
  });
});

// The strip's height is the icon size. Driven by the saved box, which takes the same path a drag
// does and is the only one a Node suite can reach.
describe('the size of the strip', () => {
  function sizeOf(abilityId: string): string {
    const tile = document.querySelector<HTMLElement>(`.woc-tile[data-ability="${abilityId}"]`);
    return tile?.style.getPropertyValue('--woc-tile-size') ?? '';
  }

  function stripEl(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-woc-frame="tiles"]');
  }

  it('starts at the tap-target floor the game holds its controls to', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(sizeOf('bestial_wrath')).toBe('40px');
  });

  // Drawn before the restore lands, so the tile has to be resized in place rather than rebuilt.
  it('resizes a tile that is already on screen', async () => {
    const h = await start(
      { layout: 'tiles' },
      { tiles: { box: { x: 20, y: 20, w: 300, h: 64 }, visible: true } },
    );
    h.cooldown('bestial_wrath', LONG);
    h.poll();
    expect(sizeOf('bestial_wrath')).toBe('40px');

    await vi.waitFor(() => {
      expect(sizeOf('bestial_wrath')).toBe('64px');
    });
  });

  // The two layouts save separately, or a column's height would open the strip huge.
  it('does not take its height from the box the bars layout saved', async () => {
    const h = await run(
      { layout: 'tiles' },
      { bars: { box: { x: 20, y: 20, w: 220, h: 260 }, visible: true } },
    );

    h.cooldown('bestial_wrath', LONG);
    h.poll();
    await settleFrames();

    expect(sizeOf('bestial_wrath')).toBe('40px');
  });

  // A bare frame clips, so under one square a tile would be cut in half.
  it('holds the strip at one square when a saved box is shorter', async () => {
    const h = await run({ layout: 'tiles' }, { tiles: { box: CRAMPED, visible: true } });

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(stripEl()?.style.height).toBe(`${TILE_FLOOR}px`);
    expect(sizeOf('bestial_wrath')).toBe(`${TILE_FLOOR}px`);
  });

  // Without a stated floor, a frame takes the size it opened at as its minimum.
  it('lets the strip be dragged narrower than it opened', async () => {
    await run({ layout: 'tiles' }, { tiles: { box: CRAMPED, visible: true } });

    expect(stripEl()?.style.width).toBe(`${CRAMPED.w}px`);
  });
});

// The column divides its box between the BUDGET of rows, never the rows on screen. Driven by the
// saved box, for the reason the strip's cases are.
describe('the size of the column', () => {
  function columnEl(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-woc-frame="bars"]');
  }

  function rowOf(abilityId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.woc-bar[data-ability="${abilityId}"]`);
  }

  /** The height the kit was asked for, which its own sheet turns into art and text. */
  function heightOf(abilityId: string): string {
    return rowOf(abilityId)?.style.getPropertyValue('--woc-bar-size') ?? '';
  }

  /** A box tall enough for a budget of two rows at twice their natural height. */
  const Tall: FrameBox = { x: 20, y: 20, w: 220, h: stack(BAR_HEIGHT * 2, 2) };

  it('opens with room for the whole bar budget', async () => {
    await run({ 'max-bars': 3 });

    await vi.waitFor(() => {
      expect(columnEl()?.style.height).toBe(`${stack(BAR_HEIGHT, 3)}px`);
    });
  });

  it('holds a row at its natural height', async () => {
    const h = await run({ 'max-bars': 3 });

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(heightOf('bestial_wrath')).toBe(String(BAR_HEIGHT));
  });

  // The kit derives art and text from the height; an inline font size would beat the touch floor.
  it('asks the kit for a row scaled to the box', async () => {
    const h = await run({ 'max-bars': 2 }, { bars: { box: Tall, visible: true } });

    h.cooldown('bestial_wrath', LONG);
    h.poll();
    await settleFrames();

    expect(heightOf('bestial_wrath')).toBe(String(BAR_HEIGHT * 2));
    expect(rowOf('bestial_wrath')?.classList.contains('woc-bar-sized')).toBe(true);
    expect(rowOf('bestial_wrath')?.style.fontSize).toBe('');
  });

  it('builds a later row at the size the box already reported', async () => {
    const h = await run({ 'max-bars': 2 }, { bars: { box: Tall, visible: true } });

    h.cooldown('bestial_wrath', LONG);
    h.poll();
    await settleFrames();
    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(heightOf('arcane_shot')).toBe(String(BAR_HEIGHT * 2));
  });

  it('keeps a row the same height when another cooldown starts', async () => {
    const h = await run({ 'max-bars': 2 }, { bars: { box: Tall, visible: true } });

    h.cooldown('bestial_wrath', LONG);
    h.poll();
    await settleFrames();
    const before = heightOf('bestial_wrath');
    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(heightOf('bestial_wrath')).toBe(before);
  });

  it('lets the column be dragged down to a single row', async () => {
    const h = await run({ 'max-bars': 8 }, { bars: { box: CRAMPED, visible: true } });

    h.cooldown('bestial_wrath', LONG);
    h.poll();
    await settleFrames();

    expect(Number(columnEl()?.style.height.replace('px', ''))).toBeLessThan(stack(BAR_HEIGHT, 8));
    expect(Number(heightOf('bestial_wrath'))).toBe(MIN_BAR_HEIGHT);
  });

  // Rows already at their floor: a bare frame clips, so it shows fewer instead of half a row.
  it('draws fewer rows when the box cannot hold the budget', async () => {
    const h = await run({ 'max-bars': 8 }, { bars: { box: CRAMPED, visible: true } });

    for (const id of CROWD) {
      h.cooldown(id, LONG);
    }
    h.poll();
    await settleFrames();
    h.poll();

    expect(h.drawn().length).toBeLessThan(CROWD.length);
    expect(h.drawn().length).toBeGreaterThan(0);
  });

  // The strip shares `shown` with the column; dividing its one-tile height by a row's pitch
  // would cut it to two tiles.
  it('draws the whole budget as tiles whatever the strip is a row of', async () => {
    const h = await run({ layout: 'tiles', 'max-bars': 8 });

    for (const id of CROWD) {
      h.cooldown(id, LONG);
    }
    h.poll();
    await settleFrames();
    h.poll();

    expect(h.drawn()).toHaveLength(CROWD.length);
  });

  it('lets the column be dragged narrower than it opened', async () => {
    await run({}, { bars: { box: CRAMPED, visible: true } });

    await vi.waitFor(() => {
      expect(columnEl()?.style.width).toBe(`${MIN_COLUMN_WIDTH}px`);
    });
  });
});

// The kit tints from the game's own debuff-border palette; no addon can pass a colour.
describe('tinting a timer by its school', () => {
  function classesOf(abilityId: string): string {
    return barFor(abilityId)?.className ?? '';
  }

  it('draws no school at all until it is asked for', async () => {
    const h = await run();

    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(classesOf('arcane_shot')).not.toContain('school');
  });

  it('tints a row by what the spellbook says the ability is', async () => {
    const h = await run({ 'tint-school': true });

    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(classesOf('arcane_shot')).toContain('woc-bar-school-arcane');
  });

  // A row the spellbook does not carry has no school to colour by.
  it('leaves a measured row uncoloured', async () => {
    const h = await run({ 'tint-school': true });

    h.cooldown('system_unstuck', LONG);
    h.poll();

    expect(classesOf('system_unstuck')).not.toContain('school');
  });

  it('tints a tile too, which wears it as a border', async () => {
    const h = await run({ layout: 'tiles', 'tint-school': true });

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(classesOf('bestial_wrath')).toContain('woc-tile-school-physical');
  });
});

// The tooltip is a function, since a string attached at build time would report what was left
// when the cooldown started.
describe('the tooltip on a timer', () => {
  function hover(abilityId: string): string {
    document
      .querySelector(`[data-ability="${abilityId}"]`)
      ?.dispatchEvent(new Event('pointerenter'));
    return document.getElementById('woc-tooltip')?.textContent ?? '';
  }

  it('names the ability the way the game does', async () => {
    const h = await run();
    h.cooldown('arcane_shot', LONG);
    h.poll();

    hover('arcane_shot');

    expect(document.querySelector('.woc-tip-title')?.textContent).toBe('Fell Shot');
  });

  it('answers with what is left now, not with what was left when it started', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();
    expect(hover('bestial_wrath')).toContain('120.0s left');

    h.cooldown('bestial_wrath', LONG / 2);
    h.frame();

    expect(hover('bestial_wrath')).toContain('60.0s left');
  });

  it('admits when it does not know the full length', async () => {
    const h = await run();

    h.cooldown('system_unstuck', LONG);
    h.poll();

    expect(hover('system_unstuck')).toContain('length unknown');
  });

  it('says nothing about an unknown length for an ability you know', async () => {
    const h = await run();

    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(hover('arcane_shot')).not.toContain('length unknown');
  });

  it('explains the mark on a worked-out name', async () => {
    const h = await run();

    h.cooldown('system_unstuck', LONG);
    h.poll();

    const said = hover('system_unstuck');
    expect(said).toContain('Worked out from the ability id');
    expect(said).toContain('system_unstuck');
  });

  it('explains nothing about the name of an ability you know', async () => {
    const h = await run();

    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(hover('arcane_shot')).not.toContain('Worked out from');
  });

  // A charge pool's length is published, and the tooltip is where a tile shows the pool size.
  it('says nothing about an unknown length for a charge pool', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    const said = hover('arcane_shot');
    expect(said).not.toContain('length unknown');
    expect(said).toContain(`1 of ${String(POOL)} charges ready`);
  });

  it('names no pool size for a pool the spellbook does not carry', async () => {
    const h = await run();

    h.charges('double_charge', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(hover('double_charge')).toContain('1 charge ready');
  });

  it('counts more than one of them as charges', async () => {
    const h = await run();

    h.charges('double_charge', { charges: 2, recharge: 6, length: 12 });
    h.frame();

    expect(hover('double_charge')).toContain('2 charges ready');
  });

  it('says the same thing under a tile', async () => {
    const h = await run({ layout: 'tiles' });
    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(hover('arcane_shot')).toContain('Fell Shot');
  });
});

// Re-appending a row already in the document drops its hover state, so doing it every frame
// strands the tooltip. Rows are only moved when the order changes.
describe('how rows are placed', () => {
  it('leaves a row alone when its position has not changed', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.cooldown('system_unstuck', 180);
    h.poll();
    const first = document.querySelector('[data-ability="bestial_wrath"]');
    const observer = new MutationObserver(() => undefined);
    const list = document.querySelector('.woc-cd-list') as HTMLElement;
    observer.observe(list, { childList: true });

    h.frame();
    h.frame();

    expect(observer.takeRecords()).toEqual([]);
    expect(document.querySelector('[data-ability="bestial_wrath"]')).toBe(first);
    observer.disconnect();
  });

  it('still reorders when the order actually changes', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', 20);
    h.cooldown('system_unstuck', 10);
    h.poll();
    expect(h.drawn()).toEqual(['system_unstuck', 'bestial_wrath']);

    h.cooldown('system_unstuck', 30);
    h.frame();

    expect(h.drawn()).toEqual(['bestial_wrath', 'system_unstuck']);
  });
});

// The icon URL comes from the loader's builder, so a moved art directory is one loader edit.
describe('the skill icon', () => {
  it('points at the art for the ability, filed under the player class', async () => {
    const h = await run();

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(h.iconOf('bestial_wrath')).toBe('/ui/skills/hunter/bestial_wrath.webp');
  });

  // Not every ability ships art; the kit hides the slot on a failed load.
  it('collapses the slot when the art does not exist', async () => {
    const h = await run();
    h.cooldown('tame_beast', LONG);
    h.poll();
    const icon = barFor('tame_beast')?.querySelector('.woc-bar-icon');

    icon?.dispatchEvent(new Event('error'));

    expect((icon as HTMLImageElement).hidden).toBe(true);
    expect(barFor('tame_beast')?.textContent).toContain('Tame Beast');
  });
});
