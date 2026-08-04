// @vitest-environment happy-dom

// The Cooldown Bars example, run through the real loader.
//
// The behaviour worth pinning is the one the addon exists to demonstrate: the
// subscription reports the SET of running cooldowns changing, and the numbers
// move in a frame loop that reads the world directly. A suite can tell those two
// apart, which is the point: a bar that only moved when the set changed would
// sit still for the whole cooldown and look broken, and one that rebuilt itself
// every frame would restart its own fill forever.

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
/** A box saved narrower and shorter than the strip has any business being. */
const CRAMPED: FrameBox = { x: 20, y: 20, w: 90, h: 20 };

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
/**
 * Long enough to clear the addon's global-cooldown floor, and also the published length of
 * `bestial_wrath` below, which is the game's own 120. Those being the same number keeps most
 * of this suite reading the same way whether the total was published or observed; the cases
 * where the two answers differ use a different ability on purpose.
 */
const LONG = 120;
/** `arcane_shot`'s published length, which is the game's own 6. */
const FELL_SHOT = 6;
/**
 * The size of `arcane_shot`'s charge pool, as the spellbook resolves it. Two because of a
 * talent: the content table gives Fell Shot no `maxCharges` at all, and the Twin Fletching
 * row is what turns that into a pool of two. A reading taken from the content table would
 * find no pool here.
 */
const POOL = 2;

const teardown: Array<() => void> = [];

// The frame loop is the whole subject, so it has to be drivable. Vitest's fake
// timers cover requestAnimationFrame as well as the timer functions.
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
   * Set a charge pool, the way a snapshot carrying `achg` and `achr` would. `maxCharges` is
   * written as the zero the client actually holds rather than as a real maximum, so a reading
   * that took the pool size from here instead of from the spellbook would draw "1 of 0" and
   * be caught.
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
 * Start the addon, optionally with settings already stored. Seeded before the addon loads,
 * because the loader hydrates settings and then evaluates: an addon reads `woc.settings`
 * while it builds its first frame, which is when the layout is decided.
 *
 * This is the raw start, before the overlay has come up. Nearly every case wants `run`
 * instead; this exists for the cases whose subject is the window between a frame being built
 * and its stored state landing.
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
  // `templateId` on a player is the CLASS, which is the directory the game files a
  // skill icon under. Without it there is nothing to build an icon URL from.
  const player = liveEntity({ set: { cooldowns, abilityCharges, templateId: 'hunter' } });
  // The spellbook in the game's own shape, and the source of both things the addon cannot get
  // off the wire: an ability's display name and its resolved length.
  //
  // Every id and name here is the game's own. Both hunter abilities are shown under a name an
  // id cannot be turned into: `arcane_shot` is "Fell Shot" and `bestial_wrath` is "Howling
  // Rage". Fell Shot also carries the pool of two the Twin Fletching talent resolves, which is
  // what `abilityCharges.maxCharges` zero-fills and never reports.
  //
  // Every other id this suite uses is deliberately absent, `system_unstuck` first among them.
  // That one is a real key of the game's own cooldown map (the anti-relog timer, shipped in
  // the `cds` payload unfiltered) and is provably not an ability, so it is exactly the case
  // the spellbook can never answer and it keeps the fallback name, the measured denominator
  // and the re-baselining covered.
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
    // Read off the attribute rather than the dataset, which is an index
    // signature: the linter wants dot access there and the compiler forbids it.
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
 * `start`, plus the wait for the overlay to come up. A frame that saves its state starts
 * hidden and is shown once that state arrives, keyed per character, so it takes a watcher
 * sample and then a storage read. A hidden frame is the state the addon's own frame loop
 * stands down for.
 */
