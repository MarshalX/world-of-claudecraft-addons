// @vitest-environment happy-dom

// Foretell, run through the real loader.
//
// The claim this suite holds is the one the addon was written for: a mob casting raises no
// `castStart` event, so nothing an addon can subscribe to says a boss mechanic started. Every
// case below drives the world by setting cast state on an entity, which is where the game puts
// it, and never delivers an event of any kind.
//
// The second claim is the one every animated display shares: the subscription reports the set
// of casts changing and the bar's fill moves in a frame handler that reads the world again. So
// the cases that drain a cast advance a frame and poll nothing. That frame is the loader's one
// loop, stepped through `harness.frames`, so every drain case is also a case about the addon
// being on `woc.onFrame` rather than on a `requestAnimationFrame` of its own.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { perCharacterKey, uiNamespace } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the cooldown-bars suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
/** A caster that is nowhere near your spellbook: a boss with a scripted mechanic. */
const BOSS = 900;
const ADD = 901;
/** A hostile PLAYER, which is the one caster whose ability you might also know. */
const DUELIST = 902;
/** A friendly player standing next to you. */
const HEALER = 903;
/** A third hostile caster, for the case about a box with room for only two. */
const STRAGGLER = 904;

/** The storage namespace this addon's frame state is saved under. */
const FQID = 'official/foretell';
/** What tests/fakes/shared-services.ts says the player is called. */
const CHARACTER = 'Claudemoon/Marshal';

/** The box the loader owns and hands back through `FrameOpts.onMove`. */
interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The addon's own row pitch, which the list's whole height is made of.
 *
 * The pitch is a NAMED bar and the gap under it: 19 for the head line, 13 for the
 * caster underneath, 4 of padding and 3 of gap. happy-dom lays none of that out, so
 * this suite cannot check the figure against a rendered row and neither can any
 * other; what it can do is fail when the addon and this file stop agreeing on it.
 */
const ROW_PITCH = 39;
/** What the setting defaults to, and therefore how much room the list opens with. */
const DEFAULT_MAX_BARS = 5;

function listHeight(rows: number): number {
  return rows * ROW_PITCH;
}

/** The narrowest a row is still readable at, which is the addon's own width floor. */
const MIN_FRAME_WIDTH = 120;
/** A box saved narrower and shorter than the list has any business being. */
const CRAMPED: FrameBox = { x: 20, y: 20, w: 96, h: 20 };
/** Narrower than the list OPENS at, and wide enough to still be readable. */
const NARROW: FrameBox = { x: 20, y: 20, w: 160, h: listHeight(3) };
/** A box with room for exactly two bars. */
const TWO_ROWS: FrameBox = { x: 20, y: 20, w: 240, h: listHeight(2) };

type Fake = Record<string, unknown>;

/**
 * The player's spellbook, in the game's own shape. `arcane_shot` is displayed as "Fell Shot"
 * and its school is arcane, which is how a name and a tint are recovered at all.
 *
 * `glacial_front` is the game's own four-stage cone and `frostbolt` an ordinary cast, both
 * from `src/sim/content/classes.ts`. `empowerStages` sits on the DEF and is ABSENT on an
 * ordinary ability rather than 0.
 */
const SPELLBOOK = Object.freeze([
  {
    def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
    rank: 3,
    cost: 55,
    castTime: 2,
    cooldown: 5.4,
  },
  {
    def: {
      id: 'glacial_front',
      name: 'Glacial Front',
      school: 'frost',
      requiresTarget: false,
      empowerStages: 4,
    },
    rank: 1,
    cost: 80,
    castTime: 2.4,
    cooldown: 12,
  },
  {
    def: { id: 'frostbolt', name: 'Rimelance', school: 'frost', requiresTarget: true },
    rank: 4,
    cost: 30,
    castTime: 2.2,
    cooldown: 0,
  },
]);

/** `glacial_front`'s stage count, the divisor every boundary below sits on. */
const STAGES = 4;

interface CastSpec {
  ability: string;
  remaining: number;
  /** Defaults to `remaining`, which is a cast that has only just started. */
  total?: number;
  channeling?: boolean;
}

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

/**
 * Write a field on a live entity. A computed access, because the fixture is a
 * `Record<string, unknown>`: the linter wants dot access on a literal key and the compiler
 * forbids it on an index signature.
 */
function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

/** Cast state where the game puts it, which is on the entity and nowhere else. */
function writeCast(entity: Fake, spec: CastSpec): void {
  setField(entity, 'castingAbility', spec.ability);
  setField(entity, 'castRemaining', spec.remaining);
  setField(entity, 'castTotal', spec.total ?? spec.remaining);
  setField(entity, 'channeling', spec.channeling ?? false);
}

