// @vitest-environment happy-dom

// Longwatch, run through the real loader.
//
// Every mob is an ordinary entity with no rare flag, so the addon may recognise one only by
// `templateId`.
//
// The two clocks are driven SEPARATELY, which makes a four hour countdown cheap: `setWallClock`
// moves `woc.wallClock()`, advancing the fake timers runs the once-a-second redraw, and neither
// moves the other.
//
// `rares.json` is seeded as raw text keyed by the declared path, as the host's install cache holds
// it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_SENDER } from '../../loader/src/runtime/bus/hub.ts';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { characterNamespace, perCharacterKey } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the cooldown-bars suite.
import SOURCE from './main.js?raw';
import RANKS_TEXT from './mobs.json?raw';
import ROSTER_TEXT from './rares.json?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const FQID = 'official/longwatch';
/** What tests/fakes/shared-services.ts says the player is called, and which host. */
const CHARACTER = 'Claudemoon/Marshal';
const CHANNEL = 'pbe';
const STORE_KEY = 'sightings';
const ROSTER_FILE = 'rares.json';
/** The rank table this addon carries for other addons. */
const RANKS_FILE = 'mobs.json';
/** The topic it is published on. `follow` derives `mobs:ask` from it. */
const RANKS_TOPIC = 'mobs';
/**
 * The highest minor anything this addon calls arrived in: `woc.data` at 2; `ui.list`,
 * `fmt.duration` and `world.distanceTo` at 4. An older loader strips an unknown manifest key, so an
 * under-declared manifest installs and throws on the first read. A frame's `toggleKey` is not used;
 * see the bind in `main.js`.
 */
const NEEDS_MINOR = 4;

const PLAYER_ID = PLAYER_ENTITY.id;
/** Somebody else, because nobody receives their own bus messages. */
const ASKER = 'official/facemark';
/** What the harness's wall clock starts at, and therefore what every case starts at. */
const NOW = 1_700_000_000_000;
/** The redraw's period, so advancing this much runs exactly one of them. */
const TICK_MS = 1000;
/** How many microtask turns the roster read, the frame restore and the reads want. */
const SETTLE_TURNS = 12;
/** How many rares the shipped file carries, and therefore how many rows there are. */
const ROSTER_SIZE = 19;
/** How long a session ran on the MONOTONIC clock, which a page load throws away. */
const SESSION_MS = 1_200_000;

/** Three rares picked for the three respawn lengths the roster spans. */
const GREYJAW = 'old_greyjaw';
const VOSKAR = 'voskar_emberwing';
const CRAGMAW = 'old_cragmaw';
/** The one rare the game rolls a respawn window for. */
const GRIX = 'grix_the_tunnelking';

/** A template id no roster carries, as a hand edit could leave. */
const GONE_RARE = 'made_up_rare';

/** The alt. `world.characterKey` is the realm and this, so changing it is the switch. */
const OTHER_CHARACTER = 'Marshalt';

const GREYJAW_ID = 700;
const VOSKAR_ID = 701;
const GRIX_ID = 702;

type Fake = Record<string, unknown>;

const teardown: Array<() => void> = [];

