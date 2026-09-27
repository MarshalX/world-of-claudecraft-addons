// @vitest-environment happy-dom

// Facemark, run through the real loader.
//
// Nothing here delivers an event: casts, auras, marks and threat are written where the game
// keeps them (the entity, its aura array, the marker record, the mob's hate table).
//
// The shared fake camera resolves no unit, so `start` installs one: each entity's own position,
// with depth as distance from the origin. `blind()` removes it for the "do not draw" case.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { addonNamespace } from '../../loader/src/shared/storage-keys.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all.
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
/** A mob that is not hostile: neutral. */
const CRITTER = 904;

/** The addon's slow sampling cadence. */
const SLOW_MS = 100;
/** The addon's own account-wide key, holding whether the plates are drawn. */
const SHOWN_KEY = 'shown';
/** The chord the manifest binds the toggle to, in the manifest's own spelling. */
const TOGGLE = 'Alt+Shift+KeyF';
/** The manifest's default. */
const DRAW_DISTANCE = 60;
const MAX_AURAS = 4;

/** The game's own name colours, as the addon writes them. */
const HOSTILE_NAME = 'rgb(255 85 85)';
const FRIENDLY_NAME = 'rgb(127 184 255)';
const NEUTRAL_NAME = 'rgb(230 230 230)';
/** The game's threat red, on the edge of a plate that is on you. */
const EDGE_TOP = 'rgb(192 57 43)';
const EDGE_CALM = 'rgb(120 160 255 / 60%)';
/** The colour the game files the star mark under. */
const STAR_COLOUR = 'rgb(255 226 58)';
/** The game's team tokens, for the carrier tag. */
const TEAM_RED = 'var(--color-team-red)';
const TEAM_BLUE = 'var(--color-team-blue)';
/** The two battleground teams, by the index the game gives each. */
const CRIMSON = 0;
const AZURE = 1;
/** The companion that carries the mob rank table, and the topic it publishes on. */
const RANKER = 'official/longwatch';
const RANKS_TOPIC = 'mobs';
/** The game's elite gold and boss red, drawn on the health bar's edge. */
const ELITE_COLOUR = 'rgb(242 200 75)';
const BOSS_COLOUR = 'rgb(255 85 85)';
/** The game's nameplate con bands. */
const CON_RED = 'rgb(255 68 68)';
const CON_ORANGE = 'rgb(255 170 51)';
const CON_YELLOW = 'rgb(255 233 122)';
const CON_GREY = 'rgb(157 157 157)';
/** A friendly pet takes one colour rather than a band. */
const CON_FRIENDLY = 'rgb(159 220 127)';
/** The game's corpse grey. */
const CORPSE_NAME = 'rgb(187 187 187)';
/** Somebody else's tap. */
const TAPPED_NAME = 'rgb(150 150 150)';
/** The fixture player's level, which every con band is measured against. */
const PLAYER_LEVEL = 20;
/** A lit combo pip. */
const PIP_ON = 'rgb(255 226 58)';
/** The game's own translucency for a stealthed unit. */
const STEALTH_FADE = 0.55;
/** The current target's name step, and the edge the game draws around its bar. */
const TARGET_FONT = '13px';
const TARGET_STROKE = 'rgb(255 255 255 / 67%)';
/** The start of the star's path, to tell one drawn mark from another. */
const STAR_PATH_START = 'M 0,-42';
/** The game's mark order, as a screen reader is told it. */
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
  /** Control an encounter owns, which no player action breaks. */
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
  /** The owning player, for a pet. Null on everything wild. */
  ownerId?: number | null;
  /** The /afk display bit, which the player sets themselves. */
  afk?: boolean;
  /** Sitting, EATING or DRINKING: the wire folds all three into this one bit. */
  sitting?: boolean;
  /** A mount key, or empty on foot. Not an item id, and never resolves to art. */
  mountKey?: string;
  /** The operator-set mark on an AI-operated account. */
  aiAccount?: boolean;
  cheaterMark?: boolean;
  /** Whether a corpse has loot on it. */
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

/** A part's colour, or empty when hidden: a hidden tag keeps its last colour. */
function shownColour(part: HTMLElement | null): string {
  if (part === null || part.style.display === 'none') {
    return '';
  }
  return part.style.color;
}

/**
 * The player-only fields, defaulted to an idle player. `mountKey` is empty on foot; the
 * fixture's generated string would read as every unit mounted.
 */
function playerState(spec: UnitSpec): Fake {
  return {
    afk: spec.afk ?? false,
    sitting: spec.sitting ?? false,
    mountKey: spec.mountKey ?? '',
    aiAccount: spec.aiAccount ?? false,
    cheaterMark: spec.cheaterMark ?? false,
  };
}