async function run(
  settings: Record<string, unknown> = {},
  frames: Record<string, { box: FrameBox; visible: boolean }> = {},
): Promise<BarsHarness> {
  const harness = await start(settings, frames);
  // The sample is what resolves the character; the settle is what lets the read
  // keyed on it come back.
  harness.poll();
  await settleFrames();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // It never touches the socket, so it must not ask for it. A permission an addon does not use
  // is one every player is asked to grant for nothing.
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

  // A global cooldown rides almost every press, so bars for those would be a
  // row that flickers once a second and tells you nothing you did not just do.
  it('hides a cooldown shorter than the global cooldown', async () => {
    const h = await run();

    h.cooldown('shoot', 1);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  // Soonest ready first, because that is the order the next decision is made in.
  it('draws the soonest ready at the top', async () => {
    const h = await run();

    h.cooldown('system_unstuck', 180);
    h.cooldown('bestial_wrath', LONG);
    h.cooldown('multi_shot', 10);
    h.poll();

    expect(h.drawn()).toEqual(['multi_shot', 'bestial_wrath', 'system_unstuck']);
  });

  // The label the game itself uses, which a cooldown map cannot supply: it is keyed by id, and
  // the id and the display name have diverged. Reading `arcane_shot` as "Arcane Shot" names an
  // ability nothing else in the game calls that.
  it('calls an ability what the game calls it, not what its id suggests', async () => {
    const h = await run();

    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(barFor('arcane_shot')?.textContent).toContain('Fell Shot');
    expect(barFor('arcane_shot')?.textContent).not.toContain('Arcane Shot');
  });

  // An id the spellbook does not carry is not always an ability at all: the game's own
  // anti-relog timer rides the same cooldown map under `system_unstuck`. A guess from the id
  // beats a blank row, and the mark beside it is what says the guess is a guess. It is
  // foretell's exactly, because the two addons hedge the same fact.
  it('marks a name it worked out from the id', async () => {
    const h = await run();

    h.cooldown('system_unstuck', LONG);
    h.poll();

    expect(barFor('system_unstuck')?.textContent).toContain('System Unstuck?');
  });

  // And never on a name the game itself supplied, or the mark would say nothing:
  // a hedge that is on every row is a hedge nobody reads.
  it('leaves a name off the spellbook unmarked', async () => {
    const h = await run();

    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(barFor('arcane_shot')?.textContent).toContain('Fell Shot');
    expect(barFor('arcane_shot')?.textContent).not.toContain('Fell Shot?');
  });

  // A tile has no room for a label, so the mark has to reach the accessible name:
  // that string is the only thing naming the ability for a screen reader, and an
  // unmarked one there would be the guess presented as fact.
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

  // The claim the whole example is built to demonstrate: the subscription is
  // not what moves the number. Nothing is polled here and nothing is published;
  // only a frame passes, and the bar has to follow the world on its own.
  it('follows the cooldown down without another set change', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    h.cooldown('bestial_wrath', LONG / 2);
    h.frame();

    expect(h.fillOf('bestial_wrath')).toBe('50.00%');
    expect(h.leftOf('bestial_wrath')).toBe('60.0s');
  });

  // The whole point of reading the spellbook: found half spent, drawn half full, on the first
  // frame it exists. The measured rule would call 2.7 the total and open this bar at 100
  // percent with nothing on screen to say so.
  it('fills an ability you know against its published length', async () => {
    const h = await run();

    h.cooldown('arcane_shot', FELL_SHOT / 2);
    h.poll();

    expect(h.fillOf('arcane_shot')).toBe('50.00%');
  });

  // A pool size is per ability, off that ability's own spellbook entry, and "known but with no
  // pool" is a different answer from "not known at all". Howling Rage is in this hunter's
  // spellbook and carries no `charges`, so a reading that took the pool from the spellbook as
  // a whole would draw "1/2" on this row instead of "1".
  it('draws a bare count for a known ability whose entry carries no pool', async () => {
    const h = await run();

    h.charges('bestial_wrath', { charges: 1, recharge: 6, length: LONG });
    h.frame();

    expect(h.leftOf('bestial_wrath')).toBe('6.0s (1)');
  });

  // The residue, and the reason `rebaseline` survives. An item cooldown is in no
  // spellbook, so there is no length to divide by and the bar is filled from whatever
  // it was found at rather than from a guess.
  it('treats what it first saw as full for an ability outside your spellbook', async () => {
    const h = await run();

    h.cooldown('system_unstuck', 60);
    h.poll();
    h.cooldown('system_unstuck', 30);
    h.frame();

    expect(h.fillOf('system_unstuck')).toBe('50.00%');
  });

  // A rebuild must not restart the fill: the bar keeps the total it was created
  // with, or every unrelated cooldown starting would reset every other bar.
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

// A cooldown that does not simply run down.
//
// The game has three shapes of this and the addon meets all three. `clearCooldowns` deletes an
// entry outright. Refunds and shaves lower it while it keeps running. And a shared cooldown
// re-arms an entry that is already running: casting one shaman shock sets the cooldown on
// every shock, so an entry with two seconds left jumps back to six.
//
// The third is the one that bites, and only on a measured row. The set of running ids has not
// changed, so the subscription does not fire and the bar keeps the total it was built with,
// which may now be smaller than what is left. A row that took its denominator from the
// spellbook already has the right number, which is why every case below that turns on
// re-learning uses an ability the fake spellbook does not carry.
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

  // A shave keeps the entry, so the bar has to follow it down without a set change.
  it('follows a cooldown that was shortened while running', async () => {
    const h = await run();
    h.cooldown('combustion', 60);
    h.poll();

    h.cooldown('combustion', 30);
    h.frame();

    expect(h.fillOf('combustion')).toBe('50.00%');
    expect(h.leftOf('combustion')).toBe('30.0s');
  });

  // The reachable failure, now only for the residue: first seen part-way down, then re-armed
  // to its full length by a shared cooldown. A bar that keeps its first total has a
  // denominator smaller than what is left, and reads full for the whole difference.
  it('rebaselines when the remaining time goes back up', async () => {
    const h = await run();
    // Found mid-cooldown, which is what happens when the addon loads during one
    // or when a shave landed before the first sample.
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

  // The other direction cannot be detected, and this pins that it is not pretended otherwise.
  // A reset and re-press onto a shorter cooldown, landing below the old remaining, produces 30
  // then 15 then 10, which is what draining looks like. If a frame catches the gap at zero the
  // bar is dropped and rebuilt correctly; if none does, it reads low until the cooldown next
  // reaches zero.
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

  // And when a frame does catch the gap, the rebuild is what gets it right.
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

  // The same sequence on an ability you do know needs none of that reasoning: the denominator
  // never moved, so 40 of a published 120 is simply 40 of 120.
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
});

// The one denominator that comes off the wire rather than out of the spellbook.
//
// A recharge is not the ability's cooldown, so `world.abilities` does not carry it and could
// not: `rechargeLength` rides the charge pool itself. That makes these rows exact from their
// first frame, and it is why the charge reading wins wherever both describe one ability.
//
// The pool size is the other way round: nowhere on the wire, since `maxCharges` is zero-filled
// by the client, and in the spellbook.
//
// The subscription cannot see any of this. A charge coming back while the pool still holds a
// use changes no cooldown id, so only the frame loop can raise or drop the row.
describe('an ability regenerating a charge', () => {
  it('raises a bar from the frame loop, with no cooldown set change', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.drawn()).toEqual(['arcane_shot']);
  });

  // The whole point: half of a published twelve, right the first time it is drawn.
  it('fills against the published length rather than against what it first saw', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.fillOf('arcane_shot')).toBe('50.00%');
  });

  // "1/2", not "1". The wire's maximum is the zero the client filled in and the spellbook's is
  // the resolved pool size, so the denominator drawn here has to be the second one: `h.charges`
  // writes `maxCharges: 0` precisely so a reading that took it from the pool would show it.
  it('shows how many uses are left out of how many there are', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.leftOf('arcane_shot')).toBe(`6.0s (1/${String(POOL)})`);
  });

  // A pool on an ability outside your kit has a size nowhere at all, and the bare count is the
  // honest answer. Drawing "1 of 0" from `maxCharges` is the failure this shape avoids.
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

  // A pool that has emptied is ALSO on the ordinary cooldown wire, so both readings
  // describe the same ability. One row, and the charge reading wins, because it is
  // the one with a real total.
  it('does not draw the same ability twice when the pool is empty', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 0, recharge: 9, length: 12 });
    h.cooldown('arcane_shot', 9);
    h.poll();

    expect(h.drawn()).toEqual(['arcane_shot']);
    expect(h.fillOf('arcane_shot')).toBe('75.00%');
  });

  // A fresh recharge starting is not a re-arm to learn from: the length is already
  // known, so a remaining that goes back up must not become the new denominator.
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

  // An addon that walked the pools every frame when there are none would be paying
  // for a feature almost no class has.
  it('costs nothing for a player with no charge abilities', async () => {
    const h = await run();

    h.frame();

    expect(h.drawn()).toEqual([]);
  });
});