beforeEach(() => {
  // For the redraw's interval only. Every stamp reads `woc.wallClock()`, which the harness owns and
  // `vi.setSystemTime` cannot reach.
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

/**
 * Write a field on a live entity. Computed access, because the fixture is a `Record<string,
 * unknown>`: the linter wants dot access on a literal key and the compiler forbids it on an index
 * signature.
 */
function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

function rowFor(templateId: string): HTMLElement | null {
  return document.querySelector(`.woc-lw-row[data-rare="${templateId}"]`);
}

function textIn(templateId: string, selector: string): string {
  return rowFor(templateId)?.querySelector(selector)?.textContent ?? '';
}

/** The per-character key the stamps are supposed to land under, and nowhere else. */
function storedSightings(storage: FakeStorage): unknown {
  const dumped = storage.dump();
  return dumped[`${characterNamespace(FQID)}/${perCharacterKey(CHANNEL, CHARACTER, STORE_KEY)}`];
}

interface LongwatchHarness extends SharedHarness {
  storage: FakeStorage;
  /** Every payload this addon has put on the rank topic, in order. */
  published: () => unknown[];
  /** Ask for the table the way `bus.follow` does, which is the whole of the protocol. */
  ask: () => void;
  /** Put a mob in interest scope, with nothing on it that says it is rare. */
  spawn: (id: number, templateId: string, name?: string) => Fake;
  /** Kill one: the corpse goes dead, and the death record lands. */
  kill: (id: number, templateId: string) => void;
  /**
   * Kill one out of earshot: the corpse goes dead and NO death record lands, as for a kill outside
   * the event radius or before this session.
   */
  killQuietly: (id: number, templateId: string) => void;
  /** Put a body in scope that this character never saw standing. */
  body: (id: number, templateId: string) => Fake;
  /**
   * The corpse's loot lock as the game's client mirrors it: `Infinity` while the tapper owns the
   * pool, `0` once lapsed. Absent is a corpse with no loot record, which `world.corpses` does not
   * carry.
   */
  lock: (id: number, ffaTimer: number) => void;
  despawn: (id: number) => void;
  /** Walk the player somewhere. Copied, because the game mutates `pos` in place. */
  walkTo: (x: number, z: number) => void;
  /** Become somebody else, which is what `world.characterKey` is derived from. */
  becomeCharacter: (name: string) => void;
  /** Re-read the world, which is what turns a set change into a handler call. */
  poll: () => void;
  /** Run the addon's once-a-second redraw where the wall clock already is. */
  tick: () => void;
  /** Move the wall clock this far past the start of the case, and redraw there. */
  clockTo: (ms: number) => void;
  /** The template ids with a row up, in the order they are drawn. */
  drawn: () => string[];
  pinned: () => string[];
  figureOf: (templateId: string) => string;
  /** One row's fill, as a percentage. A number, because the clock drifts. */
  fillOf: (templateId: string) => number;
  detailOf: (templateId: string) => string;
  /** Every class on one row, so a tone can be read off it. */
  classesOf: (templateId: string) => string[];
  /** The banner on screen, or '' when there is none. */
  banner: () => string;
}

/**
 * Let the roster read, the frame restore and the per-character reads land: a microtask chain, since
 * each is a promise the loader already holds.
 */
function settle(): Promise<void> {
  let done = Promise.resolve();
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    done = done.then(() => undefined);
  }
  return done;
}

/**
 * One roster row. `id` is named and the rest is an index signature, which settles `useLiteralKeys`
 * (no brackets) against `noPropertyAccessFromIndexSignature` (no dots through the signature).
 */
interface RosterRow {
  id: string;
  [field: string]: unknown;
}

/** One row of the rank table, in the shape a follower receives it. */
interface RankRow {
  id: string;
  name: string;
  rank?: 'elite' | 'boss';
  rare?: true;
  requiresQuestId?: string;
}

/** The shipped roster with one row broken, as a hand edit leaves it, built from the real file. */
function doctored(id: string, patch: Record<string, unknown>): string {
  const file = JSON.parse(ROSTER_TEXT) as { rares: RosterRow[] };
  const rares = file.rares.map((rare) => {
    if (rare.id !== id) {
      return rare;
    }
    return { ...rare, ...patch };
  });
  return JSON.stringify({ ...file, rares });
}

/** A mob to put in interest scope BEFORE the addon evaluates its first line. */
interface Standing {
  id: number;
  templateId: string;
}

/**
 * Start the addon over a world holding only the player. Storage is a parameter so cross-session
 * cases run a second addon over what the first wrote. `standing` is already in scope at start, the
 * one case where a sighting is not called out.
 */
async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
  standing: readonly Standing[] = [],
  roster: string = ROSTER_TEXT,
): Promise<LongwatchHarness> {
  // Eastbrook Vale by default: z 0 is inside its band and x 0 inside the world strip.
  const player = liveEntity({
    set: { templateId: 'hunter', pos: { x: 0, y: 5, z: 0 }, kind: 'player' },
  });
  const entities = new Map<number, Fake>([[PLAYER_ID, player]]);
  const mob = (id: number, templateId: string, name: string): Fake =>
    liveEntity({ set: { id, name, kind: 'mob', templateId, hostile: true, dead: false } });
  for (const there of standing) {
    entities.set(there.id, mob(there.id, there.templateId, there.templateId));
  }
  const world = { entities, player, known: [] };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    storage,
    settings,
    // The shipped files, seeded as the host's install cache holds them; a case wanting a broken one
    // passes its own text.
    data: { [ROSTER_FILE]: roster, [RANKS_FILE]: RANKS_TEXT },
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  // Subscribed as somebody else, since nobody receives their own messages. The first announce
  // happens during evaluation, before anything here listens, which is why `ask()` exists.
  const published: unknown[] = [];
  teardown.push(
    harness.shared.bus.subscribe({
      from: ANY_SENDER,
      topic: RANKS_TOPIC,
      owner: ASKER,
      handler: (message) => {
        published.push(message.payload);
      },
      onError: (err: unknown) => {
        throw err;
      },
    }),
  );

  return {
    ...harness,
    storage,
    published: () => published,
    ask: () => {
      harness.shared.bus.emit(ASKER, `${RANKS_TOPIC}:ask`, null);
    },
    spawn: (id, templateId, name = templateId) => {
      // No rare flag, no elite flag: the template id alone distinguishes this from any other wolf.
      const entity = mob(id, templateId, name);
      entities.set(id, entity);
      return entity;
    },
    kill: (id, templateId) => {
      const corpse = entities.get(id);
      if (corpse !== undefined) {
        setField(corpse, 'dead', true);
      }
      harness.inbound(
        eventsFrame([{ type: 'death', entityId: id, killerId: PLAYER_ID, templateId }]),
      );
    },
    killQuietly: (id) => {
      const corpse = entities.get(id);
      if (corpse !== undefined) {
        setField(corpse, 'dead', true);
        setField(corpse, 'loot', null);
      }
    },
    // `loot` must be stated: `tests/fakes/entity.ts` builds an `object` field as `{}` regardless of
    // nullability, so every fixture corpse would carry a loot record and a readable lock. The game
    // sends one only for a mob that rolled untaken loot, null otherwise.
    body: (id, templateId) => {
      const corpse = mob(id, templateId, templateId);
      setField(corpse, 'dead', true);
      setField(corpse, 'loot', null);
      entities.set(id, corpse);
      return corpse;
    },
    lock: (id, ffaTimer) => {
      const corpse = entities.get(id);
      if (corpse !== undefined) {
        // `world.corpses` carries an entity only where the wire shipped a loot record, the same
        // branch of the game's death path that arms the lock.
        setField(corpse, 'loot', { copper: 120, items: [] });
        setField(corpse, 'lootFfaTimer', ffaTimer);
      }
    },
    despawn: (id) => {
      entities.delete(id);
    },
    walkTo: (x, z) => {
      setField(player, 'pos', { x, y: 5, z });
    },
    becomeCharacter: (name) => {
      setField(player, 'name', name);
    },
    poll: () => harness.shared.world.watcher.poll(),
    tick: () => {
      vi.advanceTimersByTime(TICK_MS);
    },
    clockTo: (ms) => {
      // The wall clock first, so the redraw reads the moment asked for.
      harness.setWallClock(NOW + ms);
      vi.advanceTimersByTime(TICK_MS);
    },
    drawn: () =>
      [...document.querySelectorAll('.woc-lw-row')].map((el) => el.getAttribute('data-rare') ?? ''),
    pinned: () =>
      [...document.querySelectorAll('.woc-lw-pin')].map((el) => el.getAttribute('data-rare') ?? ''),
    figureOf: (templateId) => textIn(templateId, '.woc-bar-value'),
    fillOf: (templateId) =>
      Number.parseFloat(
        rowFor(templateId)?.querySelector<HTMLElement>('.woc-bar-fill')?.style.width ?? '',
      ),
    detailOf: (templateId) => textIn(templateId, '.woc-bar-detail'),
    classesOf: (templateId) => [...(rowFor(templateId)?.classList ?? [])],
    banner: () => document.querySelector('.woc-banner-text')?.textContent ?? '',
  };
}

