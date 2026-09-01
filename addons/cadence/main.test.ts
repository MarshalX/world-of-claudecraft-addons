// @vitest-environment happy-dom

// Cadence, run through the real loader.
//
// The claim worth pinning is the one the addon exists for: the swing bar resets the moment
// the game re-arms the timer, which is when the swing landed, and not when the damage event
// describing that swing turns up. Those are two different moments on the wire and the event
// is the later of them, so a display driven by it runs down to zero, sits there for a round
// trip and jumps. The suite drives both halves: a re-armed timer with no event, and an
// event with no re-arm.
//
// Nothing in this addon is driven by a subscription except combat, so almost every case
// advances a frame rather than polling the watcher.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { perCharacterKey, uiNamespace } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the cooldown-bars suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
const MOB_ID = 9001;
/** The mainhand speed the fixture is wearing, which seeds the swing row. */
const SWING_SPEED = 2.4;
/** The namespace a frame's box is saved under, and the character it is saved for. */
const FQID = 'official/cadence';
const CHANNEL = 'pbe';
const CHARACTER = 'Claudemoon/Marshal';

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

interface CadenceHarness extends SharedHarness {
  /** `<marketplace>/<id>`, which is the namespace a settings write lands in. */
  fqid: string;
  /** Write fields onto the live player, the way a snapshot merge does. */
  self: (fields: Record<string, unknown>) => void;
  /** Put a mob in scope whose hate table names the player, which IS combat. */
  pullMob: () => void;
  /** Put a mob in scope and select it. */
  target: (id: number, fields?: Record<string, unknown>) => void;
  /** Write fields onto a mob already in scope. */
  mob: (id: number, fields: Record<string, unknown>) => void;
  /** Take an entity out of scope. */
  drop: (id: number) => void;
  /** Select nothing. */
  untarget: () => void;
  /** State the server's movement multiplier, or null for a session with no answer. */
  speed: (mult: number | null) => void;
  /** Watch somebody else, which nulls the multiplier. */
  spectate: (who: string | null) => void;
  /** Report a round trip. It is stated rather than measured: see `netState`. */
  latency: (ms: number | null) => void;
  /** Re-read the world, which is what turns a state change into a handler call. */
  poll: () => void;
  /** Run the loader's shared frame loop once, which is what the addon draws on. */
  frame: () => void;
  /** The row keys on screen, in the order they are drawn. */
  drawn: () => string[];
  /** One row's fill width, as the style string the kit wrote. */
  fillOf: (key: string) => string;
  /** One row's right-hand figure. */
  valueOf: (key: string) => string;
  labelOf: (key: string) => string;
  /** The latency band's width, or '' when it is not drawn. */
  bandWidth: () => string;
  /** The combo pips, true for filled. */
  pips: () => boolean[];
  strip: () => HTMLElement;
}

/** The height the kit was asked for. Its own sheet turns that into text and art. */
function heightFor(key: string): string {
  return rowFor(key)?.style.getPropertyValue('--woc-bar-size') ?? '';
}

function rowFor(key: string): HTMLElement | null {
  return document.querySelector(`[data-row="${key}"]`);
}

function pipStrip(): HTMLElement {
  return document.querySelector('.woc-cadence-pips') as HTMLElement;
}

function textIn(key: string, selector: string): string {
  return rowFor(key)?.querySelector(selector)?.textContent ?? '';
}

/**
 * Whether something is really on screen. Both halves, because `[hidden]` is a UA rule at the
 * lowest priority there is and the loader's own unlayered sheet beats it outright: measured
 * on the stage, the strip with the attribute alone still computes `display: flex`.
 *
 * The class is the half that actually hides it. Every `.css` import resolves to '' under
 * Vitest, so the rule behind it cannot be seen from here.
 */
function shown(el: HTMLElement): boolean {
  return !(el.hidden || el.classList.contains('woc-hidden'));
}

/**
 * Let the async frame restore land before reading what the addon drew. A frame that saves
 * its state starts hidden and is shown once the stored answer arrives, keyed per character,
 * so it takes a watcher sample and a storage read. The addon's own loop stands down while
 * the frame is hidden.
 */
async function settleFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
): Promise<CadenceHarness> {
  // A rogue: energy, combo points, and a weapon with a real swing speed. The swing timer and
  // the global cooldown ride the self record, so everything the addon reads is written onto
  // this one entity.
  const player = liveEntity({
    set: {
      templateId: 'rogue',
      resourceType: 'energy',
      resource: 100,
      maxResource: 100,
      weapon: { min: 40, max: 60, speed: SWING_SPEED, dagger: true },
      autoAttack: true,
    },
  });
  const entities = new Map<number, unknown>([[PLAYER_ID, player]]);
  // The spellbook in the game's own shape. The id and the display name have
  // diverged, which is the whole reason `world.abilities` exists.
  const known = [
    {
      def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
      rank: 3,
      cost: 55,
      castTime: 2,
      cooldown: 5.4,
    },
  ];
  // The movement read is gated on both `spectating` and the wire version: left unstated,
  // every speed case passes on null.
  const world: Record<string, unknown> = {
    entities,
    player,
    known,
    spectating: null,
    movementWireVersion: 2,
  };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings,
    storage,
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  return {
    ...harness,
    self: (fields) => {
      Object.assign(player, fields);
    },
    pullMob: () => {
      entities.set(
        MOB_ID,
        liveEntity({
          set: {
            id: MOB_ID,
            kind: 'mob',
            hostile: true,
            threat: new Map([[PLAYER_ID, 500]]),
          },
        }),
      );
    },
    // `world.unit('target')` reads the player's `targetId` against the entity map, so both
    // halves are needed.
    target: (id, fields = {}) => {
      entities.set(
        id,
        liveEntity({
          set: { id, kind: 'mob', name: `Mob${String(id)}`, hostile: true, ...fields },
        }),
      );
      Object.assign(player, { targetId: id });
    },
    mob: (id, fields) => {
      Object.assign(entities.get(id) as Record<string, unknown>, fields);
    },
    drop: (id) => {
      entities.delete(id);
    },
    untarget: () => {
      Object.assign(player, { targetId: null });
    },
    // The loader reads `reconMoveSpeedMult`, gated on the v2 movement wire and on not
    // spectating, so all three are stated. Null is the field taken away, the offline shape.
    speed: (mult) => {
      Object.assign(world, { movementWireVersion: 2, spectating: null });
      if (mult === null) {
        Reflect.deleteProperty(world as Record<string, unknown>, 'reconMoveSpeedMult');
        return;
      }
      Object.assign(world, { reconMoveSpeedMult: mult });
    },
    spectate: (who) => {
      Object.assign(world, { spectating: who });
    },
    latency: (ms) => harness.netState({ latencyMs: ms }),
    poll: () => harness.shared.world.watcher.poll(),
    // The loader's own loop, stepped by hand. The addon is on `woc.onFrame`, so nothing it
    // draws happens until the shared tick runs.
    frame: () => harness.frames.tick(),
    drawn: () =>
      [...document.querySelectorAll('[data-row]')].map((el) => el.getAttribute('data-row') ?? ''),
    fillOf: (key) =>
      (rowFor(key)?.querySelector('.woc-bar-fill') as HTMLElement | null)?.style.width ?? '',
    valueOf: (key) => textIn(key, '.woc-bar-value'),
    labelOf: (key) => textIn(key, '.woc-bar-label'),
    bandWidth: () => {
      const band = document.querySelector<HTMLElement>('.woc-cadence-band');
      if (band === null || band.hidden) {
        return '';
      }
      return band.style.width;
    },
    // Filled and spent are one colour at two opacities, which is also the only
    // half of a pip happy-dom keeps: its parser drops a `var()` outright.
    pips: () =>
      [...document.querySelectorAll<HTMLElement>('.woc-cadence-pip')].map(
        (pip) => pip.style.opacity === '1',
      ),
    strip: () => document.querySelector('.woc-cadence') as HTMLElement,
  };
}

