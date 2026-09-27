// @vitest-environment happy-dom

// Wayline, run through the real loader. After a stretch with nothing earned the panel reports no
// rate at all, never a shrinking one. `advance` moves both `woc.now()` and the fake timers that
// drive `woc.setInterval`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import type { AddonHarness, MountInput } from '../../tests/fakes/addon.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import { type SharedHarness, WALL_CLOCK_MS } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the cooldown-bars suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
const MOB_ID = 9001;
const MATE_ID = 662;
const STRANGER_ID = 7777;

const MINUTE = 60_000;
const HOUR = 3_600_000;
/** The addon's own save interval, so a case can make one happen. */
const SAVE_MS = 10_000;
/** The window the manifest defaults to. */
const WINDOW_MINUTES = 10;
/** What the level 5 table entry asks for, which most of these cases level against. */
const LEVEL_5_NEED = 2800;
/** The level 20 entry, which is the cap requirement and the virtual curve's base. */
const CAP_NEED = 23_200;
/**
 * Lifetime experience needed to reach the cap. `xp` is frozen at 0 at the cap, so every capped
 * fixture states `xp: 0` to catch a virtual curve read from it instead of `lifetimeXp`.
 */
const CAP_LIFETIME = 167_200;
/**
 * The lifetime total that stands exactly at virtual 40, as a literal: a curve checked against a
 * rerun of itself agrees with a wrong one. Rounding the step in place is 21 low here.
 */
const VIRTUAL_40_LIFETIME = 1_495_979;

/** How many microtask turns the per-character restore takes to settle. */
const MICROTASK_TICKS = 8;

/** Where a per-character key lands: the channel and character the fakes report. */
const CHARACTER_KEY = 'char:official/wayline/pbe:Claudemoon/Marshal:samples';

const teardown: Array<() => void> = [];

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

interface Sheet {
  xp?: number;
  lifetimeXp?: number;
  restedXp?: number;
  prestigeRank?: number;
  partyInfo?: unknown;
}

interface WaylineHarness extends SharedHarness {
  fqid: string;
  /** Write the character sheet, the way a snapshot merge does. */
  sheet: (fields: Sheet) => void;
  setLevel: (level: number) => void;
  /** One experience award off the wire. `rested` is the bonus INSIDE the amount. */
  award: (amount: number, rested?: number) => void;
  /** A death in scope, credited to whoever is named. */
  slay: (killerId?: number) => void;
  /** Move both clocks: the addon measures with one and is woken by the other. */
  tick: (ms: number) => void;
  poll: () => void;
  rate: () => string;
  kills: () => string;
  time: () => string;
  barValue: (row: string) => string;
  barLabel: (row: string) => string;
  barDetail: (row: string) => string;
  barFill: (row: string) => string;
  shown: (row: string) => boolean;
  hover: (el: Element | null) => string;
  rowEl: (key: string) => HTMLElement | null;
  stored: () => unknown;
}

/** One of the three figures, read out of the kit bar it is drawn in. */
function figureOf(key: string): string {
  return document.querySelector(`[data-wayline="${key}"] .woc-bar-value`)?.textContent ?? '';
}

function barOf(row: string): HTMLElement | null {
  return document.querySelector(`.woc-wayline-${row}`);
}

function resetButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.woc-wayline-reset');
}

function partOf(row: string, part: string): string {
  return barOf(row)?.querySelector(`.woc-bar-${part}`)?.textContent ?? '';
}

/** Let the per-character restore land, several microtasks after the body has run. */
async function settle(): Promise<void> {
  let chain = Promise.resolve();
  for (let at = 0; at < MICROTASK_TICKS; at += 1) {
    chain = chain.then(() => undefined);
  }
  await chain;
}

/** Mount with or without a world: `exactOptionalPropertyTypes` refuses a `game: undefined`. */
function mount(
  base: MountInput,
  world: Record<string, unknown>,
  offline: boolean,
): Promise<AddonHarness> {
  if (offline) {
    return mountAddon(base);
  }
  return mountAddon({ ...base, game: Promise.resolve({ world }) });
}