/**
 * `start`, plus the wait for the panel and one frame. A saved frame starts hidden until its
 * per-character state loads, and the addon draws nothing while hidden. The extra tick moves no
 * clock, so every case starts at `NOW`.
 */
async function run(
  settings: Record<string, unknown> = {},
  storage?: FakeStorage,
  standing?: readonly Standing[],
  roster?: string,
): Promise<LongwatchHarness> {
  const harness = await start(settings, storage, standing, roster);
  harness.poll();
  await settle();
  harness.tick();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // Every one is used: socket for death records, world for roster and position, storage for stamps,
  // sound and ui for the alert, keys for the toggle.
  it('asks for exactly what it uses', () => {
    expect(manifest().permissions).toEqual([
      'net.read',
      'world.read',
      'ui',
      'sound',
      'storage',
      'keys',
    ]);
  });

  // Without the minor this would install on a loader with no `woc.data` and find its only content
  // file missing.
  it('declares both tables and the minor that reads them', () => {
    expect(manifest().data).toEqual([ROSTER_FILE, RANKS_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  it('binds the toggle where the roster says', () => {
    expect(manifest().keybinds?.[0]?.default).toBe('Alt+KeyR');
  });
});

// The roster comes from `rares.json`. The loader guarantees only that a data file is JSON, so the
// shape is checked.
describe('the roster it reads', () => {
  // Fails if the table is pasted back into the source.
  it('carries no rare of its own', () => {
    expect(SOURCE).not.toContain(GREYJAW);
    expect(SOURCE).not.toContain(VOSKAR);
  });

  // One named gap beats a blank panel. A respawn of zero is the bad field used, because it reads as
  // due the instant the rare dies.
  it('leaves out a row the file got wrong and keeps the rest', async () => {
    const h = await run({}, undefined, [], doctored(GREYJAW, { respawn: 0 }));

    expect(h.drawn()).toHaveLength(ROSTER_SIZE - 1);
    expect(h.drawn()).not.toContain(GREYJAW);
    expect(h.drawn()).toContain(VOSKAR);
  });

  // A row in a zone with no rectangle could never pass the zone filter.
  it('refuses a row naming a zone it has no rectangle for', async () => {
    const h = await run({}, undefined, [], doctored(GREYJAW, { zone: 'farshore_isle' }));

    expect(h.drawn()).not.toContain(GREYJAW);
  });

  it('draws nothing rather than throwing when the file is not a roster at all', async () => {
    const h = await run({}, undefined, [], JSON.stringify({ mobs: [] }));

    expect(h.drawn()).toEqual([]);
  });
});

// The roster is asserted rather than assumed. `generate.mjs` gives both reasons a rare template is
// left out: no camp to wait at, or a zone this addon does not resolve.
describe('the roster it carries', () => {
  it('lists a row per rare it knows about', async () => {
    const h = await run();

    expect(h.drawn()).toHaveLength(ROSTER_SIZE);
  });

  it('says where each one lives', async () => {
    const h = await run();

    expect(h.detailOf(GREYJAW)).toContain('Eastbrook Vale');
    expect(h.detailOf(VOSKAR)).toContain('Thornpeak Heights');
  });

  // The one whose camp is authored in `src/sim/data.ts` rather than its zone file, which a roster
  // read from zone files alone would lose.
  it('carries the rare whose camp is filed away from its zone', async () => {
    const h = await run();

    expect(h.drawn()).toContain('grix_the_tunnelking');
  });

  it('starts every row unseen', async () => {
    const h = await run();

    expect(h.figureOf(GREYJAW)).toBe('Unseen');
    expect(h.fillOf(GREYJAW)).toBe(0);
  });
});

// Recognising a rare, which the wire does not help with.
describe('a rare in interest scope', () => {
  it('reads as up, matched on nothing but its template id', async () => {
    const h = await run();

    h.spawn(GREYJAW_ID, GREYJAW, 'Old Greyjaw');
    h.poll();

    expect(h.figureOf(GREYJAW)).toBe('Up');
    expect(h.classesOf(GREYJAW)).toContain('woc-bar-danger');
  });

  it('ignores an ordinary mob standing in the same place', async () => {
    const h = await run();

    h.spawn(GREYJAW_ID, 'forest_wolf', 'Forest Wolf');
    h.poll();

    expect(h.drawn()).toHaveLength(ROSTER_SIZE);
    expect(h.figureOf(GREYJAW)).toBe('Unseen');
  });

  // A corpse stays in scope after the kill; counting it as a sighting would read "up" for exactly
  // the time it is not.
  it('does not read a corpse as up', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    h.kill(GREYJAW_ID, GREYJAW);
    h.poll();

    expect(h.figureOf(GREYJAW)).not.toBe('Up');
  });

  it('stops reading it as up once it leaves range', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    expect(h.figureOf(GREYJAW)).toBe('Up');

    h.despawn(GREYJAW_ID);
    h.poll();

    expect(h.figureOf(GREYJAW)).toBe('Unseen');
  });
});

// The countdown length is a pure function of the template, so the addon must know it.
describe('the countdown after a kill', () => {
  it("starts at the template's own respawn length", async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    h.kill(GREYJAW_ID, GREYJAW);
    h.tick();

    // 25 seconds base times the default rare multiplier of 4.
    expect(h.figureOf(GREYJAW)).toBe('1m 40s');
    expect(h.fillOf(GREYJAW)).toBeCloseTo(100, 0);
  });

  // Six hours, for the rare that has one: one assumed length for every rare would be hours wrong
  // here.
  it("uses each rare's own length rather than one for all of them", async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();

    h.kill(VOSKAR_ID, VOSKAR);
    h.tick();

    expect(h.figureOf(VOSKAR)).toBe('6h 0m');
  });

  // Nothing arrives as the clock runs, so the number follows the clock on the redraw timer.
  it('drains without another set change', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID, GREYJAW);
    h.tick();

    // Off a whole second on purpose: the countdown rounds UP, so a boundary target would read
    // either side.
    h.clockTo(50_400);

    expect(h.figureOf(GREYJAW)).toBe('50s');
    expect(h.fillOf(GREYJAW)).toBeCloseTo(49.6, 1);
  });

  it('goes warm as it comes back up', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();
    h.kill(VOSKAR_ID, VOSKAR);
    h.tick();
    expect(h.classesOf(VOSKAR)).toContain('woc-bar-default');

    h.clockTo(21_570_000);

    expect(h.classesOf(VOSKAR)).toContain('woc-bar-warn');
  });

  // Past the window and still unseen. "Due" and "still counting" are different answers, so the
  // countdown is named rather than clamped at zero. The corpse is walked away from first; a body
  // still in scope has its own case.
  it('reads as due once the window has passed', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID, GREYJAW);
    h.despawn(GREYJAW_ID);
    h.poll();

    h.clockTo(200_000);

    expect(h.figureOf(GREYJAW)).toBe('Due');
  });

  // Whatever the arithmetic says, the rare is demonstrably standing there.
  it('drops the countdown when the rare turns up again', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID, GREYJAW);
    h.despawn(GREYJAW_ID);
    h.poll();
    expect(h.figureOf(GREYJAW)).not.toBe('Up');

    h.clockTo(120_000);
    h.spawn(GREYJAW_ID + 1, GREYJAW);
    h.poll();

    expect(h.figureOf(GREYJAW)).toBe('Up');
  });

  it('ignores a death that is not one of its rares', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, 'forest_wolf');
    h.poll();

    h.kill(GREYJAW_ID, 'forest_wolf');
    h.tick();

    expect(h.figureOf(GREYJAW)).toBe('Unseen');
  });
});

