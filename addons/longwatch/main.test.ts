// @vitest-environment happy-dom

// Longwatch, run through the real loader.
//
// The wire cannot say what is rare, so every case drives the world with ordinary mob entities
// carrying no flag of any kind and the addon may only recognise one by its `templateId`.
//
// THE TWO CLOCKS ARE DRIVEN SEPARATELY, which is what makes a four hour countdown cheap:
// `setWallClock` moves what `woc.wallClock()` answers, advancing the fake timers runs the
// once-a-second redraw, and neither moves the other.
//
// `rares.json` is seeded as raw text keyed by the declared path, the way the host's
// install-time cache holds it, because the addon reads it with `woc.data` on its first line.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import ROSTER_TEXT from './rares.json?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const FQID = 'official/longwatch';
/** What tests/fakes/shared-services.ts says the player is called, and which host. */
const CHARACTER = 'Claudemoon/Marshal';
const CHANNEL = 'pbe';
const STORE_KEY = 'sightings';
const ROSTER_FILE = 'rares.json';
/**
 * The highest minor anything this addon calls arrived in. `woc.data` is 2; `ui.list`,
 * `fmt.duration` and `world.distanceTo` are 4. An older loader strips an unknown manifest key rather than refusing it, so a
 * manifest claiming less than it calls installs, starts, and throws on the first read.
 *
 * A frame's own `toggleKey` is 4 as well and is deliberately NOT on that list: the toggle
 * is bound by hand, for the reason written above the bind in `main.js`.
 */
const NEEDS_MINOR = 4;

const PLAYER_ID = PLAYER_ENTITY.id;
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

/** Three of the nineteen, picked for the three respawn lengths the roster spans. */
const GREYJAW = 'old_greyjaw';
const VOSKAR = 'voskar_emberwing';
const CRAGMAW = 'old_cragmaw';

/** A template id no roster carries: what a hand edit or an older version could leave. */
const GONE_RARE = 'made_up_rare';

/** The alt. `world.characterKey` is the realm and this, so changing it is the switch. */
const OTHER_CHARACTER = 'Marshalt';

const GREYJAW_ID = 700;
const VOSKAR_ID = 701;

type Fake = Record<string, unknown>;

const teardown: Array<() => void> = [];