/**
 * Corpse, tap, pool and taunt fields. The id fields mean "nobody" as null, never 0:
 * `tappedById: 0` is a real entity id and would make every fixture mob somebody else's kill.
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

/** One battleground roster row, in the game's `players` shape (which carries no health). */
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

/** Cast state on the entity, where the game puts it. */
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
  /** Write one row of a mob's hate table. */
  hate: (entity: Fake, entityId: number, threat: number) => void;
  /** Place a raid mark in the world's marker record. */
  mark: (id: number, index: number) => void;
  /** Put the player in a duel. */
  duel: (otherPid: number) => void;
  /** Put the player in a battleground on Crimson; `carrying` is whoever holds a flag. */
  battleground: (spec: { enemies: number[]; allies?: number[]; carrying?: number }) => void;
  /** End whatever bout is on, clearing both keys as the game does. */
  endBout: () => void;
  /** Re-read the world, turning a set change into a handler call. */
  poll: () => void;
  /** Advance the slow sampler one tick. */
  sample: () => void;
  /** Run the loader's frame loop once. */
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
  /** The level's con colour. */
  levelColourOf: (id: number) => string;
  /** The one word saying what a player is doing, or empty. */
  noteOf: (id: number) => string;
  /** The AI-account tag, or empty. */
  aiOf: (id: number) => string;
  /** The operators' Cheater tag, or empty. */
  cheaterOf: (id: number) => string;
  /** The Cheater tag's `display`, which decides whether it costs the row a gap. */
  cheaterDisplayOf: (id: number) => string;
  /** Publish a mob rank table as the companion addon would. */
  ranks: (rows: unknown) => void;
  /** Put one quest in the log. */
  quest: (questId: string, state: 'active' | 'ready' | 'done') => void;
  /** What the mark slot holds as text. */
  markOf: (id: number) => string;
  markColourOf: (id: number) => string;
  /** The mark's accessible name. */
  markLabelOf: (id: number) => string;
  /** The first path in the drawn mark, so a shape can be told from another shape. */
  markPathOf: (id: number) => string;
  /** The health bar's edge, where rank and the current target are drawn. */
  strokeOf: (id: number) => string;
  /** How many combo pips are lit over this unit. */
  pipsOf: (id: number) => number;
  /** Whether the pip row is on screen at all. */
  pipsShown: (id: number) => boolean;
  /** The name's own font size, which the current target steps up. */
  nameSizeOf: (id: number) => string;
  /** Select a unit (`player.targetId`). */
  target: (id: number | null) => void;
  /** Your own combo points. */
  combo: (points: number) => void;
  /** Whether the identity row under the name is on screen at all. */
  tagsShown: (id: number) => boolean;
  /** Whether the alert row under the cast bar is on screen at all. */
  alertsShown: (id: number) => boolean;
  /** The health bar's left-hand count. */
  healthCountOf: (id: number) => string;
  /** The health bar's classes, where the kit records a class tint. */
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
  /** The pool's fill colour. */
  powerColourOf: (id: number) => string;
  /** The taunt tag, or empty. */
  tauntOf: (id: number) => string;
  /** The rare tag. */
  rareOf: (id: number) => string;
  /** The alert-row words for a cast pointed at you. */
  atYouOf: (id: number) => string;
  /** One effect tile's accessible name. */
  tileLabelOf: (id: number, at: number) => string;
  tileClassesOf: (id: number, at: number) => string[];
  /** Put a party on the world. */
  party: (pids: readonly number[]) => void;
  /** The plate's transform: declutter shift and scale. */
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
 * Start the addon over a world holding only you. The spellbook's `arcane_shot` displays as
 * "Fell Shot", so a name derived from an id is a guess.
 */
async function start(
  settings: Record<string, unknown> = {},
  storage: FakeStorage = createFakeStorage(),
): Promise<FacemarkHarness> {
  // `kind` is stated: the fixture's default '' makes your own pet's owner not a player, so the
  // pet reads neutral.
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
    // A real ability whose id ends in an `AURA_SUFFIXES` tail.
    {
      def: { id: 'dismiss_pet', name: 'Release Companion', school: 'physical' },
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
    },
  ];
  // Loosely typed: `duelInfo` and `bgInfo` are written later, absent until a bout starts.
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
  // The unit point is the entity's position and the projector turns it into depth.
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
          // Null means "nobody"; a 0 makes every wild mob a pet of entity 0.
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
    cheaterOf: (id) => textOf(id, '.woc-fm-cheater'),
    cheaterDisplayOf: (id) => partOf(id, '.woc-fm-cheater')?.style.display ?? '',
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
 * `start`, plus the wait for the stored on/off value to land: the plates draw first and are
 * corrected a microtask later.
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

  // Casts, effects, marks and hate tables are all world state, not socket frames.
  it('asks for no network permission', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'keys']);
  });

  // The highest member read is `Entity.cheaterMark`, published at minor 7.
  it('declares the minor the surface it reads was added in', () => {
    expect(manifest().apiMinor).toBe(7);
  });

  // `over: 'head'` resolves the model height, so an offset's only correct value is zero.
  it('offers no plate offset setting', () => {
    const ids = (manifest().settings ?? []).map((setting) => setting.id);
    expect(ids).not.toContain('offset');
    expect(ids.some((id) => id.includes('height'))).toBe(false);
  });
});