// The two shapes a timer can take.
//
// The layout is chosen when a row is built, which is why a settings change tears the rows down
// instead of repainting them: an element cannot change from a bar into a tile, and a display
// that kept its old elements would answer the setting only for cooldowns that started
// afterwards.
//
// What the shapes share is asserted too. Everything between the builder and the screen (which
// rows exist, their order, the re-baselining, the tone) is written once.
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

  // A strip, not a column: the frame is content-sized, so this one declaration is
  // the difference between a row of squares and a stack of them.
  it('lays the strip out across rather than down', async () => {
    await run({ layout: 'tiles' });

    const list = document.querySelector<HTMLElement>('.woc-cd-list');

    expect(list?.style.flexDirection).toBe('row');
  });

  // The sweep takes the elapsed share while the addon holds a remaining, so a half-spent
  // cooldown is the case that tells a correct conversion from an inverted one.
  it('sweeps the square as the cooldown runs down', async () => {
    const h = await run({ layout: 'tiles' });
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    h.cooldown('bestial_wrath', LONG / 2);
    h.frame();

    expect(sweepOf('bestial_wrath')).toBe('50.00%');
  });

  // 40 pixels of art has no room for "119.4s", so the seconds lose their decimal
  // and anything over a minute is drawn in minutes.
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

  // A bar carries its charge count in the same figure as the time; a tile has a corner for it,
  // which is the one place the two shapes genuinely differ. The corner takes a number, so the
  // pool size the bar draws as "1/2" lives in the tooltip instead.
  it('puts a charge count in the corner instead of in the countdown', async () => {
    const h = await run({ layout: 'tiles' });

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(tileFor('arcane_shot')?.querySelector('.woc-tile-count')?.textContent).toBe('1');
    expect(tileFor('arcane_shot')?.querySelector('.woc-tile-value')?.textContent).toBe('6');
  });

  // The shared half: ordering is not part of either builder, so it has to survive
  // the switch. Soonest ready first still, left to right.
  it('keeps the soonest ready first', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('system_unstuck', 180);
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(h.drawn()).toEqual(['bestial_wrath', 'system_unstuck']);
  });

  // The ability's name is nowhere on a tile: the art is the label. So the name has
  // to reach assistive technology some other way, and that is what `label` is for.
  it('announces the ability it cannot draw a name for', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(tileFor('arcane_shot')?.getAttribute('aria-label')).toContain('Fell Shot');
  });

  // Another tab writing the setting, which is how it actually changes: the manager
  // is a different surface and the storage change is what reaches a running addon.
  it('swaps every row when the setting changes under it', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();
    expect(document.querySelectorAll('.woc-bar')).toHaveLength(1);

    h.hub.remote(`config:${FQID}`, 'values', { layout: 'tiles' });

    expect(document.querySelectorAll('.woc-bar')).toHaveLength(0);
    expect(tileFor('bestial_wrath')).not.toBeNull();
  });

  // A rebuild destroys rows, and a destroyed row must not be left in the map: the
  // next frame would append an element belonging to nothing back into the strip.
  it('leaves no orphan behind when it swaps', async () => {
    const h = await run();
    h.cooldown('bestial_wrath', LONG);
    h.poll();

    h.hub.remote(`config:${FQID}`, 'values', { layout: 'tiles' });
    h.frame();

    expect(h.drawn()).toEqual(['bestial_wrath']);
  });
});