/** `start`, plus the wait for the overlay to actually come up. */
async function run(
  settings: Record<string, unknown> = {},
  storage?: FakeStorage,
): Promise<CadenceHarness> {
  const harness = await start(settings, storage);
  harness.poll();
  await settleFrames();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // It reads the socket only for the round trip behind the latency band, and it
  // never plays a cue or writes a key of its own.
  it('asks for the world, the socket, a frame and a key, and nothing else', () => {
    expect(parseManifest(MANIFEST_TEXT).permissions).toEqual([
      'world.read',
      'net.read',
      'ui',
      'keys',
    ]);
  });

  // The smallest minor carrying every member the file reads. `woc.ui.column`,
  // `woc.ui.row` and `woc.ui.show` for the strip and its pips, `woc.fmt.titleCase`
  // for the cast label, and `toggleKey` on the frame options were minor 4; the two
  // that moved it to 6 are `size` on a bar, which is how a row is scaled now, and
  // `frame.box()`, which is where the height being divided comes from.
  //
  // The target row moves nothing: `world.unit`, `Entity.swingTimer` and `Entity.autoAttack`
  // were published before 6. `Entity.offhandSwingTimer` and `Entity.offhandWeapon` are
  // published at minor 10.
  it('declares the minor every member it reads is carried by', () => {
    expect(parseManifest(MANIFEST_TEXT).apiMinor).toBe(10);
  });
});

describe('which rows are on the strip', () => {
  it('draws all four in a fixed order', async () => {
    const h = await run();

    expect(h.drawn()).toEqual(['swing', 'gcd', 'cast', 'power']);
  });

  it('leaves a row out when it is switched off', async () => {
    const h = await run({ 'show-gcd': false });

    expect(h.drawn()).toEqual(['swing', 'cast', 'power']);
  });

  // A row with nothing to say stays where it is. The strip is read by muscle
  // memory at a fixed spot, and a cast row that appeared as a cast started would
  // move the two rows above it at the exact moment they are being watched.
  it('keeps an idle row in place rather than removing it', async () => {
    const h = await run();

    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();
    h.self({ castingAbility: null, castRemaining: 0, castTotal: 0 });
    h.frame();

    expect(h.drawn()).toEqual(['swing', 'gcd', 'cast', 'power']);
    expect(h.valueOf('cast')).toBe('');
  });
});

