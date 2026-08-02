// @vitest-environment happy-dom

// Facemark, run through the real loader.
//
// The claims this suite exists to hold are the DECISIONS a nameplate display is made
// of, not the pixels. Which units get a plate, which of them survives the cap, what a
// name is called when nothing published it, which effects reach the strip, and who
// owns whether the plates are drawn at all. Where a plate ENDED UP is a live question
// and is not pretended to be one of these: no anchor here is ever painted on a real
// screen.
//
// Two things about the way the world is driven are load-bearing.
//
// NOTHING HERE DELIVERS AN EVENT. A cast is written onto the entity, which is where
// the game puts it; an effect is pushed onto the entity's own aura array; a mark is
// written into the world's marker record; threat is written into the mob's own hate
// table. That is the wire this addon reads, and a display built on events would pass
// none of it.
//
// THE CAMERA IS INSTALLED, because `tests/fakes/shared-services.ts` resolves no unit
// at all and answers one constant screen point for every world point, which is a
// camera nothing can be measured against. `unitPoint` and `project` are ordinary
// fields on the kit that `ui.project` reads per call, so a suite that needs real
// positions says what they are. The default one here answers for every entity in the
// fake world and puts depth at the unit's distance from the origin, which is what the
// fade cases move; `blind()` takes it away again, which is the "do not draw" case.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { addonNamespace } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the foretell suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const PLAYER_ID = PLAYER_ENTITY.id;
/** A hostile mob: the unit this addon is installed for. */
const BOSS = 900;
const ADD = 901;
/** A hostile PLAYER, the one caster whose ability you might also know. */
const DUELIST = 902;
/** A friendly player standing next to you. */
const HEALER = 903;
/** A mob that is not hostile, which is the whole of what "neutral" can mean. */
const CRITTER = 904;

/** The addon's own sampling cadence, which is what every slow reading moves on. */
const SLOW_MS = 100;
/** The addon's own account-wide key, holding whether the plates are drawn. */
const SHOWN_KEY = 'shown';
/** The chord the manifest binds the toggle to, in the manifest's own spelling. */
const TOGGLE = 'Alt+Shift+KeyF';
/** The manifest's own default, which every distance case is measured against. */
const DRAW_DISTANCE = 60;
const MAX_AURAS = 4;

/** The game's own hostile-name red and player blue, as the addon writes them. */
const HOSTILE_NAME = 'rgb(255 85 85)';
const FRIENDLY_NAME = 'rgb(127 184 255)';
const NEUTRAL_NAME = 'rgb(230 230 230)';
/** The game's own threat-plate red, drawn down the edge of a plate that is on you. */
const EDGE_TOP = 'rgb(192 57 43)';
const EDGE_CALM = 'rgb(120 160 255 / 60%)';
/** The colour the game files the star mark under. */
const STAR_COLOUR = 'rgb(255 226 58)';

type Fake = Record<string, unknown>;

/** A world point, in the shape a unit point resolver answers in. */
interface Place {
  x: number;
  y: number;
  z: number;
}

/** A screen position, in the shape `ui.project` answers in. */
interface Spot {
  x: number;
  y: number;
  depth: number;
}

interface AuraSpec {
  id?: string;
  name?: string;
  kind?: string;
  remaining?: number;
  duration?: number;
  value?: number;
  sourceId?: number;
  school?: string;
  stacks?: number;
}

interface CastSpec {
  ability: string;
  remaining: number;
  total?: number;
  channeling?: boolean;
}