describe('where a plate is put', () => {
  it('anchors over the head rather than at the unit position', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();
    h.frame();

    expect(h.overs()).toContain('head');
    expect(h.overs()).not.toContain('body');
  });

  // The head point is null where the game draws no model; the plate must hide, not freeze.
  it('hides the plate when the camera cannot resolve the point', async () => {
    const h = await run();
    h.unit(BOSS);
    h.poll();
    h.frame();
    expect(h.fadeOf(BOSS)).toBe('1');

    h.blind();
    h.frame();

    expect(h.fadeOf(BOSS)).toBe('0');
  });

  it('fades a farther plate more than a nearer one', async () => {
    const h = await run();
    h.unit(BOSS, { x: 5 });
    h.unit(ADD, { x: 38 });

    h.poll();
    h.frame();

    expect(Number(h.fadeOf(ADD))).toBeLessThan(Number(h.fadeOf(BOSS)));
    expect(Number(h.fadeOf(ADD))).toBeGreaterThan(0);
  });

  // The fade follows the camera, so it moves in the frame loop rather than the slow pass.
  it('fades on a frame without waiting for the next sample', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { x: 5 });
    h.poll();
    h.frame();
    expect(h.fadeOf(BOSS)).toBe('1');

    setField(boss, 'pos', { x: 55, y: 0, z: 0 });
    h.frame();

    expect(Number(h.fadeOf(BOSS))).toBeLessThan(1);
  });

  // Spread around the pair's middle, so a third arriving moves each neighbour half a step.
  it('spreads two overlapping plates around their middle', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { x: 5 });
    h.unit(ADD, { x: 5 });

    h.poll();
    h.frame();

    expect(h.transformOf(BOSS)).toContain('translateY(-10px)');
    expect(h.transformOf(ADD)).toContain('translateY(10px)');
  });

  it('leaves plates that do not overlap unshifted', async () => {
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

describe('which units get a plate', () => {
  // Only under 'everything' does the self check do the work; the default filters you as friendly.
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

  it('drops the plate when the unit leaves scope', async () => {
    const h = await run();
    h.unit(BOSS);
    h.poll();
    expect(h.drawn()).toEqual([BOSS]);

    h.gone(BOSS);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('gives a mob corpse no plate', async () => {
    const h = await run();
    h.unit(BOSS, { dead: true });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('gives a unit with no health no plate', async () => {
    const h = await run({ show: 'everything' });
    h.unit(CRITTER, { kind: 'object', hostile: false, hp: 0, maxHp: 0 });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });
});

// Nearest to the player, not the camera, so turning the camera changes nothing.
describe('the cap', () => {
  it('keeps the nearest units and drops the rest', async () => {
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

  // Nothing reports a health change, so health is repainted every frame.
  it('follows health changes with no set change', async () => {
    const h = await run();
    const boss = h.unit(BOSS, { hp: 100, maxHp: 100 });
    h.poll();
    h.frame();
    expect(h.healthOf(BOSS)).toBe('100%');

    setField(boss, 'hp', 25);
    h.frame();

    expect(h.healthOf(BOSS)).toBe('25%');
  });

  // `dead` stays true through both halves of dying; only `ghost` tells them apart.
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

// Every player here has `hostile: false`, as the game sends it, so red can only come from the
// bout roster.
describe('which side a player is on', () => {
  it('colours a duel opponent hostile', async () => {
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

  it('colours battleground enemies hostile and allies friendly', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });
    h.battleground({ enemies: [DUELIST], allies: [HEALER] });

    h.poll();

    expect(h.nameColourOf(DUELIST)).toBe(HOSTILE_NAME);
    expect(h.nameColourOf(HEALER)).toBe(FRIENDLY_NAME);
  });

  it('plates an enemy player when asked for hostiles alone', async () => {
    const h = await run({ show: 'hostile' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.battleground({ enemies: [DUELIST] });

    h.poll();

    expect(h.drawn()).toEqual([DUELIST]);
  });

  it('forgets the roster when the bout ends', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.duel(DUELIST);
    h.poll();
    expect(h.nameColourOf(DUELIST)).toBe(HOSTILE_NAME);

    h.endBout();
    h.sample();

    expect(h.nameColourOf(DUELIST)).toBe(FRIENDLY_NAME);
  });

  // A pet takes its owner's side; its own flag would read neutral.
  it("colours an enemy player's pet hostile", async () => {
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

describe('the flag carrier', () => {
  it("marks an enemy carrier in their side's colour", async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'rogue' });
    h.battleground({ enemies: [DUELIST], carrying: DUELIST });

    h.poll();

    expect(h.carryOf(DUELIST)).toBe(TEAM_RED);
  });

  it('marks an ally carrier in the other colour', async () => {
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

describe('what a plate says about a cast', () => {
  it('draws a bar for a mob cast', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 3, total: 4 });

    h.poll();
    h.frame();

    expect(h.castShown(BOSS)).toBe(true);
    expect(h.castLabelOf(BOSS)).toBe('Flame Pillar?');
  });

  // `arcane_shot` displays as "Fell Shot"; a derived name would read "Arcane Shot".
  it('uses the spellbook name, unmarked, for an ability you know', async () => {
    const h = await run();
    const duelist = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });

    h.poll();
    h.frame();

    expect(h.castLabelOf(DUELIST)).toBe('Fell Shot');
  });

  // Tinting only spellbook casts would make the colour mean "you know this one".
  it('never tints a cast bar, even for a spellbook ability', async () => {
    const h = await run();
    const duelist = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(duelist, { ability: 'arcane_shot', remaining: 2 });

    h.poll();
    h.frame();

    expect(h.castClassesOf(DUELIST).some((name) => name.startsWith('woc-bar-school-'))).toBe(false);
  });

  // Fails if someone adds a sentinel exclusion list: the game's sentinel set grows.
  it('draws a bar for an activity cast', async () => {
    const h = await run();
    const crafter = h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    h.casts(crafter, { ability: 'crafting', remaining: 3, total: 4 });

    h.poll();
    h.frame();

    expect(h.castShown(DUELIST)).toBe(true);
    expect(h.castLabelOf(DUELIST)).toBe('Crafting?');
  });

  it('hides the bar when the cast ends', async () => {
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

  it('draws no cast bar when casts are switched off', async () => {
    const h = await run({ casts: false });
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'flame_pillar', remaining: 3 });

    h.poll();
    h.frame();

    expect(h.castShown(BOSS)).toBe(false);
  });
});

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

  it('resolves art for an effect a player applied', async () => {
    const h = await run();
    h.unit(DUELIST, { kind: 'player', hostile: true, templateId: 'hunter' });
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'arcane_shot', name: 'Fell Shot', sourceId: DUELIST });

    h.poll();

    const art = h.tilesOf(BOSS)[0]?.querySelector('.woc-tile-art');
    expect(art?.getAttribute('src')).toContain('arcane_shot');
  });

  // Art is filed per player class, so a mob's effect has none.
  it('gives a mob effect a school colour and a countdown but no icon', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'molten_grip', school: 'fire', remaining: 4.2, sourceId: BOSS });

    h.poll();

    const [tile] = h.tilesOf(BOSS);
    expect(tile?.querySelector('.woc-tile-art')?.getAttribute('src')).toBe(null);
    expect(tile?.classList.contains('woc-tile-school-fire')).toBe(true);
    expect(tile?.querySelector('.woc-tile-value')?.textContent).toBe('4.2');
  });

  // A 30px tile has no room for a unit or, past ten seconds, a decimal.
  it('drops the unit and the decimal from a long tile countdown', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'molten_grip', remaining: 12.4, sourceId: BOSS });

    h.poll();

    expect(h.tilesOf(BOSS)[0]?.querySelector('.woc-tile-value')?.textContent).toBe('12');
  });

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

  it('puts your own effect first', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'their_dot', name: 'Their Dot', remaining: 1, sourceId: BOSS });
    h.afflict(boss, { id: 'my_dot', name: 'My Dot', remaining: 9, sourceId: PLAYER_ID });

    h.poll();

    expect(h.tilesOf(BOSS)[0]?.getAttribute('aria-label')).toContain('My Dot');
  });

  it('keeps the four soonest to expire', async () => {
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

  // Nothing reports an effect landing; the sampler covers it.
  it('picks up an effect that landed with no set change', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.poll();
    expect(h.tilesOf(BOSS)).toHaveLength(0);

    h.afflict(boss, { id: 'rend', name: 'Rend' });
    h.sample();

    expect(h.tilesOf(BOSS)).toHaveLength(1);
  });

  it('empties the strip when the effect falls off', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'rend', name: 'Rend' });
    h.poll();
    expect(h.tilesOf(BOSS)).toHaveLength(1);

    setField(boss, 'auras', []);
    h.sample();

    expect(h.tilesOf(BOSS)).toHaveLength(0);
  });

  it('draws no strip when effects are switched off', async () => {
    const h = await run({ auras: false });
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'rend', name: 'Rend' });

    h.poll();

    expect(h.tilesOf(BOSS)).toHaveLength(0);
  });
});

