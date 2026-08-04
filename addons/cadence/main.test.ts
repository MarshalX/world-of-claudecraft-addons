// @vitest-environment happy-dom

// Cadence, run through the real loader.
//
// The claim worth pinning is the one the addon exists for: the swing bar resets
// the moment the game re-arms the timer, which is when the swing LANDED, and not
// when the damage event describing that swing turns up. Those are two different
// moments on the wire and the event is the later of them, so a display driven by
// it runs down to zero, sits there for a round trip and jumps. The suite drives
// both halves: a re-armed timer with no event at all, and an event with no
// re-arm.
//
// Everything else here is the same split the world API forces on any display that
// animates. Nothing in this addon is driven by a subscription except combat, so
// almost every case advances a frame rather than polling the watcher.

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
  /** One row's label. */
  labelOf: (key: string) => string;
  /** The latency band's width, or '' when it is not drawn. */
  bandWidth: () => string;
  /** The combo pips, true for filled. */
  pips: () => boolean[];
  strip: () => HTMLElement;
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
 * Whether something is really on screen.
 *
 * Both halves, because neither alone is enough on an element carrying an inline
 * display: `[hidden]` is a UA rule at the lowest priority there is, so an inline
 * `display: flex` beats it and the element stays visible.
 */
function shown(el: HTMLElement): boolean {
  return !el.hidden && el.style.display !== 'none';
}