interface ForetellHarness extends SharedHarness {
  /** Your own entity, which sits in the roster like any other. */
  player: Fake;
  /** Put an entity in interest scope. Hostile mob unless told otherwise. */
  caster: (id: number, over?: Fake) => Fake;
  /** Start, replace, or move along a cast on one entity. */
  casts: (entity: Fake, spec: CastSpec) => void;
  /** The cast finishes or is interrupted: the entity simply stops carrying one. */
  stops: (entity: Fake) => void;
  /** Re-read the world, which is what turns a set change into a handler call. */
  poll: () => void;
  /** Run the loader's one frame loop once, which is what the addon draws on. */
  frame: () => void;
  /** The caster ids with a bar up, in the order they are drawn. */
  drawn: () => number[];
  /** One bar's fill width, as the style string the addon wrote. */
  fillOf: (id: number) => string;
  /** One bar's countdown figure. */
  leftOf: (id: number) => string;
  /** One bar's head line, which is the ability. */
  labelOf: (id: number) => string;
  /** One bar's second line, which is the caster. */
  detailOf: (id: number) => string;
  /** One bar's icon URL, or '' when the slot is empty. */
  iconOf: (id: number) => string;
  /** Every class on one bar, so a tone or a school can be read off it. */
  classesOf: (id: number) => string[];
}

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

function barFor(id: number): HTMLElement | null {
  return document.querySelector(`[data-caster="${String(id)}"]`);
}

function textIn(id: number, selector: string): string {
  return barFor(id)?.querySelector(selector)?.textContent ?? '';
}

/** Hover something and read the tooltip, which is empty when the kit declines one. */
function tipOn(el: Element | null): string {
  el?.dispatchEvent(new Event('pointerenter'));
  return document.getElementById('woc-tooltip')?.textContent ?? '';
}

/** Let the async frame restore land before reading what the display did. */
async function settleFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Start the addon over an empty world, with settings already stored. Seeded before the body is
 * evaluated, because the layout decides whether there is a frame at all and the addon reads
 * that on its first line.
 *
 * A saved frame box is seeded the same way, and it is how every case about the size of the list
 * is driven: the restore takes the same path a drag does, clamped against the same bounds and
 * reported through the same callback.
 */
async function start(
  settings: Record<string, unknown> = {},
  frames: Record<string, { box: FrameBox; visible: boolean }> = {},
  known: readonly unknown[] = SPELLBOOK,
): Promise<ForetellHarness> {
  const storage = createFakeStorage();
  await Promise.all(
    Object.entries(frames).map(([frameId, state]) =>
      storage.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, frameId), state),
    ),
  );
  const player = liveEntity({ set: { templateId: 'hunter' } });
  const entities = new Map<number, Fake>([[PLAYER_ID, player]]);
  const world = { entities, player, known };
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
    player,
    caster: (id, over = {}) => {
      const entity = liveEntity({
        set: {
          id,
          name: `Caster${String(id)}`,
          kind: 'mob',
          templateId: 'boss_wolf',
          hostile: true,
          ...over,
        },
      });
      entities.set(id, entity);
      return entity;
    },
    casts: (entity, spec) => writeCast(entity, spec),
    stops: (entity) => {
      setField(entity, 'castingAbility', null);
      setField(entity, 'castRemaining', 0);
      setField(entity, 'castTotal', 0);
    },
    poll: () => harness.shared.world.watcher.poll(),
    frame: () => harness.frames.tick(),
    // Read off the attribute rather than the dataset, which is an index signature.
    drawn: () =>
      [...document.querySelectorAll('[data-caster]')].map((el) =>
        Number(el.getAttribute('data-caster')),
      ),
    fillOf: (id) => barFor(id)?.querySelector<HTMLElement>('.woc-bar-fill')?.style.width ?? '',
    leftOf: (id) => textIn(id, '.woc-bar-value'),
    labelOf: (id) => textIn(id, '.woc-bar-label'),
    detailOf: (id) => textIn(id, '.woc-bar-detail'),
    iconOf: (id) => barFor(id)?.querySelector('.woc-bar-icon')?.getAttribute('src') ?? '',
    classesOf: (id) => [...(barFor(id)?.classList ?? [])],
  };
}

/**
 * `start`, plus the wait for the panel to come up. A frame that saves its state starts hidden
 * and is shown once that state arrives, keyed per character, so it takes a watcher sample and a
 * storage read. A hidden display draws nothing at all, deliberately.
 */
async function run(
  settings: Record<string, unknown> = {},
  frames: Record<string, { box: FrameBox; visible: boolean }> = {},
  known: readonly unknown[] = SPELLBOOK,
): Promise<ForetellHarness> {
  const harness = await start(settings, frames, known);
  harness.poll();
  await settleFrames();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // The point of the addon, stated as a permission: it reads the world, never the socket. An
  // addon asking for `net.read` here would be asking for the surface that cannot answer the
  // question.
  it('asks for no network permission', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'keys']);
  });
});