// The rare whose respawn the GAME rolls (Grix, [15m, 30m)). A watched kill dates the death to the
// second and still cannot date the return.
describe('a rare the game draws a fresh respawn for', () => {
  it('reads as a window after a kill it watched, not as a countdown', async () => {
    const h = await run();
    h.spawn(GRIX_ID, GRIX);
    h.poll();

    h.kill(GRIX_ID, GRIX);
    h.tick();

    // The ceiling, marked as one. A bare '15m' would run out at the floor and sit on 'Due' for the
    // other fifteen minutes.
    expect(h.figureOf(GRIX)).toBe('≤ 30m 0s');
    expect(h.fillOf(GRIX)).toBeCloseTo(100, 0);
  });

  // The floor is when it is worth riding over, the ceiling when it is certainly back, so the row
  // goes warm at the first and due at the second.
  it('goes warm at the earliest it could be back rather than at the latest', async () => {
    const h = await run();
    h.spawn(GRIX_ID, GRIX);
    h.poll();
    h.kill(GRIX_ID, GRIX);
    h.despawn(GRIX_ID);
    h.poll();

    h.clockTo(890_000);
    expect(h.classesOf(GRIX)).toContain('woc-bar-default');

    h.clockTo(910_000);
    expect(h.classesOf(GRIX)).toContain('woc-bar-warn');
    expect(h.figureOf(GRIX)).toBe('≤ 14m 50s');
  });

  it('reads as due only once the whole window has run out', async () => {
    const h = await run();
    h.spawn(GRIX_ID, GRIX);
    h.poll();
    h.kill(GRIX_ID, GRIX);
    h.despawn(GRIX_ID);
    h.poll();

    h.clockTo(1_790_000);
    expect(h.figureOf(GRIX)).not.toBe('Due');

    h.clockTo(1_810_000);
    expect(h.figureOf(GRIX)).toBe('Due');
  });

  // A rare on a fixed schedule still counts down to a moment.
  it('leaves a fixed-schedule rare counting down exactly', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    h.kill(GREYJAW_ID, GREYJAW);
    h.tick();

    expect(h.figureOf(GREYJAW)).toBe('1m 40s');
  });
});