/**
 * Let the async frame restore land before reading what the addon drew.
 *
 * A frame that saves its state starts hidden and is shown once the stored answer
 * arrives, keyed per character, so it takes a watcher sample to find the character
 * and a storage read to come back. The addon's own loop stands down while the
 * frame is hidden, so every case about what it DRAWS wants this to have happened.
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
  // A rogue: energy, combo points, and a weapon with a real swing speed. The
  // swing timer and the global cooldown ride the SELF record, so everything the
  // addon reads is written onto this one entity and nowhere else.
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
  const world = { entities, player, known };
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
    latency: (ms) => harness.netState({ latencyMs: ms }),
    poll: () => harness.shared.world.watcher.poll(),
    // The loader's own loop, stepped by hand. The addon is on `woc.onFrame`, so
    // there is no timer of its own to advance: nothing it draws happens until the
    // shared tick runs, which is the arrangement this is here to exercise.
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

  // `woc.onFrame` is a minor-2 member and the strip is drawn from it, so a
  // manifest still declaring 1 would be refused by a loader that implements
  // exactly what this addon asks for.
  it('declares the minor its frame loop needs', () => {
    expect(parseManifest(MANIFEST_TEXT).apiMinor).toBe(2);
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

// The subject of the addon.
//
// Nothing publishes how long a swing takes. What is readable is how much is LEFT,
// so the row learns its length from the reset, and the reset is the swing landing.
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

  // The "done when". The game re-arms the timer on the snapshot that resolved the
  // swing; the damage event describing that same swing arrives afterwards. So the
  // bar is full the frame after the reset, with nothing having been published.
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

  // The other half, which is what a display built on the event would fail. The
  // damage lands while the timer is still running down, so the bar must ignore it
  // entirely and keep draining.
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

  // `weapon.speed` is the UNHASTED speed and the period the timer resets to is the
  // hasted one, which nothing publishes. So the seed is only what the first swing
  // is measured against, and the first observed reset replaces it. Without the
  // relearn a hasted rogue's bar would top out at three quarters and never fill.
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

  // The seed is off by the melee haste STAT and by nothing else. Every other term
  // of the game's own swing period is an ordinary published aura carrying a plain
  // multiplier, so a slowed player's first bar is measured against the slowed
  // period rather than against the weapon's own speed, which would be short by the
  // slow.
  it('seeds a slowed swing from the aura as well as the weapon', async () => {
    const h = await run();

    h.self({
      auras: [{ id: 'thunder_clap', kind: 'attackspeed', value: 1.5, remaining: 10 }],
      swingTimer: SWING_SPEED * 1.5 * 0.5,
    });
    h.frame();

    expect(h.fillOf('swing')).toBe('50.00%');
  });

  // The other half of the same rule, and the one the header used to give away: a
  // haste AURA is on the wire exactly as a slow is, so it belongs in the seed for
  // the same reason. Only the melee haste stat is unreadable. Without this the
  // first bar of a hasted swing is measured against the bare weapon speed and tops
  // out at two thirds.
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
  // independent adjustments: the slows MULTIPLY the period and the hastes divide
  // the result through one additive bucket.
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

// The row where the arithmetic exists, which is what separates it from the swing
// above it. Every term of the game's own formula is published, so the length is
// computed rather than learned and the bar is right on the FIRST press of a
// session. The cases below are one per term, because the version that is easy to
// guess gets three of them wrong at once.
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

  // A rogue's base is a third shorter than everyone else's, and it is the only
  // class the game singles out. Reading 1.5 for one is the mistake that put a
  // wrong denominator on every rogue's bar.
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

  // Haste from an aura is ADDED to the stat rather than already folded into it,
  // so an implementation reading the stat alone draws a bar that is long by
  // exactly whatever the player has running.
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

  // No amount of haste takes it under the floor. Without one, this player's
  // length would come out at half a second and the bar would read three quarters
  // full where it is half.
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

// The part the game's own cast bar does not draw.
//
// It is a MEASUREMENT of the round trip and never a claim about what the server
// does with a press that arrives during a cast. Nothing published says that, so
// the band is drawn from what was measured and the tooltip says as much.
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

  // The game's `ResourceType` is exactly these three. A hunter is on mana rather
  // than on a bar of its own, which is the case worth pinning: it is the class a
  // file writing this table from memory is most likely to give a fourth kind to.
  it('names each of the three kinds the game sends', async () => {
    const h = await run();

    for (const [kind, label] of [
      ['mana', 'Mana'],
      ['rage', 'Rage'],
      ['energy', 'Energy'],
    ]) {
      h.self({ templateId: 'hunter', resourceType: kind, resource: 60, maxResource: 100 });
      h.frame();

      expect(h.labelOf('power')).toBe(label);
    }
  });

  // `focus` in particular, because this addon shipped a label for it and the game
  // has never had one: no class is on focus, a hunter included, and the union has
  // no such member. So it is not a kind waiting to be labelled, it is the exact
  // shape of the mistake, and pinning it here is what fails if the entry returns.
  it('falls back for a kind the game does not send', async () => {
    const h = await run();

    h.self({ templateId: 'hunter', resourceType: 'focus', resource: 60, maxResource: 100 });
    h.frame();

    expect(h.labelOf('power')).toBe('Power');
  });

  it('draws a pip per combo point', async () => {
    const h = await run();

    h.self({ comboPoints: 3 });
    h.frame();

    expect(h.pips()).toEqual([true, true, true]);
  });

  // There is no maximum on the wire, exactly as there is none for a charge pool,
  // so the strip is as wide as the most points this session has actually shown.
  // Writing five in would be a claim about every class in the game.
  it('keeps the slots it has seen rather than claiming a maximum', async () => {
    const h = await run();
    h.self({ comboPoints: 4 });
    h.frame();

    h.self({ comboPoints: 1 });
    h.frame();

    expect(h.pips()).toEqual([true, false, false, false]);
  });

  // Found by looking at the stage rather than at this suite. The pips are a LINE
  // of their own and the frame's height was stated for the rows alone, so on the
  // one class that has them the strip stood taller than its own box; a bare frame
  // clips, and what it clipped was the pips. Every line divides the box now, so
  // the first point of a session takes the rows down to make room for itself.
  it('makes room for the pips out of the box the rows had', async () => {
    const h = await run();
    expect(rowFor('swing')?.style.height).toBe('14px');

    h.self({ comboPoints: 2 });
    h.frame();

    // Five lines and their four gaps inside the 62px the frame opened at.
    expect(rowFor('swing')?.style.height).toBe('10px');
    expect(shown(pipStrip())).toBe(true);
  });

  it('shows nothing for a class that has never had one', async () => {
    const h = await run();

    h.frame();

    expect(h.pips()).toEqual([]);
    expect(shown(pipStrip())).toBe(false);
  });
});

// The frame's own visibility is the player's and the loader persists it, so the
// setting hides the CONTENT instead. On a bare frame that is the same thing on
// screen, and it cannot argue with the restore of a frame the player had closed.
describe('hiding it out of combat', () => {
  it('draws nothing while nothing is fighting', async () => {
    const h = await run({ 'hide-out-of-combat': true });

    expect(shown(h.strip())).toBe(false);
  });

  // The half a suite is the only place to catch: the strip is an inline flex
  // line, so the attribute on its own leaves it on screen.
  it('hides it by the display as well as by the attribute', async () => {
    const h = await run({ 'hide-out-of-combat': true });

    expect(h.strip().hidden).toBe(true);
    expect(h.strip().style.display).toBe('none');
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

// Rows are placed once and never moved. An element removed and re-inserted loses
// the hover state the browser was tracking on it, with no leave event to say so,
// and doing that sixty times a second is how a tooltip ends up stranded.
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

// Reported from a live session: the strip could not be dragged smaller, and the
// height was the worse of the two axes.
//
// A frame's minimum size defaults to the size it OPENED at, so a strip that stated
// no bounds took the kit's own fallback (240 by 120) as its floor, and 120 is
// nearly twice what four 14px rows measure. Nothing about this addon's rows was
// involved in the number the player could not get under, which is why the fix is
// to state both bounds from the row-height setting rather than to nudge one.
//
// What is observable from a suite is the inline box the loader paints, which is
// where every bound has already been applied. The gestures themselves are not:
// interactjs does not move a box under happy-dom, which has no layout. So the
// smaller box arrives the way a player's own would across a login, out of the
// per-character frame state.
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

  // The rows follow the box, which is what makes a shorter frame a smaller strip
  // rather than a clipped one. The gaps between them come out of the box first:
  // four rows in 60px is 13 each and not 15, and the difference is the bottom row
  // hanging out of a frame whose density clips.
  it('scales the rows down with the box', async () => {
    const hub = createFakeStorage();
    await savedBox(hub, { w: 120, h: 60 });

    await run({}, hub);

    expect(rowFor('swing')?.style.height).toBe('13px');
  });

  // The floor is real rather than an accident of the first paint: it is the row
  // height setting's own minimum, spread over every line the strip can be asked
  // to draw. Below it the lines stop shrinking, so the frame would clip them
  // rather than get smaller. Five lines and not four: the combo pips are a line
  // that arrives mid-session, on a class whose points cannot be known when the
  // bounds are stated, and a floor that left them out would be one the pips can
  // be dragged out of sight under.
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
  // The frame handler is the loader's to unsubscribe now, which is most of why
  // the addon is on the shared tick: the loop keeps scheduling itself for as long
  // as anything is subscribed, so a handler left behind is a browser callback
  // running against DOM that has already gone.
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