// `net.onEvent('castStart')` fires for a player's cast, a pet's cast and the timed activities
// the game runs through the same cast machinery. A mob's mechanic sets its cast state directly
// on the entity and announces nothing, so a boss mod built on the event is silent for every mob
// in the game. Nothing here delivers an event; the world is driven exactly the way the game
// drives it.
describe('a boss with a scripted cast', () => {
  it('shows a bar, with no cast event anywhere', async () => {
    const h = await run();
    const boss = h.caster(BOSS, { name: 'Emberlord' });

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
    expect(h.labelOf(BOSS)).toBe('Flame Pillar?');
    expect(h.detailOf(BOSS)).toBe('Emberlord');
  });

  it('drops the bar when the cast finishes', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    h.stops(boss);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  // A boss that finishes one mechanic and immediately starts another keeps its row, and the row
  // has to follow: the entity id alone has not changed, so a display that named the bar once
  // would keep announcing the mechanic that already landed.
  it('renames the bar when the same caster starts something else', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    h.casts(boss, { ability: 'shadow_bolt', remaining: 3 });
    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
    expect(h.labelOf(BOSS)).toBe('Shadow Bolt?');
  });
});

describe('which casts are drawn', () => {
  it('starts with none', async () => {
    const h = await run();

    expect(h.drawn()).toEqual([]);
  });

  // Soonest to land first, which is the order the next decision is made in.
  it('puts the cast about to land at the top', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);

    h.casts(boss, { ability: 'flame_pillar', remaining: 6 });
    h.casts(add, { ability: 'shadow_bolt', remaining: 2 });
    h.poll();

    expect(h.drawn()).toEqual([ADD, BOSS]);
  });

  // Your own bar is the game's to draw, under the crosshair. Friendly casts are switched on
  // here on purpose: you are a friendly entity, so with the default filter this would pass
  // without anything having excluded you.
  it('leaves your own cast to the game', async () => {
    const h = await run({ friendly: true });

    h.casts(h.player, { ability: 'arcane_shot', remaining: 2 });
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('shows no more bars than asked for', async () => {
    const h = await run({ 'max-bars': 1 });
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);

    h.casts(boss, { ability: 'flame_pillar', remaining: 6 });
    h.casts(add, { ability: 'shadow_bolt', remaining: 2 });
    h.poll();

    expect(h.drawn()).toEqual([ADD]);
  });
});

// Friendly casts, channels and short casts: three filters, all of them off by
// default in the direction that keeps the display about the fight.
describe('the filters', () => {
  it('ignores a friendly caster by default', async () => {
    const h = await run();
    const healer = h.caster(HEALER, { kind: 'player', hostile: false });

    h.casts(healer, { ability: 'mending_word', remaining: 3 });
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('draws one when the player asks for friendly casts', async () => {
    const h = await run({ friendly: true });
    const healer = h.caster(HEALER, { kind: 'player', hostile: false });

    h.casts(healer, { ability: 'mending_word', remaining: 3 });
    h.poll();

    expect(h.drawn()).toEqual([HEALER]);
  });

  // A cast id is sometimes an ACTIVITY sentinel rather than an ability: the game runs
  // gathering, fishing and the crafting family through the same cast machinery, and the set
  // grows with the game. A nearby crafter therefore gets a bar, title-cased and marked as
  // worked out, which is what the unit is actually doing. The case is here to fail if anyone
  // adds an exclusion list of sentinels, since such a list is stale the day the game adds one.
  it('draws an activity cast rather than treating it as a non-cast', async () => {
    const h = await run({ friendly: true });
    const crafter = h.caster(HEALER, {
      kind: 'player',
      hostile: false,
      templateId: 'hunter',
      name: 'Tinker',
    });

    h.casts(crafter, { ability: 'crafting', remaining: 3 });
    h.poll();

    expect(h.drawn()).toEqual([HEALER]);
    expect(h.labelOf(HEALER)).toBe('Crafting?');
  });

  it('draws a channel by default', async () => {
    const h = await run();
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'drain_life', remaining: 5, channeling: true });
    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });

  it('drops channels when the player switches them off', async () => {
    const h = await run({ channels: false });
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'drain_life', remaining: 5, channeling: true });
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('hides a cast shorter than the length the player set', async () => {
    const h = await run({ 'min-cast': 3 });
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'quick_jab', remaining: 1.5 });
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  // The trap in that filter. It is measured against the cast's total, because a long cast is
  // nearly over exactly when it matters most: filtering on what is left would take the bar away
  // in its final second.
  it('keeps a long cast up once it is nearly done', async () => {
    const h = await run({ 'min-cast': 3 });
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 6, total: 6 });
    h.poll();

    h.casts(boss, { ability: 'flame_pillar', remaining: 0.5, total: 6 });
    h.frame();

    expect(h.drawn()).toEqual([BOSS]);
    expect(h.leftOf(BOSS)).toBe('0.5s');
  });
});

