// @vitest-environment happy-dom

// Facemark, run through the real loader.
//
// The claims this suite holds are the decisions a nameplate display is made of rather than the
// pixels: which units get a plate, which of them survives the cap, what a name is called when
// nothing published it, which effects reach the strip, and who owns whether the plates are
// drawn at all. Where a plate ended up is a live question, since no anchor here is ever
// painted on a real screen.
//
// Two things about the way the world is driven are load-bearing.
//
// Nothing here delivers an event. A cast is written onto the entity, which is where the game
// puts it; an effect is pushed onto the entity's own aura array; a mark is written into the
// world's marker record; threat is written into the mob's own hate table. A display built on
// events would pass none of it.
//
// The camera is installed, because `tests/fakes/shared-services.ts` resolves no unit at all
// and answers one constant screen point for every world point. `unitPoint` and `project` are
// ordinary fields on the kit that `ui.project` reads per call, so a suite that needs real
// positions says what they are. The default here answers for every entity in the fake world
// and puts depth at the unit's distance from the origin, which is what the fade cases move;
// `blind()` takes it away again, which is the "do not draw" case.

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
/** The game's own team tokens, which the carrier tag is written in. */
const TEAM_RED = 'var(--color-team-red)';
const TEAM_BLUE = 'var(--color-team-blue)';
/** The two battleground teams, by the index the game gives each. */
const CRIMSON = 0;
const AZURE = 1;
/** The companion that carries the mob rank table, and the topic it publishes on. */
const RANKER = 'official/longwatch';
const RANKS_TOPIC = 'mobs';
/** The game's own elite gold and boss red, which the addon draws on the health bar's EDGE. */
const ELITE_COLOUR = 'rgb(242 200 75)';
const BOSS_COLOUR = 'rgb(255 85 85)';
/** The game's own nameplate con bands, which are not its tooltip's wider ones. */
const CON_RED = 'rgb(255 68 68)';
const CON_ORANGE = 'rgb(255 170 51)';
const CON_YELLOW = 'rgb(255 233 122)';
const CON_GREY = 'rgb(157 157 157)';
/** A friendly pet, which the game gives one colour outright rather than a band. */
const CON_FRIENDLY = 'rgb(159 220 127)';
/** The game's own corpse grey, which reads as past tense whoever it was. */
const CORPSE_NAME = 'rgb(187 187 187)';
/** Somebody else's kill, which nothing in the game says anywhere. */
const TAPPED_NAME = 'rgb(150 150 150)';
/** What the fixture player is, which every con band is measured against. */
const PLAYER_LEVEL = 20;
/** A lit combo pip, which is the only thing that tells one from a spent one. */
const PIP_ON = 'rgb(255 226 58)';
/** The game's own translucency for a stealthed unit. */
const STEALTH_FADE = 0.55;
/** The current target's name step, and the edge the game draws around its bar. */
const TARGET_FONT = '13px';
const TARGET_STROKE = 'rgb(255 255 255 / 67%)';
/** The star's own path, which is how one drawn mark is told from another. */
const STAR_PATH_START = 'M 0,-42';
/** The game's own index order, which is what a screen reader is told. */
const MARK_NAMES = ['Star', 'Circle', 'Diamond', 'Triangle', 'Moon', 'Square', 'Cross', 'Skull'];

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
  /** Control an encounter owns, which nothing the player does breaks. */
  unbreakableControl?: boolean;
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
  /** The owning player, for a pet. Null on everything wild, which is the game's own default. */
  ownerId?: number | null;
  /** The /afk display bit, which the player sets themselves. */
  afk?: boolean;
  /** Sitting, EATING or DRINKING: the wire folds all three into this one bit. */
  sitting?: boolean;
  /** A mount key, or empty on foot. Not an item id, and never resolves to art. */
  mountKey?: string;
  /** The operator-set mark on an AI-operated account. */
  aiAccount?: boolean;
  /** Whether a corpse has anything on it, which is what keeps its plate on screen. */
  lootable?: boolean;
  /** The first player to damage it, who owns the kill. Null means nobody has. */
  tappedById?: number | null;
  /** A caster mob's pool, which rides any entity the server gives one. */
  resourceType?: string | null;
  resource?: number;
  maxResource?: number;
  /** Who a taunt is holding this mob on, and for how much longer. */
  forcedTargetId?: number | null;
  forcedTargetTimer?: number;
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
 * A part's colour, or empty when it is hidden.
 *
 * Both halves matter: the tag keeps its last colour when it is switched off, so a
 * case that read the colour alone would pass on a tag nobody can see.
 */
function shownColour(part: HTMLElement | null): string {
  if (part === null || part.style.display === 'none') {
    return '';
  }
  return part.style.color;
}

/**
 * The four PLAYER fields, defaulted to what the game sends for somebody doing nothing.
 *
 * Its own helper rather than four more lines in the unit factory, which the complexity
 * limit was already at: `mountKey` is EMPTY on foot rather than the fixture's generated
 * string, which would read as every unit in the world being mounted on something.
 */
function playerState(spec: UnitSpec): Fake {
  return {
    afk: spec.afk ?? false,
    sitting: spec.sitting ?? false,
    mountKey: spec.mountKey ?? '',
    aiAccount: spec.aiAccount ?? false,
  };
}

/**
 * The fields a corpse, a kill and a caster mob are read through.
 *
 * Every one of them is NULLABLE on the wire and means "nobody" or "none" as null,
 * which is why none of them takes a zero here: `tappedById: 0` is a real entity id
 * and would make every fixture mob somebody else's kill.
 */
function unitState(spec: UnitSpec): Fake {
  return {
    lootable: spec.lootable ?? false,
    tappedById: spec.tappedById ?? null,
    resourceType: spec.resourceType ?? null,
    resource: spec.resource ?? 0,
    maxResource: spec.maxResource ?? 0,
    forcedTargetId: spec.forcedTargetId ?? null,
    forcedTargetTimer: spec.forcedTargetTimer ?? 0,
  };
}

/** Write a field on a live entity, which is a `Record<string, unknown>`. */
function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

function readField(entity: Fake, field: string): unknown {
  return entity[field];
}

/**
 * One battleground roster row, in the game's own `players` shape.
 *
 * Note what it does NOT carry: an enemy's health never reaches a client past the
 * ordinary interest radii, and the roster is deliberately built without one.
 */
function bgFighter(pid: number, team: number, carrying: boolean): Fake {
  return {
    pid,
    name: `p${String(pid)}`,
    cls: 'rogue',
    team,
    carrying,
    dead: false,
    kills: 0,
    deaths: 0,
    captures: 0,
    assists: 0,
  };
}

function bgFlag(carrying: number | null): Fake {
  if (carrying === null) {
    return { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null };
  }
  return { state: 'carried', carrierPid: carrying, carrierName: 'carrier', carrierTeam: AZURE };
}