// Resizing the strip, which is how a player picks the icon size.
//
// The height is the size: the loader owns a resizable frame's box and reports it through
// `onMove`, and the addon writes that height onto every tile. Measuring the element instead
// would force a layout on every frame of a display that already writes styles every frame.
//
// Driven here by the saved box, because that is the same path a drag takes: the restore lands
// asynchronously and reports through the same callback.
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

  // The tile is drawn before the restore lands, which is the live path: a tile already on
  // screen has to be resized rather than rebuilt, or a drag would throw away the art the
  // browser has decoded on every pointer move. `start` rather than `run`, because that window
  // is the subject.
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

  // The two layouts save separately. Sharing one key would restore a column of
  // five bars' worth of height into the strip, which opens it with icons the size
  // of a portrait.
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

  // The column is sized by its content: a fixed height would either pad it out or
  // hide the row that just started.
  it('leaves the bars layout unresizable', async () => {
    await run();

    await vi.waitFor(() => {
      expect(document.querySelector('[data-woc-frame="bars"]')).not.toBeNull();
    });
    const frame = document.querySelector<HTMLElement>('[data-woc-frame="bars"]');
    expect(frame?.style.height).toBe('');
  });

  // Both bounds are stated, and these two cases are why. A bare frame's body clips rather than
  // scrolls, so a strip dragged under one square would cut a cooldown in half; and a frame
  // that states no bounds takes the size it opened at as its floor. Driven by the saved box,
  // because that is the same path a drag takes.
  it('holds the strip at one square when a saved box is shorter', async () => {
    const h = await run({ layout: 'tiles' }, { tiles: { box: CRAMPED, visible: true } });

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(stripEl()?.style.height).toBe(`${TILE_FLOOR}px`);
    expect(sizeOf('bestial_wrath')).toBe(`${TILE_FLOOR}px`);
  });

  // The width is only room to grow into, so its floor is one square rather than the
  // width the strip opened at: a player watching two cooldowns should be able to
  // take the invisible drag area back down to what the strip actually draws.
  it('lets the strip be dragged narrower than it opened', async () => {
    await run({ layout: 'tiles' }, { tiles: { box: CRAMPED, visible: true } });

    expect(stripEl()?.style.width).toBe(`${CRAMPED.w}px`);
  });
});