// Nothing publishes how long a swing takes. What is readable is how much is left, so the row
// learns its length from the reset, and the reset is the swing landing.
describe('the swing timer', () => {
  it('drains as the timer runs down, with no subscription in between', async () => {
    const h = await run();
    h.self({ swingTimer: SWING_SPEED });
    h.frame();
    expect(h.fillOf('swing')).toBe('100.00%');

    h.self({ swingTimer: SWING_SPEED / 2 });
    h.frame();

    expect(h.fillOf('swing')).toBe('50.00%');
    expect(h.valueOf('swing')).toBe('1.2s');
  });

  // The game re-arms the timer on the snapshot that resolved the swing; the damage event
  // describing that same swing arrives afterwards.
  it('resets the instant the timer is re-armed, before any damage event', async () => {
    const h = await run();
    h.self({ swingTimer: SWING_SPEED });
    h.frame();
    h.self({ swingTimer: 0.1 });
    h.frame();
    expect(h.fillOf('swing')).toBe('4.17%');

    h.self({ swingTimer: SWING_SPEED });
    h.frame();

    expect(h.fillOf('swing')).toBe('100.00%');
  });

  // The other half, which a display built on the event would fail: the damage lands while
  // the timer is still running down, so the bar must ignore it and keep draining.
  it('ignores the damage event that follows a swing', async () => {
    const h = await run();
    h.self({ swingTimer: SWING_SPEED });
    h.frame();
    h.self({ swingTimer: SWING_SPEED / 2 });
    h.frame();

    h.inbound({
      t: 'events',
      list: [
        {
          type: 'damage',
          sourceId: PLAYER_ID,
          targetId: MOB_ID,
          amount: 214,
          ability: null,
          school: 'physical',
        },
      ],
    });
    h.frame();

    expect(h.fillOf('swing')).toBe('50.00%');
  });

  // `weapon.speed` is the unhasted speed and the period the timer resets to is the hasted
  // one, which nothing publishes. Without the relearn a hasted rogue's bar would top out at
  // three quarters and never fill.
  it('learns a hasted swing from the reset rather than from the weapon', async () => {
    const h = await run();
    h.self({ swingTimer: 0.2 });
    h.frame();

    h.self({ swingTimer: 1.8 });
    h.frame();
    expect(h.fillOf('swing')).toBe('100.00%');

    h.self({ swingTimer: 0.9 });
    h.frame();

    expect(h.fillOf('swing')).toBe('50.00%');
  });

  // The seed is off by the melee haste stat and by nothing else. Every other term of the
  // game's swing period is a published aura carrying a plain multiplier, so a slowed player's
  // first bar is measured against the slowed period.
  it('seeds a slowed swing from the aura as well as the weapon', async () => {
    const h = await run();

    h.self({
      auras: [{ id: 'thunder_clap', kind: 'attackspeed', value: 1.5, remaining: 10 }],
      swingTimer: SWING_SPEED * 1.5 * 0.5,
    });
    h.frame();

    expect(h.fillOf('swing')).toBe('50.00%');
  });

  // The other half of the same rule: a haste aura is on the wire exactly as a slow is, so it
  // belongs in the seed for the same reason. Without this the first bar of a hasted swing is
  // measured against the bare weapon speed and tops out at two thirds.
  it('seeds a hastened swing from the aura as well as the weapon', async () => {
    const h = await run();

    h.self({
      auras: [{ id: 'pack_frenzy', kind: 'buff_haste', value: 1.5, remaining: 10 }],
      swingTimer: (SWING_SPEED / 1.5) * 0.5,
    });
    h.frame();

    expect(h.fillOf('swing')).toBe('50.00%');
  });

  // A slow and a haste at once, which is the game's own arithmetic rather than two
  // independent adjustments: the slows multiply the period and the hastes divide the result
  // through one additive bucket.
  it('seeds a swing that is slowed and hastened at once', async () => {
    const h = await run();

    h.self({
      auras: [
        { id: 'thunder_clap', kind: 'attackspeed', value: 1.5, remaining: 10 },
        { id: 'pack_frenzy', kind: 'buff_haste', value: 1.25, remaining: 10 },
      ],
      swingTimer: ((SWING_SPEED * 1.5) / 1.25) * 0.5,
    });
    h.frame();

    expect(h.fillOf('swing')).toBe('50.00%');
  });

  // A swing timer on a character who is not auto-attacking counts to nothing.
  it('says so when auto-attack is off', async () => {
    const h = await run();

    h.self({ swingTimer: SWING_SPEED, autoAttack: false });
    h.frame();

    expect(h.valueOf('swing')).toBe('off');
    expect(h.fillOf('swing')).toBe('0.00%');
  });
});

// `world.moveSpeedMult` is the server's net multiplier with no breakdown, new at game 0.41.0.
describe('the movement speed row', () => {
  const On = { 'show-speed': true };
  const speedRow = (): HTMLElement => rowFor('speed') as HTMLElement;

  it('is off by default', async () => {
    const h = await run();

    expect(h.drawn()).toEqual(['swing', 'gcd', 'cast', 'power']);
  });

  // Null is "no answer": before world entry, offline, spectating, or on the older movement
  // wire, where a 1 would sit while the player really was snared.
  it('says nothing at all when the field has no answer', async () => {
    const h = await run(On);
    h.speed(null);

    h.frame();

    expect(shown(speedRow())).toBe(false);
  });

  // A moderator spectate repoints the client's player at somebody else and the server skips
  // the block carrying this field.
  it('says nothing while spectating somebody else', async () => {
    const h = await run(On);
    h.speed(0.5);
    h.frame();
    expect(shown(speedRow())).toBe(true);

    h.spectate('Someone-Else');
    h.frame();

    expect(shown(speedRow())).toBe(false);
  });

  it('stays quiet at exactly normal speed', async () => {
    const h = await run(On);
    h.speed(1);

    h.frame();

    expect(shown(speedRow())).toBe(false);
  });

  it('speaks up for a real snare, as a share of your normal speed', async () => {
    const h = await run(On);
    h.speed(0.6);

    h.frame();

    expect(shown(speedRow())).toBe(true);
    expect(h.labelOf('speed')).toBe('Speed');
    expect(h.valueOf('speed')).toBe('60%');
    expect(h.fillOf('speed')).toBe('60.00%');
  });

  // The game folds stealth into the same `Math.min` as a snare, and a rogue's Stealth is 0.5.
  it('stays quiet while stealthed, where 0.5 is the stealth and not a snare', async () => {
    const h = await run(On);
    h.speed(0.5);
    h.self({ auras: [{ id: 'stealth', kind: 'stealth', value: 0.5, remaining: 3600 }] });

    h.frame();

    expect(shown(speedRow())).toBe(false);
  });

  // A mount is +60% to +80% for as long as the journey lasts.
  it('stays quiet while mounted', async () => {
    const h = await run(On);
    h.speed(1.6);
    h.self({ mountKey: 'galecrest_courser' });

    h.frame();

    expect(shown(speedRow())).toBe(false);
  });

  // Empty is the on-foot answer, so a falsy gate on it would silence the row for everybody.
  it('still speaks on foot, where the mount key is empty rather than absent', async () => {
    const h = await run(On);
    h.speed(0.4);
    h.self({ mountKey: '' });

    h.frame();

    expect(shown(speedRow())).toBe(true);
    expect(h.valueOf('speed')).toBe('40%');
  });

  // A released spirit is a flat 1.25 returned before the aura scan, with no aura to explain it.
  it('stays quiet for a ghost, whose 1.25 has no aura behind it', async () => {
    const h = await run(On);
    h.speed(1.25);
    h.self({ ghost: true });

    h.frame();

    expect(shown(speedRow())).toBe(false);
  });

  // Slow immunity gates only the game's `slow` arm, so an immune player carrying a snare
  // computes exactly 1.
  it('is quiet for a slow-immune player carrying a snare, without a rule for it', async () => {
    const h = await run(On);
    h.speed(1);
    h.self({
      auras: [
        { id: 'crippling_poison', kind: 'slow', value: 0.5, remaining: 8 },
        { id: 'veilbound_march', kind: 'slow_immunity', value: 1, remaining: 8 },
      ],
    });

    h.frame();

    expect(shown(speedRow())).toBe(false);
  });

  it('speaks at a dead stop, which a falsy guard would swallow', async () => {
    const h = await run(On);
    h.speed(0);

    h.frame();

    expect(shown(speedRow())).toBe(true);
    expect(h.valueOf('speed')).toBe('0%');
  });

  it('shows a rush with the bar pinned full and the figure carrying the excess', async () => {
    const h = await run(On);
    h.speed(1.4);

    h.frame();

    expect(h.valueOf('speed')).toBe('140%');
    expect(h.fillOf('speed')).toBe('100.00%');
  });

  it('takes a line only while it is speaking, and gives it back', async () => {
    const h = await run(On);
    h.speed(1);
    h.frame();
    expect(heightFor('swing')).toBe('14');

    h.speed(0.5);
    h.frame();
    expect(heightFor('swing')).toBe('10');

    h.speed(1);
    h.frame();

    expect(heightFor('swing')).toBe('14');
  });

  it('opens at the same height as a strip without it', async () => {
    await run(On);

    expect((document.querySelector('[data-woc-frame="strip"]') as HTMLElement).style.height).toBe(
      '62px',
    );
    expect(shown(speedRow())).toBe(false);
  });

  it('says it names no cause and publishes no speed', async () => {
    const h = await run(On);
    h.speed(0.6);
    h.frame();

    speedRow().dispatchEvent(new Event('pointerenter'));
    const said = document.getElementById('woc-tooltip')?.textContent ?? '';

    expect(said).toContain('no breakdown, so this names no cause');
    expect(said).toContain('no yards-per-second');
  });
});