interface UnitSpec {
  x?: number;
  z?: number;
  kind?: string;
  templateId?: string;
  hostile?: boolean;
  name?: string;
  level?: number;
  hp?: number;
  maxHp?: number;
  dead?: boolean;
  ghost?: boolean;
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

/** Write a field on a live entity, which is a `Record<string, unknown>`. */
function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

function readField(entity: Fake, field: string): unknown {
  return entity[field];
}

/** Cast state where the game puts it, which is on the entity and nowhere else. */
function writeCast(entity: Fake, spec: CastSpec): void {
  setField(entity, 'castingAbility', spec.ability);
  setField(entity, 'castRemaining', spec.remaining);
  setField(entity, 'castTotal', spec.total ?? spec.remaining);
  setField(entity, 'channeling', spec.channeling ?? false);
}

/** One effect in the shape the client decodes onto the entity. */
function auraOf(spec: AuraSpec): Record<string, unknown> {
  return {
    id: spec.id ?? 'flame_pillar',
    name: spec.name ?? 'Flame Pillar',
    kind: spec.kind ?? 'dot',
    remaining: spec.remaining ?? 6,
    duration: spec.duration ?? 12,
    value: spec.value ?? 40,
    sourceId: spec.sourceId ?? 0,
    school: spec.school ?? 'fire',
    stacks: spec.stacks,
  };
}

interface FacemarkHarness extends SharedHarness {
  /** Put a unit in interest scope. A hostile mob unless told otherwise. */
  unit: (id: number, spec?: UnitSpec) => Fake;
  /** Take a unit out of scope, which is what walking away does. */
  gone: (id: number) => void;
  /** Give a unit an effect, on its own aura array. */
  afflict: (entity: Fake, spec?: AuraSpec) => void;
  /** Start or move along a cast. */
  casts: (entity: Fake, spec: CastSpec) => void;
  /** Write one row of a mob's hate table, which is where threat actually lives. */
  hate: (entity: Fake, entityId: number, threat: number) => void;
  /** Place a raid mark, in the record the game keeps them in. */
  mark: (id: number, index: number) => void;
  /** Re-read the world, which is what turns a set change into a handler call. */
  poll: () => void;
  /** Move the sampler on, which is what every slow reading is taken by. */
  sample: () => void;
  /** Run the loader's one frame loop once, which is what health and casts move on. */
  frame: () => void;
  /** Answer no screen position for anything: a camera that cannot be asked. */
  blind: () => void;
  /** Every `over` value this addon has asked a unit point for. */
  overs: () => string[];
  /** The unit ids with a plate, ascending, so a case is order-free. */
  drawn: () => number[];
  plateOf: (id: number) => HTMLElement | null;
  nameOf: (id: number) => string;
  nameColourOf: (id: number) => string;
  levelOf: (id: number) => string;
  markOf: (id: number) => string;
  markColourOf: (id: number) => string;
  edgeOf: (id: number) => string;
  fadeOf: (id: number) => string;
  healthOf: (id: number) => string;
  healthFillOf: (id: number) => string;
  castLabelOf: (id: number) => string;
  castShown: (id: number) => boolean;
  castClassesOf: (id: number) => string[];
  /** The effect tiles on one plate that are actually on screen. */
  tilesOf: (id: number) => HTMLElement[];
  /** Every toast on screen, newest last. */
  toasts: () => string[];
  /** What the addon has written under its own account-wide key. */
  stored: () => Promise<unknown>;
}

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

function plateEl(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.woc-fm-plate[data-unit="${String(id)}"]`);
}

function partOf(id: number, selector: string): HTMLElement | null {
  return plateEl(id)?.querySelector<HTMLElement>(selector) ?? null;
}

function textOf(id: number, selector: string): string {
  return partOf(id, selector)?.textContent ?? '';
}

/** Let the async frame restore land before reading what the display did. */
async function settleFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Start the addon over a world holding you and nothing else.
 *
 * The spellbook is the game's own shape and holds one ability, because the whole of
 * what `world.abilities` can name is your own kit: `arcane_shot` is displayed as "Fell
 * Shot", which is the divergence that makes a worked-out name a guess rather than a
 * near miss.
 */
async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
): Promise<FacemarkHarness> {
  const player = liveEntity({ set: { templateId: 'hunter', pos: { x: 0, y: 0, z: 0 } } });
  const entities = new Map<number, Fake>([[PLAYER_ID, player]]);
  const markers: Record<string, number> = {};
  const known = [
    {
      def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
      rank: 3,
      cost: 55,
      castTime: 2,
      cooldown: 5.4,
    },
    // A real hunter ability whose own id ends in what AURA_SUFFIXES would otherwise
    // take for a tail. It is here so the "leave a named ability alone" case has one.
    {
      def: { id: 'dismiss_pet', name: 'Release Companion', school: 'physical' },
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
    },
  ];
  const world = { entities, player, known, markers };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings,
    storage,
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  const overs: string[] = [];
  const kit = harness.shared.kit as unknown as {
    unitPoint: (at: { unit: number; over?: string }) => Place | null;
    project: (x: number, y: number, z: number) => (Spot & { behind: boolean }) | null;
  };
  // The unit point carries the entity's own position and the projector turns it into a
  // depth, so one fake answers both halves and cannot disagree with itself.
  kit.unitPoint = (at) => {
    overs.push(at.over ?? 'head');
    const entity = entities.get(at.unit);
    if (entity === undefined) {
      return null;
    }
    return readField(entity, 'pos') as Place;
  };
  kit.project = (x, y, z) => ({ x, y, depth: Math.hypot(x, y, z), behind: false });

  return {
    ...harness,
    unit: (id, spec = {}) => {
      const entity = liveEntity({
        set: {
          id,
          name: spec.name ?? `Unit${String(id)}`,
          kind: spec.kind ?? 'mob',
          templateId: spec.templateId ?? 'boss_wolf',
          hostile: spec.hostile ?? true,
          level: spec.level ?? 12,
          hp: spec.hp ?? 60,
          maxHp: spec.maxHp ?? 100,
          dead: spec.dead ?? false,
          ghost: spec.ghost ?? false,
          pos: { x: spec.x ?? 5, y: 0, z: spec.z ?? 0 },
          auras: [],
          threat: new Map<number, number>(),
        },
      });
      entities.set(id, entity);
      return entity;
    },
    gone: (id) => {
      entities.delete(id);
    },
    afflict: (entity, spec = {}) => {
      (readField(entity, 'auras') as Record<string, unknown>[]).push(auraOf(spec));
    },
    casts: (entity, spec) => writeCast(entity, spec),
    hate: (entity, entityId, threat) => {
      (readField(entity, 'threat') as Map<number, number>).set(entityId, threat);
    },
    mark: (id, index) => {
      markers[String(id)] = index;
    },
    poll: () => harness.shared.world.watcher.poll(),
    sample: () => vi.advanceTimersByTime(SLOW_MS),
    frame: () => harness.frames.tick(),
    blind: () => {
      kit.unitPoint = () => null;
    },
    overs: () => overs,
    drawn: () =>
      [...document.querySelectorAll('.woc-fm-plate')]
        .map((el) => Number(el.getAttribute('data-unit')))
        .sort((a, b) => a - b),
    plateOf: (id) => plateEl(id),
    nameOf: (id) => textOf(id, '.woc-fm-name'),
    nameColourOf: (id) => partOf(id, '.woc-fm-name')?.style.color ?? '',
    levelOf: (id) => textOf(id, '.woc-fm-level'),
    markOf: (id) => textOf(id, '.woc-fm-mark'),
    markColourOf: (id) => partOf(id, '.woc-fm-mark')?.style.color ?? '',
    edgeOf: (id) => plateEl(id)?.style.borderLeftColor ?? '',
    fadeOf: (id) => plateEl(id)?.style.opacity ?? '',
    healthOf: (id) => textOf(id, '.woc-fm-health .woc-bar-value'),
    healthFillOf: (id) => partOf(id, '.woc-fm-health .woc-bar-fill')?.style.width ?? '',
    castLabelOf: (id) => textOf(id, '.woc-fm-cast .woc-bar-label'),
    castShown: (id) => partOf(id, '.woc-fm-cast')?.style.display !== 'none',
    castClassesOf: (id) => [...(partOf(id, '.woc-fm-cast')?.classList ?? [])],
    tilesOf: (id) =>
      [...(plateEl(id)?.querySelectorAll<HTMLElement>('.woc-fm-tile') ?? [])].filter(
        (tile) => tile.style.display !== 'none',
      ),
    toasts: () => [...document.querySelectorAll('.woc-toast')].map((el) => el.textContent ?? ''),
    stored: () => harness.hub.get(addonNamespace(harness.fqid), SHOWN_KEY),
  };
}

/**
 * `start`, plus the wait for the stored on-and-off answer to land.
 *
 * The plates draw from the first pass and are corrected a microtask later, so a case
 * about what is on screen wants the correction to have happened: without the wait, a
 * seeded "off" would be read after the assertion rather than before it.
 */
async function run(
  settings: Record<string, unknown> = {},
  storage?: FakeStorage,
): Promise<FacemarkHarness> {
  const harness = await start(settings, storage);
  harness.poll();
  await settleFrames();
  harness.sample();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // It reads the world and draws. Nothing here comes off the socket: a cast, an
  // effect, a mark and a hate table are all entity state.
  it('asks for no network permission', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'keys']);
  });

  // `ui.anchor3d`'s unit point, `over: 'head'`, `ui.project`, `woc.onFrame` and
  // `world.harmful` are all minor 2, and the addon is a guessed offset without the
  // first two.
  it('declares the minor the surface it reads was added in', () => {
    expect(manifest().apiMinor).toBe(2);
  });

  // The setting an earlier plan for this addon would have shipped and that `over:
  // 'head'` answers outright. Its correct value is always zero, so offering it would
  // be a control that can only be got wrong.
  it('offers no plate offset, because the head point resolves the model height', () => {
    const ids = (manifest().settings ?? []).map((setting) => setting.id);
    expect(ids).not.toContain('offset');
    expect(ids.some((id) => id.includes('height'))).toBe(false);
  });
});

