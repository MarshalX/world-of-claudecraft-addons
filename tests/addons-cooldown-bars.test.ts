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
import MANIFEST_TEXT from '../addons/cooldown-bars/addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the dev-harness suite.
import SOURCE from '../addons/cooldown-bars/main.js?raw';
import { loadAddon } from '../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { validateManifest } from '../loader/src/shared/schema.ts';
import { frameKey, uiNamespace } from '../loader/src/shared/storage-keys.ts';
import { liveEntity } from './fakes/entity.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';
import { createSharedServices, type SharedHarness } from './fakes/shared-services.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/cooldown-bars';
/** What tests/fakes/shared-services.ts says the player is called. */
const CHARACTER = 'Claudemoon/Marshal';

interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
/** Long enough to clear the addon's global-cooldown floor. */
const LONG = 30;

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
  const parsed = validateManifest(MANIFEST_JSON);
  if (!parsed.ok) {
    throw new Error(`the cooldown-bars manifest is invalid: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.value;
}

function row(): InstalledAddon {
  return { fqid: FQID, marketplace: 'official', manifest: manifest(), enabled: true, pin: null };
}

interface BarsHarness extends SharedHarness {
  /** Put an ability on cooldown, or move what is left on it. */
  cooldown: (abilityId: string, seconds: number) => void;
  /**
   * Set a charge pool, the way a snapshot carrying `achg` and `achr` would.
   *
   * `maxCharges` is written as the zero the client actually holds rather than as a
   * real maximum, because the server never sends one. An addon reading it would
   * find a number that is always 0, which is why nothing here reads it.
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
 * Start the addon, optionally with settings already stored.
 *
 * Seeded BEFORE the addon loads, because the loader hydrates settings and then
 * evaluates: an addon reads `woc.settings` while it builds its first frame, which
 * is exactly when the layout is decided.
 */
async function run(
  settings: Record<string, unknown> = {},
  frames: Record<string, { box: FrameBox; visible: boolean }> = {},
): Promise<BarsHarness> {
  const storage = createFakeStorage();
  await storage.set(`config:${FQID}`, 'values', settings);
  await Promise.all(
    Object.entries(frames).map(([frameId, state]) =>
      storage.set(uiNamespace(FQID), frameKey('pbe', CHARACTER, frameId), state),
    ),
  );
  const cooldowns = new Map<string, number>();
  const abilityCharges: Record<string, unknown> = {};
  // `templateId` on a player is the CLASS, which is the directory the game files a
  // skill icon under. Without it there is nothing to build an icon URL from.
  const player = liveEntity({ set: { cooldowns, abilityCharges, templateId: 'hunter' } });
  // The spellbook in the game's own shape. `arcane_shot` is displayed as "Fell
  // Shot", which is the divergence a label read from the id alone gets wrong, and
  // `rapid_fire` is deliberately absent so the fallback stays covered too.
  const known = [
    {
      def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
      rank: 3,
      cost: 55,
      castTime: 0,
      cooldown: 5.4,
    },
  ];
  const world = { entities: new Map([[PLAYER_ID, player]]), player, known };
  const harness = createSharedServices(document, storage, {
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);
  const addon = await loadAddon({ shared: harness.shared, row: row(), source: SOURCE });
  teardown.push(addon.dispose);

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

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // It never touches the socket, so it must not ask for it. A permission an
  // addon does not use is one every player is asked to grant for nothing.
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

    h.cooldown('aimed_shot', LONG);
    h.poll();

    expect(h.drawn()).toEqual(['aimed_shot']);
  });

  it('drops the bar when the cooldown finishes', async () => {
    const h = await run();
    h.cooldown('aimed_shot', LONG);
    h.poll();

    h.cooldown('aimed_shot', 0);
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

    h.cooldown('rapid_fire', 180);
    h.cooldown('aimed_shot', LONG);
    h.cooldown('multi_shot', 10);
    h.poll();

    expect(h.drawn()).toEqual(['multi_shot', 'aimed_shot', 'rapid_fire']);
  });

  // The label the game itself uses, which a cooldown map cannot supply on its own:
  // it is keyed by id, and the id and the display name have diverged. Reading
  // `arcane_shot` as "Arcane Shot" is what these rows used to show, and it names an
  // ability nothing else in the game calls that.
  it('calls an ability what the game calls it, not what its id suggests', async () => {
    const h = await run();

    h.cooldown('arcane_shot', LONG);
    h.poll();

    expect(barFor('arcane_shot')?.textContent).toContain('Fell Shot');
    expect(barFor('arcane_shot')?.textContent).not.toContain('Arcane Shot');
  });

  // An id the spellbook does not carry is something the player did not learn: an
  // item cooldown, or an ability granted from outside the class kit. A guess from
  // the id beats a blank row for those.
  it('falls back to the id for an ability outside the spellbook', async () => {
    const h = await run();

    h.cooldown('rapid_fire', LONG);
    h.poll();

    expect(barFor('rapid_fire')?.textContent).toContain('Rapid Fire');
  });
});

describe('the drain', () => {
  it('starts full', async () => {
    const h = await run();

    h.cooldown('aimed_shot', LONG);
    h.poll();

    expect(h.fillOf('aimed_shot')).toBe('100.00%');
  });

  // The claim the whole example is built to demonstrate: the subscription is
  // not what moves the number. Nothing is polled here and nothing is published;
  // only a frame passes, and the bar has to follow the world on its own.
  it('follows the cooldown down without another set change', async () => {
    const h = await run();
    h.cooldown('aimed_shot', LONG);
    h.poll();

    h.cooldown('aimed_shot', LONG / 2);
    h.frame();

    expect(h.fillOf('aimed_shot')).toBe('50.00%');
    expect(h.leftOf('aimed_shot')).toBe('15.0s');
  });

  // A cooldown already running when the addon loaded has no known total, so the
  // bar is filled from whatever it was found at rather than from a guess.
  it('treats what it first saw as full for a cooldown already running', async () => {
    const h = await run();

    h.cooldown('rapid_fire', 60);
    h.poll();
    h.cooldown('rapid_fire', 30);
    h.frame();

    expect(h.fillOf('rapid_fire')).toBe('50.00%');
  });

  // A rebuild must not restart the fill: the bar keeps the total it was created
  // with, or every unrelated cooldown starting would reset every other bar.
  it('keeps its fill when an unrelated cooldown starts', async () => {
    const h = await run();
    h.cooldown('aimed_shot', LONG);
    h.poll();
    h.cooldown('aimed_shot', LONG / 2);
    h.frame();

    h.cooldown('rapid_fire', 180);
    h.poll();

    expect(h.fillOf('aimed_shot')).toBe('50.00%');
  });
});

describe('disabling it', () => {
  it('leaves no frame, no keybind, and no frame loop behind', async () => {
    const h = await run();
    h.cooldown('aimed_shot', LONG);
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
// The game has three shapes of this and the addon meets all three. `clearCooldowns`
// (Preparation) deletes an entry outright. Refunds and shaves lower it while it
// keeps running. And a shared cooldown re-arms an entry that is ALREADY running:
// casting one shaman shock sets the cooldown on every shock, so an entry with two
// seconds left jumps back to six.
//
// The third is the one that bites. The set of running ids has not changed, so the
// subscription does not fire and the bar keeps the total it was built with, which
// may now be smaller than what is left.
describe('a cooldown that is reset or re-armed', () => {
  it('drops the bar when another ability clears the cooldown outright', async () => {
    const h = await run();
    h.cooldown('rapid_fire', 180);
    h.poll();

    // What `clearCooldowns` does: the entry is deleted, not set to zero.
    h.cooldown('rapid_fire', 0);
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

  // The reachable failure: first seen part-way down, then re-armed to its full
  // length by a shared cooldown. A bar that keeps its first total has a denominator
  // smaller than what is left, and reads full for the whole difference.
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

  // The other direction cannot be detected, and this pins that it is not pretended
  // otherwise. A reset and re-press onto a SHORTER cooldown, landing below the old
  // remaining, produces 30 then 15 then 10, which is exactly what draining looks
  // like. Nothing on the wire tells them apart. If a frame catches the gap at zero
  // the bar is dropped and rebuilt correctly; if none does, it reads low until the
  // cooldown next reaches zero.
  //
  // Written down because the first version of this suite asserted the impossible
  // and would have driven a guess into the addon to satisfy it.
  it('reads a shorter re-press as a drain, which is all it can do', async () => {
    const h = await run();
    h.cooldown('aimed_shot', 30);
    h.poll();
    h.cooldown('aimed_shot', 15);
    h.frame();

    h.cooldown('aimed_shot', 10);
    h.frame();

    expect(h.fillOf('aimed_shot')).toBe('33.33%');
  });

  // And when a frame does catch the gap, the rebuild is what gets it right.
  it('rebuilds from the new length when a frame catches the reset', async () => {
    const h = await run();
    h.cooldown('aimed_shot', 30);
    h.poll();

    h.cooldown('aimed_shot', 0);
    h.poll();
    h.cooldown('aimed_shot', 10);
    h.poll();

    expect(h.fillOf('aimed_shot')).toBe('100.00%');
  });
});

// The one exact bar in the addon.
//
// Every other row here fills from whatever it was first seen at, because a
// cooldown's LENGTH is not published: the client converts an absolute schedule to a
// remaining and discards the rest. A charge pool is the exception. It carries a real
// `rechargeLength`, so the bar has a true denominator on its first frame and never
// needs re-baselining at all.
//
// The subscription cannot see these. A charge coming back while the pool still holds
// a use changes no cooldown id, so the set stays exactly as it was and only the frame
// loop can raise or drop the row.
describe('an ability regenerating a charge', () => {
  it('raises a bar from the frame loop, with no cooldown set change', async () => {
    const h = await run();

    h.charges('twinstrike', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.drawn()).toEqual(['twinstrike']);
  });

  // The whole point: half of a published twelve, right the first time it is drawn.
  it('fills against the published length rather than against what it first saw', async () => {
    const h = await run();

    h.charges('twinstrike', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.fillOf('twinstrike')).toBe('50.00%');
  });

  // The count is "1 left", not "1 of 2": the maximum is a server-side detail the
  // client zero-fills, so an addon that showed a denominator would show 0.
  it('shows how many uses are left beside the timer', async () => {
    const h = await run();

    h.charges('twinstrike', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(h.leftOf('twinstrike')).toBe('6.0s (1)');
  });

  it('drops the row once the pool is full again', async () => {
    const h = await run();
    h.charges('twinstrike', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    h.charges('twinstrike', { charges: 2, recharge: 0, length: 12 });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // A pool that has emptied is ALSO on the ordinary cooldown wire, so both readings
  // describe the same ability. One row, and the charge reading wins, because it is
  // the one with a real total.
  it('does not draw the same ability twice when the pool is empty', async () => {
    const h = await run();

    h.charges('twinstrike', { charges: 0, recharge: 9, length: 12 });
    h.cooldown('twinstrike', 9);
    h.poll();

    expect(h.drawn()).toEqual(['twinstrike']);
    expect(h.fillOf('twinstrike')).toBe('75.00%');
  });

  // A fresh recharge starting is not a re-arm to learn from: the length is already
  // known, so a remaining that goes back up must not become the new denominator.
  it('does not re-baseline off a published length', async () => {
    const h = await run();
    h.charges('twinstrike', { charges: 1, recharge: 3, length: 12 });
    h.frame();

    h.charges('twinstrike', { charges: 0, recharge: 12, length: 12 });
    h.frame();
    h.charges('twinstrike', { charges: 0, recharge: 6, length: 12 });
    h.frame();

    expect(h.fillOf('twinstrike')).toBe('50.00%');
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
// The layout is chosen when a row is BUILT, which is the whole reason a settings
// change tears the rows down instead of repainting them: an element cannot change
// from a bar into a tile, and a display that kept its old elements would answer the
// setting only for cooldowns that started afterwards.
//
// What the shapes share is asserted too. Everything the addon does between the
// builder and the screen (which rows exist, their order, the re-baselining, the
// tone) is written once and must not have quietly become bar-only.
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

    h.cooldown('aimed_shot', LONG);
    h.poll();

    expect(tileFor('aimed_shot')).not.toBeNull();
    expect(document.querySelector('.woc-bar')).toBeNull();
  });

  // A strip, not a column: the frame is content-sized, so this one declaration is
  // the difference between a row of squares and a stack of them.
  it('lays the strip out across rather than down', async () => {
    await run({ layout: 'tiles' });

    const list = document.querySelector<HTMLElement>('.woc-cd-list');

    expect(list?.style.flexDirection).toBe('row');
  });

  // The sweep takes the ELAPSED share while the addon holds a remaining, so a
  // half-spent cooldown is the case that tells a correct conversion from an
  // inverted one: both ends look right under either.
  it('sweeps the square as the cooldown runs down', async () => {
    const h = await run({ layout: 'tiles' });
    h.cooldown('aimed_shot', LONG);
    h.poll();

    h.cooldown('aimed_shot', LONG / 2);
    h.frame();

    expect(sweepOf('aimed_shot')).toBe('50.00%');
  });

  // 40 pixels of art has no room for "119.4s", so the seconds lose their decimal
  // and anything over a minute is drawn in minutes.
  it.each([
    [4.2, '5'],
    [30, '30'],
    [180, '3m'],
  ])('reads %ss left as "%s"', async (remaining, shown) => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('aimed_shot', remaining);
    h.poll();

    expect(tileFor('aimed_shot')?.querySelector('.woc-tile-value')?.textContent).toBe(shown);
  });

  // A bar carries its charge count in the same figure as the time; a tile has a
  // corner for it, which is the one place the two shapes genuinely differ.
  it('puts a charge count in the corner instead of in the countdown', async () => {
    const h = await run({ layout: 'tiles' });

    h.charges('twinstrike', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    expect(tileFor('twinstrike')?.querySelector('.woc-tile-count')?.textContent).toBe('1');
    expect(tileFor('twinstrike')?.querySelector('.woc-tile-value')?.textContent).toBe('6');
  });

  // The shared half: ordering is not part of either builder, so it has to survive
  // the switch. Soonest ready first still, left to right.
  it('keeps the soonest ready first', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('rapid_fire', 180);
    h.cooldown('aimed_shot', LONG);
    h.poll();

    expect(h.drawn()).toEqual(['aimed_shot', 'rapid_fire']);
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
    h.cooldown('aimed_shot', LONG);
    h.poll();
    expect(document.querySelectorAll('.woc-bar')).toHaveLength(1);

    h.hub.remote(`config:${FQID}`, 'values', { layout: 'tiles' });

    expect(document.querySelectorAll('.woc-bar')).toHaveLength(0);
    expect(tileFor('aimed_shot')).not.toBeNull();
  });

  // A rebuild destroys rows, and a destroyed row must not be left in the map: the
  // next frame would append an element belonging to nothing back into the strip.
  it('leaves no orphan behind when it swaps', async () => {
    const h = await run();
    h.cooldown('aimed_shot', LONG);
    h.poll();

    h.hub.remote(`config:${FQID}`, 'values', { layout: 'tiles' });
    h.frame();

    expect(h.drawn()).toEqual(['aimed_shot']);
  });
});

// Resizing the strip, which is how a player picks the icon size.
//
// The height IS the size: the loader owns a resizable frame's box and reports it
// through `onMove`, and the addon writes that height onto every tile. Measuring the
// element instead would force a layout on every frame of a display that already
// writes styles every frame.
//
// Driven here by the SAVED box, because that is the same path a drag takes: the
// restore lands asynchronously and reports through the same callback, so a strip a
// player sized last session comes back at that size.
describe('the size of the strip', () => {
  function sizeOf(abilityId: string): string {
    const tile = document.querySelector<HTMLElement>(`.woc-tile[data-ability="${abilityId}"]`);
    return tile?.style.getPropertyValue('--woc-tile-size') ?? '';
  }

  it('starts at the tap-target floor the game holds its controls to', async () => {
    const h = await run({ layout: 'tiles' });

    h.cooldown('aimed_shot', LONG);
    h.poll();

    expect(sizeOf('aimed_shot')).toBe('40px');
  });

  // The tile is drawn BEFORE the restore lands, which is the live path: a tile
  // already on screen has to be resized rather than rebuilt, or a drag would throw
  // away the art the browser has decoded on every pointer move.
  it('resizes a tile that is already on screen', async () => {
    const h = await run(
      { layout: 'tiles' },
      { tiles: { box: { x: 20, y: 20, w: 300, h: 64 }, visible: true } },
    );
    h.cooldown('aimed_shot', LONG);
    h.poll();
    expect(sizeOf('aimed_shot')).toBe('40px');

    await vi.waitFor(() => {
      expect(sizeOf('aimed_shot')).toBe('64px');
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

    h.cooldown('aimed_shot', LONG);
    h.poll();
    await settleFrames();

    expect(sizeOf('aimed_shot')).toBe('40px');
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
});

// What a timer says when you hover it.
//
// A function rather than a string, because the answer changes every frame: an
// attachment made when the row was built would report what was left at the moment
// the ability went on cooldown. It is also the only place the two layouts say the
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
    h.cooldown('aimed_shot', LONG);
    h.poll();
    expect(hover('aimed_shot')).toContain('30.0s left');

    h.cooldown('aimed_shot', LONG / 2);
    h.frame();

    expect(hover('aimed_shot')).toContain('15.0s left');
  });

  // The honest half. Every ordinary cooldown is measured against what it had left
  // when first seen, which is a floor rather than the length, and the row itself
  // has nowhere to say so.
  it('admits when it does not know the full length', async () => {
    const h = await run();

    h.cooldown('aimed_shot', LONG);
    h.poll();

    expect(hover('aimed_shot')).toContain('length unknown');
  });

  // A charge pool publishes a real length, so its bar is measured against the
  // truth and the tooltip must not claim otherwise.
  it('says nothing about an unknown length for a charge pool', async () => {
    const h = await run();

    h.charges('twinstrike', { charges: 1, recharge: 6, length: 12 });
    h.frame();

    const said = hover('twinstrike');
    expect(said).not.toContain('length unknown');
    expect(said).toContain('1 charge(s) ready');
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
// `appendChild` on an element already in the document MOVES it, which is a removal
// and an insertion, and the browser drops an element's hover state on the removal.
// Doing it to every row on every animation frame stranded the tooltip on whatever
// the pointer was over: reported from a live session, with the row still on screen
// under it. The kit no longer lets that orphan a tooltip; this is the other half,
// which is not handing it the problem sixty times a second.
describe('how rows are placed', () => {
  it('leaves a row alone when its position has not changed', async () => {
    const h = await run();
    h.cooldown('aimed_shot', LONG);
    h.cooldown('rapid_fire', 180);
    h.poll();
    const first = document.querySelector('[data-ability="aimed_shot"]');
    const observer = new MutationObserver(() => undefined);
    const list = document.querySelector('.woc-cd-list') as HTMLElement;
    observer.observe(list, { childList: true });

    h.frame();
    h.frame();

    // Nothing was inserted or removed, so nothing was moved.
    expect(observer.takeRecords()).toEqual([]);
    expect(document.querySelector('[data-ability="aimed_shot"]')).toBe(first);
    observer.disconnect();
  });

  it('still reorders when the order actually changes', async () => {
    const h = await run();
    h.cooldown('aimed_shot', 20);
    h.cooldown('rapid_fire', 10);
    h.poll();
    expect(h.drawn()).toEqual(['rapid_fire', 'aimed_shot']);

    h.cooldown('rapid_fire', 30);
    h.frame();

    expect(h.drawn()).toEqual(['aimed_shot', 'rapid_fire']);
  });
});

// The icon comes from the loader's own URL builder rather than from a path the addon
// wrote, which is what makes a game update that moves the directory one edit in the
// loader instead of a silent break in every addon.
describe('the skill icon', () => {
  it('points at the art for the ability, filed under the player"s class', async () => {
    const h = await run();

    h.cooldown('aimed_shot', LONG);
    h.poll();

    expect(h.iconOf('aimed_shot')).toBe('/ui/skills/hunter/aimed_shot.webp');
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