beforeEach(() => {
  // For the redraw's interval and nothing else. Every stamp this addon takes reads
  // `woc.wallClock()`, which the harness owns and `vi.setSystemTime` cannot reach.
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
 * Write a field on a live entity. A computed access, because the fixture is a
 * `Record<string, unknown>`: the linter wants dot access on a literal key and the compiler
 * forbids it on an index signature.
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
  /** Put a mob in interest scope, with nothing on it that says it is rare. */
  spawn: (id: number, templateId: string, name?: string) => Fake;
  /** Kill one: the corpse goes dead, and the death record lands. */
  kill: (id: number, templateId: string) => void;
  /**
   * Kill one out of earshot: the corpse goes dead and NO death record lands, which is what
   * a kill outside the event radius or before this session looks like from here.
   */
  killQuietly: (id: number, templateId: string) => void;
  /** Put a body in scope that this character never saw standing. */
  body: (id: number, templateId: string) => Fake;
  /**
   * The loot lock on a corpse, as the game's own client mirrors it: `Infinity` while the
   * tapper still owns the pool, `0` once it has lapsed. Absent is a corpse with no loot
   * record at all, which is not a corpse `world.corpses` carries.
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
 * Let the roster read, the async frame restore and the per-character reads all land. A
 * microtask chain rather than a timer, because everything being waited for is a promise the
 * loader already holds: `woc.data` resolves through the host stub and then a parse before the
 * stored stamps are even asked for.
 */
function settle(): Promise<void> {
  let done = Promise.resolve();
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    done = done.then(() => undefined);
  }
  return done;
}

/**
 * One row of the roster file, as this suite has to reach into it. `id` is named and the rest is
 * an index signature, which settles the two rules that would otherwise disagree about `rare.id`:
 * `useLiteralKeys` refuses the bracket form, and `noPropertyAccessFromIndexSignature` refuses
 * the dot form for anything reached through the signature.
 */
interface RosterRow {
  id: string;
  [field: string]: unknown;
}

/**
 * The shipped roster with one row broken, as a hand edit or an older version leaves it. Built
 * from the real file rather than a hand-written stub, so a case about a bad row is a case about
 * this roster with one field wrong.
 */
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
 * Start the addon over a world holding nothing but the player. The storage is a parameter rather
 * than a local, because the cross-session cases run a second addon over what the first one
 * wrote.
 *
 * `standing` is what is already in interest scope when the addon starts, which is the one case
 * where a sighting is deliberately not called out.
 */
async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
  standing: readonly Standing[] = [],
  roster: string = ROSTER_TEXT,
): Promise<LongwatchHarness> {
  // Eastbrook Vale by default: z 0 is inside its band, and x 0 is inside the world
  // strip, which is the rectangle test the addon does from position alone.
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
    // The shipped file, seeded the way the host's install-time cache holds it. A case
    // that wants a broken one passes its own text.
    data: { [ROSTER_FILE]: roster },
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  return {
    ...harness,
    storage,
    spawn: (id, templateId, name = templateId) => {
      // No rare flag, no elite flag, nothing: the template id is the only thing distinguishing
      // this from any other wolf in the zone.
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
    // `loot` is stated rather than left alone, and it is the one field here that has to be.
    // `tests/fakes/entity.ts` builds a field of kind `object` as `{}` whatever the shape
    // table says about it being nullable, so every fixture entity arrives carrying a loot
    // record and therefore reads as a corpse `world.corpses` knows the lock of. The game
    // sends one for a mob that rolled loot and nobody has taken, and null for everything
    // else, which is what a case about reading no lock has to be driving.
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
        // `world.corpses` carries an entity only where the wire shipped a loot record, which
        // is the same branch of the game's death path that arms the lock.
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
      // The wall clock first, so the redraw that follows reads the moment asked for
      // rather than the one it was already standing on.
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
 * `start`, plus the wait for the panel to come up and one frame to draw in it. A frame that
 * saves its state starts hidden and is shown once that state arrives, keyed per character, and
 * this addon draws nothing while it is hidden. The extra tick is because the panel comes up
 * asynchronously, after the addon's own first draw has already declined to run; it moves no
 * clock, so every case still starts at `NOW`.
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

  // Every one of these is spent. The socket is read for the death record, the world
  // for the roster and the position, storage for the stamps, sound and ui for the
  // sighting alert, and keys for the toggle.
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

  // `data` is what puts the roster in its own file, and the minor is what says which loader
  // can read it. Without it this addon would install on a loader with no `woc.data`, start,
  // and find that its only content file does not exist.
  it('declares the roster file and the minor that reads it', () => {
    expect(manifest().data).toEqual([ROSTER_FILE]);
    expect(manifest().apiMinor).toBe(NEEDS_MINOR);
  });

  it('binds the toggle where the roster says', () => {
    expect(manifest().keybinds?.[0]?.default).toBe('Alt+KeyR');
  });
});

// Where the roster comes from, which is `rares.json` rather than a literal in the middle of
// main.js. The loader guarantees a data file is JSON at install and nothing past that, so the
// shape is a claim this addon checks rather than one it can lean on.
describe('the roster it reads', () => {
  // Fails the moment anybody pastes the table back into the source, which is the only
  // way this addon quietly stops being a file plus a reader again.
  it('carries no rare of its own', () => {
    expect(SOURCE).not.toContain(GREYJAW);
    expect(SOURCE).not.toContain(VOSKAR);
  });

  // One named gap beats a blank panel: eighteen rares still answer the question the player
  // opened this for, and the warning is the record that the file is wrong. A respawn of zero is
  // the row worth using for it, because it divides the fill by nothing and reads as due the
  // instant the rare dies.
  it('leaves out a row the file got wrong and keeps the rest', async () => {
    const h = await run({}, undefined, [], doctored(GREYJAW, { respawn: 0 }));

    expect(h.drawn()).toHaveLength(ROSTER_SIZE - 1);
    expect(h.drawn()).not.toContain(GREYJAW);
    expect(h.drawn()).toContain(VOSKAR);
  });

  // A row in a zone this addon has no rectangle for could never pass the zone filter
  // and would sort by a distance measured to nowhere.
  it('refuses a row naming a zone it has no rectangle for', async () => {
    const h = await run({}, undefined, [], doctored(GREYJAW, { zone: 'farshore_isle' }));

    expect(h.drawn()).not.toContain(GREYJAW);
  });

  it('draws nothing rather than throwing when the file is not a roster at all', async () => {
    const h = await run({}, undefined, [], JSON.stringify({ mobs: [] }));

    expect(h.drawn()).toEqual([]);
  });
});

// The roster is the addon's whole reason to exist, so what it carries is asserted rather than
// assumed. Nineteen of the game's twenty-four rare templates, and both reasons for leaving one
// out are in `generate.mjs`: four have no camp to be waited for (three summoned by the Nythraxis
// crypt, one miniboss inside a dungeon), and one stands in a zone this addon does not resolve
// positions against.
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

  // The one whose camp is authored in `src/sim/data.ts` rather than in its own zone
  // file, which is exactly the entry a roster read from the zone files alone loses.
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

// Recognising a rare, which is the thing the wire refuses to help with.
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

  // A corpse stays in interest scope for a while after the kill. Counting one as a
  // sighting would make the display read "up" for the whole time it is lying there,
  // which is precisely when it is not.
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

// The countdown, whose length is a pure function of the template and is therefore
// something the addon has to know rather than read.
describe('the countdown after a kill', () => {
  it('starts at the template"s own respawn length', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    h.kill(GREYJAW_ID, GREYJAW);
    h.tick();

    // 25 seconds base times the default rare multiplier of 4.
    expect(h.figureOf(GREYJAW)).toBe('1m 40s');
    expect(h.fillOf(GREYJAW)).toBeCloseTo(100, 0);
  });

  // Six hours, for the rare that actually has one. A display that assumed one respawn length for
  // every rare would be five hours and fifty-eight minutes wrong about this row.
  it('uses each rare"s own length rather than one for all of them', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();

    h.kill(VOSKAR_ID, VOSKAR);
    h.tick();

    expect(h.figureOf(VOSKAR)).toBe('6h 0m');
  });

  // The subscription said a mob died; nothing says anything as the clock runs. The
  // number has to follow the clock on its own, which is the redraw timer's whole job.
  it('drains without another set change', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID, GREYJAW);
    h.tick();

    // Landed off a whole second on purpose. The countdown rounds UP, so a target
    // sitting exactly on a second boundary would read either side of it if a redraw
    // ever landed anywhere but the moment it was asked for.
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

  // Past the window and still nobody has seen it. "Due" and "still counting" are
  // different answers to a player deciding whether to ride over there, so the
  // countdown is named rather than clamped at zero.
  //
  // The corpse is walked away from first. A body still in scope past the window is the one
  // thing that can disprove "due", and it has a case of its own below.
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

// What a body proves, which is most of what a player ever gets to see. A slain mob is not
// removed from the world: it lies where it fell for the whole respawn window and stands up
// again under the same entity id. The death RECORD only reaches a player inside the event
// radius, so a rare killed by somebody else, or before this session started, leaves a corpse
// and nothing else. That bounds the return without fixing it.
describe('a body it finds with no kill to go with it', () => {
  it('reads the ceiling off the moment the body was found', async () => {
    const h = await run();

    h.body(VOSKAR_ID, VOSKAR);
    h.poll();

    // Six hours from finding it, and marked as a ceiling rather than drawn as a countdown.
    expect(h.figureOf(VOSKAR)).toBe('≤ 6h 0m');
  });

  // The bound is anchored to the sighting rather than re-taken every time the body is looked
  // at again. Re-taking it would restart a six hour ceiling once a second for as long as the
  // player stood over the corpse, which is a display that never moves.
  it('holds the ceiling still while the body is watched', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);
    h.poll();

    h.clockTo(7_200_000);

    expect(h.figureOf(VOSKAR)).toBe('≤ 4h 0m');
  });

  // The one thing that can disprove the arithmetic. Whatever the ceiling says, a body in
  // scope is a rare that has not come back, and "Due" would send the player to an empty camp.
  it('says the body is still there rather than due when the ceiling runs out', async () => {
    const h = await run();
    h.body(GREYJAW_ID, GREYJAW);
    h.poll();

    h.clockTo(200_000);

    expect(h.figureOf(GREYJAW)).toBe('Down');
    expect(h.classesOf(GREYJAW)).toContain('woc-bar-default');
  });

  // A window with no floor could close at any moment across its whole length, and a row
  // that is warm for six hours has stopped telling anybody anything.
  it('stays cool for a window it has no floor for', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);
    h.poll();

    h.clockTo(10_800_000);

    expect(h.classesOf(VOSKAR)).toContain('woc-bar-default');
  });

  // The floor: seen standing at one moment and dead at another, the rare cannot be back
  // before the first of those plus its respawn. The gap between the two sightings is exactly
  // how wide the window is, so the player rides away between them.
  it('warms once the last sighting says it could be back', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();
    h.despawn(VOSKAR_ID);
    h.poll();

    // Five hours later they ride past again and find a body. The kill happened somewhere in
    // those five hours, so the rare is back between one and six hours from now.
    h.clockTo(18_000_000);
    h.body(VOSKAR_ID + 1, VOSKAR);
    h.poll();
    expect(h.figureOf(VOSKAR)).toBe('≤ 6h 0m');
    expect(h.classesOf(VOSKAR)).toContain('woc-bar-default');

    h.clockTo(18_000_000 + 3_600_000);

    expect(h.figureOf(VOSKAR)).toBe('≤ 5h 0m');
    expect(h.classesOf(VOSKAR)).toContain('woc-bar-warn');
  });

  // The floor is taken every pass rather than at the arrival, so watching a rare for an hour
  // and then losing it is an hour better than glimpsing it once.
  it('floors the window at the last pass that saw it standing', async () => {
    const h = await run();
    h.spawn(VOSKAR_ID, VOSKAR);
    h.poll();
    h.clockTo(3_600_000);
    h.despawn(VOSKAR_ID);
    h.poll();

    h.body(VOSKAR_ID + 1, VOSKAR);
    h.poll();

    // Five and a half hours after the body was found, which is the one stretch the two
    // readings disagree over: floored at the last pass the rare cannot be back for another
    // half hour, floored at the arrival it could have been back for the last half hour.
    h.clockTo(3_600_000 + 19_800_000);

    expect(h.classesOf(VOSKAR)).toContain('woc-bar-default');
  });

  // A rare that falls in view keeps its entity id and its place in the entity SET, so nothing
  // `world.on('entities')` can see happens at all. The once-a-second pass is what catches it,
  // and without it the row reads "Up" over a corpse until the body leaves range.
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

  // A kill this character watched is a measurement, and it beats a bound rather than being
  // averaged with one.
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

  // The body found before is a body of a life that has since ended: the rare stood up,
  // somebody else killed it, and the corpse in front of the player now is a different death.
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

