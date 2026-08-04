// @vitest-environment happy-dom

// Wayline, run through the real loader.
//
// The claim worth pinning is a negative one: after a stretch with nothing earned, the panel
// stops reporting a rate at all rather than reporting a smaller and smaller one forever. That is
// the case an average since the addon started passes for the first few minutes and fails
// permanently afterwards, which is why "earn, then wait out the window" is the first thing in
// this file and why it asserts on the exact string.
//
// Almost everything here is driven by `advance`, because the subject is a rate. The addon's own
// clock is `woc.now()`, which `advance` moves, and its timers are `woc.setInterval`, which
// vitest's fake timers move, so the harness moves both together.

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
 * Lifetime experience needed to reach the cap: the sum of every level's own requirement below
 * it.
 *
 * The virtual curve is a function of `lifetimeXp` and not of `xp`, which is the correction these
 * cases exist to hold. `xp` is progress within the current level and is frozen at 0 once the cap
 * is reached, so a virtual level derived from it reads as the first one for the life of the
 * character. Every capped fixture below therefore states `xp: 0` explicitly.
 */
const CAP_LIFETIME = 167_200;
/**
 * The lifetime total that stands exactly at virtual 40. A literal rather than the addon's own
 * loop run a second time: a curve checked against a repetition of itself agrees with a wrong one
 * as readily as with a right one. The post-cap step is rounded on its way into the total and not
 * in place, and the two orders produce identical thresholds through virtual 30; they first part
 * at 31, and by 40 the wrong one is 21 experience low.
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

/**
 * One of the three figures, read out of the kit row it is drawn in. `.woc-bar-value` rather than
 * a class of the addon's own, because these three rows are kit bars whose fill is never set:
 * they are rows rather than fractions, and asking the kit for the row is what keeps them the
 * same size as the bars they sit between.
 */
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

/**
 * Let the async restore land before reading what the addon drew. The per-character read waits
 * for the character and then goes through the storage hub, so it settles several microtasks
 * after the body has finished running.
 */
async function settle(): Promise<void> {
  let chain = Promise.resolve();
  for (let at = 0; at < MICROTASK_TICKS; at += 1) {
    chain = chain.then(() => undefined);
  }
  await chain;
}

/**
 * Mount with or without a world, without a ternary over the options object. Two calls rather
 * than one, for the reason `mountAddon` itself makes two: `exactOptionalPropertyTypes` refuses a
 * `game: undefined`, so the difference has to be which object is built.
 */
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
  // The character sheet rides the game's own world object, which is where
  // `world.character` reads every one of these from.
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
      // Rebuilt rather than mutated. Assigning a member of a Record is an index access, and the
      // two linters want opposite things about one: TypeScript's
      // noPropertyAccessFromIndexSignature forbids the dot and Biome's useLiteralKeys forbids the
      // bracket. A fresh object with a literal key is neither.
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
  // The one sample that carries the world from "not there" to live, which is what the character
  // subscription reports. Deliberately not a clock advance: every case below measures a rate.
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