// A slain mob lies where it fell for the whole respawn and stands up under the same id, and the
// death RECORD reaches only players inside the event radius, so a kill by somebody else leaves only
// a corpse. That bounds the return without fixing it.
describe('a body it finds with no kill to go with it', () => {
  it('reads the ceiling off the moment the body was found', async () => {
    const h = await run();

    h.body(VOSKAR_ID, VOSKAR);
    h.poll();

    // Six hours from finding it, marked as a ceiling.
    expect(h.figureOf(VOSKAR)).toBe('≤ 6h 0m');
  });

  // The bound is anchored to the first sighting; re-taking it would restart the ceiling every
  // second the player stood over the corpse.
  it('holds the ceiling still while the body is watched', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);
    h.poll();

    h.clockTo(7_200_000);

    expect(h.figureOf(VOSKAR)).toBe('≤ 4h 0m');
  });

  // A body in scope is a rare that has not come back, whatever the ceiling says; "Due" would send
  // the player to an empty camp.
  it('says the body is still there rather than due when the ceiling runs out', async () => {
    const h = await run();
    h.body(GREYJAW_ID, GREYJAW);
    h.poll();

    h.clockTo(200_000);

    expect(h.figureOf(GREYJAW)).toBe('Down');
    expect(h.classesOf(GREYJAW)).toContain('woc-bar-default');
  });

  // A window with no floor could close at any moment, and a row warm for six hours says nothing.
  it('stays cool for a window it has no floor for', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);
    h.poll();

    h.clockTo(10_800_000);

    expect(h.classesOf(VOSKAR)).toContain('woc-bar-default');
  });

  // Seen standing at one moment and dead at another, the rare cannot be back before the first plus
  // its respawn; the gap between sightings is the window's width.
  it('warms once the last sighting says it could be back', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();
    h.despawn(VOSKAR_ID);
    h.poll();

    // Five hours later the player finds a body, so the rare is back between one and six hours from
    // now.
    h.clockTo(18_000_000);
    h.body(VOSKAR_ID + 1, VOSKAR);
    h.poll();
    expect(h.figureOf(VOSKAR)).toBe('≤ 6h 0m');
    expect(h.classesOf(VOSKAR)).toContain('woc-bar-default');

    h.clockTo(18_000_000 + 3_600_000);

    expect(h.figureOf(VOSKAR)).toBe('≤ 5h 0m');
    expect(h.classesOf(VOSKAR)).toContain('woc-bar-warn');
  });

  // The floor is taken every pass, so watching a rare for an hour then losing it is an hour better
  // than a glimpse.
  it('floors the window at the last pass that saw it standing', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();
    h.clockTo(3_600_000);
    h.despawn(VOSKAR_ID);
    h.poll();

    h.body(VOSKAR_ID + 1, VOSKAR);
    h.poll();

    // Five and a half hours after the find, where the two readings disagree: floored at the last
    // pass the rare cannot be back for half an hour; floored at the arrival it could already be.
    h.clockTo(3_600_000 + 19_800_000);

    expect(h.classesOf(VOSKAR)).toContain('woc-bar-default');
  });

  // A rare that falls in view keeps its id and place in the entity SET, so `world.on('entities')`
  // sees nothing; the once-a-second pass catches it, or the row reads "Up" over a corpse.
  it('notices a rare falling in view with no set change', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();
    h.killQuietly(VOSKAR_ID, VOSKAR);

    h.poll();
    expect(h.figureOf(VOSKAR)).toBe('Up');

    h.tick();

    expect(h.figureOf(VOSKAR)).toBe('≤ 6h 0m');
  });

  // A watched kill is a measurement and beats a bound outright.
  it('drops the bound for a kill it watches happen', async () => {
    const h = await run();
    h.body(GREYJAW_ID, GREYJAW);
    h.poll();
    expect(h.figureOf(GREYJAW)).toBe('≤ 1m 40s');

    h.despawn(GREYJAW_ID);
    h.spawn(GREYJAW_ID + 1, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID + 1, GREYJAW);
    h.tick();

    expect(h.figureOf(GREYJAW)).toBe('1m 40s');
  });

  // The earlier body belonged to a life that has ended: the rare stood up and died again, and this
  // corpse is a different death.
  it('starts a fresh bound for a body found after the old one ran out', async () => {
    const h = await run();
    h.body(GREYJAW_ID, GREYJAW);
    h.poll();
    h.despawn(GREYJAW_ID);
    h.poll();

    h.clockTo(600_000);
    h.body(GREYJAW_ID + 1, GREYJAW);
    h.poll();

    expect(h.figureOf(GREYJAW)).toBe('≤ 1m 40s');
  });
});