/** A match view as `bgInfoFor` builds one, with both flags at home unless somebody has one. */
function bgMatch(players: Fake[], carrying: number | null): Fake {
  return {
    state: 'active',
    myTeam: CRIMSON,
    capsToWin: 3,
    scores: [0, 0],
    flags: [bgFlag(null), bgFlag(carrying)],
    players,
    countdown: 0,
    timeLeft: 600,
    waveIn: [5, 5],
    respawnIn: 0,
    winner: null,
  };
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
    unbreakableControl: spec.unbreakableControl,
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
  /** Put the player in a duel, which is the cheapest bout that names an enemy. */
  duel: (otherPid: number) => void;
  /**
   * Put the player in a battleground, on Crimson.
   *
   * `enemies` are the pids on the other side and `carrying` is whoever holds a
   * flag. The roster is the game's own `players`, both sides in one list, which
   * is the only thing that says which players are fighting you.
   */
  battleground: (spec: { enemies: number[]; allies?: number[]; carrying?: number }) => void;
  /** End whatever bout is on, which is how the game clears both keys. */
  endBout: () => void;
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
  /** The level's colour, which is where a rank is drawn rather than in a mark of its own. */
  levelColourOf: (id: number) => string;
  /** The one word saying what a player is doing, or empty. */
  noteOf: (id: number) => string;
  /** The AI-account tag, or empty. */
  aiOf: (id: number) => string;
  /** Publish a mob rank table as the companion addon would. */
  ranks: (rows: unknown) => void;
  /** Put one quest in the log, which is where the game keeps what you are on. */
  quest: (questId: string, state: 'active' | 'ready' | 'done') => void;
  /** What the mark slot draws as TEXT, which is the corpse `$` and nothing else. */
  markOf: (id: number) => string;
  markColourOf: (id: number) => string;
  /** What a screen reader is told the mark is, which the glyph itself cannot say. */
  markLabelOf: (id: number) => string;
  /** The first path in the drawn mark, so a shape can be told from another shape. */
  markPathOf: (id: number) => string;
  /** The health bar's edge, where rank and the current target are drawn. */
  strokeOf: (id: number) => string;
  /** How many combo pips are lit over this unit. */
  pipsOf: (id: number) => number;
  /** Whether the pip row is on screen at all, which no pips at all must not be. */
  pipsShown: (id: number) => boolean;
  /** The name's own font size, which the current target steps up. */
  nameSizeOf: (id: number) => string;
  /** Select a unit, which is what the game fills `player.targetId` from. */
  target: (id: number | null) => void;
  /** Your own combo points, which are yours rather than the target's. */
  combo: (points: number) => void;
  /** Whether the identity row under the name is on screen at all. */
  tagsShown: (id: number) => boolean;
  /** Whether the alert row under the cast bar is on screen at all. */
  alertsShown: (id: number) => boolean;
  /** The health bar's left-hand figure, which is the count rather than the share. */
  healthCountOf: (id: number) => string;
  /** The health bar's own classes, which is where the kit records a class tint. */
  healthClassesOf: (id: number) => string[];
  /** The cast bar's icon URL, or empty when the slot is not drawn. */
  castIconOf: (id: number) => string;
  /** The rows of the plate in the order they are drawn, by class. */
  rowsOf: (id: number) => string[];
  /** What the head row holds, in order: the tags ride its tail. */
  headPartsOf: (id: number) => string[];
  /** Where the shield overlay starts and how wide it is, as written. */
  absorbOf: (id: number) => { left: string; width: string };
  absorbShown: (id: number) => boolean;
  /** A caster mob's pool, as a share of its own maximum. */
  powerOf: (id: number) => string;
  powerShown: (id: number) => boolean;
  /** What the pool is filled with, which must be the game's own token. */
  powerColourOf: (id: number) => string;
  /** The taunt tag, or empty. */
  tauntOf: (id: number) => string;
  /** The rare tag, which is a separate flag from rank and mostly not an elite. */
  rareOf: (id: number) => string;
  /** The words for a cast pointed at you, which are on the tag row and not on the bar. */
  atYouOf: (id: number) => string;
  /** One effect tile's accessible name, which is where an unbreakable one is said. */
  tileLabelOf: (id: number, at: number) => string;
  tileClassesOf: (id: number, at: number) => string[];
  /** Put a party on the world, which is what a shared tap is measured against. */
  party: (pids: readonly number[]) => void;
  /** The plate's own transform, which carries the declutter shift and the scale. */
  transformOf: (id: number) => string;
  /** The carrier tag's colour, or empty when the tag is not on screen. */
  carryOf: (id: number) => string;
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
 * Start the addon over a world holding you and nothing else. The spellbook is the game's own
 * shape and holds one ability, because the whole of what `world.abilities` can name is your own
 * kit: `arcane_shot` is displayed as "Fell Shot", which is the divergence that makes a
 * worked-out name a guess rather than a near miss.
 */
async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
): Promise<FacemarkHarness> {
  // `kind` is stated rather than left to the fixture's generated default, which is the
  // empty string: a player whose kind is '' is valid for the type and wrong for the
  // domain, and it makes your own pet resolve its owner to something that is not a
  // player and read neutral. The game sends 'player' on the self record always.
  const player = liveEntity({
    set: { kind: 'player', templateId: 'hunter', pos: { x: 0, y: 0, z: 0 } },
  });
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
    // A real hunter ability whose own id ends in what `AURA_SUFFIXES` would otherwise take for
    // a tail, so the "leave a named ability alone" case has one.
    {
      def: { id: 'dismiss_pet', name: 'Release Companion', school: 'physical' },
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
    },
  ];
  // Typed loosely because the bout keys are written onto it after the fact, which is
  // what the game does: `duelInfo` and `bgInfo` are absent until the player is in one.
  const world: Fake = { entities, player, known, markers };
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
          // Null rather than the fixture's own numeric default: `ownerId` means "nobody"
          // as null, and a 0 there makes every wild mob read as a pet of entity 0.
          ownerId: spec.ownerId ?? null,
          ...playerState(spec),
          ...unitState(spec),
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
    duel: (otherPid) => {
      setField(world, 'duelInfo', { otherPid, otherName: 'Rival', state: 'active' });
    },
    battleground: (spec) => {
      const roster = [
        ...(spec.allies ?? []).map((pid) => bgFighter(pid, CRIMSON, spec.carrying === pid)),
        ...spec.enemies.map((pid) => bgFighter(pid, AZURE, spec.carrying === pid)),
      ];
      setField(world, 'bgInfo', { match: bgMatch(roster, spec.carrying ?? null) });
    },
    endBout: () => {
      setField(world, 'duelInfo', null);
      setField(world, 'bgInfo', { match: null });
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
    levelColourOf: (id) => partOf(id, '.woc-fm-level')?.style.color ?? '',
    noteOf: (id) => textOf(id, '.woc-fm-note'),
    aiOf: (id) => textOf(id, '.woc-fm-ai'),
    ranks: (rows) => {
      harness.shared.bus.emit(RANKER, RANKS_TOPIC, rows);
    },
    quest: (questId, state) => {
      const log = new Map<string, { questId: string; state: string }>([
        [questId, { questId, state }],
      ]);
      setField(world, 'questLog', log);
    },
    markOf: (id) => textOf(id, '.woc-fm-mark'),
    markColourOf: (id) => partOf(id, '.woc-fm-mark')?.style.color ?? '',
    markLabelOf: (id) => partOf(id, '.woc-fm-mark')?.getAttribute('aria-label') ?? '',
    markPathOf: (id) => partOf(id, '.woc-fm-mark svg path')?.getAttribute('d') ?? '',
    strokeOf: (id) => partOf(id, '.woc-fm-health')?.style.outline ?? '',
    pipsOf: (id) =>
      [...(plateEl(id)?.querySelectorAll<HTMLElement>('.woc-fm-pip') ?? [])].filter(
        (dot) => dot.style.background === PIP_ON,
      ).length,
    pipsShown: (id) => partOf(id, '.woc-fm-pips')?.style.display !== 'none',
    nameSizeOf: (id) => partOf(id, '.woc-fm-name')?.style.fontSize ?? '',
    target: (id) => setField(player, 'targetId', id),
    combo: (points) => setField(player, 'comboPoints', points),
    tagsShown: (id) => partOf(id, '.woc-fm-tags')?.style.display !== 'none',
    alertsShown: (id) => partOf(id, '.woc-fm-alerts')?.style.display !== 'none',
    healthCountOf: (id) => textOf(id, '.woc-fm-health .woc-bar-label'),
    healthClassesOf: (id) => [...(partOf(id, '.woc-fm-health')?.classList ?? [])],
    castIconOf: (id) =>
      partOf(id, '.woc-fm-cast .woc-bar-icon')?.getAttribute('src') ??
      partOf(id, '.woc-fm-cast .woc-bar-icon')?.style.backgroundImage ??
      '',
    rowsOf: (id) =>
      [...(plateEl(id)?.children ?? [])].map((el) => el.className.split(' ')[0] ?? ''),
    headPartsOf: (id) =>
      [...(partOf(id, '.woc-fm-head')?.children ?? [])].map(
        (el) => el.className.split(' ')[0] ?? '',
      ),
    transformOf: (id) => plateEl(id)?.style.transform ?? '',
    absorbOf: (id) => ({
      left: partOf(id, '.woc-fm-absorb')?.style.left ?? '',
      width: partOf(id, '.woc-fm-absorb')?.style.width ?? '',
    }),
    absorbShown: (id) => partOf(id, '.woc-fm-absorb')?.style.display !== 'none',
    powerOf: (id) => partOf(id, '.woc-fm-power-fill')?.style.width ?? '',
    powerShown: (id) => partOf(id, '.woc-fm-power')?.style.display !== 'none',
    powerColourOf: (id) => partOf(id, '.woc-fm-power-fill')?.style.background ?? '',
    tauntOf: (id) => textOf(id, '.woc-fm-taunt'),
    rareOf: (id) => textOf(id, '.woc-fm-rare'),
    atYouOf: (id) => textOf(id, '.woc-fm-atyou'),
    tileLabelOf: (id, at) =>
      [...(plateEl(id)?.querySelectorAll<HTMLElement>('.woc-fm-tile') ?? [])][at]?.getAttribute(
        'aria-label',
      ) ?? '',
    tileClassesOf: (id, at) => [
      ...([...(plateEl(id)?.querySelectorAll<HTMLElement>('.woc-fm-tile') ?? [])][at]?.classList ??
        []),
    ],
    party: (pids) => {
      setField(world, 'partyInfo', {
        leader: pids[0],
        raid: false,
        members: pids.map((pid) => ({ pid, name: `P${String(pid)}`, cls: 'hunter', level: 20 })),
      });
    },
    carryOf: (id) => shownColour(partOf(id, '.woc-fm-carry')),
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
 * `start`, plus the wait for the stored on-and-off answer to land. The plates draw from the
 * first pass and are corrected a microtask later, so without the wait a seeded "off" would be
 * read after the assertion rather than before it.
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

  // The declaration is the smallest minor carrying every member this addon reads, and the
  // highest is now 6: the `format: 'battleground'` member of `world.match`, whose roster is
  // the only thing that says which players are fighting you. Two are minor 4: `fmt.titleCase`,
  // for an effect the wire sent with no name, and `world.abilities.describe`, for the cast
  // bar's label. The rest are minor 2: `ui.anchor3d`'s unit point, `over: 'head'`,
  // `ui.project`, `woc.onFrame` and `world.harmful`.
  it('declares the minor the surface it reads was added in', () => {
    expect(manifest().apiMinor).toBe(6);
  });

  // `over: 'head'` answers the offset outright. Its correct value is always zero, so offering
  // a setting for it would be a control that can only be got wrong.
  it('offers no plate offset, because the head point resolves the model height', () => {
    const ids = (manifest().settings ?? []).map((setting) => setting.id);
    expect(ids).not.toContain('offset');
    expect(ids.some((id) => id.includes('height'))).toBe(false);
  });
});