// `offhandWeapon.speed` is the unhasted base and not the period: the game resets this clock
// to `offhand.speed * swingIntervalMult(p)`, and neither melee haste nor the stance mastery
// is on the wire.
describe('the offhand swing timer', () => {
  const On = { 'show-offhand-swing': true };
  /** Duskfang Dirk, in the shape the self record carries a weapon. */
  const Dirk = { min: 13, max: 21, speed: 1.6, dagger: true };
  /** A second weapon of a DIFFERENT speed, so a stale period shows as a wrong fill. */
  const Shiv = { min: 9, max: 15, speed: 1.2, dagger: true };
  const dual = (weapon: Record<string, unknown>, itemId: string): Record<string, unknown> => ({
    offhandWeapon: weapon,
    offhandItemId: itemId,
  });

  it('is off by default, so a strip nobody asked to change keeps its shape', async () => {
    const h = await run();

    expect(h.drawn()).toEqual(['swing', 'gcd', 'cast', 'power']);
  });

  it('draws no row at all for a player holding nothing in the offhand', async () => {
    const h = await run(On);

    h.frame();

    expect(shown(rowFor('oswing') as HTMLElement)).toBe(false);
  });

  // Asserted before any frame runs, since the first frame hides the row either way: the
  // hidden row and the box stated for one fewer line have to agree.
  it('opens at the same height as a strip without it, before any frame runs', async () => {
    await run(On);

    expect((document.querySelector('[data-woc-frame="strip"]') as HTMLElement).style.height).toBe(
      '62px',
    );
    expect(shown(rowFor('oswing') as HTMLElement)).toBe(false);
  });

  // A shield fills `offhandItemId` and leaves the weapon null; the game derives dual-wield
  // from the weapon alone.
  it('draws no row for a shield, which fills the item id and not the weapon', async () => {
    const h = await run(On);
    h.self({ offhandWeapon: null, offhandItemId: 'bulwark_of_the_vale' });

    h.frame();

    expect(shown(rowFor('oswing') as HTMLElement)).toBe(false);
  });

  it('appears when an offhand is equipped mid-session', async () => {
    const h = await run(On);
    h.frame();
    expect(shown(rowFor('oswing') as HTMLElement)).toBe(false);

    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 1.6 });
    h.frame();

    expect(shown(rowFor('oswing') as HTMLElement)).toBe(true);
    expect(h.labelOf('oswing')).toBe('Offhand');
    expect(h.valueOf('oswing')).toBe('1.6s');
  });

  it('takes its line out of the box the other rows had', async () => {
    const h = await run(On);
    h.frame();
    expect(heightFor('swing')).toBe('14');

    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 1.6 });
    h.frame();

    // Five lines and their four gaps inside the 62px the frame opened at.
    expect(heightFor('swing')).toBe('10');
  });

  it('runs its own clock, which is not the mainhand one', async () => {
    const h = await run(On);

    h.self({
      ...dual(Dirk, 'duskfang_dirk'),
      swingTimer: SWING_SPEED,
      offhandSwingTimer: 0.8,
    });
    h.frame();

    expect(h.valueOf('swing')).toBe('2.4s');
    expect(h.valueOf('oswing')).toBe('0.8s');
  });

  // 1.6 seeded, 1.0 observed: without the relearn this bar tops out at five eighths.
  it('learns the real period from the reset rather than trusting the weapon speed', async () => {
    const h = await run(On);
    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 0.8 });
    h.frame();
    expect(h.fillOf('oswing')).toBe('50.00%');

    h.self({ offhandSwingTimer: 1 });
    h.frame();
    expect(h.fillOf('oswing')).toBe('100.00%');

    h.self({ offhandSwingTimer: 0.25 });
    h.frame();

    expect(h.fillOf('oswing')).toBe('25.00%');
  });

  // The game decrements this clock BEFORE it checks whether you are attacking, so with the
  // swing off it drains to zero and sits there.
  it('says off when auto-attack is off, rather than sitting at zero', async () => {
    const h = await run(On);

    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 0, autoAttack: false });
    h.frame();

    expect(h.valueOf('oswing')).toBe('off');
    expect(h.fillOf('oswing')).toBe('0.00%');
  });

  // The swap frame's timer must be LOWER than the frame before it: a timer jumping up reads
  // as a swing landing and the relearn corrects it whether or not anything was discarded.
  // 0.6 against the shiv's own 1.2 seed is half, and against the dirk's stale 1.6 is 37.5%.
  it('throws the learned period away when the offhand is swapped', async () => {
    const h = await run(On);
    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 1.6 });
    h.frame();
    h.self({ offhandSwingTimer: 1.2 });
    h.frame();
    expect(h.fillOf('oswing')).toBe('75.00%');

    h.self({ ...dual(Shiv, 'ratcatcher_shiv'), offhandSwingTimer: 0.6 });
    h.frame();

    expect(h.fillOf('oswing')).toBe('50.00%');
  });

  // The transition a key on the weapon's SPEED could not see. A discard falls back to the
  // SEED, not a full bar: 0.4 remaining reads a quarter on a discard and a half on a period
  // that survived.
  it('throws it away across an unequip and a re-equip of the same weapon', async () => {
    const h = await run(On);
    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 0.2 });
    h.frame();
    // Jumping UP is the swing landing, and 0.8 is what this hand actually swings at.
    h.self({ offhandSwingTimer: 0.8 });
    h.frame();
    h.self({ offhandSwingTimer: 0.4 });
    h.frame();
    expect(h.fillOf('oswing')).toBe('50.00%');

    h.self({ offhandWeapon: null, offhandItemId: null });
    h.frame();
    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 0.4 });
    h.frame();

    expect(h.fillOf('oswing')).toBe('25.00%');
  });

  it('gives its line back when the offhand comes off', async () => {
    const h = await run(On);
    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 1.6 });
    h.frame();
    expect(heightFor('swing')).toBe('10');

    h.self({ offhandWeapon: null, offhandItemId: null });
    h.frame();

    expect(shown(rowFor('oswing') as HTMLElement)).toBe(false);
    expect(heightFor('swing')).toBe('14');
  });

  it('never reaches the target row', async () => {
    const h = await run({ ...On, 'show-target-swing': true });
    h.target(7003, { autoAttack: true, swingTimer: 3, offhandSwingTimer: 0.5 });

    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 1.6 });
    h.frame();

    expect(h.drawn()).toEqual(['swing', 'oswing', 'tswing', 'gcd', 'cast', 'power']);
    expect(h.valueOf('tswing')).toBe('3.0s');
    expect(h.valueOf('oswing')).toBe('1.6s');
  });

  it('says the length starts as an estimate and is corrected by watching', async () => {
    const h = await run(On);
    h.self({ ...dual(Dirk, 'duskfang_dirk'), offhandSwingTimer: 1.6 });
    h.frame();

    rowFor('oswing')?.dispatchEvent(new Event('pointerenter'));
    const said = document.getElementById('woc-tooltip')?.textContent ?? '';

    expect(said).toContain('unhasted');
    expect(said).toContain('corrected by watching one swing');
  });
});