// The corpse's loot lock, armed at the kill and lapsing a minute later: still held turns a six hour
// window into a one minute one.
describe('the loot lock on a body', () => {
  it('floors the window a minute back when the lock still holds', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);
    h.lock(VOSKAR_ID, Number.POSITIVE_INFINITY);

    h.poll();
    await settle();

    const stored = storedSightings(h.storage) as Record<string, { aliveAt: number }>;
    expect(stored[VOSKAR]?.aliveAt).toBe(NOW - 60_000);
  });

  // A lapsed lock says only that the kill was over a minute ago, which the ceiling already said.
  it('reads no floor out of a lock that has lapsed', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);
    h.lock(VOSKAR_ID, 0);

    h.poll();
    await settle();

    const stored = storedSightings(h.storage) as Record<string, { aliveAt: number | null }>;
    expect(stored[VOSKAR]?.aliveAt).toBeNull();
  });

  // A corpse with no loot record is not in `world.corpses`, and the loader reads an unreadable lock
  // as HELD; concluding from it would claim a fresh kill at every looted body.
  it('reads no floor off a body carrying no loot record', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);

    h.poll();
    await settle();

    const stored = storedSightings(h.storage) as Record<string, { aliveAt: number | null }>;
    expect(stored[VOSKAR]?.aliveAt).toBeNull();
  });
});

// A rare killed, logged out on, and returned to shows what is left. Two addons over one storage
// model a reload. `advance` moves the monotonic clock, which a reload throws away; `setWallClock`
// moves the wall clock, which it keeps. With `woc.now()` the stored stamp reads as future after the
// reload and the countdown comes back at full length, so the assertions are exact: `6h 0m` is what
// the wrong clock produces.
describe('a countdown across a logout', () => {
  it('resumes rather than restarting', async () => {
    const storage = createFakeStorage();
    const first = await run({}, storage);
    first.spawn(VOSKAR_ID, VOSKAR);
    first.poll();
    first.kill(VOSKAR_ID, VOSKAR);
    await settle();
    expect(first.figureOf(VOSKAR)).toBe('6h 0m');
    // Twenty monotonic minutes after the kill, which the second mount does not inherit.
    first.advance(SESSION_MS);

    // Two hours later. The wall clock is moved on the SECOND harness, because it belongs to the
    // services a mount builds.
    for (const stop of teardown.splice(0)) {
      stop();
    }
    document.body.innerHTML = '';
    const second = await run({}, storage);
    await settle();
    second.clockTo(7_200_000);

    expect(second.figureOf(VOSKAR)).toBe('4h 0m');
  });

  // A rare whose window elapsed while away is back, not on a fresh timer.
  it('comes back due for a window that elapsed while the player was away', async () => {
    const storage = createFakeStorage();
    const first = await run({}, storage);
    first.spawn(GREYJAW_ID, GREYJAW);
    first.poll();
    first.kill(GREYJAW_ID, GREYJAW);
    await settle();

    for (const stop of teardown.splice(0)) {
      stop();
    }
    document.body.innerHTML = '';
    const second = await run({}, storage);
    await settle();
    second.clockTo(600_000);

    expect(second.figureOf(GREYJAW)).toBe('Due');
  });

  // Stamps are per character, asserted on the key derivation.
  it("writes the stamps under this character's own key", async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    h.kill(GREYJAW_ID, GREYJAW);
    await settle();

    const stored = storedSightings(h.storage) as Record<string, { killedAt: number }>;
    expect(stored[GREYJAW]?.killedAt).toBe(NOW);
  });

  // An entity id is reissued each session, so a stamp keyed on it or carrying it is meaningless
  // when read.
  it('writes down no entity id, which does not survive a session', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    await settle();

    // Asserted on the KEYS, since a thirteen-digit wall-clock stamp contains almost any three
    // digits by accident.
    const stored = storedSightings(h.storage) as Record<string, Record<string, unknown>>;
    expect(Object.keys(stored[GREYJAW] ?? {})).toEqual(['seenAt', 'killedAt', 'downAt', 'aliveAt']);
  });

  it('writes nothing when the player switched the memory off', async () => {
    const h = await run({ 'keep-timers': false });
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    h.kill(GREYJAW_ID, GREYJAW);
    await settle();

    expect(storedSightings(h.storage)).toBeUndefined();
  });

  it('ignores a stored record that is not a stamp', async () => {
    const storage = createFakeStorage();
    await storage.set(
      characterNamespace(FQID),
      perCharacterKey(CHANNEL, CHARACTER, STORE_KEY),
      // What a hand edit could have left behind.
      { [GREYJAW]: { killedAt: 'a while ago' }, [GONE_RARE]: { killedAt: NOW } },
    );

    const h = await run({}, storage);
    await settle();
    h.tick();

    expect(h.figureOf(GREYJAW)).toBe('Unseen');
    expect(h.drawn()).toHaveLength(ROSTER_SIZE);
  });
});