// What a timer says when you hover it. A function rather than a string, because the answer
// changes every frame: an attachment made when the row was built would report what was left at
// the moment the ability went on cooldown. It is also the only place the two layouts say the
// same thing, since a tile has room for neither the name nor the charge count.
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

  // The honest half, and it is the exception rather than the rule. A cooldown outside your
  // spellbook is measured against what it had left when first seen, which is a floor rather
  // than the length, and the row itself has nowhere to say so.
  it('admits when it does not know the full length', async () => {
    const h = await run();

    h.cooldown('system_unstuck', LONG);
    h.poll();

    expect(hover('system_unstuck')).toContain('length unknown');
  });

  // And it must not say it about a row it does know the length of: the line belongs only on a
  // measured row, never on one whose length was a call away.
  it('says nothing about an unknown length for an ability you know', async () => {
    const h = await run();

    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(hover('arcane_shot')).not.toContain('length unknown');
  });

  // The long version of the mark, for the player who hovers it to find out. The
  // marked label alone says a name is a guess; this says why, and it is the only
  // place the addon can name the id it guessed FROM.
  it('explains the mark on a worked-out name', async () => {
    const h = await run();

    h.cooldown('system_unstuck', LONG);
    h.poll();

    const said = hover('system_unstuck');
    expect(said).toContain('Worked out from the ability id');
    expect(said).toContain('system_unstuck');
  });

  // Nothing at all for a name the game supplied, for the same reason the label
  // carries no mark: that one is the game's own name and needs no defending.
  it('explains nothing about the name of an ability you know', async () => {
    const h = await run();

    h.cooldown('arcane_shot', FELL_SHOT);
    h.poll();

    expect(hover('arcane_shot')).not.toContain('Worked out from');
  });

  // A charge pool publishes a real length, so its bar is measured against the
  // truth and the tooltip must not claim otherwise. It is also where a tile gets the
  // pool size, since the square's own corner takes a number and cannot show one.
  it('says nothing about an unknown length for a charge pool', async () => {
    const h = await run();

    h.charges('arcane_shot', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    const said = hover('arcane_shot');
    expect(said).not.toContain('length unknown');
    expect(said).toContain(`1 of ${String(POOL)} charges ready`);
  });

  // The residue again: no pool size anywhere, so the count stands alone rather than being
  // given a denominator the game never stated. The count is still known, so the line is written
  // out in the number it is rather than hedged as `charge(s)`.
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

  // The tile is the case that needs it most: the square carries the sweep and a
  // countdown, and nothing else at all.
  it('says the same thing under a tile', async () => {
    const h = await run({ layout: 'tiles' });
    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(hover('arcane_shot')).toContain('Fell Shot');
  });
});

// Rows are re-ordered, not re-appended.
//
// `appendChild` on an element already in the document moves it, which is a removal and an
// insertion, and the browser drops an element's hover state on the removal. Doing that to
// every row on every animation frame strands the tooltip on whatever the pointer was over.
// The kit no longer lets that orphan a tooltip; this is the other half, which is not handing
// it the problem sixty times a second.
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

    // Nothing was inserted or removed, so nothing was moved.
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

// The icon comes from the loader's own URL builder rather than from a path the addon
// wrote, which is what makes a game update that moves the directory one edit in the
// loader instead of a silent break in every addon.
describe('the skill icon', () => {
  it('points at the art for the ability, filed under the player"s class', async () => {
    const h = await run();

    h.cooldown('bestial_wrath', LONG);
    h.poll();

    expect(h.iconOf('bestial_wrath')).toBe('/ui/skills/hunter/bestial_wrath.webp');
  });

  // Not every ability ships painted art. The kit hides the slot when the image
  // fails, so the row loses its icon and keeps its label rather than showing a
  // broken-image glyph.
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