// The placement. Nothing else can answer it: a model's height, a mount's lift and the scale
// the renderer applied are all off the renderer and none of them is on the wire.
describe('where a plate is put', () => {
  it('anchors over the head rather than at the unit position', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();
    h.frame();

    expect(h.overs()).toContain('head');
    expect(h.overs()).not.toContain('body');
  });

  // The head point resolves to nothing for a unit the game is drawing no model for, which is
  // where the game draws no nameplate either. A raw projection would report finite nonsense for
  // a point behind or inside the near plane, so the null is the whole safety of the call.
  it('draws nothing at all for a point the camera cannot answer for', async () => {
    const h = await run();
    h.unit(BOSS);
    h.poll();
    h.frame();
    expect(h.fadeOf(BOSS)).toBe('1');

    h.blind();
    h.frame();

    expect(h.fadeOf(BOSS)).toBe('0');
  });

  it('fades a plate further from the camera than one nearer it', async () => {
    const h = await run();
    h.unit(BOSS, { x: 5 });
    h.unit(ADD, { x: 38 });

    h.poll();
    h.frame();

    expect(Number(h.fadeOf(ADD))).toBeLessThan(Number(h.fadeOf(BOSS)));
    expect(Number(h.fadeOf(ADD))).toBeGreaterThan(0);
  });

  // The fade and the stack are both answers about where the CAMERA is, so both are
  // resolved in the frame loop off one projection. A tenth of a second of lag is
  // invisible on a health bar and obvious on a plate sliding as you turn.
  it('fades on a frame rather than waiting for the next sample', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { x: 5 });
    h.poll();
    h.frame();
    expect(h.fadeOf(BOSS)).toBe('1');

    setField(boss, 'pos', { x: 55, y: 0, z: 0 });
    h.frame();

    expect(Number(h.fadeOf(BOSS))).toBeLessThan(1);
  });

  // Two mobs standing together project to one point, and the plate underneath was
  // drawn exactly beneath the one on top: not a crowded reading, a missing one.
  // Spread around the pair's own middle rather than from the top one, so a third
  // arriving pushes both neighbours half a step instead of moving everybody down.
  it('spreads two plates that would land on top of each other', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { x: 5 });
    h.unit(ADD, { x: 5 });

    h.poll();
    h.frame();

    expect(h.transformOf(BOSS)).toContain('translateY(-10px)');
    expect(h.transformOf(ADD)).toContain('translateY(10px)');
  });

  it('leaves two plates far enough apart alone', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { x: 5 });
    const add = h.unit(ADD, { x: 5 });
    setField(add, 'pos', { x: 5, y: 40, z: 0 });

    h.poll();
    h.frame();

    expect(h.transformOf(BOSS)).toContain('translateY(0px)');
    expect(h.transformOf(ADD)).toContain('translateY(0px)');
  });
});