// The zone match is from position, never `world.zone`, which is localized display text; the game
// resolves a zone from a point against half-open rectangles.
describe('which zone the player is in', () => {
  it('lists only the current zone when asked to', async () => {
    const h = await run({ zones: 'The zone I am in' });

    expect(h.drawn()).toContain(GREYJAW);
    expect(h.drawn()).not.toContain(VOSKAR);
  });

  // Half-open, with the world strip's x bounds: Farshore Isle (x 180 to 540) shares Eastbrook's z
  // band, so a z-only match puts it in Eastbrook Vale.
  it('does not put a player outside the strip in the zone sharing its band', async () => {
    const h = await run({ zones: 'The zone I am in' });

    h.walkTo(200, 0);
    h.tick();

    expect(h.drawn()).toEqual([]);
  });

  // The filter is re-resolved on every frame, so nothing watches for a border crossing.
  it('follows the player across a border with no set change', async () => {
    const h = await run({ zones: 'The zone I am in' });

    h.walkTo(0, 600);
    h.tick();

    expect(h.drawn()).toContain(VOSKAR);
    expect(h.drawn()).not.toContain(GREYJAW);
  });

  // Which rares, not in what order: all unseen, so they tie and fall back to file order.
  it('lists one named zone when the player picks one', async () => {
    const h = await run({ zones: 'The Veiled Hollow' });

    expect([...h.drawn()].sort()).toEqual(['aurelhorn', 'gleamstag', 'old_marrowshell']);
  });

  it('measures the distance from the player to the camp', async () => {
    const h = await run();

    // Old Greyjaw's camp is authored at z 100, and the player is at 0.
    expect(h.detailOf(GREYJAW)).toBe('Eastbrook Vale, 100 yd');
  });
});

// The world pins, for the rares in the player's zone.
describe('the world pins', () => {
  it('pins the rares in the zone the player is in and no others', async () => {
    const h = await run();

    expect(h.pinned()).toContain(GREYJAW);
    expect(h.pinned()).not.toContain(VOSKAR);
  });

  it('moves the pins with the player', async () => {
    const h = await run();

    h.walkTo(0, 600);
    h.tick();

    expect(h.pinned()).toContain(CRAGMAW);
    expect(h.pinned()).not.toContain(GREYJAW);
  });

  // The pins are world anchors, not children of the panel. No tick between keypress and assertion:
  // leaving them to the redraw would hang them over the world for up to a second.
  it('takes the pins out of the world the moment the panel is hidden', async () => {
    const h = await run();
    expect(h.pinned().length).toBeGreaterThan(0);

    h.press('Alt+KeyR');

    expect(h.pinned()).toEqual([]);
    expect(document.querySelectorAll('.woc-lw-anchor')).toHaveLength(0);
  });
});

// The sighting alert: the one thing this addon does that interrupts.
describe('calling out a sighting', () => {
  it('says so with a banner and a cue', async () => {
    const h = await run();
    const played: string[] = [];
    h.shared.sound.play = (cue: string) => {
      played.push(cue);
    };

    h.spawn(GREYJAW_ID, GREYJAW, 'Old Greyjaw');
    h.poll();

    expect(h.banner()).toBe('Old Greyjaw is up');
    expect(played).toEqual(['ui_gather_rare']);
  });

  // Everything in range at world entry or enable arrives in the first walk; announcing those would
  // banner every login.
  it('says nothing about what was already standing there when it started', async () => {
    const h = await run({}, undefined, [{ id: GREYJAW_ID, templateId: GREYJAW }]);

    expect(h.banner()).toBe('');
    expect(h.figureOf(GREYJAW)).toBe('Up');
  });

  it('stays quiet when the player switched the alert off', async () => {
    const h = await run({ alert: false });

    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    expect(h.banner()).toBe('');
  });

  // Every set change walks the roster again with the rare still standing; only the arrival is news.
  it('does not announce the same rare twice for standing still', async () => {
    const h = await run();
    const played: string[] = [];
    h.shared.sound.play = (cue: string) => {
      played.push(cue);
    };
    h.spawn(GREYJAW_ID, GREYJAW, 'Old Greyjaw');
    h.poll();

    h.spawn(VOSKAR_ID, 'forest_wolf');
    h.poll();

    expect(played).toHaveLength(1);
  });
});

describe('the order of the list', () => {
  // Up first, then soonest back, never-killed at the bottom.
  it('puts what is up above what is counting down', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID, GREYJAW);
    h.tick();

    expect(h.drawn()[0]).toBe(VOSKAR);
    expect(h.drawn()[1]).toBe(GREYJAW);
  });

  it('sorts by name when asked to', async () => {
    const h = await run({ sort: 'Name' });

    expect(h.drawn()[0]).toBe('aurelhorn');
  });

  it('sorts by distance when asked to', async () => {
    const h = await run({ sort: 'Distance' });

    // At the origin, the nearest camp is Old Greyjaw's at 100 yards.
    expect(h.drawn()[0]).toBe(GREYJAW);
  });

  it('re-sorts a settings change without a reload', async () => {
    const h = await run();
    // One kill, so the two orders differ for a stated reason rather than falling back to file
    // order.
    h.spawn(VOSKAR_ID, VOSKAR);
    h.kill(VOSKAR_ID, VOSKAR);
    h.tick();
    expect(h.drawn()[0]).toBe(VOSKAR);

    h.hub.remote(`config:${FQID}`, 'values', { sort: 'Name' });
    h.tick();

    expect(h.drawn()[0]).toBe('aurelhorn');
  });
});

describe('the toggle', () => {
  it('hides the panel', async () => {
    const h = await run();

    h.press('Alt+KeyR');

    expect(document.querySelector('[data-woc-frame="rares"]')?.classList).toContain('woc-hidden');
  });
});