interface StartOpts {
  level?: number;
  sheet?: Sheet;
  storage?: FakeStorage;
  /** Leave the world out entirely, which is where an addon's first line runs. */
  offline?: boolean;
}

async function start(
  settings: Record<string, unknown> = {},
  opts: StartOpts = {},
): Promise<WaylineHarness> {
  const player = liveEntity({ set: { level: opts.level ?? 5 } });
  const entities = new Map<number, unknown>([[PLAYER_ID, player]]);
  // The character sheet rides the game's own world object, where `world.character` reads it.
  const world: Record<string, unknown> = {
    entities,
    player,
    partyInfo: null,
    xp: 0,
    lifetimeXp: 0,
    restedXp: 0,
    prestigeRank: 0,
    ...opts.sheet,
  };
  const storage = opts.storage ?? createFakeStorage();
  const harness = await mount(
    { manifest: MANIFEST_TEXT, source: SOURCE, settings, storage },
    world,
    opts.offline === true,
  );
  teardown.push(harness.dispose);

  return {
    ...harness,
    sheet: (fields) => {
      Object.assign(world, fields);
    },
    setLevel: (level) => {
      Object.assign(player, { level });
    },
    award: (amount, rested) => {
      // Rebuilt rather than mutated: TypeScript forbids the dot on an index signature and Biome
      // forbids the bracket on a literal key.
      let event: Record<string, unknown> = { type: 'xp', amount };
      if (rested !== undefined) {
        event = { ...event, rested };
      }
      harness.inbound(eventsFrame([event]));
    },
    slay: (killerId = PLAYER_ID) => {
      harness.inbound(eventsFrame([{ type: 'death', entityId: MOB_ID, killerId }]));
    },
    tick: (ms) => {
      harness.advance(ms);
      vi.advanceTimersByTime(ms);
    },
    poll: () => harness.shared.world.watcher.poll(),
    rate: () => figureOf('rate'),
    kills: () => figureOf('kills'),
    time: () => figureOf('time'),
    barValue: (row) => partOf(row, 'value'),
    barLabel: (row) => partOf(row, 'label'),
    barDetail: (row) => partOf(row, 'detail'),
    barFill: (row) =>
      document.querySelector<HTMLElement>(`.woc-wayline-${row} .woc-bar-fill`)?.style.width ?? '',
    shown: (row) => barOf(row)?.hidden === false,
    hover: (el) => {
      el?.dispatchEvent(new Event('pointerenter'));
      return document.getElementById('woc-tooltip')?.textContent ?? '';
    },
    rowEl: (key) => document.querySelector(`[data-wayline="${key}"]`),
    stored: () => harness.hub.dump()[CHARACTER_KEY],
  };
}

/** `start`, plus the restore and the first sample that turns the world on. */
async function run(
  settings: Record<string, unknown> = {},
  opts: StartOpts = {},
): Promise<WaylineHarness> {
  const harness = await start(settings, opts);
  await settle();
  // The sample that takes the world live. Not a clock advance: the cases below measure a rate.
  harness.poll();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  it('asks for the wire, the world, a frame, a key and its own storage', () => {
    expect(parseManifest(MANIFEST_TEXT).permissions).toEqual([
      'net.read',
      'world.read',
      'ui',
      'storage',
      'keys',
    ]);
  });
});