// The server sends `swing` only for an auto-attacking entity and the client reads presence
// as `autoAttack`. No weapon speed rides it, so the row knows only what it watched.
describe("the target's swing timer", () => {
  const TargetId = 7001;
  const SecondId = 7002;
  const On = { 'show-target-swing': true };
  /** A mob mid-swing: attacking, with time left on the clock. */
  const swinging = (remaining: number): Record<string, unknown> => ({
    autoAttack: true,
    swingTimer: remaining,
  });

  it('is off by default, so an upgrade does not reshape a strip nobody asked to change', async () => {
    const h = await run();

    expect(h.drawn()).toEqual(['swing', 'gcd', 'cast', 'power']);
  });

  it('sits under your own swing when it is switched on', async () => {
    const h = await run(On);

    expect(h.drawn()).toEqual(['swing', 'tswing', 'gcd', 'cast', 'power']);
  });

  it('says there is no target rather than drawing a stalled bar', async () => {
    const h = await run(On);

    h.frame();

    expect(h.valueOf('tswing')).toBe('no target');
    expect(h.fillOf('tswing')).toBe('0.00%');
    expect(h.labelOf('tswing')).toBe('Target');
  });

  // The server omits `swing` for an entity that is not auto-attacking, and so does every
  // server older than 0.41.0.
  it('says off for a target that is not auto-attacking', async () => {
    const h = await run(On);
    h.target(TargetId, { autoAttack: false, swingTimer: 0 });

    h.frame();

    expect(h.valueOf('tswing')).toBe('off');
  });

  // A corpse keeps its last swing value.
  it('says dead for a target that has died mid-swing', async () => {
    const h = await run(On);
    h.target(TargetId, swinging(2));
    h.frame();
    expect(h.valueOf('tswing')).toBe('2.0s');

    h.mob(TargetId, { dead: true });
    h.frame();

    expect(h.valueOf('tswing')).toBe('dead');
  });

  // A door is an entity with a swing field and no swing; the game excludes `object` by kind.
  it('says off for a door or a crate', async () => {
    const h = await run(On);
    h.target(TargetId, { kind: 'object', autoAttack: true, swingTimer: 2 });

    h.frame();

    expect(h.valueOf('tswing')).toBe('off');
  });

  it('names the target, so the row says whose cadence it is measuring', async () => {
    const h = await run(On);
    h.target(TargetId, { name: 'Sableweb Lurker', ...swinging(2) });

    h.frame();

    expect(h.labelOf('tswing')).toBe('Sableweb Lurker');
  });

  it('starts full, since the length of a swing it has not seen is unknowable', async () => {
    const h = await run(On);
    h.target(TargetId, swinging(2.6));

    h.frame();

    expect(h.fillOf('tswing')).toBe('100.00%');
  });

  // Guessed 2.6, real 4: without the relearn this bar runs off the end of its own scale.
  it('learns the real period from the reset edge and drains against it', async () => {
    const h = await run(On);
    h.target(TargetId, swinging(2.6));
    h.frame();
    h.mob(TargetId, swinging(0.2));
    h.frame();

    // The timer jumping UP is the swing landing, and the freshly armed value IS the period.
    h.mob(TargetId, swinging(4));
    h.frame();
    expect(h.fillOf('tswing')).toBe('100.00%');

    h.mob(TargetId, swinging(1));
    h.frame();

    expect(h.fillOf('tswing')).toBe('25.00%');
  });

  // Carrying 4 over would draw this add's full one-second swing as a quarter of a bar.
  it('throws the learned period away when the target changes', async () => {
    const h = await run(On);
    h.target(TargetId, swinging(4));
    h.frame();
    h.mob(TargetId, swinging(2));
    h.frame();
    expect(h.fillOf('tswing')).toBe('50.00%');

    h.target(SecondId, swinging(1));
    h.frame();

    expect(h.fillOf('tswing')).toBe('100.00%');
    expect(h.labelOf('tswing')).toBe(`Mob${String(SecondId)}`);
  });

  it('throws it away when the target goes out of range and comes back', async () => {
    const h = await run(On);
    h.target(TargetId, swinging(4));
    h.frame();

    h.drop(TargetId);
    h.frame();
    expect(h.valueOf('tswing')).toBe('no target');

    h.target(TargetId, swinging(1.5));
    h.frame();

    expect(h.fillOf('tswing')).toBe('100.00%');
  });

  it('goes back to saying nothing when the target is dropped', async () => {
    const h = await run(On);
    h.target(TargetId, swinging(2));
    h.frame();

    h.untarget();
    h.frame();

    expect(h.valueOf('tswing')).toBe('no target');
    expect(h.fillOf('tswing')).toBe('0.00%');
  });

  // A row taking the player's swing would pass every case above that never sets one.
  it('reads the target and not the player, when both are swinging', async () => {
    const h = await run(On);
    h.self({ swingTimer: SWING_SPEED });
    h.target(TargetId, swinging(3));

    h.frame();

    expect(h.valueOf('swing')).toBe('2.4s');
    expect(h.valueOf('tswing')).toBe('3.0s');
  });

  it('says the length is learned and that a switch discards it', async () => {
    await run(On);

    rowFor('tswing')?.dispatchEvent(new Event('pointerenter'));
    const said = document.getElementById('woc-tooltip')?.textContent ?? '';

    expect(said).toContain('No weapon speed is sent for anyone but you');
    expect(said).toContain('Switching target throws that away');
  });
});