// A rate over "everything since the addon started" keeps answering forever: the numerator stops
// and the denominator does not, so it decays toward zero while still printing a figure, and the
// time to level grows without limit. The window is what makes the display stop instead.
describe('the rate', () => {
  it('measures what was earned against the stretch it was earned over', async () => {
    const h = await run();

    h.award(1000);
    h.tick(5 * MINUTE);

    expect(h.rate()).toBe('12,000 xp/hr');
  });

  // The case a since-start average fails. Nothing is earned for longer than the window, so the
  // last award falls out of it and there is nothing left to divide.
  it('stops claiming a rate once the window has emptied', async () => {
    const h = await run();
    h.award(1000);
    h.tick(5 * MINUTE);
    expect(h.rate()).toBe('12,000 xp/hr');

    h.tick(6 * MINUTE);

    expect(h.rate()).toBe(`nothing in ${String(WINDOW_MINUTES)}m`);
  });

  // The other half of the same claim, and the one that is actually acted on: a
  // player reads the time, not the rate. It must go blank rather than to an hour,
  // then a day, then a week.
  it('stops projecting a time once the window has emptied', async () => {
    const h = await run({}, { sheet: { xp: 800 } });
    h.award(1000);
    h.tick(5 * MINUTE);
    expect(h.time()).toBe('10m');

    h.tick(6 * MINUTE);

    expect(h.time()).toBe('--');
  });

  // A shorter window empties sooner, which is the whole point of the setting: a
  // rate over a session that changed is a rate about a session that is over.
  it('empties on the window the player chose', async () => {
    const h = await run({ 'window-minutes': 2 });
    h.award(1000);
    h.tick(MINUTE);
    expect(h.rate()).toBe('60,000 xp/hr');

    h.tick(2 * MINUTE);

    expect(h.rate()).toBe('nothing in 2m');
  });

  // Without the floor the first award of a window divides by however long ago it
  // landed, so an award a second old reads in the millions.
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

// The bonus rides INSIDE the amount rather than on top of it, so leaving it out
// is a subtraction rather than an omission.
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

// An xp event does not say what earned it, so a kill is one that landed just
// after a death this player's group is owed for.
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

  // A quest turn-in and a kill are the same record, so the only thing separating
  // them is that one of them followed a death.
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

  // It fills as you earn, which is the opposite of what the kit's timer rows mean
  // by a fraction and is the only reading anyone has of an experience bar.
  it('fills as the level is earned rather than draining', async () => {
    const h = await run({}, { sheet: { xp: 2100 } });

    expect(h.barFill('level')).toBe('75.00%');
  });

  it('says so at the cap rather than reading as three quarters of nothing', async () => {
    const h = await run({}, { level: 20, sheet: { lifetimeXp: CAP_LIFETIME + 5000 } });

    expect(h.barValue('level')).toBe('max');
    expect(h.barDetail('level')).toBe('5,000 past the cap');
  });

  // At the cap the game returns before touching that bar at all, so `xp` is not a number that
  // moves slowly, it is 0 forever. A detail read from it says `0 past the cap` on day one and on
  // day two hundred.
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

  // The breakdown is what the pool is MADE of, and an empty pool is made of
  // nothing. It matters at the cap, where the pool stops filling and stays at zero
  // for the life of the character: the row would otherwise carry a second line
  // saying `0 bubbles, 0 xp` under a first one already reading `0.0 levels`.
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

  // The pool fills only inside an inn, which is a place rather than a state, so
  // the row can never say whether it is filling and the tooltip says as much.
  it('refuses to say whether it is filling', async () => {
    const h = await run({}, { sheet: { restedXp: 1400 } });

    expect(h.hover(barOf('rested'))).toContain('never how fast it is filling');
  });

  // The one thing about the filling that CAN be said, and it applies to exactly the
  // players a post-cap panel is drawn for: a capped character accrues no rested at
  // all, so the row is a pool that will not move rather than one that might be.
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

  // Derived here, because nothing on the wire carries one. Reaching the cap is
  // virtual 20 by construction, since the game's own curve reuses the real table
  // below the cap; the first level past it costs the cap requirement and each one
  // after asks a tenth more.
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

  // The reason the fixture holds `xp` at 0 throughout rather than leaving it out. At the cap `xp`
  // is frozen there by the game, so a target derived from it names virtual 2 and sits 400
  // experience away for the life of the character. The lifetime total is the only number that
  // moves, so it is the only one moved here.
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

  // Where the rounding goes is part of the curve, and the wrong place is invisible for eleven
  // virtual levels. Crossing the boundary at 40 is what tells the two apart: a curve that rounds
  // the step in place reaches 40 twenty-one experience early.
  it('steps the curve where the game steps it rather than one rounding earlier', async () => {
    const h = await run({}, { level: 20, sheet: { xp: 0, lifetimeXp: VIRTUAL_40_LIFETIME - 1 } });

    expect(h.barLabel('virtual')).toBe('Virtual 39');

    h.sheet({ xp: 0, lifetimeXp: VIRTUAL_40_LIFETIME });
    h.poll();

    expect(h.barLabel('virtual')).toBe('Virtual 40');
    // Spelled out rather than formatted from the constant: the addon groups by hand
    // so the panel reads the same in every locale, and an assertion that went
    // through `toLocaleString` would agree with a version that did not.
    expect(h.barDetail('virtual')).toBe('0 / 156,078');
  });

  it('says it is derived rather than presenting it as the game speaking', async () => {
    const h = await run({}, { level: 20, sheet: { lifetimeXp: CAP_LIFETIME } });

    expect(h.hover(barOf('virtual'))).toContain('Nothing on the wire carries a virtual level');
  });

  // Switching the display off leaves nothing to count toward, and the two derived
  // figures say nothing rather than quietly counting to a number nobody asked for.
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

// The samples are the session's, and a page reload in the middle of one must not
// be the same thing as having earned nothing.
describe('what it remembers', () => {
  // The stamp is `woc.wallClock()` rather than `Date.now()`, which the fake pins to a fixed
  // reading nowhere near the real one, so this fails if the page global comes back. The two would
  // be the same value in a browser, and a suite is the only place they can be told apart.
  it('writes the awards for this character, without the monotonic stamp', async () => {
    const h = await run();
    h.award(1000, 250);

    h.tick(SAVE_MS);
    await settle();

    expect(h.stored()).toEqual([{ wallAt: WALL_CLOCK_MS, amount: 1000, rested: 250, kill: false }]);
  });

  // The stored stamp is a WALL clock reading, because `woc.now()` restarts at every
  // page load. The restore turns it back into a monotonic one by subtracting the
  // wall time that has passed, which is what makes a rate survive a reload.
  it('puts a stored award back at the age it actually has', async () => {
    const hub = createFakeStorage();
    await hub.set('char:official/wayline', 'pbe:Claudemoon/Marshal:samples', [
      { wallAt: WALL_CLOCK_MS - 5 * MINUTE, amount: 1000, rested: 0, kill: false },
    ]);

    const h = await run({}, { storage: hub });

    expect(h.rate()).toBe('12,000 xp/hr');
  });

  // The reload itself, which is the only case the two-clock conversion exists for and the one the
  // case above cannot express: there, both clocks stand still, so a restore that ignored the wall
  // reading entirely would pass it.
  //
  // Here the wall clock is four hours further on than it was when the sample was written, while
  // the monotonic clock is the fresh one this page started with. The sample was stamped five
  // minutes before the current wall reading, so five minutes is the age it has to come back at.
  // Both ways of dropping the conversion land on 60,000 instead.
  it('restores an award across a reload that moved one clock and reset the other', async () => {
    const wallNow = WALL_CLOCK_MS + 4 * HOUR;
    const hub = createFakeStorage();
    await hub.set('char:official/wayline', 'pbe:Claudemoon/Marshal:samples', [
      { wallAt: wallNow - 5 * MINUTE, amount: 1000, rested: 0, kill: false },
    ]);

    const h = await start({}, { storage: hub });
    // Ahead of the restore settling, which is what the addon reads it at. A sample
    // stamped after the reading the restore actually used would be refused as
    // being in the future, so an ordering slip fails here rather than passing.
    h.setWallClock(wallNow);
    await settle();
    h.poll();

    expect(h.rate()).toBe('12,000 xp/hr');
  });

  // The half a levelling display is judged on: an addon that came back after a night away must
  // not present last night's rate as this morning's. Nothing moved the monotonic clock, so the
  // window can only know the sample is stale through the wall reading.
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

  // A per-character write refuses to wait for a character, so there is nothing to
  // do before world entry but decline. An addon's first line runs on the landing
  // page, which is where this case is.
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

  // The window is what makes a stale reading go away on its own, and the button is
  // what makes it go away now, which is what a player who has just changed what
  // they are doing wants.
  it('throws the recorded awards away on request', async () => {
    const h = await run();
    h.award(1000);
    h.tick(5 * MINUTE);
    expect(h.rate()).toBe('12,000 xp/hr');

    resetButton()?.click();

    expect(h.rate()).toBe(`nothing in ${String(WINDOW_MINUTES)}m`);
  });

  // A control offering to do nothing is the same class of dishonesty as a rate
  // measured over a window that holds nothing, and the panel spends every break in
  // play in exactly this state.
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
  // A frame's density is decided when it is built, so that one setting is the only
  // one that needs a new frame.
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

  // The trap the window exists for, in words, on the row the window governs.
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