// The drain, which is the half a subscription cannot do. `world.on('casts')` reports a cast
// starting, ending or being replaced and says nothing as the bar moves, so every case here
// changes the remaining time and advances a frame.
describe('the bar itself', () => {
  it('starts full', async () => {
    const h = await run();
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'flame_pillar', remaining: 4, total: 4 });
    h.poll();

    expect(h.fillOf(BOSS)).toBe('100.00%');
  });

  it('follows the cast down without another set change', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4, total: 4 });
    h.poll();

    h.casts(boss, { ability: 'flame_pillar', remaining: 2, total: 4 });
    h.frame();

    expect(h.fillOf(BOSS)).toBe('50.00%');
    expect(h.leftOf(BOSS)).toBe('2.0s');
  });

  // The last second is the one worth interrupting in, and the tone says so. It is
  // spent only there because tone WINS over the school colour in the kit.
  it('goes loud as the cast lands', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4, total: 4 });
    h.poll();
    expect(h.classesOf(BOSS)).toContain('woc-bar-default');

    h.casts(boss, { ability: 'flame_pillar', remaining: 0.6, total: 4 });
    h.frame();

    expect(h.classesOf(BOSS)).toContain('woc-bar-danger');
  });
});

// `EntityCast.ability` is an id, unlike the display name a damage record carries.
// `world.abilities` bridges the two for your own kit and for nothing else, so a mob mechanic
// falls back to a title-cased id.
describe('what a bar is called', () => {
  it('calls a known ability what the game calls it', async () => {
    const h = await run();
    const duelist = h.caster(DUELIST, { kind: 'player', templateId: 'hunter' });

    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });
    h.poll();

    expect(h.labelOf(DUELIST)).toBe('Fell Shot');
  });

  it('falls back to the id for an ability no spellbook carries', async () => {
    const h = await run();
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(h.labelOf(BOSS)).toBe('Flame Pillar?');
  });

  // Skill art is filed under a CLASS, and `templateId` is the class only on a player.
  // A mob's templateId is its mob template, so asking for art under it would be a
  // request per row for a file that cannot exist.
  it('draws art for a player caster and none for a mob', async () => {
    const h = await run();
    const duelist = h.caster(DUELIST, { kind: 'player', templateId: 'hunter' });
    const boss = h.caster(BOSS);

    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(h.iconOf(DUELIST)).toBe('/ui/skills/hunter/arcane_shot.webp');
    expect(h.iconOf(BOSS)).toBe('');
  });
});

// An `EntityCast` carries no school at all. The only place to recover one is your own
// spellbook, so a cast you also know is tinted and a boss mechanic is not. Guessing would put
// the game's own colour for a damage type on a row nothing said that about.
describe('the school tint', () => {
  it('tints a cast your own spellbook knows', async () => {
    const h = await run();
    const duelist = h.caster(DUELIST, { kind: 'player', templateId: 'hunter' });

    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });
    h.poll();

    expect(h.classesOf(DUELIST)).toContain('woc-bar-school-arcane');
  });

  it('leaves a mob mechanic untinted rather than guessing', async () => {
    const h = await run();
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(h.classesOf(BOSS).some((name) => name.startsWith('woc-bar-school-'))).toBe(false);
  });
});