describe('the rate', () => {
  it('measures what was earned against the stretch it was earned over', async () => {
    const h = await run();

    h.award(1000);
    h.tick(5 * MINUTE);

    expect(h.rate()).toBe('12,000 xp/hr');
  });

  // The case a since-start average fails.
  it('stops claiming a rate once the window has emptied', async () => {
    const h = await run();
    h.award(1000);
    h.tick(5 * MINUTE);
    expect(h.rate()).toBe('12,000 xp/hr');

    h.tick(6 * MINUTE);

    expect(h.rate()).toBe(`nothing in ${String(WINDOW_MINUTES)}m`);
  });

  it('stops projecting a time once the window has emptied', async () => {
    const h = await run({}, { sheet: { xp: 800 } });
    h.award(1000);
    h.tick(5 * MINUTE);
    expect(h.time()).toBe('10m');

    h.tick(6 * MINUTE);

    expect(h.time()).toBe('--');
  });

  it('empties on the window the player chose', async () => {
    const h = await run({ 'window-minutes': 2 });
    h.award(1000);
    h.tick(MINUTE);
    expect(h.rate()).toBe('60,000 xp/hr');

    h.tick(2 * MINUTE);

    expect(h.rate()).toBe('nothing in 2m');
  });

  // Without the floor, an award a second old reads in the millions.
  it('refuses to call ten seconds an hourly rate', async () => {
    const h = await run();

    h.award(1000);
    h.tick(10_000);

    expect(h.rate()).toBe('60,000 xp/hr');
  });

  it('counts every award in the window, not only the last', async () => {
    const h = await run();

    h.award(600);
    h.tick(MINUTE);
    h.award(600);
    h.tick(4 * MINUTE);

    expect(h.rate()).toBe('14,400 xp/hr');
  });
});

// The bonus rides INSIDE the amount, so leaving it out is a subtraction.
describe('the rested bonus in the rate', () => {
  it('counts the whole award by default, which is what actually landed', async () => {
    const h = await run();

    h.award(1000, 400);
    h.tick(5 * MINUTE);

    expect(h.rate()).toBe('12,000 xp/hr');
  });

  it('takes the bonus back out when the player asks for the unrested pace', async () => {
    const h = await run({ 'rested-apart': true });

    h.award(1000, 400);
    h.tick(5 * MINUTE);

    expect(h.rate()).toBe('7,200 xp/hr');
  });
});

// A kill is an award that landed just after a death this player's group is owed for.
describe('kills to go', () => {
  it('counts an award that followed a kill of the player’s own', async () => {
    const h = await run({}, { sheet: { xp: 800 } });

    h.slay();
    h.award(500);

    expect(h.kills()).toBe('4');
  });

  it('counts a kill a party member landed, since the award is split', async () => {
    const h = await run({}, { sheet: { xp: 800, partyInfo: { leader: PLAYER_ID, raid: false } } });
    h.sheet({
      partyInfo: {
        leader: PLAYER_ID,
        raid: false,
        members: [{ pid: PLAYER_ID }, { pid: MATE_ID }],
      },
    });

    h.slay(MATE_ID);
    h.award(500);

    expect(h.kills()).toBe('4');
  });

  it('does not count an award that followed no kill at all', async () => {
    const h = await run({}, { sheet: { xp: 800 } });

    h.award(500);

    expect(h.kills()).toBe('--');
  });

  it('does not count a kill somebody else made', async () => {
    const h = await run({}, { sheet: { xp: 800 } });

    h.slay(STRANGER_ID);
    h.award(500);

    expect(h.kills()).toBe('--');
  });

  it('does not credit an award that landed long after the death', async () => {
    const h = await run({}, { sheet: { xp: 800 } });

    h.slay();
    h.tick(10_000);
    h.award(500);

    expect(h.kills()).toBe('--');
  });

  it('goes quiet again when the kills age out of the window', async () => {
    const h = await run({}, { sheet: { xp: 800 } });
    h.slay();
    h.award(500);
    expect(h.kills()).toBe('4');

    h.tick(11 * MINUTE);

    expect(h.kills()).toBe('--');
  });
});