// The placement, which is the reason this addon was blocked until the head anchor
// landed. Nothing else can answer it: a model's height, a mount's lift and the scale
// the renderer applied are all off the renderer and none of them is on the wire.
describe('where a plate is put', () => {
  it('anchors over the head rather than at the unit position', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();

    expect(h.overs()).toContain('head');
    expect(h.overs()).not.toContain('body');
  });

  // The head point resolves to nothing for a unit the game is drawing no model for,
  // which is where the game draws no nameplate either. A raw projection would report
  // finite nonsense for a point behind or inside the near plane, so the null is the
  // whole safety of the call.
  it('draws nothing at all for a point the camera cannot answer for', async () => {
    const h = await run();
    h.unit(BOSS);
    h.poll();
    expect(h.fadeOf(BOSS)).toBe('1');

    h.blind();
    h.sample();

    expect(h.fadeOf(BOSS)).toBe('0');
  });

  it('fades a plate further from the camera than one nearer it', async () => {
    const h = await run();
    h.unit(BOSS, { x: 5 });
    h.unit(ADD, { x: 38 });

    h.poll();

    expect(Number(h.fadeOf(ADD))).toBeLessThan(Number(h.fadeOf(BOSS)));
    expect(Number(h.fadeOf(ADD))).toBeGreaterThan(0);
  });
});