describe('the threat edge', () => {
  it("uses the game's threat colour when you are the top row", async () => {
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

  it('draws no edge on a player, who keeps no hate table', async () => {
    const h = await run({ show: 'players' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });

    h.poll();

    expect(h.edgeOf(HEALER)).toBe('transparent');
  });
});

describe('the raid mark', () => {
  it('draws the mark as a glyph and names it for a screen reader', async () => {
    const h = await run();
    h.unit(BOSS);
    h.mark(BOSS, 0);

    h.poll();

    expect(h.markPathOf(BOSS)).toContain(STAR_PATH_START);
    expect(h.markLabelOf(BOSS)).toBe('Star');
    expect(h.markOf(BOSS)).toBe('');
  });

  it("fills a mark with the game's colour for it", async () => {
    const h = await run();
    h.unit(BOSS);
    h.mark(BOSS, 0);

    h.poll();

    expect(h.plateOf(BOSS)?.innerHTML).toContain(STAR_COLOUR);
  });

  // The moon, cross and skull are special cases outside the generic path.
  it('draws all eight marks, the special cases included', async () => {
    const h = await run();
    h.unit(BOSS);

    for (const at of [0, 1, 2, 3, 4, 5, 6, 7]) {
      h.mark(BOSS, at);
      h.sample();

      expect(h.markLabelOf(BOSS)).toBe(MARK_NAMES[at]);
      expect(h.plateOf(BOSS)?.querySelector('.woc-fm-mark svg')).not.toBeNull();
    }
  });

  it('draws no mark on an unmarked unit', async () => {
    const h = await run();
    h.unit(BOSS);

    h.poll();

    expect(h.markOf(BOSS)).toBe('');
    expect(h.markLabelOf(BOSS)).toBe('');
  });

  it('keeps a raid mark on a dead player', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });
    h.mark(DUELIST, 0);

    h.poll();

    expect(h.markLabelOf(DUELIST)).toBe('Star');
  });
});