// The game swaps characters without reloading, so everything held in memory belongs to whoever was
// playing a moment ago.
describe('the player becoming somebody else', () => {
  // Countdowns OFF, so nothing is written or read back and what remains on screen is only what
  // memory holds.
  it("forgets the previous character's countdowns", async () => {
    const h = await run({ 'keep-timers': false });
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID, GREYJAW);
    expect(h.figureOf(GREYJAW)).toBe('1m 40s');

    h.becomeCharacter(OTHER_CHARACTER);
    h.poll();

    expect(h.figureOf(GREYJAW)).toBe('Unseen');
  });

  // The new character's scope arrives in one walk they did not ride up to, like world entry.
  it('does not call out what the new character finds already standing there', async () => {
    const h = await run({ 'keep-timers': false }, undefined, [
      { id: GREYJAW_ID, templateId: GREYJAW },
    ]);
    expect(h.banner()).toBe('');

    h.becomeCharacter(OTHER_CHARACTER);
    h.poll();
    // Something else moving makes the addon walk the roster again, with the old rare still
    // standing.
    h.spawn(VOSKAR_ID, 'forest_wolf');
    h.poll();

    expect(h.banner()).toBe('');
  });
});

// The first line runs at document-start on the landing page, with no world or character: nothing
// may throw, be written, or be put into the world.
describe('before world entry', () => {
  it('starts without a world at all', async () => {
    const storage = createFakeStorage();
    const harness = await mountAddon({
      manifest: MANIFEST_TEXT,
      source: SOURCE,
      storage,
      // The roster still lands, so this is about there being no WORLD.
      data: { [ROSTER_FILE]: ROSTER_TEXT },
      // No game, so `world.ready` never settles: the landing page.
      settings: {},
    });
    teardown.push(harness.dispose);
    await settle();

    // Rows are not asserted absent: the loader keeps frames off the landing page. What must not
    // happen is a per-character write, with nobody to file it under, or a world anchor, with no
    // world.
    expect(document.querySelectorAll('.woc-lw-anchor')).toHaveLength(0);
    expect(storedSightings(storage)).toBeUndefined();
  });
});

describe('disabling it', () => {
  it('leaves no row, no pin, no keybind and no redraw timer behind', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('.woc-lw-row')).toHaveLength(0);
    expect(document.querySelectorAll('.woc-lw-anchor')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.tick()).not.toThrow();
  });
});

// The rank table this addon carries for everybody else, since it already evaluates `MOBS`. Nothing
// in this addon reads it; every case is about what a FOLLOWER receives.
describe('the mob rank service', () => {
  /** The shipped table, which every case here is measured against. */
  const shipped = (JSON.parse(RANKS_TEXT) as { mobs: RankRow[] }).mobs;

  /** The last thing published, taken as the table: every case asks first. */
  async function asked(): Promise<RankRow[]> {
    const h = await run();
    h.ask();
    return h.published().at(-1) as RankRow[];
  }

  it('answers an ask with the whole table', async () => {
    const rows = await asked();

    expect(rows).toHaveLength(shipped.length);
  });

  it('names every row, because a mob id is not a display name', async () => {
    const rows = await asked();

    expect(rows.every((row) => row.id.length > 0 && row.name.length > 0)).toBe(true);
  });

  // The three flags are independent in the game; folding `rare` into the rank would lose a fact
  // about a rare elite.
  it('carries the rank and the rare flag as separate answers', async () => {
    const rows = await asked();

    expect(new Set(rows.map((row) => row.rank))).toEqual(new Set([undefined, 'elite', 'boss']));
    expect(rows.some((row) => row.rank === 'elite' && row.rare === true)).toBe(true);
  });

  // Every row must carry something an id cannot give.
  it('ships no row that says nothing', async () => {
    const rows = await asked();

    expect(rows.every((row) => row.rank ?? row.rare ?? row.requiresQuestId)).toBeTruthy();
  });

  // The game hides a quest-gated mob from anybody not on the quest; nothing on the wire says so.
  it('carries the quest gate the wire cannot say', async () => {
    const rows = await asked();

    expect(rows.some((row) => row.requiresQuestId !== undefined)).toBe(true);
  });

  // The two tables fail apart: an unreadable rank table must not take the rare list down.
  it('keeps the rare list working when the rank table cannot be read', async () => {
    const harness = await mountAddon({
      manifest: MANIFEST_TEXT,
      source: SOURCE,
      storage: createFakeStorage(),
      settings: {},
      data: { [ROSTER_FILE]: ROSTER_TEXT, [RANKS_FILE]: '{"mobs":"not an array"}' },
      game: Promise.resolve({ world: { entities: new Map(), player: null, known: [] } }),
    });
    teardown.push(harness.dispose);
    await settle();

    const answers: unknown[] = [];
    teardown.push(
      harness.shared.bus.subscribe({
        from: ANY_SENDER,
        topic: RANKS_TOPIC,
        owner: ASKER,
        handler: (message) => {
          answers.push(message.payload);
        },
        onError: (err: unknown) => {
          throw err;
        },
      }),
    );
    harness.shared.bus.emit(ASKER, `${RANKS_TOPIC}:ask`, null);

    expect(answers).toEqual([null]);
    expect(harness.shared.logs.tail(harness.fqid).some((line) => line.level === 'warn')).toBe(true);
  });
});
