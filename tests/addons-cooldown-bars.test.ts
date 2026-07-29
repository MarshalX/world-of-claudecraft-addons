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
import { liveEntity } from './fakes/entity.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';
import { createSharedServices, type SharedHarness } from './fakes/shared-services.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/cooldown-bars';
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
}

function barFor(abilityId: string): Element | null {
  return document.querySelector(`[data-ability="${abilityId}"]`);
}

async function run(): Promise<BarsHarness> {
  const cooldowns = new Map<string, number>();
  const player = liveEntity({ set: { cooldowns } });
  const world = { entities: new Map([[PLAYER_ID, player]]), player };
  const harness = createSharedServices(document, createFakeStorage(), {
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
    poll: () => harness.shared.world.watcher.poll(),
    frame: () => vi.advanceTimersToNextFrame(),
    // Read off the attribute rather than the dataset, which is an index
    // signature: the linter wants dot access there and the compiler forbids it.
    drawn: () =>
      [...document.querySelectorAll('[data-ability]')].map(
        (el) => el.getAttribute('data-ability') ?? '',
      ),
    fillOf: (abilityId) =>
      (barFor(abilityId)?.querySelector('.woc-cd-fill') as HTMLElement | null)?.style.width ?? '',
    leftOf: (abilityId) => barFor(abilityId)?.querySelector('.woc-cd-left')?.textContent ?? '',
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

  it('reads the ability id as a name', async () => {
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

    expect(h.fillOf('aimed_shot')).toBe('100.0%');
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

    expect(h.fillOf('aimed_shot')).toBe('50.0%');
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

    expect(h.fillOf('rapid_fire')).toBe('50.0%');
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

    expect(h.fillOf('aimed_shot')).toBe('50.0%');
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

    expect(h.fillOf('combustion')).toBe('50.0%');
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
    expect(h.fillOf('earth_shock')).toBe('100.0%');

    // And from there it drains against the SIX, not against the two.
    h.cooldown('earth_shock', 3);
    h.frame();

    expect(h.fillOf('earth_shock')).toBe('50.0%');
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

    expect(h.fillOf('aimed_shot')).toBe('33.3%');
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

    expect(h.fillOf('aimed_shot')).toBe('100.0%');
  });
});