// Which units have a plate at all. The set, which is what the cap and every filter
// argue about.
describe('which units get a plate', () => {
  // Asked for EVERYTHING, because that is the only setting under which the self check
  // is the thing doing the work: on the default the player is filtered out for being
  // friendly, so a suite that only tested there would pass with the guard removed.
  it('never plates you, even when asked for everything', async () => {
    const h = await run({ show: 'everything' });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('plates a hostile mob', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });

  it('leaves a friendly player alone by default', async () => {
    const h = await run();
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('plates every player when asked for players', async () => {
    const h = await run({ show: 'players' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });
    h.unit(CRITTER, { hostile: false });

    h.poll();

    expect(h.drawn()).toEqual([HEALER]);
  });

  it('plates a neutral mob only when asked for everything', async () => {
    const h = await run({ show: 'everything' });
    h.unit(CRITTER, { hostile: false });

    h.poll();

    expect(h.drawn()).toEqual([CRITTER]);
  });

  it('drops a unit past the draw distance', async () => {
    const h = await run();
    h.unit(BOSS, { x: DRAW_DISTANCE + 1 });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('takes the plate down when the unit walks out of scope', async () => {
    const h = await run();
    h.unit(BOSS);
    h.poll();
    expect(h.drawn()).toEqual([BOSS]);

    h.gone(BOSS);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  // A corpse gets no plate: `dead` is on the wire and a plate over one says nothing a
  // player can act on.
  it('leaves a corpse alone', async () => {
    const h = await run();
    h.unit(BOSS, { dead: true });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  // A world object has no health to draw, so a plate over one would be a name with an
  // empty bar under it.
  it('leaves something with no health alone', async () => {
    const h = await run({ show: 'everything' });
    h.unit(CRITTER, { kind: 'object', hostile: false, hp: 0, maxHp: 0 });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });
});

// The cap, and the sort behind it. Nearest to the PLAYER rather than nearest to the
// camera, so that turning the camera through a crowd changes nothing about which
// twelve of forty units are drawn.
describe('the cap', () => {
  it('keeps the nearest and drops the rest', async () => {
    const h = await run({ 'max-plates': 2 });
    h.unit(BOSS, { x: 4 });
    h.unit(ADD, { x: 8 });
    h.unit(DUELIST, { x: 30 });

    h.poll();

    expect(h.drawn()).toEqual([BOSS, ADD]);
  });
});

describe('what a plate says about the unit', () => {
  it('draws the name, the level and the health', async () => {
    const h = await run();
    h.unit(BOSS, { name: 'Emberlord', level: 42, hp: 30, maxHp: 100 });

    h.poll();
    h.frame();

    expect(h.nameOf(BOSS)).toBe('Emberlord');
    expect(h.levelOf(BOSS)).toBe('42');
    expect(h.healthOf(BOSS)).toBe('30%');
    expect(h.healthFillOf(BOSS)).toBe('30.00%');
  });

  // Health moves in the frame loop and nothing reports it changing, so a plate that
  // only redrew on a set change would sit there showing the health the unit had when
  // it walked into range.
  it('follows the health down with no set change at all', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { hp: 100, maxHp: 100 });
    h.poll();
    h.frame();
    expect(h.healthOf(BOSS)).toBe('100%');

    setField(boss, 'hp', 25);
    h.frame();

    expect(h.healthOf(BOSS)).toBe('25%');
  });

  // `dead` stays true through both halves of dying and only one of them can be picked
  // up, so the two have to read differently.
  it('tells a body from a ghost', async () => {
    const h = await run({ show: 'everything' });
    const one = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'rogue' });
    h.poll();
    h.frame();

    setField(one, 'dead', true);
    h.frame();
    expect(h.healthOf(DUELIST)).toBe('dead');

    setField(one, 'ghost', true);
    h.frame();

    expect(h.healthOf(DUELIST)).toBe('ghost');
  });

  // The wire carries one boolean, so hostile and friendly are facts and neutral is
  // what is left over. The two colours are the game's own.
  it('colours hostile, friendly and neutral apart', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { hostile: true });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });
    h.unit(CRITTER, { hostile: false });

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(HOSTILE_NAME);
    expect(h.nameColourOf(HEALER)).toBe(FRIENDLY_NAME);
    expect(h.nameColourOf(CRITTER)).toBe(NEUTRAL_NAME);
  });
});

// The cast bar, and the two limits that ride on it.
describe('what a plate says about a cast', () => {
  it('draws a bar for a mob mechanic, which raises no event', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 3, total: 4 });

    h.poll();
    h.frame();

    expect(h.castShown(BOSS)).toBe(true);
    expect(h.castLabelOf(BOSS)).toBe('Flame Pillar?');
  });

  // The name came out of your own spellbook, so it is the game's own and carries no
  // mark. `arcane_shot` is displayed as "Fell Shot", which is why a worked-out name
  // cannot be trusted: this one would have read as "Arcane Shot".
  it('uses the real name for something in your spellbook and marks nothing', async () => {
    const h = await run();
    const duelist = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });

    h.poll();
    h.frame();

    expect(h.castLabelOf(DUELIST)).toBe('Fell Shot');
  });

  // A cast carries no school anywhere on the wire, and the only place one could be
  // recovered is your own spellbook. Tinting the handful of casts that happen to be in
  // it would make the colour mean "you know this one" rather than "this is fire".
  it('never tints a cast bar, including one it could have tinted', async () => {
    const h = await run();
    const duelist = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });

    h.poll();
    h.frame();

    expect(h.castClassesOf(DUELIST).some((name) => name.startsWith('woc-bar-school-'))).toBe(false);
  });

  it('takes the bar away when the cast ends', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 3 });
    h.poll();
    h.frame();
    expect(h.castShown(BOSS)).toBe(true);

    setField(boss, 'castingAbility', null);
    h.frame();

    expect(h.castShown(BOSS)).toBe(false);
  });

  it('draws no cast bar at all when the player turned them off', async () => {
    const h = await run({ casts: false });
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 3 });

    h.poll();
    h.frame();

    expect(h.castShown(BOSS)).toBe(false);
  });
});