// The row where the arithmetic exists, which separates it from the swing above it. Every term
// of the game's own formula is published, so the length is computed rather than learned and
// the bar is right on the first press of a session. The cases below are one per term.
describe('the global cooldown', () => {
  // The fixture is a rogue, so its base is 1.0. A row that had to watch for a
  // re-arm would divide this by its 1.5 seed and draw two thirds.
  it('is exact on the first press, with no re-arm ever observed', async () => {
    const h = await run();

    h.self({ gcdRemaining: 1 });
    h.frame();

    expect(h.fillOf('gcd')).toBe('100.00%');
  });

  it('drains against that length', async () => {
    const h = await run();
    h.self({ gcdRemaining: 1 });
    h.frame();

    h.self({ gcdRemaining: 0.5 });
    h.frame();

    expect(h.fillOf('gcd')).toBe('50.00%');
    expect(h.valueOf('gcd')).toBe('0.5s');
  });

  // A rogue's base is a third shorter than everyone else's, and it is the only class the
  // game singles out.
  it('gives a rogue the shorter base and nobody else', async () => {
    const h = await run();

    h.self({ templateId: 'mage', gcdRemaining: 1.5 });
    h.frame();

    expect(h.fillOf('gcd')).toBe('100.00%');
  });

  it('divides by spell haste', async () => {
    const h = await run();

    h.self({ templateId: 'mage', spellHaste: 0.5, gcdRemaining: 1 });
    h.frame();

    expect(h.fillOf('gcd')).toBe('100.00%');
  });

  // Haste from an aura is added to the stat rather than already folded into it, so an
  // implementation reading the stat alone draws a bar long by whatever the player has running.
  it('adds a haste aura on top of the stat', async () => {
    const h = await run();

    h.self({
      templateId: 'mage',
      spellHaste: 0.25,
      auras: [{ id: 'bloodlust', kind: 'buff_spellhaste', value: 0.25, remaining: 30 }],
      gcdRemaining: 1,
    });
    h.frame();

    expect(h.fillOf('gcd')).toBe('100.00%');
  });

  // No amount of haste takes it under the floor. Without one, this player's length would come
  // out at half a second and the bar would read three quarters full where it is half.
  it('never divides past the floor', async () => {
    const h = await run();

    h.self({ templateId: 'mage', spellHaste: 2, gcdRemaining: 0.375 });
    h.frame();

    expect(h.fillOf('gcd')).toBe('50.00%');
  });

  // Empty is the reading a player acts on: the next press goes through.
  it('empties when it is not running', async () => {
    const h = await run();
    h.self({ gcdRemaining: 1.5 });
    h.frame();

    h.self({ gcdRemaining: 0 });
    h.frame();

    expect(h.fillOf('gcd')).toBe('0.00%');
    expect(h.valueOf('gcd')).toBe('');
  });
});

describe('the cast bar', () => {
  it('names the ability the way the game does, not the way its id reads', async () => {
    const h = await run();

    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();

    expect(h.labelOf('cast')).toBe('Fell Shot');
  });

  // An ability outside your own spellbook resolves to nothing, and a readable
  // guess beats a blank row on the thing you are currently casting.
  it('falls back to the id for an ability it does not know', async () => {
    const h = await run();

    h.self({ castingAbility: 'summon_water_elemental', castRemaining: 3, castTotal: 3 });
    h.frame();

    expect(h.labelOf('cast')).toBe('Summon Water Elemental');
  });

  // `castingAbility` also carries an ACTIVITY sentinel, which is what the game runs
  // gathering, fishing and the crafting family through, and the set grows with the game. The
  // lane draws it like any other cast, because the game's own cast bar is drawing the same
  // thing. The case is here to fail if anyone adds an exclusion list of sentinels, since such
  // a list is stale the day the game adds one.
  it('draws an activity cast the same way', async () => {
    const h = await run();

    h.self({ castingAbility: 'crafting', castRemaining: 3, castTotal: 4 });
    h.frame();

    expect(h.labelOf('cast')).toBe('Crafting');
    expect(h.fillOf('cast')).toBe('75.00%');
  });

  it('drains as the cast completes', async () => {
    const h = await run();
    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();

    h.self({ castRemaining: 0.5 });
    h.frame();

    expect(h.fillOf('cast')).toBe('25.00%');
    expect(h.valueOf('cast')).toBe('0.5s');
  });

  // A channel drains the same way and is not the same thing, so the row says which.
  it('marks a channel', async () => {
    const h = await run();

    h.self({
      castingAbility: 'arcane_shot',
      castRemaining: 3,
      castTotal: 4,
      channeling: true,
    });
    h.frame();

    expect(h.labelOf('cast')).toBe('Fell Shot (channel)');
  });
});