// A charged cast's stage is on no wire, so every case drives it by moving `castRemaining`
// alone; the count comes off the spellbook.
describe('a charged cast', () => {
  /** A hostile mage: the game's empowered abilities are a mage's. */
  function aMage(h: ForetellHarness): Fake {
    return h.caster(DUELIST, { kind: 'player', templateId: 'mage', name: 'Ilvane' });
  }

  it('counts the stage on the head line, beside the name', async () => {
    const h = await run();
    const mage = aMage(h);

    h.casts(mage, { ability: 'glacial_front', remaining: 2.4, total: 2.4 });
    h.poll();

    expect(h.labelOf(DUELIST)).toBe(`Glacial Front 1/${String(STAGES)}`);
  });

  // The stage is live, so it cannot ride the ability-change guard; nothing polls, since only
  // the clock inside one cast moved.
  it('advances the stage on a frame, with no set change', async () => {
    const h = await run();
    const mage = aMage(h);
    h.casts(mage, { ability: 'glacial_front', remaining: 4, total: 4 });
    h.poll();
    expect(h.labelOf(DUELIST)).toBe('Glacial Front 1/4');

    h.casts(mage, { ability: 'glacial_front', remaining: 2, total: 4 });
    h.frame();

    expect(h.labelOf(DUELIST)).toBe('Glacial Front 3/4');
  });

  // A stage is the INTERVAL after its boundary: one hundredth short of a quarter is still
  // below and exactly on it has moved up. Rounding, or dropping the `+ 1`, agrees with the
  // game everywhere except here.
  it.each([
    [4, 1],
    [3.01, 1],
    [3, 2],
    [2.01, 2],
    [2, 3],
    [1.01, 3],
    [1, 4],
    [0.01, 4],
    [0, 4],
  ])('is at stage %2$s of four with %1$s seconds left', async (remaining, stage) => {
    const h = await run();
    const mage = aMage(h);
    h.casts(mage, { ability: 'glacial_front', remaining: 4, total: 4 });
    h.poll();

    h.casts(mage, { ability: 'glacial_front', remaining, total: 4 });
    h.frame();

    expect(h.labelOf(DUELIST)).toBe(`Glacial Front ${String(stage)}/4`);
  });

  // The game reads a cast with no length as fully charged; a NaN would reach a style
  // property and drop silently.
  it('reads a cast with no total as fully charged rather than dividing by zero', async () => {
    const h = await run();
    const mage = aMage(h);

    h.casts(mage, { ability: 'glacial_front', remaining: 0, total: 0 });
    h.poll();

    expect(h.labelOf(DUELIST)).toBe('Glacial Front 4/4');
    expect(h.labelOf(DUELIST)).not.toContain('NaN');
    expect(h.fillOf(DUELIST)).toMatch(/^[\d.]+%$/);
  });

  it('leaves an ordinary cast out of your own spellbook exactly as it was', async () => {
    const h = await run();
    const mage = aMage(h);

    h.casts(mage, { ability: 'frostbolt', remaining: 1.1, total: 2.2 });
    h.frame();
    h.poll();

    expect(h.labelOf(DUELIST)).toBe('Rimelance');
  });

  // The game's release path returns on a count at or under zero and its stage function
  // answers 1 for a count of one.
  it.each([0, 1])('draws no stage for an ability declaring %s of them', async (stages) => {
    const h = await run({}, {}, [
      {
        def: { id: 'frostbolt', name: 'Rimelance', school: 'frost', empowerStages: stages },
        rank: 1,
      },
    ]);
    const mage = aMage(h);

    h.casts(mage, { ability: 'frostbolt', remaining: 1.1, total: 2.2 });
    h.poll();

    expect(h.labelOf(DUELIST)).toBe('Rimelance');
  });

  it('drops the stage when the same caster starts an ordinary cast', async () => {
    const h = await run();
    const mage = aMage(h);
    h.casts(mage, { ability: 'glacial_front', remaining: 1, total: 4 });
    h.poll();
    expect(h.labelOf(DUELIST)).toBe('Glacial Front 4/4');

    h.casts(mage, { ability: 'frostbolt', remaining: 2.2, total: 2.2 });
    h.poll();

    expect(h.labelOf(DUELIST)).toBe('Rimelance');
  });

  // The spellbook lookup that produced the name is the one that has to produce the count, or
  // every change writes the line twice, once wrong.
  it('writes the head line once when the caster switches to a charged ability', async () => {
    const h = await run();
    const mage = aMage(h);
    h.casts(mage, { ability: 'frostbolt', remaining: 2.2, total: 2.2 });
    h.poll();
    const label = barFor(DUELIST)?.querySelector('.woc-bar-label') as HTMLElement;
    const observer = new MutationObserver(() => undefined);
    observer.observe(label, { childList: true, characterData: true, subtree: true });

    h.casts(mage, { ability: 'glacial_front', remaining: 3, total: 4 });
    h.poll();

    // Every string the head line passed through: the intermediate VALUE is what would be
    // wrong, not the record count.
    const written = observer
      .takeRecords()
      .flatMap((record) => [...record.addedNodes].map((node) => node.textContent));
    expect(label.textContent).toBe('Glacial Front 2/4');
    expect(written).toEqual(['Glacial Front 2/4']);
    observer.disconnect();
  });

  it('says on the row what the two figures mean', async () => {
    const h = await run();
    const mage = aMage(h);

    h.casts(mage, { ability: 'glacial_front', remaining: 2, total: 4 });
    h.poll();

    const tip = tipOn(barFor(DUELIST));
    expect(tip).toContain('stage 3 of 4');
    expect(tip).toContain('latest this can land');
  });
});

// `AbilityInfo` is YOUR OWN spellbook, so the stage count is reachable only for an ability
// you know, and nothing on the wire says a cast is being charged at all.
describe('a charged cast you have no spellbook for', () => {
  it('draws as an ordinary cast rather than inventing a stage', async () => {
    // An empty spellbook is every class but the caster's.
    const h = await run({}, {}, []);
    const boss = h.caster(BOSS, { name: 'Emberlord' });

    h.casts(boss, { ability: 'glacial_front', remaining: 2, total: 4 });
    h.poll();

    expect(h.labelOf(BOSS)).toBe('Glacial Front?');
    expect(h.labelOf(BOSS)).not.toContain('/');
  });

  it('shows no stage figure of any kind', async () => {
    const h = await run({}, {}, []);
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'glacial_front', remaining: 2, total: 4 });
    h.poll();

    h.casts(boss, { ability: 'glacial_front', remaining: 1, total: 4 });
    h.frame();

    expect(h.labelOf(BOSS)).toBe('Glacial Front?');
    expect(h.leftOf(BOSS)).toBe('1.0s');
  });

  it('says on the guessed row that a stage is missing for the same reason the name is', async () => {
    const h = await run({}, {}, []);
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'glacial_front', remaining: 2, total: 4 });
    h.poll();

    expect(tipOn(barFor(BOSS))).toContain('charge stage');
  });
});