// Which units have a plate at all. The set, which is what the cap and every filter
// argue about.
describe('which units get a plate', () => {
  // Asked for everything, because that is the only setting under which the self check does the
  // work: on the default the player is filtered out for being friendly, so a suite that only
  // tested there would pass with the guard removed.
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

// The cap, and the sort behind it: nearest to the player rather than nearest to the camera, so
// that turning the camera through a crowd changes nothing about which twelve of forty units
// are drawn.
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

// Which side a PLAYER is on, which is the one reaction no field answers.
//
// Every fixture here leaves `hostile` false on the player, because that is what the
// game sends: the flag is written when it builds a MOB and nowhere else. A plate that
// read it would paint all five opponents in a battleground friendly-blue, so each case
// below is red-on-blue by construction if the bout roster is ever dropped.
describe('which side a player is on', () => {
  it('colours a duel opponent hostile, though nothing on them says so', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.duel(DUELIST);

    h.poll();

    expect(h.nameColourOf(DUELIST)).toBe(HOSTILE_NAME);
  });

  it('leaves everyone else friendly while that duel runs', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });
    h.duel(DUELIST);

    h.poll();

    expect(h.nameColourOf(HEALER)).toBe(FRIENDLY_NAME);
  });

  it('colours the other side of a battleground hostile and its own side friendly', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });
    h.battleground({ enemies: [DUELIST], allies: [HEALER] });

    h.poll();

    expect(h.nameColourOf(DUELIST)).toBe(HOSTILE_NAME);
    expect(h.nameColourOf(HEALER)).toBe(FRIENDLY_NAME);
  });

  // The setting that most players run on. Before the roster was read this filtered
  // out every enemy player in the game, so a battleground drew no plates at all.
  it('plates an enemy player when asked for hostiles alone', async () => {
    const h = await run({ show: 'hostile' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.battleground({ enemies: [DUELIST] });

    h.poll();

    expect(h.drawn()).toEqual([DUELIST]);
  });

  it('forgets the roster the moment the bout ends', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.duel(DUELIST);
    h.poll();
    expect(h.nameColourOf(DUELIST)).toBe(HOSTILE_NAME);

    h.endBout();
    h.sample();

    expect(h.nameColourOf(DUELIST)).toBe(FRIENDLY_NAME);
  });

  // A pet has no side of its own. Reading the pet's own flag makes an enemy's
  // wolf read neutral, standing next to the enemy it is fighting for.
  it('gives an enemy player a pet that reads hostile', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.unit(ADD, { hostile: false, ownerId: DUELIST });
    h.duel(DUELIST);

    h.poll();

    expect(h.nameColourOf(ADD)).toBe(HOSTILE_NAME);
  });

  it('leaves your own pet friendly', async () => {
    const h = await run({ show: 'everything' });
    h.unit(ADD, { hostile: false, ownerId: PLAYER_ID });

    h.poll();

    expect(h.nameColourOf(ADD)).toBe(FRIENDLY_NAME);
  });
});

// The one mark a battleground plate carries that a scoreboard cannot: it is drawn ON
// the person to chase.
describe('the flag carrier', () => {
  it('marks an enemy carrying one in the colour of the side they are on', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.battleground({ enemies: [DUELIST], carrying: DUELIST });

    h.poll();

    expect(h.carryOf(DUELIST)).toBe(TEAM_RED);
  });

  it('marks an ally carrying one in the other colour', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });
    h.battleground({ enemies: [], allies: [HEALER], carrying: HEALER });

    h.poll();

    expect(h.carryOf(HEALER)).toBe(TEAM_BLUE);
  });

  it('marks nobody when the flags are home', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.battleground({ enemies: [DUELIST] });

    h.poll();

    expect(h.carryOf(DUELIST)).toBe('');
  });

  it('marks nobody outside a battleground', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS);

    h.poll();

    expect(h.carryOf(BOSS)).toBe('');
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

  // The name came out of your own spellbook, so it is the game's own and carries no mark.
  // `arcane_shot` is displayed as "Fell Shot", so a worked-out name would have read as "Arcane
  // Shot".
  it('uses the real name for something in your spellbook and marks nothing', async () => {
    const h = await run();
    const duelist = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });

    h.poll();
    h.frame();

    expect(h.castLabelOf(DUELIST)).toBe('Fell Shot');
  });

  // A cast carries no school anywhere on the wire, and the only place one could be recovered is
  // your own spellbook. Tinting the handful of casts that happen to be in it would make the
  // colour mean "you know this one" rather than "this is fire".
  it('never tints a cast bar, including one it could have tinted', async () => {
    const h = await run();
    const duelist = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });

    h.poll();
    h.frame();

    expect(h.castClassesOf(DUELIST).some((name) => name.startsWith('woc-bar-school-'))).toBe(false);
  });

  // A cast id is sometimes an ACTIVITY sentinel rather than an ability: gathering, fishing and
  // the crafting family all ride the same cast machinery, and the set grows with the game. The
  // plate draws it like any other cast, marked as worked out, which is what the unit is doing.
  // The case is here to fail if anyone adds an exclusion list of sentinels, since such a list
  // is stale the day the game adds one.
  it('draws a bar for an activity cast rather than hiding it', async () => {
    const h = await run();
    const crafter = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(crafter, { ability: 'crafting', remaining: 3, total: 4 });

    h.poll();
    h.frame();

    expect(h.castShown(DUELIST)).toBe(true);
    expect(h.castLabelOf(DUELIST)).toBe('Crafting?');
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

  // The recoverable half: an aura's id is the applying ability's id, and a player carries their
  // class on the entity, so this one resolves real art.
  it('resolves art for an effect a player applied', async () => {
    const h = await run();
    h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'arcane_shot', name: 'Fell Shot', sourceId: DUELIST });

    h.poll();

    const art = h.tilesOf(BOSS)[0]?.querySelector('.woc-tile-art');
    expect(art?.getAttribute('src')).toContain('arcane_shot');
  });

  // The unrecoverable half. Every aura icon in the game is painted on a canvas from a bundled
  // recipe and no aura art is served, so a mob's effect gets its school colour and its
  // countdown instead of a picture, which is what that tile means rather than one that failed.
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

  // A control aura is not the ability's own id: the game builds it as `${ability.id}_slow` and
  // fifteen more like it, so the whole id is art that can never exist and the ability under it
  // is art that does. A slow, a stun and a root are most of what a player lands on a nameplate.
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

  // Nothing reports an effect landing on a unit that was already nearby. The sampler is what
  // covers it, and a strip that waited for a watch key would never move at all.
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
  // Drawn rather than written. "Skull" as a word was the weakest thing on the plate and
  // the widest, and the game's own geometry reproduces exactly: there is no file to
  // fetch, because mark art is composited at run time, but the paths are transcribable.
  it('draws the mark the game draws, and says its name to a screen reader', async () => {
    const h = await run();
    h.unit(BOSS);
    h.mark(BOSS, 0);

    h.poll();

    expect(h.markPathOf(BOSS)).toContain(STAR_PATH_START);
    expect(h.markLabelOf(BOSS)).toBe('Star');
    expect(h.markOf(BOSS)).toBe('');
  });

  it('fills each mark with the colour the game files it under', async () => {
    const h = await run();
    h.unit(BOSS);
    h.mark(BOSS, 0);

    h.poll();

    expect(h.plateOf(BOSS)?.innerHTML).toContain(STAR_COLOUR);
  });

  // Every one of the eight has to draw something, and the three the generic path cannot
  // reach are the ones to prove: the crescent is two circles, the cross is two stroked
  // bars with no fill at all, and the skull carries its features over the top.
  it('draws all eight, the three special cases included', async () => {
    const h = await run();
    h.unit(BOSS);

    for (const at of [0, 1, 2, 3, 4, 5, 6, 7]) {
      h.mark(BOSS, at);
      h.sample();

      expect(h.markLabelOf(BOSS)).toBe(MARK_NAMES[at]);
      expect(h.plateOf(BOSS)?.querySelector('.woc-fm-mark svg')).not.toBeNull();
    }
  });

  it('says nothing about a unit nobody marked', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();

    expect(h.markOf(BOSS)).toBe('');
    expect(h.markLabelOf(BOSS)).toBe('');
  });

  // The slot holds a raid mark and nothing else. The game's own `$` and its elite
  // diamond both live here on its plate, and neither is copied: rank is already on the
  // level and on the bar's edge, and a lootable corpse gets no plate here at all.
  it('keeps a raid mark on a dead player', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });
    h.mark(DUELIST, 0);

    h.poll();

    expect(h.markLabelOf(DUELIST)).toBe('Star');
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

  // Turning a world overlay off leaves a screen indistinguishable from an addon that has
  // stopped working, and there is no panel left to find the way back from. So the off message
  // names the chord, in the spelling a keyboard uses rather than the manifest's.
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