// The part the game's own cast bar does not draw. It is a measurement of the round trip and
// never a claim about what the server does with a press that arrives during a cast.
describe('the latency band', () => {
  it('covers the share of the cast the round trip accounts for', async () => {
    const h = await run();
    h.latency(300);

    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();

    expect(h.bandWidth()).toBe('15.00%');
  });

  // Null until the first pairing, which is every session's first seconds and every
  // reconnect. A band drawn from a guess would be a made-up number on screen.
  it('draws nothing before a round trip has been measured', async () => {
    const h = await run();

    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();

    expect(h.bandWidth()).toBe('');
  });

  it('draws nothing when the setting is off', async () => {
    const h = await run({ 'show-latency': false });
    h.latency(300);

    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();

    expect(h.bandWidth()).toBe('');
  });

  it('goes away with the cast', async () => {
    const h = await run();
    h.latency(300);
    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();
    expect(h.bandWidth()).toBe('15.00%');

    h.self({ castingAbility: null, castRemaining: 0, castTotal: 0 });
    h.frame();

    expect(h.bandWidth()).toBe('');
  });

  // A round trip longer than the cast covers the whole bar rather than overflowing
  // it: the honest reading there is that the cast is shorter than your latency.
  it('stops at the whole bar', async () => {
    const h = await run();
    h.latency(3000);

    h.self({ castingAbility: 'arcane_shot', castRemaining: 1, castTotal: 1 });
    h.frame();

    expect(h.bandWidth()).toBe('100.00%');
  });
});

describe('the resource and the combo points', () => {
  it('fills against the pool and names it', async () => {
    const h = await run();

    h.self({ resource: 45, maxResource: 100 });
    h.frame();

    expect(h.labelOf('power')).toBe('Energy');
    expect(h.fillOf('power')).toBe('45.00%');
    expect(h.valueOf('power')).toBe('45');
  });

  // The game's `ResourceType` is exactly these four. `focus` is the hunter's and arrived with
  // the 0.36.0 class rebuild; before it, a hunter was on mana and this suite pinned that.
  it('names each of the four kinds the game sends', async () => {
    const h = await run();

    for (const [kind, label] of [
      ['mana', 'Mana'],
      ['rage', 'Rage'],
      ['energy', 'Energy'],
      ['focus', 'Focus'],
    ]) {
      h.self({ templateId: 'hunter', resourceType: kind, resource: 60, maxResource: 100 });
      h.frame();

      expect(h.labelOf('power')).toBe(label);
    }
  });

  // The fallback, and it earned its keep: `focus` went through it for a release, so a hunter
  // read a vague word rather than nothing at all. It stays for the next one.
  it('falls back for a kind the game does not send yet', async () => {
    const h = await run();

    h.self({ templateId: 'hunter', resourceType: 'chi', resource: 60, maxResource: 100 });
    h.frame();

    expect(h.labelOf('power')).toBe('Power');
  });

  it('draws a pip per combo point', async () => {
    const h = await run();

    h.self({ comboPoints: 3 });
    h.frame();

    expect(h.pips()).toEqual([true, true, true]);
  });

  // There is no maximum on the wire, so the strip is as wide as the most points this session
  // has shown. Writing five in would be a claim about every class in the game.
  it('keeps the slots it has seen rather than claiming a maximum', async () => {
    const h = await run();
    h.self({ comboPoints: 4 });
    h.frame();

    h.self({ comboPoints: 1 });
    h.frame();

    expect(h.pips()).toEqual([true, false, false, false]);
  });

  // The pips are a line of their own and the frame's height is stated for the rows alone, so
  // every line has to divide the box: on the one class that has them the strip would stand
  // taller than its own box and a bare frame clips.
  it('makes room for the pips out of the box the rows had', async () => {
    const h = await run();
    expect(heightFor('swing')).toBe('14');

    h.self({ comboPoints: 2 });
    h.frame();

    // Five lines and their four gaps inside the 62px the frame opened at.
    expect(heightFor('swing')).toBe('10');
    expect(shown(pipStrip())).toBe(true);
  });

  it('shows nothing for a class that has never had one', async () => {
    const h = await run();

    h.frame();

    expect(h.pips()).toEqual([]);
    expect(shown(pipStrip())).toBe(false);
  });
});

// The frame's own visibility is the player's and the loader persists it, so the setting hides
// the content instead. On a bare frame that is the same thing on screen.
describe('hiding it out of combat', () => {
  it('draws nothing while nothing is fighting', async () => {
    const h = await run({ 'hide-out-of-combat': true });

    expect(shown(h.strip())).toBe(false);
  });

  // The half a suite is the only place to catch: the strip is a flex column drawn
  // by a loader rule, so the attribute on its own leaves it on screen. Measured on
  // the stage, where `.woc-cadence` computes `display: flex` at 62px with the
  // attribute set and `display: none` at 0px once the class goes on.
  it('hides it by the class as well as by the attribute', async () => {
    const h = await run({ 'hide-out-of-combat': true });

    expect(h.strip().hidden).toBe(true);
    expect(h.strip().classList.contains('woc-hidden')).toBe(true);
  });

  it('comes back when a mob puts the player on its hate table', async () => {
    const h = await run({ 'hide-out-of-combat': true });

    h.pullMob();
    h.poll();

    expect(shown(h.strip())).toBe(true);
  });

  it('stays up out of combat when the setting is off', async () => {
    const h = await run();

    expect(shown(h.strip())).toBe(true);
  });
});

// Rows are placed once and never moved. An element removed and re-inserted loses the hover
// state the browser was tracking on it, with no leave event to say so.
describe('how the strip is drawn', () => {
  it('adds and removes nothing on a frame that only moves numbers', async () => {
    const h = await run();
    h.self({
      swingTimer: 2,
      gcdRemaining: 1,
      castingAbility: 'arcane_shot',
      castTotal: 2,
      comboPoints: 2,
    });
    h.frame();
    const first = rowFor('swing');
    const observer = new MutationObserver(() => undefined);
    // childList on the two lists rather than the whole subtree: the countdowns
    // rewrite their own text every frame, which is the display working.
    observer.observe(h.strip(), { childList: true });
    observer.observe(pipStrip(), { childList: true });

    h.self({ swingTimer: 1.5, castRemaining: 1.5, comboPoints: 1 });
    h.frame();
    h.self({ swingTimer: 1 });
    h.frame();

    expect(observer.takeRecords()).toEqual([]);
    expect(rowFor('swing')).toBe(first);
    observer.disconnect();
  });
});