// The corpse's own loot lock, which the game arms at the kill and lets lapse a minute later.
// A corpse still holding it died inside that minute, which is the one reading that turns a
// six hour window into a one minute one.
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

  // A lapsed lock says only that the kill was more than a minute ago, which is what the
  // ceiling already said. Reading a floor out of it would invent one.
  it('reads no floor out of a lock that has lapsed', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);
    h.lock(VOSKAR_ID, 0);

    h.poll();
    await settle();

    const stored = storedSightings(h.storage) as Record<string, { aliveAt: number | null }>;
    expect(stored[VOSKAR]?.aliveAt).toBeNull();
  });

  // A corpse the wire shipped no loot record for is not in `world.corpses` at all, and the
  // loader reads an unreadable lock as HELD. Concluding from that would be this addon
  // claiming a fresh kill every time it walks past an already looted body.
  it('reads no floor off a body carrying no loot record', async () => {
    const h = await run();
    h.body(VOSKAR_ID, VOSKAR);

    h.poll();
    await settle();

    const stored = storedSightings(h.storage) as Record<string, { aliveAt: number | null }>;
    expect(stored[VOSKAR]?.aliveAt).toBeNull();
  });
});

// A rare killed, logged out on, and returned to shows what is actually left rather than
// starting again. Two addons over one storage is the only honest shape for it: a stamp that
// survives has to survive an addon being torn down and rebuilt, which is what a page reload is.
//
// A reload is the two clocks coming apart, and that is what these cases drive. `advance` moves
// the monotonic clock, which a page load throws away: the second mount gets a fresh one
// starting near zero. `setWallClock` moves the wall clock, which a page load does not touch. So
// the first session is given real monotonic time to run for and the second is not.
//
// That split is what makes these two the regression against an author reaching for `woc.now()`
// for a stored stamp. With `now()` the stamp is written against a clock that goes backwards
// across the reload, so the arithmetic reads the kill as having happened in the future and the
// countdown comes back at its full length. Both assertions below are exact for that reason:
// `6h 0m` is what the wrong clock produces.
describe('a countdown across a logout', () => {
  it('resumes rather than restarting', async () => {
    const storage = createFakeStorage();
    const first = await run({}, storage);
    first.spawn(VOSKAR_ID, VOSKAR);
    first.poll();
    first.kill(VOSKAR_ID, VOSKAR);
    await settle();
    expect(first.figureOf(VOSKAR)).toBe('6h 0m');
    // The session ran for twenty minutes after the kill before the player logged out.
    // Monotonic only: this is the reading the second mount will not inherit.
    first.advance(SESSION_MS);

    // The player logs out and comes back two hours later. The wall clock is moved on
    // the SECOND harness rather than between the two, because a wall clock belongs to
    // the shared services a mount builds: moving the dead one's would move nothing.
    for (const stop of teardown.splice(0)) {
      stop();
    }
    document.body.innerHTML = '';
    const second = await run({}, storage);
    await settle();
    second.clockTo(7_200_000);

    expect(second.figureOf(VOSKAR)).toBe('4h 0m');
  });

  // The other half of the same claim: a rare whose window elapsed while the player
  // was away is back, not sitting on a fresh six hour timer.
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

  // The stamps have to be per character: the alt that has never been to Thornpeak must not
  // inherit the tank's timers. That is a key derivation rather than a behaviour, so it is
  // asserted on the key.
  it('writes the stamps under this character"s own key', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();

    h.kill(GREYJAW_ID, GREYJAW);
    await settle();

    const stored = storedSightings(h.storage) as Record<string, { killedAt: number }>;
    expect(stored[GREYJAW]?.killedAt).toBe(NOW);
  });

  // An entity id is the sim's id for one session and is reissued on the next, so a
  // stamp keyed on it or carrying it would be meaningless by the time it is read.
  it('writes down no entity id, which does not survive a session', async () => {
    const h = await run();
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    await settle();

    // Asserted on the KEYS rather than by searching the text for the id: a wall-clock
    // stamp is thirteen digits and will contain almost any three of them by accident.
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
      // What an older version of this addon, or a hand edit, could have left behind.
      { [GREYJAW]: { killedAt: 'a while ago' }, [GONE_RARE]: { killedAt: NOW } },
    );

    const h = await run({}, storage);
    await settle();
    h.tick();

    expect(h.figureOf(GREYJAW)).toBe('Unseen');
    expect(h.drawn()).toHaveLength(ROSTER_SIZE);
  });
});