describe('the level row', () => {
  it('reads the experience against the table for that level', async () => {
    const h = await run({}, { sheet: { xp: 700 } });

    expect(h.barLabel('level')).toBe('Level 5');
    expect(h.barValue('level')).toBe('25%');
    expect(h.barDetail('level')).toBe('700 / 2,800');
  });

  it('fills as the level is earned rather than draining', async () => {
    const h = await run({}, { sheet: { xp: 2100 } });

    expect(h.barFill('level')).toBe('75.00%');
  });

  it('says so at the cap rather than reading as three quarters of nothing', async () => {
    const h = await run({}, { level: 20, sheet: { lifetimeXp: CAP_LIFETIME + 5000 } });

    expect(h.barValue('level')).toBe('max');
    expect(h.barDetail('level')).toBe('5,000 past the cap');
  });

  // At the cap `xp` is 0 forever.
  it('counts the lifetime past the cap rather than this level’s own progress', async () => {
    const h = await run({}, { level: 20, sheet: { xp: 0, lifetimeXp: CAP_LIFETIME + 40_000 } });

    expect(h.barDetail('level')).toBe('40,000 past the cap');
  });

  it('shows nothing before there is a character to show', async () => {
    const h = await start({}, { offline: true });
    await settle();

    expect(h.barValue('level')).toBe('--');
    expect(h.rate()).toBe(`nothing in ${String(WINDOW_MINUTES)}m`);
  });
});

describe('the rested pool', () => {
  it('reads as a fraction of a level and as bubbles', async () => {
    const h = await run({}, { sheet: { restedXp: 1400 } });

    expect(h.barValue('rested')).toBe('0.5 levels');
    expect(h.barDetail('rested')).toBe('10 bubbles, 1,400 xp');
  });

  it('drops the breakdown when there is no pool to break down', async () => {
    const h = await run({}, { level: 20, sheet: { restedXp: 0 } });

    expect(h.barValue('rested')).toBe('0.0 levels');
    expect(h.barDetail('rested')).toBe('');
    expect(barOf('rested')?.querySelector('.woc-bar-detail')?.hasAttribute('hidden')).toBe(true);
  });

  it('measures the pool against its own cap rather than against a level', async () => {
    const h = await run({}, { sheet: { restedXp: LEVEL_5_NEED } });

    expect(h.barValue('rested')).toBe('1.0 levels');
    expect(h.barFill('rested')).toBe('66.67%');
  });

  // Nothing published says where the character is logged out, so filling is unknowable.
  it('refuses to say whether it is filling', async () => {
    const h = await run({}, { sheet: { restedXp: 1400 } });

    expect(h.hover(barOf('rested'))).toContain('never how fast it is filling');
  });

  it('says the pool stops filling at the cap', async () => {
    const capped = await run({}, { level: 20, sheet: { restedXp: 1400 } });
    expect(capped.hover(barOf('rested'))).toContain('stops filling entirely');
  });

  it('does not say that to a character who is still levelling', async () => {
    const h = await run({}, { sheet: { restedXp: 1400 } });

    expect(h.hover(barOf('rested'))).not.toContain('stops filling entirely');
  });
});