// A frame's minimum size defaults to the size it opened at, so a strip that stated no bounds
// takes the kit's own fallback (240 by 120) as its floor, which is nearly twice what four
// 14px rows measure. Both bounds are stated from the row-height setting instead.
//
// What is observable from a suite is the inline box the loader paints, which is where every
// bound has already been applied. The gestures themselves are not: interactjs does not move a
// box under happy-dom, which has no layout. So the smaller box arrives the way a player's own
// would across a login, out of the per-character frame state.
describe('how small the strip can be made', () => {
  const savedBox = async (hub: FakeStorage, box: { w: number; h: number }): Promise<void> => {
    await hub.set(uiNamespace(FQID), perCharacterKey(CHANNEL, CHARACTER, 'strip'), {
      box: { x: 40, y: 60, ...box },
      visible: true,
    });
  };

  const frameEl = (): HTMLElement =>
    document.querySelector('[data-woc-frame="strip"]') as HTMLElement;

  it('opens at the height its rows actually take', async () => {
    await run();

    // Four 14px rows and the three 2px gaps between them, and nothing else: a
    // bare frame has no chrome to allow for.
    expect(frameEl().style.height).toBe('62px');
  });

  it('opens taller when the rows are set taller', async () => {
    await run({ 'bar-height': 24 });

    expect(frameEl().style.height).toBe('102px');
  });

  it('lets a box smaller than the opening size come back', async () => {
    const hub = createFakeStorage();
    await savedBox(hub, { w: 120, h: 52 });

    await run({}, hub);

    expect(frameEl().style.height).toBe('52px');
    expect(frameEl().style.width).toBe('120px');
  });

  // The rows follow the box, which is what makes a shorter frame a smaller strip rather than
  // a clipped one. The gaps come out of the box first: four rows in 60px is 13 each and not
  // 15, and the difference is the bottom row hanging out of a frame whose density clips.
  it('scales the rows down with the box', async () => {
    const hub = createFakeStorage();
    await savedBox(hub, { w: 120, h: 60 });

    await run({}, hub);

    expect(heightFor('swing')).toBe('13');
  });

  // The floor is the row height setting's own minimum, spread over every line the strip can
  // be asked to draw. Below it the lines stop shrinking, so the frame would clip them rather
  // than get smaller. Five lines and not four: the combo pips arrive mid-session, on a class
  // whose points cannot be known when the bounds are stated.
  it('holds it at what its lines need at their smallest', async () => {
    const hub = createFakeStorage();
    await savedBox(hub, { w: 120, h: 32 });

    await run({}, hub);

    expect(frameEl().style.height).toBe('48px');
  });

  // 42 is under the floor above and over the one a row fewer makes, so this is the
  // row count deciding it and nothing else.
  it('takes that floor down with a row the player switched off', async () => {
    const hub = createFakeStorage();
    await savedBox(hub, { w: 120, h: 42 });

    await run({ 'show-gcd': false }, hub);

    expect(frameEl().style.height).toBe('42px');
  });

  it('holds it at a width its rows can still be read at', async () => {
    const hub = createFakeStorage();
    await savedBox(hub, { w: 60, h: 40 });

    await run({}, hub);

    expect(frameEl().style.width).toBe('96px');
  });
});

// The tooltip is where the band is allowed to be a paragraph rather than a
// colour, and both of the addon's honest sentences live there.
describe('what a row says under the pointer', () => {
  function hover(key: string): string {
    rowFor(key)?.dispatchEvent(new Event('pointerenter'));
    return document.getElementById('woc-tooltip')?.textContent ?? '';
  }

  it('says the swing resets on the landing, not on the damage', async () => {
    await run();

    expect(hover('swing')).toContain('not when its damage arrives');
  });

  // The band is a measurement of a round trip. Nothing published says what the
  // server does with a press that arrives during a cast, so a row that implied a
  // press inside the band is safe would be this addon inventing a rule.
  it('calls the band what it is and refuses to promise anything with it', async () => {
    const h = await run();
    h.latency(120);
    h.self({ castingAbility: 'arcane_shot', castRemaining: 2, castTotal: 2 });
    h.frame();

    const said = hover('cast');

    expect(said).toContain('120ms round trip');
    expect(said).toContain('not a promise');
  });

  it('says when there is no measurement rather than drawing a guess', async () => {
    await run();

    expect(hover('cast')).toContain('No round trip measured yet');
  });
});

describe('its keybind', () => {
  it('takes the strip off screen and brings it back', async () => {
    const h = await run();
    const el = document.querySelector('[data-woc-frame="strip"]');

    h.press('Alt+KeyG');
    expect(el?.classList.contains('woc-hidden')).toBe(true);

    h.press('Alt+KeyG');
    expect(el?.classList.contains('woc-hidden')).toBe(false);
  });
});

describe('changing a setting under it', () => {
  // Another tab writing the value, which is how a setting actually changes: the
  // manager is a different surface and the storage change is what reaches a
  // running addon.
  it('rebuilds the rows the setting decides', async () => {
    const h = await run();
    expect(h.drawn()).toEqual(['swing', 'gcd', 'cast', 'power']);

    h.hub.remote(`config:${h.fqid}`, 'values', { 'show-swing': false });

    expect(h.drawn()).toEqual(['gcd', 'cast', 'power']);
  });

  it('leaves no orphan row behind when it rebuilds', async () => {
    const h = await run();
    h.self({ gcdRemaining: 1.5 });
    h.frame();

    h.hub.remote(`config:${h.fqid}`, 'values', { 'bar-height': 24 });
    h.frame();

    expect(h.drawn()).toEqual(['swing', 'gcd', 'cast', 'power']);
    expect(document.querySelectorAll('.woc-cadence-row')).toHaveLength(4);
  });
});

describe('disabling it', () => {
  // The frame handler is the loader's to unsubscribe, which is most of why the addon
  // is on the shared tick: the loop keeps scheduling itself for as long as anything
  // is subscribed, so a handler left behind is a browser callback running against
  // DOM that has already gone.
  it('leaves no frame, no keybind, and nothing on the shared loop', async () => {
    const h = await run();
    h.self({ swingTimer: 2 });
    h.frame();
    expect(h.frames.pending()).toBe(1);

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('[data-woc-frame="strip"]')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(h.frames.pending()).toBe(0);
    expect(() => h.frame()).not.toThrow();
  });
});