// The strip, and the limit that is hardest to see: an effect a mob applied has no
// picture anywhere in the game.
describe('the effects on a unit', () => {
  it('draws a tile for a harmful effect', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'rend', name: 'Rend', kind: 'dot' });

    h.poll();

    expect(h.tilesOf(BOSS)).toHaveLength(1);
    expect(h.tilesOf(BOSS)[0]?.getAttribute('aria-label')).toContain('Rend');
  });

  it('leaves a benefit off the strip', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'battle_shout', name: 'Battle Shout', kind: 'buff_ap', value: 40 });

    h.poll();

    expect(h.tilesOf(BOSS)).toHaveLength(0);
  });

  // The recoverable half of L21. An aura's id IS the applying ability's id, and a
  // PLAYER carries their class on the entity, so this one resolves real art.
  it('resolves art for an effect a player applied', async () => {
    const h = await run();
    h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'arcane_shot', name: 'Fell Shot', sourceId: DUELIST });

    h.poll();

    const art = h.tilesOf(BOSS)[0]?.querySelector('.woc-tile-art');
    expect(art?.getAttribute('src')).toContain('arcane_shot');
  });

  // The unrecoverable half, and the reason it is stated on the card. Every aura icon
  // in the game is painted on a canvas from a bundled recipe and no aura art is
  // served, so a mob's effect gets its school colour and its countdown instead of a
  // picture, which is what that tile MEANS rather than one that failed to load.
  it('gives a mob effect colour and a countdown rather than an icon', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'molten_grip', school: 'fire', remaining: 4.2, sourceId: BOSS });

    h.poll();

    const [tile] = h.tilesOf(BOSS);
    expect(tile?.querySelector('.woc-tile-art')?.getAttribute('src')).toBe(null);
    expect(tile?.classList.contains('woc-tile-school-fire')).toBe(true);
    expect(tile?.querySelector('.woc-tile-value')?.textContent).toBe('4.2');
  });

  // A tile is 30px across and the kit draws its countdown at a fixed 14px, so the
  // figure has no room for a unit and a stack count has no corner to sit in while one
  // is there. A bar has both and keeps them.
  it('drops the unit and the decimal from a countdown a tile has no room for', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'molten_grip', remaining: 12.4, sourceId: BOSS });

    h.poll();

    expect(h.tilesOf(BOSS)[0]?.querySelector('.woc-tile-value')?.textContent).toBe('12');
  });

  // A control aura is not the ability's own id: the game builds it as
  // `${ability.id}_slow` and fifteen more like it, so the whole id is art that can
  // never exist and the ability under it is art that does. A slow, a stun and a root
  // are most of what a player actually lands on a nameplate.
  it('resolves art through the ability under a control aura', async () => {
    const h = await run();
    h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'concussive_shot_slow', kind: 'slow', sourceId: DUELIST });

    h.poll();

    const art = h.tilesOf(BOSS)[0]?.querySelector('.woc-tile-art');
    expect(art?.getAttribute('src')).toContain('concussive_shot');
    expect(art?.getAttribute('src')).not.toContain('_slow');
  });

  // Three real ability ids end in what would otherwise read as a tail, so an id the
  // game itself names is left alone rather than trimmed down to something else.
  it('leaves an ability whose own id ends in a suffix alone', async () => {
    const h = await run();
    h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'dismiss_pet', kind: 'dot', sourceId: DUELIST });

    h.poll();

    expect(h.tilesOf(BOSS)[0]?.querySelector('.woc-tile-art')?.getAttribute('src')).toContain(
      'dismiss_pet',
    );
  });

  // Two players can carry the same debuff on one target, so what YOU put there has to
  // be the one that survives the cap.
  it('puts your own effect first', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'their_dot', name: 'Their Dot', remaining: 1, sourceId: BOSS });
    h.afflict(boss, { id: 'my_dot', name: 'My Dot', remaining: 9, sourceId: PLAYER_ID });

    h.poll();

    expect(h.tilesOf(BOSS)[0]?.getAttribute('aria-label')).toContain('My Dot');
  });

  it('keeps the four soonest to fall off and no more', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    for (const [at, left] of [9, 1, 7, 3, 5].entries()) {
      h.afflict(boss, { id: `dot_${String(at)}`, name: `Dot ${String(at)}`, remaining: left });
    }

    h.poll();

    const shown = h.tilesOf(BOSS).map((tile) => tile.getAttribute('aria-label') ?? '');
    expect(shown).toHaveLength(MAX_AURAS);
    expect(shown[0]).toContain('Dot 1');
    expect(shown.join(' ')).not.toContain('Dot 0');
  });

  // Nothing reports an effect landing on a unit that was already nearby, which is L34.
  // The sampler is what covers it, and a strip that waited for a watch key would never
  // move at all.
  it('picks up an effect that landed with no set change anywhere', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.poll();
    expect(h.tilesOf(BOSS)).toHaveLength(0);

    h.afflict(boss, { id: 'rend', name: 'Rend' });
    h.sample();

    expect(h.tilesOf(BOSS)).toHaveLength(1);
  });

  it('empties the strip again when the effect falls off', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'rend', name: 'Rend' });
    h.poll();
    expect(h.tilesOf(BOSS)).toHaveLength(1);

    setField(boss, 'auras', []);
    h.sample();

    expect(h.tilesOf(BOSS)).toHaveLength(0);
  });

  it('draws no strip at all when the player turned it off', async () => {
    const h = await run({ auras: false });
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'rend', name: 'Rend' });

    h.poll();

    expect(h.tilesOf(BOSS)).toHaveLength(0);
  });
});