describe('hiding a plate that has nothing to say', () => {
  it('hides a full-health unit that is doing nothing', async () => {
    const h = await run({ 'hide-full': true });
    h.unit(BOSS, { hp: 100, maxHp: 100 });

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('keeps a full-health unit that is casting', async () => {
    const h = await run({ 'hide-full': true });
    const boss = h.unit(BOSS, { hp: 100, maxHp: 100 });
    h.casts(boss, { ability: 'flame_pillar', remaining: 3 });

    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });

  it('brings the plate back once the unit is hurt', async () => {
    const h = await run({ 'hide-full': true });
    const boss = h.unit(BOSS, { hp: 100, maxHp: 100 });
    h.poll();
    expect(h.drawn()).toEqual([]);

    setField(boss, 'hp', 90);
    h.sample();

    expect(h.drawn()).toEqual([BOSS]);
  });
});

describe('the toggle', () => {
  it('removes every plate', async () => {
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

  // Off looks like broken, so the toast names the chord, spelled as a keyboard shows it.
  it('names the key that brings the plates back', async () => {
    const h = await run();

    h.press(TOGGLE);

    expect(h.toasts().join(' ')).toContain('Press Alt+Shift+F');
  });

  it('names no key when the plates come back', async () => {
    const h = await run();
    h.press(TOGGLE);

    h.press(TOGGLE);

    expect(h.toasts().at(-1)).toBe('Facemark: plates on.');
  });

  it('stores the state account-wide', async () => {
    const h = await run();

    h.press(TOGGLE);
    await settleFrames();

    expect(await h.stored()).toBe(false);
  });

  it('starts with the plates off when off was stored', async () => {
    const storage = createFakeStorage();
    await storage.set(addonNamespace('official/facemark'), SHOWN_KEY, false);

    const h = await run({}, storage);
    h.unit(BOSS);
    h.poll();

    expect(h.drawn()).toEqual([]);
  });
});

describe('before world entry', () => {
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

// Rank arrives on the bus from `longwatch`; with nothing published, a plate is undecorated.
describe('what a plate says about rank', () => {
  it('draws a plain level with nobody publishing a table', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12 });

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12');
    expect(h.strokeOf(BOSS)).toBe('');
  });

  // Rank colours the bar's edge, so the level keeps its con colour.
  it('marks an elite as the game writes one and edges its bar', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'ancient_guardian' });
    h.ranks([{ id: 'ancient_guardian', name: 'Ancient Guardian', rank: 'elite' }]);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12+');
    expect(h.strokeOf(BOSS)).toContain(ELITE_COLOUR);
    expect(h.levelColourOf(BOSS)).toBe(CON_GREY);
  });

  it('marks a boss apart from an elite', async () => {
    const h = await run();
    h.unit(BOSS, { level: 20, templateId: 'nythraxis' });
    h.ranks([{ id: 'nythraxis', name: 'Nythraxis', rank: 'boss' }]);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('20++');
    expect(h.strokeOf(BOSS)).toContain(BOSS_COLOUR);
    expect(h.strokeOf(BOSS)).toContain('2px');
  });

  it('leaves a template the table does not name undecorated', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'boss_wolf' });
    h.ranks([{ id: 'ancient_guardian', name: 'Ancient Guardian', rank: 'elite' }]);

    h.poll();

    expect(h.levelOf(BOSS)).toBe('12');
  });

  // The payload comes from another addon, so it is validated row by row.
  it('keeps the valid rows of a table with malformed ones', async () => {
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

// The game hides a quest-exclusive mob from anybody not on the quest.
describe('a quest-gated mob', () => {
  const clutch = [{ id: 'spider_egg', name: 'Spider Egg', requiresQuestId: 'q_broodmother' }];

  it('gets no plate for a player who is not on the quest', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'spider_egg' });
    h.ranks(clutch);

    h.poll();

    expect(h.drawn()).toEqual([]);
  });

  it('gets one once the quest is active', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'spider_egg' });
    h.quest('q_broodmother', 'active');
    h.ranks(clutch);

    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });

  // Nothing is gated without a table: hiding on a guess would hide mobs the game shows.
  it('gets one when nobody published a table', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'spider_egg' });

    h.poll();

    expect(h.drawn()).toEqual([BOSS]);
  });
});