describe('the virtual level past the cap', () => {
  it('is not drawn while there is a real level to earn', async () => {
    const h = await run();

    expect(h.shown('virtual')).toBe(false);
  });

  // Below the cap the curve reuses the real table, so reaching it is virtual 20.
  it('reads as the cap itself for a character who has just reached it', async () => {
    const h = await run({}, { level: 20, sheet: { lifetimeXp: CAP_LIFETIME } });

    expect(h.shown('virtual')).toBe(true);
    expect(h.barLabel('virtual')).toBe('Virtual 20');
  });

  it('works the level out from the lifetime total past the cap', async () => {
    const h = await run({}, { level: 20, sheet: { lifetimeXp: CAP_LIFETIME + CAP_NEED + 5000 } });

    expect(h.shown('virtual')).toBe(true);
    expect(h.barLabel('virtual')).toBe('Virtual 21');
    expect(h.barDetail('virtual')).toBe('5,000 / 25,520');
  });

  // Only the lifetime total moves; a target read from `xp` would sit at virtual 2 forever.
  it('counts toward the next virtual level as the lifetime total climbs', async () => {
    const h = await run({}, { level: 20, sheet: { xp: 0, lifetimeXp: CAP_LIFETIME } });
    h.slay();
    h.award(1000);

    expect(h.hover(h.rowEl('kills'))).toContain('23,200 to virtual 21');
    expect(h.kills()).toBe('24');

    h.sheet({ xp: 0, lifetimeXp: CAP_LIFETIME + 13_200 });
    h.poll();

    expect(h.kills()).toBe('10');
  });

  // A curve that rounds the step in place reaches virtual 40 twenty-one experience early.
  it('steps the curve where the game steps it rather than one rounding earlier', async () => {
    const h = await run({}, { level: 20, sheet: { xp: 0, lifetimeXp: VIRTUAL_40_LIFETIME - 1 } });

    expect(h.barLabel('virtual')).toBe('Virtual 39');

    h.sheet({ xp: 0, lifetimeXp: VIRTUAL_40_LIFETIME });
    h.poll();

    expect(h.barLabel('virtual')).toBe('Virtual 40');
    // Spelled out, since an assertion through `toLocaleString` would pass a locale-dependent panel.
    expect(h.barDetail('virtual')).toBe('0 / 156,078');
  });

  it('says it is derived rather than presenting it as the game speaking', async () => {
    const h = await run({}, { level: 20, sheet: { lifetimeXp: CAP_LIFETIME } });

    expect(h.hover(barOf('virtual'))).toContain('Nothing on the wire carries a virtual level');
  });

  it('takes the two projections with it when it is switched off', async () => {
    const h = await run(
      { 'show-virtual': false },
      { level: 20, sheet: { lifetimeXp: CAP_LIFETIME } },
    );
    h.award(1000);
    h.tick(5 * MINUTE);

    expect(h.shown('virtual')).toBe(false);
    expect(h.rate()).toBe('12,000 xp/hr');
    expect(h.time()).toBe('--');
    expect(h.kills()).toBe('--');
  });
});

// A page reload mid-session must not read as having earned nothing.
describe('what it remembers', () => {
  // The fake pins `woc.wallClock()` far from `Date.now()`, so reading the page global fails here.
  it('writes the awards for this character, without the monotonic stamp', async () => {
    const h = await run();
    h.award(1000, 250);

    h.tick(SAVE_MS);
    await settle();

    expect(h.stored()).toEqual([{ wallAt: WALL_CLOCK_MS, amount: 1000, rested: 250, kill: false }]);
  });

  it('puts a stored award back at the age it actually has', async () => {
    const hub = createFakeStorage();
    await hub.set('char:official/wayline', 'pbe:Claudemoon/Marshal:samples', [
      { wallAt: WALL_CLOCK_MS - 5 * MINUTE, amount: 1000, rested: 0, kill: false },
    ]);

    const h = await run({}, { storage: hub });

    expect(h.rate()).toBe('12,000 xp/hr');
  });

  // The wall clock is four hours on and the monotonic clock is a fresh page's. The sample must
  // come back five minutes old; both ways of dropping the conversion land on 60,000.
  it('restores an award across a reload that moved one clock and reset the other', async () => {
    const wallNow = WALL_CLOCK_MS + 4 * HOUR;
    const hub = createFakeStorage();
    await hub.set('char:official/wayline', 'pbe:Claudemoon/Marshal:samples', [
      { wallAt: wallNow - 5 * MINUTE, amount: 1000, rested: 0, kill: false },
    ]);

    const h = await start({}, { storage: hub });
    // Before the restore settles, so an ordering slip refuses the sample as future-dated.
    h.setWallClock(wallNow);
    await settle();
    h.poll();

    expect(h.rate()).toBe('12,000 xp/hr');
  });

  // Nothing moved the monotonic clock, so only the wall reading can say the sample is stale.
  it('drops an award the reload outlived, however new the monotonic clock is', async () => {
    const hub = createFakeStorage();
    await hub.set('char:official/wayline', 'pbe:Claudemoon/Marshal:samples', [
      { wallAt: WALL_CLOCK_MS, amount: 1000, rested: 0, kill: false },
    ]);

    const h = await start({}, { storage: hub });
    h.setWallClock(WALL_CLOCK_MS + 4 * HOUR);
    await settle();
    h.poll();

    expect(h.rate()).toBe(`nothing in ${String(WINDOW_MINUTES)}m`);
  });

  it('drops a stored award the window no longer covers', async () => {
    const hub = createFakeStorage();
    await hub.set('char:official/wayline', 'pbe:Claudemoon/Marshal:samples', [
      { wallAt: WALL_CLOCK_MS - 30 * MINUTE, amount: 1000, rested: 0, kill: false },
    ]);

    const h = await run({}, { storage: hub });

    expect(h.rate()).toBe(`nothing in ${String(WINDOW_MINUTES)}m`);
  });

  // A per-character write rejects before world entry, so the addon must decline.
  it('writes nothing at all before world entry', async () => {
    const h = await start({}, { offline: true });
    await settle();

    h.award(1000);
    h.tick(SAVE_MS);
    await settle();

    expect(h.stored()).toBeUndefined();
  });
});