// The threat edge, off the server's own hate table rather than anything derived here.
describe('the threat edge', () => {
  it('goes to the game own threat colour when you are the top row', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.hate(boss, PLAYER_ID, 900);

    h.poll();

    expect(h.edgeOf(BOSS)).toBe(EDGE_TOP);
  });

  it('stays calm while somebody else is holding it', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.hate(boss, HEALER, 900);
    h.hate(boss, PLAYER_ID, 100);

    h.poll();

    expect(h.edgeOf(BOSS)).toBe(EDGE_CALM);
  });

  // A player keeps no hate table, so an edge drawn from one would be a permanent
  // nothing dressed up as a reading.
  it('draws no edge on a unit that keeps no table', async () => {
    const h = await run({ show: 'players' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });

    h.poll();

    expect(h.edgeOf(HEALER)).toBe('transparent');
  });
});

// The raid mark, which is a NAME in the game's own colour because the art is painted
// on a canvas exactly as an aura icon is.
describe('the raid mark', () => {
  it('names the mark in the colour the game files it under', async () => {
    const h = await run();
    h.unit(BOSS);
    h.mark(BOSS, 0);

    h.poll();

    expect(h.markOf(BOSS)).toBe('Star');
    expect(h.markColourOf(BOSS)).toBe(STAR_COLOUR);
  });

  it('says nothing about a unit nobody marked', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();

    expect(h.markOf(BOSS)).toBe('');
  });
});