// The zone match is done from position and never from `world.zone`, which is localized display
// text: an addon comparing it against a string would work in English and silently match nothing
// anywhere else. The game resolves a zone from a point against half-open rectangles.
describe('which zone the player is in', () => {
  it('lists only the current zone when asked to', async () => {
    const h = await run({ zones: 'The zone I am in' });

    expect(h.drawn()).toContain(GREYJAW);
    expect(h.drawn()).not.toContain(VOSKAR);
  });

  // The rectangle is half-open on both axes and the x bounds are the world strip's default.
  // Farshore Isle shares Eastbrook's z band at x 180 to 540, so a match on z alone would put a
  // player standing on Farshore in Eastbrook Vale.
  it('does not put a player outside the strip in the zone sharing its band', async () => {
    const h = await run({ zones: 'The zone I am in' });

    h.walkTo(200, 0);
    h.tick();

    expect(h.drawn()).toEqual([]);
  });

  // Nothing watches for a border crossing, and nothing needs to: the filter is
  // re-resolved on every frame the panel is up.
  it('follows the player across a border with no set change', async () => {
    const h = await run({ zones: 'The zone I am in' });

    h.walkTo(0, 600);
    h.tick();

    expect(h.drawn()).toContain(VOSKAR);
    expect(h.drawn()).not.toContain(GREYJAW);
  });

  // Which rares, not in what order: every one of these is unseen, so they tie on the default
  // sort and fall back to the order the roster file is written in.
  it('lists one named zone when the player picks one', async () => {
    const h = await run({ zones: 'The Veiled Hollow' });

    expect([...h.drawn()].sort()).toEqual(['aurelhorn', 'gleamstag', 'old_marrowshell']);
  });

  it('measures the distance from the player to the camp', async () => {
    const h = await run();

    // Old Greyjaw's camp is authored at z 100, and the player is standing at 0.
    expect(h.detailOf(GREYJAW)).toBe('Eastbrook Vale, 100 yd');
  });
});