describe('what a plate says a player is doing', () => {
  it('prefixes an away player the way the game does', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', name: 'Anserra', afk: true });

    h.poll();

    expect(h.nameOf(HEALER)).toBe('<AFK> Anserra');
  });

  it('leaves the name unprefixed when not away', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', name: 'Anserra' });

    h.poll();

    expect(h.nameOf(HEALER)).toBe('Anserra');
  });

  // The wire folds sitting, eating and drinking into one bit.
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

  // These fields exist on a mob too, holding inert defaults.
  it('says nothing about a mob', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { sitting: true, mountKey: 'valorsteed', afk: true });

    h.poll();

    expect(h.noteOf(BOSS)).toBe('');
    expect(h.nameOf(BOSS)).toBe(`Unit${String(BOSS)}`);
  });

  it('tags an AI-operated account beside its state note', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', aiAccount: true, sitting: true });

    h.poll();

    expect(h.aiOf(HEALER)).toBe('AI');
    expect(h.noteOf(HEALER)).toBe('resting');
  });

  it('does not tag other accounts as AI', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest' });

    h.poll();

    expect(h.aiOf(HEALER)).toBe('');
  });

  it("tags an account wearing the operators' Cheater mark", async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', cheaterMark: true });

    h.poll();

    expect(h.cheaterOf(HEALER)).toBe('< Cheater >');
  });

  // The mark is an account sanction, player-gated as the game gates it.
  it('never tags a mob with the Cheater mark, whatever the flag says', async () => {
    const h = await run({ show: 'everything' });
    h.unit(BOSS, { kind: 'mob', templateId: 'forest_wolf', cheaterMark: true });

    h.poll();

    expect(h.cheaterOf(BOSS)).toBe('');
  });

  // The row is a flex box with a gap, so an empty span would still cost a gap on every plate.
  it('takes the Cheater tag out of the flow on a player with no mark', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', sitting: true });

    h.poll();

    expect(h.cheaterDisplayOf(HEALER)).toBe('none');
  });

  it('puts the Cheater tag in the flow on a marked player', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', cheaterMark: true });

    h.poll();

    expect(h.cheaterDisplayOf(HEALER)).not.toBe('none');
  });

  // The game keeps the mark power-neutral, so nothing else about the plate changes.
  it("changes nothing else about a marked player's plate", async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', templateId: 'priest', cheaterMark: true, sitting: true });

    h.poll();

    expect(h.noteOf(HEALER)).toBe('resting');
    expect(h.nameOf(HEALER)).toBe(`Unit${String(HEALER)}`);
  });
});