// Saying the limit on screen, which is the half a comment in this file cannot do.
//
// A worked-out name and an untinted fill are the normal case here rather than a failure, so a
// player who is not told reads a plain uncoloured bar carrying a name the game does not use as
// a display that is broken. The hedge is on the row that earned it: a question mark, which
// travels with the bar into a layout that has no panel to put a footnote under and no pointer
// events to hover.
describe('what the display admits to', () => {
  it("marks a name it had to work out and leaves the game's own alone", async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    const duelist = h.caster(DUELIST, { kind: 'player', templateId: 'hunter' });

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });
    h.poll();

    expect(h.labelOf(BOSS)).toBe('Flame Pillar?');
    expect(h.labelOf(DUELIST)).toBe('Fell Shot');
  });

  // The layout that can say the least is the one the mark matters most in, since
  // there is nothing to hover there and no room for anything under the rows.
  it('carries the mark into the anchored layout', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(h.labelOf(BOSS)).toBe('Flame Pillar?');
  });

  it('tells a guessed row which id it was worked out from', async () => {
    const h = await run();
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(tipOn(barFor(BOSS))).toContain('flame_pillar');
  });

  // A name that came out of your own spellbook is the game's own and needs no
  // defending, so hovering it says nothing at all rather than repeating the caveat.
  it('says nothing about a name your spellbook supplied', async () => {
    const h = await run();
    const duelist = h.caster(DUELIST, { kind: 'player', templateId: 'hunter' });

    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });
    h.poll();

    expect(tipOn(barFor(DUELIST))).toBe('');
  });
});

// Rows are re-ordered, not re-appended. `appendChild` on an element already in the document
// moves it, which is a removal and an insertion, and the browser drops an element's hover state
// on the removal.
describe('how rows are placed', () => {
  it('leaves a row alone when its position has not changed', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);
    h.casts(boss, { ability: 'flame_pillar', remaining: 6, total: 6 });
    h.casts(add, { ability: 'shadow_bolt', remaining: 2, total: 2 });
    h.poll();
    const first = barFor(ADD);
    const list = document.querySelector('.woc-ft-list') as HTMLElement;
    const observer = new MutationObserver(() => undefined);
    observer.observe(list, { childList: true });

    h.frame();
    h.frame();

    expect(observer.takeRecords()).toEqual([]);
    expect(barFor(ADD)).toBe(first);
    observer.disconnect();
  });

  it('still reorders when a nearer cast starts', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);
    h.casts(boss, { ability: 'flame_pillar', remaining: 2, total: 6 });
    h.poll();
    expect(h.drawn()).toEqual([BOSS]);

    h.casts(add, { ability: 'shadow_bolt', remaining: 1, total: 1 });
    h.poll();

    expect(h.drawn()).toEqual([ADD, BOSS]);
  });
});