// The clutter setting, and the one case it must not swallow.
describe('hiding a plate that has nothing to say', () => {
  it('hides a full-health unit that is doing nothing', async () => {
    const h = await run({ 'hide-full': true });
    h.unit(BOSS, { hp: 100, maxHp: 100 });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  // A boss standing at full health winding up a mechanic is not clutter, which is
  // exactly the moment the display exists for.
  it('keeps a full-health unit that is casting', async () => {
    const h = await run({ 'hide-full': true });
    const boss = h.unit(BOSS, { hp: 100, maxHp: 100 });
    h.casts(boss, { ability: 'flame_pillar', remaining: 3 });

    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });

  it('brings the plate back the moment the unit is hurt', async () => {
    const h = await run({ 'hide-full': true });
    const boss = h.unit(BOSS, { hp: 100, maxHp: 100 });
    h.poll();
    expect(h.drawn()).toEqual([]);

    setField(boss, 'hp', 90);
    h.sample();

    expect(h.drawn()).toEqual([BOSS]);
  });
});

// The toggle, which is the whole of this addon's chrome. There is no panel: the plates
// are the display, so nothing else may own whether they are drawn.
describe('the toggle', () => {
  it('takes every plate out of the world', async () => {
    const h = await run();
    h.unit(BOSS);
    h.poll();
    expect(h.drawn()).toEqual([BOSS]);

    h.press(TOGGLE);

    expect(h.drawn()).toEqual([]);
  });

  it('brings them back', async () => {
    const h = await run();
    h.unit(BOSS);
    h.poll();
    h.press(TOGGLE);

    h.press(TOGGLE);

    expect(h.drawn()).toEqual([BOSS]);
  });

  // Turning a world overlay off leaves a screen indistinguishable from an addon that
  // has stopped working, and there is no panel left to find the way back from. So the
  // off message names the chord, in the spelling a keyboard uses rather than the
  // manifest's.
  it('names the key that brings the plates back', async () => {
    const h = await run();

    h.press(TOGGLE);

    expect(h.toasts().join(' ')).toContain('Press Alt+Shift+F');
  });

  it('says nothing about a key when the plates are coming back', async () => {
    const h = await run();
    h.press(TOGGLE);

    h.press(TOGGLE);

    expect(h.toasts().at(-1)).toBe('Facemark: plates on.');
  });

  it('remembers the answer for the account rather than the character', async () => {
    const h = await run();

    h.press(TOGGLE);
    await settleFrames();

    expect(await h.stored()).toBe(false);
  });

  it('starts with the plates off when that is what was stored', async () => {
    const storage = createFakeStorage();
    await storage.set(addonNamespace('official/facemark'), SHOWN_KEY, false);

    const h = await run({}, storage);
    h.unit(BOSS);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });
});

describe('before world entry', () => {
  // An addon's first line runs at document-start on the landing page, where every read
  // answers null. Nothing is drawn and nothing throws.
  it('draws nothing and does not throw', async () => {
    const harness = await mountAddon({ manifest: MANIFEST_TEXT, source: SOURCE });
    teardown.push(harness.dispose);

    expect(() => harness.frames.tick()).not.toThrow();
    expect(() => vi.advanceTimersByTime(SLOW_MS)).not.toThrow();

    expect(document.querySelectorAll('.woc-fm-plate')).toHaveLength(0);
  });
});

describe('disabling it', () => {
  it('leaves no plate, no keybind, no sampler and no frame handler behind', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'rend', name: 'Rend' });
    h.casts(boss, { ability: 'flame_pillar', remaining: 3 });
    h.poll();
    h.frame();
    expect(h.drawn()).toEqual([BOSS]);

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('.woc-fm-plate')).toHaveLength(0);
    expect(document.querySelectorAll('.woc-bar')).toHaveLength(0);
    expect(document.querySelectorAll('.woc-tile')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.frame()).not.toThrow();
    expect(() => vi.advanceTimersByTime(SLOW_MS)).not.toThrow();
  });
});