// The world pins, for the rares in the zone the player is actually standing in.
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

  // The pins are anchors the loader holds over the world rather than children of the panel, so
  // hiding the panel does not hide them and nothing else would. No tick between the keypress and
  // the assertion, deliberately: leaving the pins to the once-a-second redraw would hang
  // nineteen of them over the world for up to a second after the player hid the panel.
  it('takes the pins out of the world the moment the panel is hidden', async () => {
    const h = await run();
    expect(h.pinned().length).toBeGreaterThan(0);

    h.press('Alt+KeyR');

    expect(h.pinned()).toEqual([]);
    expect(document.querySelectorAll('.woc-lw-anchor')).toHaveLength(0);
  });
});

// The sighting alert: the one thing this addon does that interrupts the player.
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

  // The first walk of a populated roster is world entry, or the moment the player enabled the
  // addon, and everything already in range arrives in that one walk. Announcing those means a
  // banner on every login for something the player did not walk up to.
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

  // Every set change walks the whole roster again, and the rare is still standing
  // there in every one of them. Only the arrival is news.
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
  // Up first, then soonest back, with the ones nobody has killed at the bottom.
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

    // Standing at the origin, the nearest camp is Old Greyjaw's at 100 yards.
    expect(h.drawn()[0]).toBe(GREYJAW);
  });

  it('re-sorts a settings change without a reload', async () => {
    const h = await run();
    // One kill, so "Soonest back" has something to rank and the two orders differ for a stated
    // reason. Without it every row is unseen, every rank is the same, and which id comes out on
    // top is whatever order the roster file happens to be written in.
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

// A character switch inside one page load, which is real: the game clones and removes its HUD
// rather than reloading, so nothing forces an addon to start again. Everything this addon holds
// in memory belongs to whoever was playing a moment ago.
describe('the player becoming somebody else', () => {
  // Run with the countdowns switched OFF, so nothing is written and nothing is read
  // back: what is left on screen afterwards is then only what memory still holds,
  // which is the thing the switch has to clear.
  it('forgets the previous character"s countdowns', async () => {
    const h = await run({ 'keep-timers': false });
    h.spawn(GREYJAW_ID, GREYJAW);
    h.poll();
    h.kill(GREYJAW_ID, GREYJAW);
    expect(h.figureOf(GREYJAW)).toBe('1m 40s');

    h.becomeCharacter(OTHER_CHARACTER);
    h.poll();

    expect(h.figureOf(GREYJAW)).toBe('Unseen');
  });

  // The new character's whole interest scope arrives in one walk they did not ride up
  // to, which is the same moment the first-roster flag exists for at world entry.
  it('does not call out what the new character finds already standing there', async () => {
    const h = await run({ 'keep-timers': false }, undefined, [
      { id: GREYJAW_ID, templateId: GREYJAW },
    ]);
    expect(h.banner()).toBe('');

    h.becomeCharacter(OTHER_CHARACTER);
    h.poll();
    // Something else moving is what makes the addon walk the roster again, with the
    // rare from before the switch still standing exactly where it was.
    h.spawn(VOSKAR_ID, 'forest_wolf');
    h.poll();

    expect(h.banner()).toBe('');
  });
});

// An addon's first line runs at document-start, on the landing page, where there is no world
// and no character. Nothing here may throw, nothing may be written, and nothing may be put into
// a world that is not there.
describe('before world entry', () => {
  it('starts without a world at all', async () => {
    const storage = createFakeStorage();
    const harness = await mountAddon({
      manifest: MANIFEST_TEXT,
      source: SOURCE,
      storage,
      // The roster still lands, so this is a case about there being no WORLD rather
      // than about there being nothing to draw.
      data: { [ROSTER_FILE]: ROSTER_TEXT },
      // No game, so `world.ready` never settles: the landing page.
      settings: {},
    });
    teardown.push(harness.dispose);
    await settle();

    // Not asserted: that no row was built. An addon runs before world entry by design and the
    // loader is what keeps its frames off the landing page, so a built panel is a panel that is
    // ready rather than one on screen. What must not happen is a per-character write, because
    // there is nobody yet to file one under, and a world anchor, because there is no world.
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