// The other layout: the same bar, floating over whoever is casting it.
//
// There is no frame in this mode, so there is nothing to look in: the bars are
// anchors the loader positions from a world point every frame.
describe('the anchored layout', () => {
  function anchors(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('.woc-ft-anchor')];
  }

  /** Where one caster is on screen, in the shape `ui.project` answers in. */
  interface Spot {
    x: number;
    y: number;
    depth: number;
  }

  /**
   * Put the casters somewhere on screen, which the shared fake cannot do.
   *
   * `tests/fakes/shared-services.ts` answers one constant screen point for every world point
   * and resolves no unit at all, because it has no renderer behind it, so the declutter has
   * nothing to work on there. Both halves are ordinary fields on the kit that `ui.project`
   * reads per call.
   *
   * The unit point carries the entity id in its x and nothing else, and the projector reads it
   * back out, so one map answers both halves and cannot disagree with itself. Only `ui.project`
   * is affected: the anchors were built over the fake's own projector and stay where that puts
   * them, which is the right scope, since what is under test is the arithmetic this addon does
   * with an answer.
   */
  function placeCasters(h: ForetellHarness, spots: Map<number, Spot>): void {
    const kit = h.shared.kit as unknown as {
      unitPoint: (at: { unit: number }) => { x: number; y: number; z: number } | null;
      project: (x: number, y: number, z: number) => (Spot & { behind: boolean }) | null;
    };
    kit.unitPoint = (at) => {
      if (!spots.has(at.unit)) {
        return null;
      }
      return { x: at.unit, y: 0, z: 0 };
    };
    kit.project = (x) => {
      const spot = spots.get(x);
      if (spot === undefined) {
        return null;
      }
      return { ...spot, behind: false };
    };
  }

  it('floats a bar over each caster instead of listing them', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(anchors()).toHaveLength(1);
    expect(anchors()[0]?.contains(barFor(BOSS))).toBe(true);
    expect(document.querySelector('[data-woc-frame="casts"]')).toBeNull();
  });

  // The bar is already over the caster, so repeating the name underneath it would be
  // a second line saying what the player is looking at.
  it('drops the caster name from a bar that is already over them', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS, { name: 'Emberlord' });

    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    expect(h.labelOf(BOSS)).toBe('Flame Pillar?');
    expect(h.detailOf(BOSS)).toBe('');
  });

  // The head point is the loader's, off the renderer's own view of that model, and the case
  // worth pinning is the one where there is no view: past the game's draw range, or in a suite
  // with no renderer. No view is no point, so there is no bar, which is where the game draws no
  // nameplate either. A fixed offset above `entity.pos` answers here with a bar floating over a
  // unit nothing is drawing.
  it('draws no bar over a unit the game is drawing no model for', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    h.frame();

    expect(anchors()[0]?.classList.contains('woc-anchor3d-off')).toBe(true);
  });

  // The declutter reads `ui.project`, and a point it cannot answer for is a bar the loader has
  // already hidden. Nothing is moved and nothing is dropped: this addon exists to show casts
  // nothing else announces, so tidying the screen by taking one away would throw away the thing
  // it is for.
  it('leaves every bar alone while no cast has a place on screen', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);
    h.casts(boss, { ability: 'flame_pillar', remaining: 6 });
    h.casts(add, { ability: 'shadow_bolt', remaining: 2 });
    h.poll();

    h.frame();

    expect(h.drawn()).toEqual([ADD, BOSS]);
    expect(barFor(BOSS)?.style.transform).toBe('');
    expect(barFor(ADD)?.style.transform).toBe('');
  });

  // The declutter, which is what `ui.project` and its depth are for. Two casters standing
  // together put two bars in one place, and the nearer of them keeps its place. The farther bar
  // moves up and takes its caster's name back, because a bar that is no longer over anybody
  // must stop claiming to be positional.
  it('lifts a bar off the nearer one it would have landed on', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);
    placeCasters(
      h,
      new Map([
        [BOSS, { x: 400, y: 300, depth: 30 }],
        [ADD, { x: 410, y: 302, depth: 10 }],
      ]),
    );
    h.casts(boss, { ability: 'flame_pillar', remaining: 6 });
    h.casts(add, { ability: 'shadow_bolt', remaining: 2 });
    h.poll();

    h.frame();

    expect(barFor(ADD)?.style.transform).toBe('');
    expect(h.detailOf(ADD)).toBe('');
    expect(barFor(BOSS)?.style.transform).toBe('translateY(-39px)');
    expect(h.detailOf(BOSS)).toBe('Caster900');
  });

  it('leaves two casters standing apart where they are', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);
    placeCasters(
      h,
      new Map([
        [BOSS, { x: 200, y: 300, depth: 30 }],
        [ADD, { x: 600, y: 300, depth: 10 }],
      ]),
    );
    h.casts(boss, { ability: 'flame_pillar', remaining: 6 });
    h.casts(add, { ability: 'shadow_bolt', remaining: 2 });
    h.poll();

    h.frame();

    expect(barFor(BOSS)?.style.transform).toBe('');
    expect(barFor(ADD)?.style.transform).toBe('');
    expect(h.detailOf(BOSS)).toBe('');
  });

  // A bar that was lifted and then has the place to itself goes back down, and drops
  // the name again with it: a stale lift would leave it hanging over nothing.
  it('puts a lifted bar back once the caster it cleared has stopped', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    const add = h.caster(ADD);
    placeCasters(
      h,
      new Map([
        [BOSS, { x: 400, y: 300, depth: 30 }],
        [ADD, { x: 410, y: 302, depth: 10 }],
      ]),
    );
    h.casts(boss, { ability: 'flame_pillar', remaining: 6 });
    h.casts(add, { ability: 'shadow_bolt', remaining: 2 });
    h.poll();
    h.frame();
    expect(barFor(BOSS)?.style.transform).toBe('translateY(-39px)');

    h.stops(add);
    h.poll();
    h.frame();

    expect(barFor(BOSS)?.style.transform).toBe('');
    expect(h.detailOf(BOSS)).toBe('');
  });

  it('takes the anchor away with the cast', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    h.stops(boss);
    h.poll();

    expect(anchors()).toEqual([]);
  });

  // A layout change cannot be repainted into: an anchored bar lives in an element the
  // loader positions and a listed one lives in the column.
  it('rebuilds every bar when the layout changes under it', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();
    expect(anchors()).toEqual([]);

    h.hub.remote('config:official/foretell', 'values', { layout: 'anchors' });
    h.frame();

    expect(anchors()).toHaveLength(1);
    expect(h.drawn()).toEqual([BOSS]);
  });
});