// The game's nameplate con bands (`mobNameColor`), not its tooltip's.
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

  // The game con-colours no player's level.
  it('leaves a player uncoloured', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', hostile: false, level: PLAYER_LEVEL + 5 });

    h.poll();

    expect(h.levelColourOf(HEALER)).toBe('');
  });

  it('gives a friendly pet the friendly colour rather than a band', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', hostile: false });
    h.unit(ADD, { hostile: false, ownerId: HEALER, level: PLAYER_LEVEL + 4 });

    h.poll();

    expect(h.levelColourOf(ADD)).toBe(CON_FRIENDLY);
  });
});

describe('the current target', () => {
  it('steps its name up and edges its bar', async () => {
    const h = await run();
    h.unit(BOSS);
    h.target(BOSS);

    h.poll();

    expect(h.nameSizeOf(BOSS)).toBe(TARGET_FONT);
    expect(h.strokeOf(BOSS)).toContain(TARGET_STROKE);
  });

  it('leaves other plates at their own size', async () => {
    const h = await run();
    h.unit(BOSS);
    h.unit(ADD);
    h.target(BOSS);

    h.poll();

    expect(h.nameSizeOf(ADD)).toBe('');
    expect(h.strokeOf(ADD)).toBe('');
  });

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

  it('draws no pip row with no combo points', async () => {
    const h = await run();
    h.unit(BOSS);
    h.target(BOSS);
    h.combo(0);

    h.poll();

    expect(h.pipsOf(BOSS)).toBe(0);
    expect(h.pipsShown(BOSS)).toBe(false);
  });

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

// A dead player keeps a plate; a dead mob does not, because the game's corpse plate cannot be
// switched off.
describe('a corpse', () => {
  it('draws no plate over a lootable mob corpse', async () => {
    const h = await run();
    h.unit(BOSS, { dead: true, lootable: true });

    h.poll();

    expect(h.drawn()).not.toContain(BOSS);
  });

  it('draws no plate over an empty mob corpse', async () => {
    const h = await run();
    h.unit(BOSS, { dead: true, lootable: false });

    h.poll();

    expect(h.drawn()).not.toContain(BOSS);
  });

  it('keeps a dead player and greys the name', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });

    h.poll();

    expect(h.drawn()).toContain(DUELIST);
    expect(h.nameColourOf(DUELIST)).toBe(CORPSE_NAME);
  });

  it('shows no effects on a dead player', async () => {
    const h = await run({ show: 'everything' });
    const one = h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });
    h.afflict(one, { id: 'serpent_sting', kind: 'dot' });

    h.poll();

    expect(h.tilesOf(DUELIST)).toHaveLength(0);
  });

  // No game toggle hides an NPC's own plate.
  it('draws no plate over an npc, whatever the setting says', async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'npc', hostile: false, name: 'Brother Aldric' });

    h.poll();

    expect(h.drawn()).not.toContain(HEALER);
  });
});

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

describe('what no nameplate says', () => {
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

  it('greys a mob somebody else tapped', async () => {
    const h = await run();
    h.unit(BOSS, { tappedById: DUELIST });

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(TAPPED_NAME);
  });

  it('does not grey your own tap', async () => {
    const h = await run();
    h.unit(BOSS, { tappedById: PLAYER_ID });

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(HOSTILE_NAME);
  });

  it('counts a party member as you', async () => {
    const h = await run();
    h.unit(BOSS, { tappedById: HEALER });
    h.party([PLAYER_ID, HEALER]);

    h.poll();

    expect(h.nameColourOf(BOSS)).toBe(HOSTILE_NAME);
  });

  // `tappedById` means nobody as null; 0 is a real entity id.
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
    expect(h.powerColourOf(BOSS)).toBe('var(--color-mana)');
    expect(h.powerShown(ADD)).toBe(false);
  });

  // A drained caster and a resource-less wolf both read zero; `resourceType` tells them apart.
  it('keeps the pool of a caster drained to nothing', async () => {
    const h = await run();
    h.unit(BOSS, { resourceType: 'mana', resource: 0, maxResource: 60 });

    h.poll();

    expect(h.powerShown(BOSS)).toBe(true);
    expect(h.powerOf(BOSS)).toBe('0%');
  });

  it('says a cast is coming at you and tones the bar', async () => {
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

  // An absent `castTargetId` is read as nothing, never as "not at you".
  it('claims nothing for a cast with no target at all', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'arcane_shot', remaining: 1.5, total: 2 });

    h.poll();
    h.frame();

    expect(h.atYouOf(BOSS)).toBe('');
  });

  it('says when your taunt is holding a mob, and for how long', async () => {
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

  it('marks control an encounter owns', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'gravebreaker_stun', kind: 'stun', unbreakableControl: true });

    h.poll();

    expect(h.tileLabelOf(BOSS, 0)).toContain('unbreakable');
    expect(h.tileClassesOf(BOSS, 0)).toContain('woc-tile-danger');
  });

  it('does not mark an ordinary stun', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.afflict(boss, { id: 'concussive_shot_stun', kind: 'stun' });

    h.poll();

    expect(h.tileLabelOf(BOSS, 0)).not.toContain('unbreakable');
    expect(h.tileClassesOf(BOSS, 0)).not.toContain('woc-tile-danger');
  });
});