// Rank, which no snapshot carries and this addon does not work out for itself.
//
// `longwatch` publishes the table the game's own `MOBS` is the source of, and every case
// here is about what arrives on the bus rather than about anything on an entity. The
// companion GATES NOTHING: with nothing published a plate is what it was before, which is
// the first case below and the one that keeps the rest honest.
describe('what a plate says about rank', () => {
  it('draws a plain level with nobody publishing a table', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12 });

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12');
    expect(h.strokeOf(BOSS)).toBe('');
  });

  // The suffix is the game's own spelling for an elite. The COLOUR is on the health
  // bar's edge rather than on the level, which is where the game puts rank and which
  // is what gives the level back to the con band.
  it('marks an elite the way the game writes one, and edges its bar', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'ancient_guardian' });
    h.ranks([{ id: 'ancient_guardian', name: 'Ancient Guardian', rank: 'elite' }]);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12+');
    expect(h.strokeOf(BOSS)).toContain(ELITE_COLOUR);
    expect(h.levelColourOf(BOSS)).toBe(CON_GREY);
  });

  // The game separates the two with a heavier frame, and here that is literally the
  // edge: a boss is two pixels of red where an elite is one of gold.
  it('marks a boss apart from an elite', async () => {
    const h = await run();
    h.unit(BOSS, { level: 20, templateId: 'nythraxis' });
    h.ranks([{ id: 'nythraxis', name: 'Nythraxis', rank: 'boss' }]);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('20++');
    expect(h.strokeOf(BOSS)).toContain(BOSS_COLOUR);
    expect(h.strokeOf(BOSS)).toContain('2px');
  });

  it('leaves a template the table does not name alone', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'boss_wolf' });
    h.ranks([{ id: 'ancient_guardian', name: 'Ancient Guardian', rank: 'elite' }]);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12');
  });

  // One malformed row must not cost the others, which is the whole reason a payload is
  // validated rather than trusted: it comes from another addon, not from the loader.
  it('takes the rows it can read out of a table carrying rubbish', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'ancient_guardian' });
    h.ranks([null, 42, { name: 'no id' }, { id: 'ancient_guardian', name: 'AG', rank: 'elite' }]);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12+');
  });

  it('ignores a payload that is not a table at all', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'ancient_guardian' });
    h.ranks(null);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12');
  });
});

// The gate the game applies itself: a quest-exclusive mob is hidden outright, with no
// nameplate and no health bar, for anybody not on the quest. Drawing over it turns a
// clutch of eggs that should read as scenery into a row of targets.
describe('a quest-gated mob', () => {
  const clutch = [{ id: 'spider_egg', name: 'Spider Egg', requiresQuestId: 'q_broodmother' }];

  it('gets no plate for a player who is not on the quest', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'spider_egg' });
    h.ranks(clutch);

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('gets one once the quest is under way', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'spider_egg' });
    h.quest('q_broodmother', 'active');
    h.ranks(clutch);

    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });

  // With no rank service installed nothing is gated, because nothing said this template
  // was gated. An addon that hid on a guess would hide mobs the game shows.
  it('gets one when nobody published a table', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'spider_egg' });

    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });
});

// What a player is DOING, which is four fields the wire has always carried and no plate
// in the game draws together. Each is absent on the plate until it is true, which is what
// lets them share a row with a name.
describe('what a plate says a player is doing', () => {
  it('prefixes an away player the way the game does', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', name: 'Anserra', afk: true });

    h.poll();

    expect(h.nameOf(HEALER)).toBe('<AFK> Anserra');
  });

  it('leaves a name alone when nobody is away', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', name: 'Anserra' });

    h.poll();

    expect(h.nameOf(HEALER)).toBe('Anserra');
  });

  // The wire folds sitting, eating and drinking into one bit, so one honest word covers
  // all three: what a fight cares about is that they have to stand up first.
  it('says a resting player is resting', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', sitting: true });

    h.poll();

    expect(h.noteOf(HEALER)).toBe('resting');
  });

  it('says a mounted player is mounted', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', mountKey: 'valorsteed' });

    h.poll();

    expect(h.noteOf(HEALER)).toBe('mounted');
  });

  // The game does not let both happen, and if it ever did, leaving is the more actionable
  // of the two: a mounted player is going somewhere.
  it('says mounted when a mounted player also reads as resting', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, {
      kind: 'player',
      templateId: 'priest',
      sitting: true,
      mountKey: 'valorsteed',
    });

    h.poll();

    expect(h.noteOf(HEALER)).toBe('mounted');
  });

  // Every one of these fields exists on a mob too, holding an inert default forever, which
  // is the trap the published types warn about. A mob is never asked.
  it('says nothing about a mob', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { sitting: true, mountKey: 'valorsteed', afk: true });

    h.poll();

    expect(h.noteOf(BOSS)).toBe('');
    expect(h.nameOf(BOSS)).toBe(`Unit${String(BOSS)}`);
  });

  // A disclosure about the account rather than about the moment, which is why it is its
  // own tag: it is true whatever that account is doing.
  it('tags an AI-operated account, beside whatever it is doing', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', aiAccount: true, sitting: true });

    h.poll();

    expect(h.aiOf(HEALER)).toBe('AI');
    expect(h.noteOf(HEALER)).toBe('resting');
  });

  it('tags nobody else', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest' });

    h.poll();

    expect(h.aiOf(HEALER)).toBe('');
  });
});