// The idle state, which is most of a session.
//
// Something is casting for a few seconds at a time and nothing is casting the rest of the
// time, so whatever this display looks like empty is what it looks like mostly. At any chromed
// density that is a small titled box parked on the HUD saying nothing. The rows are the
// display, so the frame carries no chrome at all.
//
// happy-dom lays nothing out, so none of this can be asserted in pixels. What it can assert is
// that there is nothing there to have any: no panel, no title bar, no close button, and a body
// with nothing in it.
//
// The frame does hold a box while idle, which is the price of being resizable: a resizable
// frame is one the loader paints a width and a height onto, so the room it reserves is there
// whether or not anything is drawn in it. Nothing is visible in that room.
describe('while nothing is casting', () => {
  function frameEl(): HTMLElement | null {
    return document.querySelector('[data-woc-frame="casts"]');
  }

  it('draws no panel, no title bar and no close button', async () => {
    await run();

    expect(frameEl()?.classList.contains('woc-density-bare')).toBe(true);
    // `panel` is the GAME's class and brings its border and background with it.
    expect(frameEl()?.classList.contains('panel')).toBe(false);
    expect(frameEl()?.querySelector('.woc-titlebar')).toBeNull();
    expect(frameEl()?.querySelector('.woc-close')).toBeNull();
  });

  it('leaves nothing inside it either', async () => {
    const h = await run();

    expect(h.drawn()).toEqual([]);
    expect(document.querySelectorAll('.woc-ft-list > *')).toHaveLength(0);
  });

  // The chrome goes and the name stays. It is the frame's accessible name and the row in the
  // rail menu a player clicks to get the display back, and with no title bar and no close
  // button those are the only two ways to it.
  it('is still called Casts', async () => {
    const h = await run();

    expect(frameEl()?.getAttribute('aria-label')).toBe('Casts');
    expect(h.shared.kit.roster.entries().map((entry) => entry.title)).toEqual(['Casts']);
  });
});

// Resizing the list, and the two halves of that which only work together.
//
// A bare frame with no `resizable` has no handles at all. Handles alone are the other half of
// the same bug, because the loader's bare body clips rather than scrolls: a frame with no floor
// takes the size it opened at as its minimum, and any box under what the display draws cuts a
// bar in half rather than offering a scrollbar.
//
// Driven by the saved box, because that is the same path a drag takes: the restore lands
// asynchronously, is clamped against the same bounds, and reports through the same callback.
describe('the size of the list', () => {
  function frameEl(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-woc-frame="casts"]');
  }

  // Room for the row budget the player set, so the space reserved out of the box is
  // the space the display will actually use. A frame with no stated height opens at
  // the kit's own fallback, which is neither.
  it('opens at room for the bars the settings ask for', async () => {
    await run();

    expect(frameEl()?.style.height).toBe(`${listHeight(DEFAULT_MAX_BARS)}px`);
  });

  it('holds the list at one bar and a readable row when a saved box is under both', async () => {
    await run({}, { casts: { box: CRAMPED, visible: true } });

    expect(frameEl()?.style.height).toBe(`${listHeight(1)}px`);
    expect(frameEl()?.style.width).toBe(`${MIN_FRAME_WIDTH}px`);
  });

  // The floor is what a row needs to be READ, not the width the list opened at: a
  // player watching one mechanic should be able to take the drag area back down to
  // what the display actually draws.
  it('lets the list be dragged narrower than it opened', async () => {
    await run({}, { casts: { box: NARROW, visible: true } });

    expect(frameEl()?.style.width).toBe(`${NARROW.w}px`);
  });

  // A shorter box gives up bars rather than clipping them, and the order is what makes
  // that safe: rows are sorted soonest-to-land first, so what goes is always the cast
  // with the most time left on it.
  it('draws only the bars the box has room for, dropping the furthest off', async () => {
    const h = await run({}, { casts: { box: TWO_ROWS, visible: true } });
    for (const [at, id] of [BOSS, ADD, STRAGGLER].entries()) {
      h.casts(h.caster(id), { ability: 'flame_pillar', remaining: at + 1 });
    }
    h.poll();

    expect(h.drawn()).toEqual([BOSS, ADD]);
  });
});

describe('the toggle', () => {
  it('hides the panel', async () => {
    const h = await run();
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    h.press('Alt+KeyF');

    expect(document.querySelector('[data-woc-frame="casts"]')?.classList).toContain('woc-hidden');
  });

  // The anchored layout has no frame to hide, so the bars themselves have to go:
  // nothing else would take an element the loader is holding over the world.
  it('takes the anchored bars out of the world', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();
    expect(document.querySelectorAll('.woc-ft-anchor')).toHaveLength(1);

    h.press('Alt+KeyF');
    h.frame();

    expect(document.querySelectorAll('.woc-ft-anchor')).toHaveLength(0);
  });
});

describe('disabling it', () => {
  // The frame handler is the loader's, so leaving one behind is not this addon burning a
  // callback of its own: it is a handler the shared loop goes on calling against a world its
  // addon has stopped reading, and it keeps the loop awake for every other addon too.
  // `pending()` is one while the loop is live and zero once nothing is on it.
  it('leaves no bar, no anchor, no keybind and nothing on the frame loop', async () => {
    const h = await run({ layout: 'anchors' });
    const boss = h.caster(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 4 });
    h.poll();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('.woc-ft-anchor')).toHaveLength(0);
    expect(document.querySelectorAll('.woc-bar')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(h.frames.pending()).toBe(0);
    expect(() => h.frame()).not.toThrow();
  });
});