// Rare and elite are independent flags, so a rare can carry no rank.
describe('a rare spawn', () => {
  it('tags a rare that is not an elite', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'grubjaw' });
    h.ranks([{ id: 'grubjaw', name: 'Grubjaw the Glutton', rare: true }]);

    h.poll();

    expect(h.rareOf(BOSS)).toBe('rare');
    expect(h.levelOf(BOSS)).toBe('12');
  });

  it('says both for a rare elite', async () => {
    const h = await run();
    h.unit(BOSS, { level: 12, templateId: 'aurelhorn' });
    h.ranks([{ id: 'aurelhorn', name: 'Aurelhorn, First of the Herd', rank: 'elite', rare: true }]);

    h.poll();

    expect(h.rareOf(BOSS)).toBe('rare');
    expect(h.levelOf(BOSS)).toBe('12+');
    expect(h.strokeOf(BOSS)).toContain(ELITE_COLOUR);
  });

  it('does not tag an elite that is not rare', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'ancient_guardian' });
    h.ranks([{ id: 'ancient_guardian', name: 'Ancient Guardian', rank: 'elite' }]);

    h.poll();

    expect(h.rareOf(BOSS)).toBe('');
  });

  it('tags nothing with nobody publishing a table', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'grubjaw' });

    h.poll();

    expect(h.rareOf(BOSS)).toBe('');
    expect(h.tagsShown(BOSS)).toBe(false);
  });
});

describe('reading a plate at a glance', () => {
  it('says the health count beside the share', async () => {
    const h = await run();
    h.unit(BOSS, { hp: 1347, maxHp: 2000 });

    h.poll();
    h.frame();

    expect(h.healthCountOf(BOSS)).toBe('1.3K');
    expect(h.healthOf(BOSS)).toBe('67%');
  });

  it('writes a pool under a thousand in full', async () => {
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

  it('drops the count on a corpse and keeps the word', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false, dead: true });

    h.poll();
    h.frame();

    expect(h.healthCountOf(DUELIST)).toBe('');
    expect(h.healthOf(DUELIST)).toBe('dead');
  });

  // Art is filed per class, and only a player's `templateId` is a class.
  it('draws the art for a player cast', async () => {
    const h = await run({ show: 'everything' });
    const rival = h.unit(DUELIST, { kind: 'player', hostile: false, templateId: 'hunter' });
    h.casts(rival, { ability: 'arcane_shot', remaining: 1.5, total: 2 });

    h.poll();
    h.frame();

    expect(h.castIconOf(DUELIST)).toContain('arcane_shot');
  });

  it('draws no art for a mob cast', async () => {
    const h = await run();
    const boss = h.unit(BOSS);
    h.casts(boss, { ability: 'rift_thunderhead', remaining: 1.5, total: 2 });

    h.poll();
    h.frame();

    expect(h.castIconOf(BOSS)).toBe('');
  });

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

// The kit carries the class palette; this passes only the id.
describe('the colour of a health bar', () => {
  it("takes a player's class", async () => {
    const h = await run({ show: 'everything' });
    h.unit(HEALER, { kind: 'player', hostile: false, templateId: 'priest' });

    h.poll();
    h.frame();

    expect(h.healthClassesOf(HEALER)).toContain('woc-bar-class-priest');
  });

  it('takes nothing from a mob, whose templateId is not a class', async () => {
    const h = await run();
    h.unit(BOSS, { templateId: 'boss_wolf' });

    h.poll();
    h.frame();

    expect(h.healthClassesOf(BOSS).some((name) => name.startsWith('woc-bar-class-'))).toBe(false);
  });

  it('follows a class change on the same plate', async () => {
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

// Show Player Nameplates always spares the target, so a selected player has a game plate.
describe('the plate over a player you have selected', () => {
  it("gives way to the game's own by default", async () => {
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

  it('still draws every other player', async () => {
    const h = await run({ show: 'everything' });
    h.unit(DUELIST, { kind: 'player', hostile: false });
    h.unit(HEALER, { kind: 'player', hostile: false });
    h.target(DUELIST);

    h.poll();

    expect(h.drawn()).toContain(HEALER);
  });

  // The game's mob rule has no target exception, so a mob target may have no other plate.
  it('keeps a mob target, which the game does not spare', async () => {
    const h = await run();
    h.unit(BOSS);
    h.target(BOSS);

    h.poll();

    expect(h.drawn()).toContain(BOSS);
  });

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