// The con bands, which are the one number a player reads before deciding to pull. The
// game's own NAMEPLATE spread, not its tooltip's: `mobNameColor` and `mobTooltipConColor`
// sit next to each other in the game's own source with deliberately different bands, and
// taking the wrong one puts a plate a band out from the game the player read last week.
describe('what a level is coloured by', () => {
  it('reads red three levels above you and up', async () => {
    const h = await run();
    h.unit(BOSS, { level: PLAYER_LEVEL + 3 });

    h.poll();

    expect(h.levelColourOf(BOSS)).toBe(CON_RED);
  });

  it('reads orange one to two above', async () => {
    const h = await run();
    h.unit(BOSS, { level: PLAYER_LEVEL + 2 });

    h.poll();

    expect(h.levelColourOf(BOSS)).toBe(CON_ORANGE);
  });

  it('reads yellow at your own level', async () => {
    const h = await run();
    h.unit(BOSS, { level: PLAYER_LEVEL });

    h.poll();

    expect(h.levelColourOf(BOSS)).toBe(CON_YELLOW);
  });

  it('reads grey once it is trivial', async () => {
    const h = await run();
    h.unit(BOSS, { level: PLAYER_LEVEL - 6 });

    h.poll();

    expect(h.levelColourOf(BOSS)).toBe(CON_GREY);
  });

  // A player three levels above you is not a harder pull, they are a person. The game
  // con-colours no player's level and neither does this.
  it('leaves a player uncoloured', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', hostile: false, level: PLAYER_LEVEL + 5 });

    h.poll();

    expect(h.levelColourOf(HEALER)).toBe('');
  });

  // A pet takes its owner's side, and the game gives a friendly one the friendly green
  // outright rather than any band: your own boar is not a pull at all.
  it('gives a friendly pet the friendly colour rather than a band', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', hostile: false });
    h.unit(ADD, { hostile: false, ownerId: HEALER, level: PLAYER_LEVEL + 4 });

    h.poll();

    expect(h.levelColourOf(ADD)).toBe(CON_FRIENDLY);
  });
});

// What you have selected, and what you have saved up to spend on it. Both are things the
// game's own plate says and this one did not, so a player switching the game's plates off
// was losing them.
describe('the current target', () => {
  it('steps its name up and edges its bar', async () => {
    const h = await run();
    h.unit(BOSS);
    h.target(BOSS);

    h.poll();

    expect(h.nameSizeOf(BOSS)).toBe(TARGET_FONT);
    expect(h.strokeOf(BOSS)).toContain(TARGET_STROKE);
  });

  it('leaves everything else at its own size', async () => {
    const h = await run();
    h.unit(BOSS);
    h.unit(ADD);
    h.target(BOSS);

    h.poll();

    expect(h.nameSizeOf(ADD)).toBe('');
    expect(h.strokeOf(ADD)).toBe('');
  });

  // Rank wins the edge, because a boss is a boss whether or not you have clicked it.
  it('gives the edge to rank where both would draw one', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'nythraxis' });
    h.ranks([{ id: 'nythraxis', name: 'Nythraxis', rank: 'boss' }]);
    h.target(BOSS);

    h.poll();

    expect(h.strokeOf(BOSS)).toContain(BOSS_COLOUR);
  });

  it('lights one pip per combo point, over the target alone', async () => {
    const h = await run();
    h.unit(BOSS);
    h.unit(ADD);
    h.target(BOSS);
    h.combo(3);

    h.poll();

    expect(h.pipsOf(BOSS)).toBe(3);
    expect(h.pipsOf(ADD)).toBe(0);
  });

  it('draws no pips at all with none saved up', async () => {
    const h = await run();
    h.unit(BOSS);
    h.target(BOSS);
    h.combo(0);

    h.poll();

    expect(h.pipsOf(BOSS)).toBe(0);
    expect(h.pipsShown(BOSS)).toBe(false);
  });

  // The game caps them at five and stops drawing on a corpse, and a transient overshoot
  // must not overflow the row.
  it('caps at five and drops them on a dead target', async () => {
    const h = await run({ show: 'everything' });
    const boss = h.unit(BOSS);
    h.target(BOSS);
    h.combo(9);
    h.poll();
    expect(h.pipsOf(BOSS)).toBe(5);

    setField(boss, 'dead', true);
    h.sample();

    expect(h.pipsOf(BOSS)).toBe(0);
  });
});

// A corpse. A dead PLAYER keeps a plate and a dead mob does not, and the difference is
// which of them the player can switch the game's own plate off for.
describe('a corpse', () => {
  // The game draws this corpse's plate and its `$` whatever the player does:
  // `showNameplates` hides living mobs only, so the V key leaves every corpse on screen.
  // A plate here would be the same fact twice, for everybody, permanently.
  it('draws no plate over a lootable mob, which the game always plates itself', async () => {
    const h = await run();
    h.unit(BOSS, { dead: true, lootable: true });

    h.poll();

    expect(h.drawn()).not.toContain(BOSS);
  });

  it('drops a mob with nothing on it', async () => {
    const h = await run();
    h.unit(BOSS, { dead: true, lootable: false });

    h.poll();

    expect(h.drawn()).not.toContain(BOSS);
  });

  // `dead` is match-wide in a battleground by design, so a grey plate on the far five is
  // the reading a scoreboard cannot draw: it is on the people rather than in a panel.
  it('keeps a dead player and greys the name', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });

    h.poll();

    expect(h.drawn()).toContain(DUELIST);
    expect(h.nameColourOf(DUELIST)).toBe(CORPSE_NAME);
  });

  it('shows nothing that was true of them alive', async () => {
    const h = await run({ show: 'everything' });
    const one = h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });
    h.afflict(one, { id: 'serpent_sting', kind: 'dot' });

    h.poll();

    expect(h.tilesOf(DUELIST)).toHaveLength(0);
  });

  // There is no toggle for an npc plate anywhere in the game, so a second one under it
  // is noise nobody asked for and nobody can turn off.
  it('draws no plate over an npc, whatever the setting says', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'npc', hostile: false, name: 'Brother Aldric' });

    h.poll();

    expect(h.drawn()).not.toContain(HEALER);
  });
});

// Stealth, which the game draws by taking the whole plate down to a bit over half.
describe('a stealthed unit', () => {
  it('draws its plate fainter than the same unit unstealthed', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { x: 5 });
    h.poll();
    h.frame();
    const plain = Number(h.fadeOf(BOSS));

    h.afflict(boss, { id: 'shadowmeld', kind: 'stealth' });
    h.sample();
    h.frame();

    expect(Number(h.fadeOf(BOSS))).toBeCloseTo(plain * STEALTH_FADE, 5);
  });

  // Multiplied into the distance fade rather than replacing it, or a stealthed unit at
  // seventy yards would read as nearer than a visible one at thirty.
  it('keeps fading with distance while stealthed', async () => {
    const h = await run({ show: 'everything' });
    const near = h.unit(BOSS, { x: 5 });
    const far = h.unit(ADD, { x: 50 });
    h.afflict(near, { id: 'shadowmeld', kind: 'stealth' });
    h.afflict(far, { id: 'shadowmeld', kind: 'stealth' });

    h.poll();
    h.frame();

    expect(Number(h.fadeOf(ADD))).toBeLessThan(Number(h.fadeOf(BOSS)));
  });
});