describe('its controls', () => {
  it('takes the panel off screen and brings it back', async () => {
    const h = await run();
    const el = document.querySelector('[data-woc-frame="panel"]');

    h.press('Alt+KeyX');
    expect(el?.classList.contains('woc-hidden')).toBe(true);

    h.press('Alt+KeyX');
    expect(el?.classList.contains('woc-hidden')).toBe(false);
  });

  it('throws the recorded awards away on request', async () => {
    const h = await run();
    h.award(1000);
    h.tick(5 * MINUTE);
    expect(h.rate()).toBe('12,000 xp/hr');

    resetButton()?.click();

    expect(h.rate()).toBe(`nothing in ${String(WINDOW_MINUTES)}m`);
  });

  it('turns the button off while there is nothing recorded to throw away', async () => {
    const h = await run();
    expect(resetButton()?.disabled).toBe(true);

    h.award(1000);
    expect(resetButton()?.disabled).toBe(false);

    h.tick(11 * MINUTE);

    expect(resetButton()?.disabled).toBe(true);
  });
});

describe('changing a setting under it', () => {
  // A frame's density is decided when it is built.
  it('rebuilds the frame for the density and leaves exactly one behind', async () => {
    const h = await run();
    expect(document.querySelector('[data-woc-frame="panel"]')?.className).toContain(
      'woc-density-compact',
    );

    h.hub.remote(`config:${h.fqid}`, 'values', { density: 'comfortable' });

    const frames = document.querySelectorAll('[data-woc-frame="panel"]');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.className).toContain('woc-density-comfortable');
    expect(document.querySelectorAll('.woc-wayline')).toHaveLength(1);
  });

  it('answers a window change from the next paint rather than a rebuild', async () => {
    const h = await run();
    h.award(1000);
    h.tick(5 * MINUTE);

    h.hub.remote(`config:${h.fqid}`, 'values', { 'window-minutes': 2 });

    expect(h.rate()).toBe('nothing in 2m');
    expect(document.querySelectorAll('[data-woc-frame="panel"]')).toHaveLength(1);
  });
});

describe('what a row says under the pointer', () => {
  it('says the projection stops rather than growing without limit', async () => {
    const h = await run();

    expect(h.hover(h.rowEl('time'))).toContain('growing without limit');
  });

  it('says there is no rate rather than implying a small one', async () => {
    const h = await run();

    expect(h.hover(h.rowEl('rate'))).toContain('no rate to report');
  });

  it('names the party split and the grey band on the rate row', async () => {
    const h = await run();
    h.award(1000);
    h.tick(MINUTE);

    const said = h.hover(h.rowEl('rate'));

    expect(said).toContain('within 80 yards');
    expect(said).toContain('worth nothing at all');
  });
});

describe('disabling it', () => {
  it('leaves no panel, no keybind, and nothing still ticking', async () => {
    const h = await run();
    h.award(1000);
    h.tick(MINUTE);

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('[data-woc-frame="panel"]')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.tick(5 * MINUTE)).not.toThrow();
  });
});