// Everything in this block is something NEITHER plate says: not this one before now, and
// not the game's own either. That is the bar for adding to a 132px row.
describe('what no nameplate says', () => {
  // A unit at 40 percent with a shield worth another 30 is not a unit at 40 percent, and
  // every plate in the game says it is. The game draws this on its unit frames only.
  it('lays a shield over the health bar past where health ends', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { hp: 40, maxHp: 100 });
    h.afflict(boss, { id: 'power_word_shield', kind: 'absorb', value: 30 });

    h.poll();
    h.frame();

    expect(h.absorbOf(BOSS)).toEqual({ left: '40%', width: '30%' });
  });

  it('sums every shield on a unit', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { hp: 40, maxHp: 100 });
    h.afflict(boss, { id: 'power_word_shield', kind: 'absorb', value: 20 });
    h.afflict(boss, { id: 'ice_barrier', kind: 'absorb', value: 10 });

    h.poll();
    h.frame();

    expect(h.absorbOf(BOSS).width).toBe('30%');
  });

  // A shield bigger than the missing health is a full bar and no more: the overlay stops
  // at the end rather than running past it.
  it('stops a shield at the end of the bar', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { hp: 90, maxHp: 100 });
    h.afflict(boss, { id: 'power_word_shield', kind: 'absorb', value: 50 });

    h.poll();
    h.frame();

    expect(h.absorbOf(BOSS).width).toBe('10%');
  });

  it('draws no shield for a unit that has none', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();
    h.frame();

    expect(h.absorbShown(BOSS)).toBe(false);
  });

  // The classic grey. Nothing in the game says this anywhere, and without it a plate
  // offers you a fight whose reward is somebody else's.
  it('greys a mob somebody else tapped', async () => {
    const h = await run();
    h.unit(BOSS, { tappedById: DUELIST });

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(TAPPED_NAME);
  });

  it('leaves your own tap alone', async () => {
    const h = await run();
    h.unit(BOSS, { tappedById: PLAYER_ID });

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(HOSTILE_NAME);
  });

  // A group's tap is the group's. Reading the party is what keeps a plate from greying
  // out the mob your own healer just pulled.
  it('counts a party member as you', async () => {
    const h = await run();
    h.unit(BOSS, { tappedById: HEALER });
    h.party([PLAYER_ID, HEALER]);

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(HOSTILE_NAME);
  });

  // The fixture trap this cost a change to `liveEntity` to avoid: nullable numbers mean
  // nobody, and a generated 0 is a real entity id that would grey every mob in the world.
  it('reads an untapped mob as untapped rather than as entity zero', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(HOSTILE_NAME);
  });

  it('draws a pool for a caster mob and nothing for a wolf', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { resourceType: 'mana', resource: 30, maxResource: 60 });
    h.unit(ADD);

    h.poll();

    expect(h.powerOf(BOSS)).toBe('50%');
    // The game's own token, so the strip is the blue a player already reads as mana on
    // their own frame and it follows the game's theme picker.
    expect(h.powerColourOf(BOSS)).toBe('var(--color-mana)');
    expect(h.powerShown(ADD)).toBe(false);
  });

  // `resourceType` is the honest test: a drained caster and a resource-less wolf both
  // read zero, and only one of them has a pool at all.
  it('keeps the pool of a caster drained to nothing', async () => {
    const h = await run();
    h.unit(BOSS, { resourceType: 'mana', resource: 0, maxResource: 60 });

    h.poll();

    expect(h.powerShown(BOSS)).toBe(true);
    expect(h.powerOf(BOSS)).toBe('0%');
  });

  // The one thing about a cast bar that changes what a player does, and the game says it
  // nowhere. The tone waited for this: on every mob cast it would mark the world urgent.
  it('says a cast is coming at you, and tones the bar', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'arcane_shot', remaining: 1.5, total: 2 });
    setField(boss, 'castTargetId', PLAYER_ID);

    h.poll();
    h.frame();

    expect(h.atYouOf(BOSS)).toBe('at you');
    expect(h.castClassesOf(BOSS)).toContain('woc-bar-danger');
  });

  it('leaves a cast at somebody else untoned', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'arcane_shot', remaining: 1.5, total: 2 });
    setField(boss, 'castTargetId', HEALER);

    h.poll();
    h.frame();

    expect(h.atYouOf(BOSS)).toBe('');
    expect(h.castClassesOf(BOSS)).not.toContain('woc-bar-danger');
  });

  // Absence is not evidence: the field is only ever read as a positive, so an untargeted
  // cast reads exactly like one aimed at somebody else and neither claims anything.
  it('claims nothing for a cast with no target at all', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'arcane_shot', remaining: 1.5, total: 2 });

    h.poll();
    h.frame();

    expect(h.atYouOf(BOSS)).toBe('');
  });

  it('says when a taunt of yours is holding a mob, and for how long', async () => {
    const h = await run();
    h.unit(BOSS, { forcedTargetId: PLAYER_ID, forcedTargetTimer: 2.5 });

    h.poll();

    expect(h.tauntOf(BOSS)).toBe('taunt 2.5s');
  });

  it('says nothing about a taunt holding somebody else', async () => {
    const h = await run();
    h.unit(BOSS, { forcedTargetId: HEALER, forcedTargetTimer: 2.5 });

    h.poll();

    expect(h.tauntOf(BOSS)).toBe('');
  });

  // The difference between a stun a trinket clears and one an encounter owns. Said in
  // words because the tile's only free channel is a border that already carries school.
  it('marks control an encounter owns', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'gravebreaker_stun', kind: 'stun', unbreakableControl: true });

    h.poll();

    expect(h.tileLabelOf(BOSS, 0)).toContain('unbreakable');
    expect(h.tileClassesOf(BOSS, 0)).toContain('woc-tile-danger');
  });

  it('leaves an ordinary stun alone', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'concussive_shot_stun', kind: 'stun' });

    h.poll();

    expect(h.tileLabelOf(BOSS, 0)).not.toContain('unbreakable');
    expect(h.tileClassesOf(BOSS, 0)).not.toContain('woc-tile-danger');
  });
});

// A rare and an elite are two independent flags on the game's own template, and four of
// the game's rares carry no rank at all: Grubjaw the Glutton is a level 12 troll that
// reads exactly like the two ordinary trolls beside it. The game's own plate says nothing
// about a rare either, so this is a thing only an addon can say.
describe('a rare spawn', () => {
  it('says so for a rare that is not an elite', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'grubjaw' });
    h.ranks([{ id: 'grubjaw', name: 'Grubjaw the Glutton', rare: true }]);

    h.poll();

    expect(h.rareOf(BOSS)).toBe('rare');
    expect(h.levelOf(BOSS)).toBe('12');
  });

  // Both flags, both said: the level carries the rank and the tag carries the rarity,
  // which is what keeps a rare elite from reading as an ordinary elite.
  it('says both for a rare elite', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'aurelhorn' });
    h.ranks([{ id: 'aurelhorn', name: 'Aurelhorn, First of the Herd', rank: 'elite', rare: true }]);

    h.poll();

    expect(h.rareOf(BOSS)).toBe('rare');
    expect(h.levelOf(BOSS)).toBe('12+');
    expect(h.strokeOf(BOSS)).toContain(ELITE_COLOUR);
  });

  it('says nothing for an elite that is not rare', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'ancient_guardian' });
    h.ranks([{ id: 'ancient_guardian', name: 'Ancient Guardian', rank: 'elite' }]);

    h.poll();

    expect(h.rareOf(BOSS)).toBe('');
  });

  it('says nothing with nobody publishing a table', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'grubjaw' });

    h.poll();

    expect(h.rareOf(BOSS)).toBe('');
    expect(h.tagsShown(BOSS)).toBe(false);
  });
});

// What the bar says, where the words sit, and what the cast bar shows. Every case here
// answers a question a player asked of a live plate rather than one the code raised.
describe('reading a plate at a glance', () => {
  // A share says how much of a fight is left and a count says whether your next hit
  // finishes it. The plate said only the first, which cannot tell a boss from a critter.
  it('says the health count beside the share', async () => {
    const h = await run();
    h.unit(BOSS, { hp: 1347, maxHp: 2000 });

    h.poll();
    h.frame();

    expect(h.healthCountOf(BOSS)).toBe('1.3K');
    expect(h.healthOf(BOSS)).toBe('67%');
  });

  it('writes a small pool as itself rather than as a fraction of a thousand', async () => {
    const h = await run();
    h.unit(BOSS, { hp: 60, maxHp: 100 });

    h.poll();
    h.frame();

    expect(h.healthCountOf(BOSS)).toBe('60');
  });

  it('compacts a raid boss pool to its leading digits', async () => {
    const h = await run();
    h.unit(BOSS, { hp: 2_400_000, maxHp: 4_000_000 });

    h.poll();
    h.frame();

    expect(h.healthCountOf(BOSS)).toBe('2.4M');
  });

  // A corpse's zero is the word beside it, not a figure: "0 dead" says one thing twice.
  it('drops the count on a corpse and keeps the word', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });

    h.poll();
    h.frame();

    expect(h.healthCountOf(DUELIST)).toBe('');
    expect(h.healthOf(DUELIST)).toBe('dead');
  });

  // Art is filed per CLASS, and the only class an entity carries is a player's
  // templateId, so a player's cast resolves and a boss's cannot.
  it('draws the art for a player cast', async () => {
    const h = await run({ show: 'everything' });
    const rival = h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'hunter' });
    h.casts(rival, { ability: 'arcane_shot', remaining: 1.5, total: 2 });

    h.poll();
    h.frame();

    expect(h.castIconOf(DUELIST)).toContain('arcane_shot');
  });

  it('draws no art for a mob cast, which is filed nowhere', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'rift_thunderhead', remaining: 1.5, total: 2 });

    h.poll();
    h.frame();

    expect(h.castIconOf(BOSS)).toBe('');
  });

  // The words sit against what they are about: who somebody is rides the tail of the
  // name's own row, and what is about to happen sits under the cast bar. One row at the
  // bottom drifted down the plate as a cast bar and an effect strip came and went.
  it('puts the identity tags on the head row and the alert row under the cast', async () => {
    const h = await run();

    h.unit(BOSS);
    h.poll();

    expect(h.rowsOf(BOSS)).toEqual([
      'woc-fm-head',
      'woc-bar',
      'woc-fm-power',
      'woc-fm-pips',
      'woc-bar',
      'woc-fm-alerts',
      'woc-fm-strip',
    ]);
    expect(h.headPartsOf(BOSS)).toEqual([
      'woc-fm-mark',
      'woc-fm-name',
      'woc-fm-level',
      'woc-fm-tags',
    ]);
  });

  it('shows each row only for what belongs to it', async () => {
    const h = await run({ show: 'everything' });
    const rival = h.unit(DUELIST, { kind: 'player', hostile: false, sitting: true });
    h.casts(rival, { ability: 'arcane_shot', remaining: 1.5, total: 2 });
    setField(rival, 'castTargetId', PLAYER_ID);

    h.poll();
    h.frame();

    expect(h.tagsShown(DUELIST)).toBe(true);
    expect(h.noteOf(DUELIST)).toBe('resting');
    expect(h.alertsShown(DUELIST)).toBe(true);
    expect(h.atYouOf(DUELIST)).toBe('at you');
  });

  it('draws neither row for a plain mob', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();

    expect(h.tagsShown(BOSS)).toBe(false);
    expect(h.alertsShown(BOSS)).toBe(false);
  });
});

// A class is what a player is identified by before their name is read, and the game's own
// palette is the only honest one to draw it in: three addons drawing three blues for mage
// would be worse than none of them drawing any. So the kit carries the colour and this
// passes the id.
describe('the colour of a health bar', () => {
  it("takes a player's class", async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });

    h.poll();
    h.frame();

    expect(h.healthClassesOf(HEALER)).toContain('woc-bar-class-priest');
  });

  // `templateId` is a class on a player and a mob template on everything else, so passing
  // it unguarded would hand the kit `boss_wolf` and rely on it refusing.
  it('takes nothing from a mob, whose templateId is not a class', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'boss_wolf' });

    h.poll();
    h.frame();

    expect(h.healthClassesOf(BOSS).some((name) => name.startsWith('woc-bar-class-'))).toBe(false);
  });

  it('follows the unit when a plate is reused for somebody else', async () => {
    const h = await run({ show: 'everything' });
    const one = h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });
    h.poll();
    h.frame();

    setField(one, 'templateId', 'druid');
    h.sample();
    h.frame();

    expect(h.healthClassesOf(HEALER)).toContain('woc-bar-class-druid');
    expect(h.healthClassesOf(HEALER)).not.toContain('woc-bar-class-priest');
  });
});

// The one plate the game keeps whatever the player does. Show Player Nameplates spares
// the current target so a clicked player stays readable, which is the only place a player
// who switched the game's plates off still gets two of everything.
describe('the plate over a player you have selected', () => {
  // On by DEFAULT, which is safe only because this is the one case where hiding cannot
  // leave a hole: a player you have selected always has a game plate, either because the
  // toggle is on for everybody or because the target exception spared exactly them.
  it('gives way to the game’s own by default', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false });
    h.target(DUELIST);

    h.poll();

    expect(h.drawn()).not.toContain(DUELIST);
  });

  it('is drawn when the setting is switched off', async () => {
    const h = await run({ show: 'everything', 'hide-selected-player': false });
    h.unit(DUELIST, { kind: 'player', hostile: false });
    h.target(DUELIST);

    h.poll();

    expect(h.drawn()).toContain(DUELIST);
  });

  it('leaves every other player alone', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false });
    h.unit(HEALER, { kind: 'player', hostile: false });
    h.target(DUELIST);

    h.poll();

    expect(h.drawn()).toContain(HEALER);
  });

  // The mob rule has NO target exception, so with mob nameplates off a mob target has no
  // game plate to double. Hiding this one would leave the unit you are fighting bare.
  it('keeps a mob target, which the game does not spare', async () => {
    const h = await run();
    h.unit(BOSS);
    h.target(BOSS);

    h.poll();

    expect(h.drawn()).toContain(BOSS);
  });

  // It follows the selection rather than a unit, which is what makes it worth a setting
  // rather than a filter: the doubled plate moves as the player moves their target.
  it('follows the selection from one player to another', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false });
    h.unit(HEALER, { kind: 'player', hostile: false });
    h.target(DUELIST);
    h.poll();
    expect(h.drawn()).not.toContain(DUELIST);

    h.target(HEALER);
    h.sample();

    expect(h.drawn()).toContain(DUELIST);
    expect(h.drawn()).not.toContain(HEALER);
  });
});
