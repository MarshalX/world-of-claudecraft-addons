// @vitest-environment happy-dom

// Tocsin, run through the real loader.
//
// Every case drives the world the way the game does. A boss mechanic raises no `castStart`,
// so a cast is written onto the entity carrying it; a channel is a cast on the PLAYER doing
// it, which is why those cases write onto roster entities rather than onto the boss. Only a
// named damage record arrives as an event, because that is all this addon learns from one.
//
// Fixtures are built from the SHIPPED `bosses.json` rather than a stub, so a regenerated
// table that moved an id fails here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import MANIFEST_TEXT from './addon.json?raw';
import TABLE_TEXT from './bosses.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the foretell suite.
import SOURCE from './main.js?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const TABLE = JSON.parse(TABLE_TEXT) as Table;

/**
 * Written out with the keys this suite reads rather than as a `Record`, so a regenerated
 * table that drops one fails the TYPECHECK here instead of reading `undefined` into a fixture
 * and producing a case that quietly asserts nothing.
 */
interface Mechanic {
  id: string;
  label: string;
  every: number;
  detail?: string;
  phase?: 'one' | 'two' | 'both';
  charge?: true;
  liveCast?: string;
  anchor?: { damage?: string; spawn?: string; cast?: string };
}

interface ChannelsBlock {
  kind: 'channels';
  label: string;
  duringCast: string;
  castSeconds: number;
  channelCast: string;
  channelSeconds: number;
  objectTemplateId: string;
  reach: number;
  distinct: boolean;
  objects: Array<{ name: string; x: number; z: number }>;
}

interface MarksBlock {
  kind: 'marks';
  label: string;
  aura: string;
  durationSeconds: number;
  stackRange: number;
  count: number;
  heroicMult: number;
}

interface TankBlock {
  kind: 'tankStacks';
  label: string;
  aura: string;
  perStack: number;
  maxStacks: number;
  heroicOnly: boolean;
}

interface AddRow {
  templateId: string;
  name: string;
  answer: string;
  note?: string;
  heroicTell?: boolean;
  interruptCast?: string;
}

interface AddsBlock {
  kind: 'adds';
  label: string;
  rows: AddRow[];
}

interface EnrageBlock {
  kind: 'enrage';
  label: string;
  name: string;
  aura: string;
  hp: number;
}

type Block = ChannelsBlock | MarksBlock | TankBlock | AddsBlock | EnrageBlock;

interface Encounter {
  id: string;
  templateId: string;
  name: string;
  phases: { transitionAura: string; phaseTwoHp: number; seeds: Record<string, number> };
  pullSeeds: Record<string, number>;
  freeze: Array<{ kind: 'aura' | 'cast'; id: string }>;
  mechanics: Mechanic[];
  blocks: Block[];
}

interface Table {
  gameVersion: string;
  encounters: Encounter[];
}

function only<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`bosses.json carries no ${what}, so there is nothing to test against`);
  }
  return row;
}

const ENCOUNTER: Encounter = only(TABLE.encounters, 'encounter');

function blockOf<K extends Block['kind']>(kind: K): Extract<Block, { kind: K }> {
  const found = ENCOUNTER.blocks.find((block) => block.kind === kind);
  if (found === undefined) {
    throw new Error(`bosses.json declares no ${kind} block, so there is nothing to test`);
  }
  return found as Extract<Block, { kind: K }>;
}

/**
 * A helper rather than an index with a fallback: the key is a variable, which keeps the linter
 * and the compiler from asking for opposite things, and a missing seed throws by name rather
 * than defaulting to a zero that would make a case assert nothing.
 */
function seedOf(id: string): number {
  const found = ENCOUNTER.phases.seeds[id];
  if (found === undefined) {
    throw new Error(`bosses.json declares no phase-two seed for ${id}`);
  }
  return found;
}

/** What the game's own initialiser starts a clock at, which is not always its cadence. */
function pullSeedOf(id: string): number {
  const found = ENCOUNTER.pullSeeds[id];
  if (found === undefined) {
    throw new Error(`bosses.json declares no pull seed for ${id}`);
  }
  return found;
}

function mechanicOf(id: string): Mechanic {
  const found = ENCOUNTER.mechanics.find((one) => one.id === id);
  if (found === undefined) {
    throw new Error(`bosses.json declares no ${id} mechanic`);
  }
  return found;
}

const CHANNELS = blockOf('channels');
/** What freezes every clock, and the seeds the next phase starts with. */
const FREEZE_AURA = only(
  ENCOUNTER.freeze.filter((one) => one.kind === 'aura').map((one) => one.id),
  'freeze condition',
);
const SEED_GRAVEBREAKER = seedOf('gravebreaker');
const PULL_GRAVEBREAKER = pullSeedOf('gravebreaker');
const PULL_RAISE_FALLEN = pullSeedOf('raise-fallen');
const SEED_SOUL_REND = seedOf('soul-rend');
const SEED_DEATHLESS = seedOf('deathless');
const TUNING_CAST_MS = CHANNELS.castSeconds * 1000 + 500;
const MARKS = blockOf('marks');
const TANK = blockOf('tankStacks');
const ENRAGE = blockOf('enrage');
/** The addon watches from twice the trigger, and the fixture boss carries a thousand health. */
const ENRAGE_WATCH_HP = ENRAGE.hp * 2 * 1000;
const ADDS = blockOf('adds');
const GRAVEBREAKER = mechanicOf('gravebreaker');
const SOUL_REND = mechanicOf('soul-rend');
const DEATHLESS = mechanicOf('deathless');
const FIRST_COURT_ADD = only(
  ADDS.rows.filter((row) => row.heroicTell === true),
  'heroic court',
);
const WAVE_ADD = only(
  ADDS.rows.filter((row) => row.heroicTell !== true),
  'wave add',
);

const PLAYER_ID = PLAYER_ENTITY.id;
const BOSS_ID = 900;
/** The three roster members who take a wardstone in the ward cases. */
const ALDREN = 901;
const VOSS = 902;
const MALRIC = 903;
/** The off tank, who exists to answer whether a swap is safe yet. */
const BRONN = 904;
/** A member with a roster row and no entity at all, which is the far-side case. */
const FARAWAY = 905;
/** The three wardstone entities, left to right as the room lays them out. */
const WARD_LEFT = 950;
const WARD_MID = 951;
const WARD_RIGHT = 952;

type Fake = Record<string, unknown>;

interface Aura {
  id: string;
  kind: string;
  remaining: number;
  duration: number;
  value: number;
  sourceId: number;
  school: string;
  stacks?: number;
}

interface MemberSpec {
  pid: number;
  name: string;
  x: number;
  z: number;
  role?: 'tank' | 'healer' | 'dps';
  /** Whether this member has an entity in scope. A row exists either way. */
  near?: boolean;
}

const ROSTER: MemberSpec[] = [
  { pid: PLAYER_ID, name: 'Marshal', x: 0, z: 90, role: 'dps', near: true },
  { pid: ALDREN, name: 'Aldren', x: -40, z: 79, role: 'dps', near: true },
  { pid: VOSS, name: 'Voss', x: 40, z: 79, role: 'dps', near: true },
  { pid: MALRIC, name: 'Malric', x: 0, z: 63, role: 'healer', near: true },
  { pid: BRONN, name: 'Bronn', x: 0, z: 94, role: 'tank', near: true },
  { pid: FARAWAY, name: 'Distant', x: 120, z: 10, role: 'dps', near: false },
];

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

function aura(id: string, over: Partial<Aura> = {}): Aura {
  return {
    id,
    kind: 'vulnerability',
    remaining: 8,
    duration: 8,
    value: 0,
    sourceId: BOSS_ID,
    school: 'shadow',
    ...over,
  };
}

/**
 * A computed access because the two checkers want opposite things: the linter asks for dot
 * access on a literal key and the compiler forbids it on an index signature.
 */
function setField(entity: Fake, field: string, value: unknown): void {
  entity[field] = value;
}

function readField<T>(entity: Fake, field: string): T {
  return entity[field] as T;
}

function writeCast(entity: Fake, ability: string, remaining: number, total: number): void {
  setField(entity, 'castingAbility', ability);
  setField(entity, 'castRemaining', remaining);
  setField(entity, 'castTotal', total);
  setField(entity, 'channeling', false);
}

function clearCast(entity: Fake): void {
  setField(entity, 'castingAbility', null);
  setField(entity, 'castRemaining', 0);
  setField(entity, 'castTotal', 0);
}

interface TocsinHarness extends SharedHarness {
  boss: Fake;
  /** One roster member's entity, for the members that have one. */
  entityOf: (pid: number) => Fake;
  /** Put a mob in the world and hand it back. */
  spawn: (id: number, templateId: string, over?: Fake) => Fake;
  /** Write one field on the boss, for the states a reset leaves behind. */
  setBossField: (field: string, value: unknown) => void;
  /** Take an entity back out, which is what a death or a despawn looks like. */
  despawn: (id: number) => void;
  /** Give one unit an aura, replacing any it already had by that id. */
  give: (pid: number, one: Aura) => void;
  /** Take an aura off. */
  strip: (pid: number, id: string) => void;
  /** Put the compact aura strip on a roster ROW, which is what a far member has. */
  giveRow: (pid: number, id: string, remaining: number) => void;
  /** Walk a member to a point, on the ROW, which is where every distance is read from. */
  move: (pid: number, x: number, z: number) => void;
  /** Start a wardstone channel by the given member, standing at the given stone. */
  channel: (pid: number, stoneId: number, remaining: number) => void;
  /** Deliver one damage record, which is the only event this addon reads. */
  damage: (ability: string) => void;
  /** Run the loader's one frame loop, which is what the addon draws on. */
  frame: (times?: number) => void;
  /** The row ids drawn in one block, in order. */
  rows: (block: string) => string[];
  /** One row's head line. */
  labelOf: (block: string, row: string) => string;
  /** One row's second line. */
  detailOf: (block: string, row: string) => string;
  /** One row's right-hand figure. */
  valueOf: (block: string, row: string) => string;
  /** Whether a block is on screen at all. */
  shows: (block: string) => boolean;
  /** One block's heading, which the ACTIVE encounter's own label sets. */
  headingOf: (block: string) => string;
  /** Everything the addon warned about, which is where an unknown block kind lands. */
  warnings: () => string[];
  /** Every line of muted text the console is carrying. */
  notes: () => string[];
}

function blockEl(block: string): HTMLElement | null {
  return document.querySelector(`[data-block="${block}"]`);
}

function rowEl(block: string, row: string): Element | null {
  return blockEl(block)?.querySelector(`[data-row="${row}"]`) ?? null;
}

function textIn(block: string, row: string, selector: string): string {
  return rowEl(block, row)?.querySelector(selector)?.textContent ?? '';
}

/** Written out rather than looped, one turn per await the addon and the loader make. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function targetFor(opts: StartOpts): number | null {
  if (opts.engaged === false) {
    return null;
  }
  return opts.tank ?? BRONN;
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

function memberRow(spec: MemberSpec) {
  return {
    pid: spec.pid,
    name: spec.name,
    cls: 'warrior',
    level: 20,
    hp: 1000,
    mhp: 1000,
    res: 100,
    mres: 100,
    rtype: 'mana',
    x: spec.x,
    z: spec.z,
    dead: 0,
    inCombat: 1,
    group: 1,
    role: spec.role,
    connected: 1,
    auras: [] as Array<{ id: string; kind: string; remaining: number }>,
  };
}

interface StartOpts {
  settings?: Record<string, unknown>;
  /** The table the host has cached, for the cases about a table this addon has not seen. */
  table?: string;
  /** The boss template in the room, for the case about a SECOND encounter in the table. */
  templateId?: string;
  /** Whether the boss has a target, which is the one engagement signal a mob sends. */
  engaged?: boolean;
  /** Who the boss is hitting. Defaults to the off tank. */
  tank?: number;
  hp?: number;
}

/**
 * The stones are placed from the table rather than at made-up points, so the reach check is
 * exercised against real geometry: a channeller has to be standing where the fixture says.
 */
async function start(opts: StartOpts = {}): Promise<TocsinHarness> {
  const entities = new Map<number, Fake>();
  const rows = ROSTER.map(memberRow);
  const player = liveEntity({ set: { id: PLAYER_ID, name: 'Marshal', templateId: 'warrior' } });
  entities.set(PLAYER_ID, player);
  for (const spec of ROSTER) {
    if (spec.near === true && spec.pid !== PLAYER_ID) {
      const entity = liveEntity({
        set: { id: spec.pid, name: spec.name, kind: 'player', pos: { x: spec.x, y: 0, z: spec.z } },
      });
      entities.set(spec.pid, entity);
    }
  }
  const boss = liveEntity({
    set: {
      id: BOSS_ID,
      name: ENCOUNTER.name,
      kind: 'mob',
      hostile: true,
      templateId: opts.templateId ?? ENCOUNTER.templateId,
      hp: opts.hp ?? 1000,
      maxHp: 1000,
      pos: { x: 0, y: 0, z: 96 },
      aggroTargetId: targetFor(opts),
    },
  });
  entities.set(BOSS_ID, boss);
  const stoneIds = [WARD_LEFT, WARD_MID, WARD_RIGHT];
  // Sorted by x so the fixture's ids run left to right, which is the order the console
  // claims to draw them in and therefore the order the assertions read.
  const placed = [...CHANNELS.objects].sort((a, b) => a.x - b.x);
  placed.forEach((stone, index) => {
    const id = stoneIds[index] ?? 0;
    entities.set(
      id,
      liveEntity({
        set: {
          id,
          name: stone.name,
          kind: 'object',
          templateId: CHANNELS.objectTemplateId,
          pos: { x: stone.x, y: 0, z: stone.z },
        },
      }),
    );
  });
  const world = { entities, player, partyInfo: { leader: PLAYER_ID, raid: true, members: rows } };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings: opts.settings ?? {},
    data: { 'bosses.json': opts.table ?? TABLE_TEXT },
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);
  await settle();

  const entityOf = (pid: number): Fake => entities.get(pid) as Fake;
  return {
    ...harness,
    boss,
    entityOf,
    spawn: (id, templateId, over = {}) => {
      const entity = liveEntity({
        set: { id, kind: 'mob', hostile: true, templateId, name: templateId, ...over },
      });
      entities.set(id, entity);
      return entity;
    },
    setBossField: (field, value) => {
      setField(boss, field, value);
    },
    despawn: (id) => {
      entities.delete(id);
    },
    give: (pid, one) => {
      const entity = entityOf(pid);
      const held = readField<Aura[]>(entity, 'auras').filter((each) => each.id !== one.id);
      setField(entity, 'auras', [...held, one]);
    },
    strip: (pid, id) => {
      const entity = entityOf(pid);
      setField(
        entity,
        'auras',
        readField<Aura[]>(entity, 'auras').filter((each) => each.id !== id),
      );
    },
    giveRow: (pid, id, remaining) => {
      const row = rows.find((each) => each.pid === pid);
      row?.auras.push({ id, kind: 'vulnerability', remaining });
    },
    move: (pid, x, z) => {
      const row = rows.find((each) => each.pid === pid);
      if (row !== undefined) {
        row.x = x;
        row.z = z;
      }
      const entity = entities.get(pid);
      if (entity !== undefined) {
        setField(entity, 'pos', { x, y: 0, z });
      }
    },
    channel: (pid, stoneId, remaining) => {
      const entity = entityOf(pid);
      const stone = entities.get(stoneId) as Fake;
      setField(entity, 'pos', { ...readField<object>(stone, 'pos') });
      writeCast(entity, CHANNELS.channelCast, remaining, CHANNELS.channelSeconds);
    },
    damage: (ability) => {
      harness.inbound(
        eventsFrame([
          { type: 'damage', sourceId: BOSS_ID, targetId: PLAYER_ID, amount: 10, ability },
        ]),
      );
    },
    frame: (times = 1) => {
      for (let step = 0; step < times; step += 1) {
        harness.frames.tick();
      }
    },
    rows: (block) =>
      [...(blockEl(block)?.querySelectorAll('[data-row]') ?? [])].map(
        (el) => el.getAttribute('data-row') ?? '',
      ),
    labelOf: (block, row) => textIn(block, row, '.woc-bar-label'),
    detailOf: (block, row) => textIn(block, row, '.woc-bar-detail'),
    valueOf: (block, row) => textIn(block, row, '.woc-bar-value'),
    // The kit hides with the `hidden` attribute and a class, never with an inline style, so
    // that is what a suite has to read. See ui/kit/layout.ts.
    shows: (block) => {
      const el = blockEl(block);
      return el !== null && !el.hasAttribute('hidden');
    },
    headingOf: (block) => blockEl(block)?.querySelector('.woc-layout-line')?.textContent ?? '',
    warnings: () =>
      harness.shared.logs
        .tail(harness.fqid)
        .filter((entry) => entry.level === 'warn')
        .map((entry) => entry.text),
    notes: () =>
      [...document.querySelectorAll('.woc-layout-line')]
        .filter((el) => !el.hasAttribute('hidden'))
        .map((el) => el.textContent ?? '')
        .filter(Boolean),
  };
}

function banner(): string {
  return document.getElementById('woc-banner')?.textContent ?? '';
}

/**
 * The card itself, which is what a case asserting a call was NOT repeated has to read. Nothing
 * dismisses a banner under the suite's services, so its text stays in the document for the rest
 * of the case and a second call reads exactly like the first one still being up. Showing one
 * replaces the card, so the NODE is the difference between them.
 */
function bannerCard(): Element | null {
  return document.getElementById('woc-banner')?.firstElementChild ?? null;
}

function castDeathless(h: TocsinHarness, remaining: number): void {
  writeCast(h.boss, CHANNELS.duringCast, remaining, CHANNELS.castSeconds);
}

describe('the manifest', () => {
  it('is what the marketplace validates', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  it('declares the table it reads and nothing else', () => {
    expect(parseManifest(MANIFEST_TEXT).data).toEqual(['bosses.json']);
  });
});

describe('the shipped table', () => {
  it('carries the ids every reading joins on', () => {
    expect(ENCOUNTER.templateId).toBe('nythraxis_scourge_of_thornpeak');
    expect(MARKS.aura).toBe('nythraxis_soul_rend');
    expect(CHANNELS.channelCast).toBe('nythraxis_ward_channel');
  });

  it('declares one block per shape of problem, and no shape the addon cannot draw', () => {
    // The renderers this file knows about. A table declaring a fifth kind is a table that
    // needs a fifth renderer, and this is where that lands rather than in a blank panel.
    expect(ENCOUNTER.blocks.map((block) => block.kind).sort(byName)).toEqual([
      'adds',
      'channels',
      'enrage',
      'marks',
      'tankStacks',
    ]);
  });

  /**
   * A live cast is NOT a way to start a clock, and accepting one here as if it were is how a
   * mechanic shipped with nothing to seed its at all. `liveCast` draws the game's own bar
   * while the cast runs and seeds nothing, so the cadence counted down once, clamped at zero
   * and called the same banner every re-warn floor for the rest of the pull.
   */
  it('gives every mechanic a way to start its clock, which a live cast is not', () => {
    const stuck = ENCOUNTER.mechanics
      .filter(
        (one) =>
          Object.values(one.anchor ?? {}).length === 0 &&
          ENCOUNTER.pullSeeds[one.id] === undefined &&
          ENCOUNTER.phases.seeds[one.id] === undefined,
      )
      .map((one) => one.id);
    expect(stuck).toEqual([]);
  });

  it('carries three wardstones with the game’s own names', () => {
    expect(CHANNELS.objects.map((one) => one.name).sort(byName)).toEqual([
      'Left Wardstone',
      'Right Wardstone',
      'Threshold Wardstone',
    ]);
  });
});

// The claim this addon makes about its own future: an encounter is added to the TABLE
// rather than built into the code. These cases are the only place that claim is testable,
// and they make it by handing the addon a table it has never seen.
describe('an encounter the shipped table does not carry', () => {
  /** The shipped table with one more encounter in it, reusing two of the same block kinds. */
  function withSecondEncounter(): string {
    const second = {
      ...ENCOUNTER,
      id: 'second',
      templateId: 'some_other_raid_boss',
      name: 'The Second Boss',
      mechanics: [{ id: 'sweep', label: 'Sweep', every: 20, detail: 'move out', phase: 'both' }],
      blocks: [{ ...MARKS, label: 'Chosen' }],
    };
    return JSON.stringify({ ...TABLE, encounters: [...TABLE.encounters, second] });
  }

  it('draws a second encounter from its own row, with no code that names it', async () => {
    const h = await start({ table: withSecondEncounter(), templateId: 'some_other_raid_boss' });
    h.frame();
    expect(h.labelOf('mechanics', 'sweep')).toBe('Sweep');
    expect(h.detailOf('mechanics', 'sweep')).toBe('armed, not seen yet');
  });

  it('reuses a block kind under whatever name that encounter gives it', async () => {
    const h = await start({ table: withSecondEncounter(), templateId: 'some_other_raid_boss' });
    h.give(ALDREN, aura(MARKS.aura, { remaining: 6 }));
    h.giveRow(ALDREN, MARKS.aura, 6);
    h.frame();
    expect(h.rows('marks').map((row) => h.labelOf('marks', row))).toEqual(['Aldren']);
    // The heading is the second encounter's word for it, not this one's.
    expect(h.headingOf('marks')).toBe('Chosen');
  });

  it('skips a block kind it has no renderer for rather than drawing it wrongly', async () => {
    const table = JSON.parse(TABLE_TEXT) as Table;
    const [row] = table.encounters;
    if (row === undefined) {
      throw new Error('no encounter to amend');
    }
    row.blocks = [{ kind: 'somethingNew', label: 'New' } as unknown as Block, ...row.blocks];
    const h = await start({ table: JSON.stringify(table) });
    h.frame();
    // The rest of the frame is unaffected, which is the point: an unknown kind costs its own
    // block and nothing else.
    expect(h.rows('mechanics').length).toBeGreaterThan(0);
    expect(h.warnings().join(' ')).toContain('somethingNew');
  });

  it('draws nothing at all for a boss no row names', async () => {
    const h = await start({ templateId: 'a_boss_from_a_later_patch' });
    h.frame();
    expect(h.notes().join(' ')).toContain('No encounter this addon knows is in range');
  });
});

describe('when there is no fight', () => {
  it('says the boss is out of range rather than drawing an empty box', async () => {
    const h = await start();
    h.despawn(BOSS_ID);
    h.frame();
    expect(h.notes().join(' ')).toContain('No encounter this addon knows is in range');
    expect(h.rows('mechanics')).toEqual([]);
  });

  it('tells a boss standing there apart from one that is fighting', async () => {
    const h = await start({ engaged: false });
    h.frame();
    expect(h.notes().join(' ')).toContain('not in combat');
  });
});

describe('the wardstone block', () => {
  it('names the stone nobody is channelling, from the stone’s own name', async () => {
    const h = await start();
    castDeathless(h, 6);
    h.channel(ALDREN, WARD_LEFT, 3);
    h.channel(MALRIC, WARD_MID, 2);
    h.frame();
    const unheld = h.rows('channels').filter((row) => h.valueOf('channels', row) === 'UNHELD');
    expect(unheld).toHaveLength(1);
    expect(h.labelOf('channels', unheld[0] ?? '')).toBe('Right Wardstone');
  });

  it('draws every stone as unheld before anyone reaches one', async () => {
    const h = await start();
    castDeathless(h, 9);
    h.frame();
    expect(h.rows('channels')).toHaveLength(3);
    for (const row of h.rows('channels')) {
      expect(h.valueOf('channels', row)).toBe('UNHELD');
    }
  });

  it('names who is on a stone and how far through their channel', async () => {
    const h = await start();
    castDeathless(h, 6);
    h.channel(VOSS, WARD_RIGHT, 2.4);
    h.frame();
    const row = h
      .rows('channels')
      .find((each) => h.labelOf('channels', each) === 'Right Wardstone');
    expect(h.detailOf('channels', row ?? '')).toBe('Voss');
    expect(h.valueOf('channels', row ?? '')).toBe('2.4s');
  });

  it('drops a channeller who walked out of reach, rather than remembering them', async () => {
    const h = await start();
    castDeathless(h, 6);
    h.channel(ALDREN, WARD_LEFT, 3);
    h.frame();
    const left = h
      .rows('channels')
      .find((each) => h.labelOf('channels', each) === 'Left Wardstone');
    expect(h.detailOf('channels', left ?? '')).toBe('Aldren');
    // A channel that breaks fires no event: the player simply stops carrying the cast.
    clearCast(h.entityOf(ALDREN));
    h.frame();
    expect(h.valueOf('channels', left ?? '')).toBe('UNHELD');
  });

  it('does not credit a channel to a stone the player is not standing at', async () => {
    const h = await start();
    castDeathless(h, 6);
    // The channel is real and the player is nowhere near a stone, which is what a knockback
    // or a mis-click looks like. The game's own check is a distance, so this one is too, and
    // without it the nearest stone would read as held by somebody across the room.
    h.channel(ALDREN, WARD_LEFT, 3);
    h.move(ALDREN, 0, 200);
    h.frame();
    for (const row of h.rows('channels')) {
      expect(h.valueOf('channels', row)).toBe('UNHELD');
    }
  });

  it('holds a finished channel as DONE rather than falling back to unheld', async () => {
    const h = await start();
    castDeathless(h, 6);
    h.channel(ALDREN, WARD_LEFT, 0.05);
    h.frame();
    // The game clears the cast on the same tick the channel's remaining hits zero, so this is
    // what a completion looks like from a client: the cast is simply gone.
    clearCast(h.entityOf(ALDREN));
    h.frame();
    const left = h.rows('channels').find((row) => h.labelOf('channels', row) === 'Left Wardstone');
    expect(h.valueOf('channels', left ?? '')).toBe('DONE');
    expect(h.detailOf('channels', left ?? '')).toBe('Aldren');
  });

  it('reads a channel that broke with time left as unheld, not as done', async () => {
    const h = await start();
    castDeathless(h, 6);
    h.channel(ALDREN, WARD_LEFT, 3.2);
    h.frame();
    clearCast(h.entityOf(ALDREN));
    h.frame();
    const left = h.rows('channels').find((row) => h.labelOf('channels', row) === 'Left Wardstone');
    expect(h.valueOf('channels', left ?? '')).toBe('UNHELD');
  });

  it('leaves a finished object out of the alert and out of the outcome', async () => {
    const h = await start();
    castDeathless(h, 6);
    h.channel(ALDREN, WARD_LEFT, 0.05);
    h.frame();
    clearCast(h.entityOf(ALDREN));
    castDeathless(h, 2);
    h.frame();
    expect(banner()).not.toContain('Left');
    h.advance(TUNING_CAST_MS);
    clearCast(h.boss);
    h.frame();
    expect(h.detailOf('channels', 'outcome')).not.toContain('Left Wardstone');
  });

  it('reads the cast ending early as the raid having interrupted it', async () => {
    const h = await start();
    castDeathless(h, 9);
    h.frame();
    clearCast(h.boss);
    h.frame();
    expect(h.labelOf('channels', 'outcome')).toBe('Interrupted');
  });

  it('names the stones nobody held once the cast has resolved', async () => {
    const h = await start();
    castDeathless(h, 9);
    h.channel(ALDREN, WARD_LEFT, 3);
    h.frame();
    // The full cast length elapses, which is the game resolving it rather than losing it.
    h.advance(CHANNELS.castSeconds * 1000 + 500);
    clearCast(h.boss);
    h.frame();
    expect(h.labelOf('channels', 'outcome')).toBe('Resolved');
    expect(h.detailOf('channels', 'outcome')).toContain('Threshold Wardstone');
    expect(h.detailOf('channels', 'outcome')).toContain('Right Wardstone');
  });

  it('calls out one player taking two stones, which the game does not count', async () => {
    const h = await start();
    castDeathless(h, 9);
    h.channel(ALDREN, WARD_LEFT, 1);
    h.frame();
    h.channel(ALDREN, WARD_MID, 4);
    h.frame();
    h.advance(CHANNELS.castSeconds * 1000 + 500);
    clearCast(h.boss);
    h.frame();
    expect(h.detailOf('channels', 'duplicates')).toContain('Aldren');
  });
});

describe('a wipe under a pull the addon still thinks is running', () => {
  it('starts a new pull when the boss comes back to full health', async () => {
    const h = await start({ hp: 500 });
    h.frame();
    h.damage('Gravebreaker');
    h.frame();
    expect(h.valueOf('mechanics', 'gravebreaker')).toBe(`~${GRAVEBREAKER.every.toFixed(1)}s`);
    // A wipe restores the boss and clears its threat, but leaves the target field set, so the
    // engagement signal goes on reading true and the old clocks would otherwise carry over.
    h.setBossField('hp', 1000);
    h.frame();
    expect(h.detailOf('mechanics', 'gravebreaker')).toBe('armed, not seen yet');
  });

  it('does not restart a pull that has simply not taken damage yet', async () => {
    const h = await start();
    h.frame();
    h.damage('Gravebreaker');
    h.frame();
    // Full health because nobody has hit it, which is an opening rather than a reset.
    expect(h.valueOf('mechanics', 'gravebreaker')).toBe(`~${GRAVEBREAKER.every.toFixed(1)}s`);
    h.frame();
    expect(h.valueOf('mechanics', 'gravebreaker')).toBe(`~${GRAVEBREAKER.every.toFixed(1)}s`);
  });
});

describe('the settings', () => {
  it('hides the state blocks without silencing the warnings they justify', async () => {
    const h = await start({ settings: { state: false } });
    h.give(BRONN, aura(TANK.aura, { stacks: 9, remaining: 45, duration: 45 }));
    h.frame();
    expect(h.shows('tankStacks')).toBe(false);
    expect(banner()).toContain('TAUNT');
    // And the heroic tell still lands, so the figures do not stay on the normal ones.
    expect(h.notes().join(' ')).not.toContain('Normal figures');
  });
});

describe('the Soul Rend block', () => {
  function mark(h: TocsinHarness, pid: number, remaining = 8): void {
    h.give(pid, aura(MARKS.aura, { remaining }));
    h.giveRow(pid, MARKS.aura, remaining);
  }

  it('names every marked player, which the game names nowhere', async () => {
    const h = await start();
    mark(h, ALDREN);
    mark(h, VOSS);
    mark(h, MALRIC);
    h.frame();
    const names = h.rows('marks').map((row) => h.labelOf('marks', row));
    expect(names.sort(byName)).toEqual(['Aldren', 'Malric', 'Voss']);
  });

  it('counts who is inside the stack range and what that share costs', async () => {
    const h = await start();
    // Aldren and Voss are 80 yards apart in the fixture, so both are standing alone.
    mark(h, ALDREN);
    mark(h, VOSS);
    h.frame();
    const row = h.rows('marks').find((each) => h.labelOf('marks', each) === 'Aldren');
    expect(h.detailOf('marks', row ?? '')).toContain('alone');
    expect(h.detailOf('marks', row ?? '')).toContain('100%');
  });

  it('halves the share once two marks are standing together', async () => {
    const h = await start();
    mark(h, ALDREN);
    mark(h, VOSS);
    // Voss walks onto Aldren, inside the game's own 5 yard stack range. The reading is made
    // from the party ROW's position, which is why this moves the row.
    h.move(VOSS, -40, 79);
    h.frame();
    const drawn = h.rows('marks').find((each) => h.labelOf('marks', each) === 'Voss');
    expect(h.detailOf('marks', drawn ?? '')).toContain('2 stacked');
    expect(h.detailOf('marks', drawn ?? '')).toContain('50%');
  });

  it('reads a mark on a member who has a row and no entity', async () => {
    const h = await start();
    h.giveRow(FARAWAY, MARKS.aura, 5);
    h.frame();
    expect(h.rows('marks').map((row) => h.labelOf('marks', row))).toEqual(['Distant']);
    expect(h.valueOf('marks', String(FARAWAY))).toBe('5s');
  });

  it('is not on screen at all when nobody is marked', async () => {
    const h = await start();
    h.frame();
    expect(h.shows('marks')).toBe(false);
  });

  it('reads more marks than normal applies as the fight being heroic', async () => {
    const h = await start();
    for (const pid of [ALDREN, VOSS, MALRIC, BRONN]) {
      mark(h, pid);
    }
    expect(MARKS.count).toBeLessThan(4);
    h.frame();
    expect(h.notes().join(' ')).not.toContain('Normal figures');
  });
});

describe('the tank block', () => {
  it('is absent while nothing has said the fight is heroic', async () => {
    const h = await start();
    h.frame();
    expect(h.shows('tank')).toBe(false);
    expect(h.notes().join(' ')).toContain('Normal figures');
  });

  it('reads the stacks off the boss’s own target and says what they are worth', async () => {
    const h = await start();
    h.give(BRONN, aura(TANK.aura, { stacks: 6, remaining: 45, duration: 45 }));
    h.frame();
    expect(h.labelOf('tankStacks', 'tank')).toBe('Bronn');
    expect(h.valueOf('tankStacks', 'tank')).toBe('6 stacks');
    expect(h.detailOf('tankStacks', 'tank')).toBe('+60% damage taken');
  });

  it('latches heroic off the curse, so the normal caveat goes', async () => {
    const h = await start();
    h.give(BRONN, aura(TANK.aura, { stacks: 1, remaining: 45, duration: 45 }));
    h.frame();
    expect(h.notes().join(' ')).not.toContain('Normal figures');
  });

  it('says the other tank is not clear yet while their own aura is still running', async () => {
    const h = await start({ tank: MALRIC });
    // Malric is the healer row in this fixture, so the boss is on somebody who is not the
    // off tank: the relief row is about Bronn, who is still carrying stacks of their own.
    h.give(MALRIC, aura(TANK.aura, { stacks: 3, remaining: 45, duration: 45 }));
    h.giveRow(BRONN, TANK.aura, 21);
    h.frame();
    expect(h.labelOf('tankStacks', 'relief')).toBe('Bronn');
    expect(h.detailOf('tankStacks', 'relief')).toContain('still carrying');
    expect(h.valueOf('tankStacks', 'relief')).toBe('21s');
  });

  it('says the other tank can take it once their aura has gone', async () => {
    const h = await start({ tank: MALRIC });
    h.give(MALRIC, aura(TANK.aura, { stacks: 8, remaining: 45, duration: 45 }));
    h.frame();
    expect(h.valueOf('tankStacks', 'relief')).toBe('ready');
  });
});

describe('the enrage block', () => {
  it('says nothing while the boss is nowhere near it', async () => {
    const h = await start({ hp: 500 });
    h.frame();
    expect(h.shows('enrage')).toBe(false);
  });

  it('names the trigger while the fight is approaching it', async () => {
    const h = await start({ hp: ENRAGE_WATCH_HP - 10 });
    h.frame();
    // The heading names the shape and the row names the aura, so neither says the other twice.
    expect(h.headingOf('enrage')).toBe(ENRAGE.label);
    expect(h.labelOf('enrage', 'enrage')).toBe(ENRAGE.name);
    expect(h.detailOf('enrage', 'enrage')).toContain('5%');
  });

  /**
   * The aura runs to the end of the fight, so a call made on its PRESENCE is a call made
   * every re-warn floor until the boss dies. It is the arrival that is news.
   */
  it('calls the enrage once, on the aura arriving', async () => {
    const h = await start({ hp: 40 });
    h.give(BOSS_ID, aura(ENRAGE.aura, { kind: 'buff_haste', remaining: 600, duration: 600 }));
    h.frame();
    expect(h.valueOf('enrage', 'enrage')).toBe('ENRAGED');
    expect(h.detailOf('enrage', 'enrage')).toContain('4%');
    expect(banner()).toContain('ENRAGED');
    const called = bannerCard();
    h.advance(13_000);
    h.frame();
    expect(bannerCard()).toBe(called);
  });
});

describe('the add block', () => {
  it('says what each member of the court wants done to it', async () => {
    const h = await start();
    for (const add of ADDS.rows) {
      h.spawn(910 + ADDS.rows.indexOf(add), add.templateId, { name: add.name });
    }
    h.frame();
    const answers = h.rows('adds').map((row) => h.detailOf('adds', row));
    expect(answers).toContain('interrupt');
    expect(answers).toContain('control');
    expect(answers).toContain('tank');
  });

  it('draws the interrupt first, which is the one that cannot be out-damaged', async () => {
    const h = await start();
    ADDS.rows.forEach((add, index) => {
      h.spawn(910 + index, add.templateId, { name: add.name });
    });
    h.frame();
    const first = h.rows('adds')[0] ?? '';
    expect(h.detailOf('adds', first)).toBe('interrupt');
  });

  it('reads a member of the court as the fight being heroic', async () => {
    const h = await start();
    h.spawn(915, FIRST_COURT_ADD.templateId, { name: FIRST_COURT_ADD.name });
    h.frame();
    expect(h.notes().join(' ')).not.toContain('Normal figures');
  });

  it('says a wave add cannot be controlled, which is the whole decision about it', async () => {
    const h = await start();
    h.spawn(920, WAVE_ADD.templateId, { name: WAVE_ADD.name });
    h.frame();
    expect(h.detailOf('adds', '920')).toContain('no crowd control');
  });
});

describe('the banner', () => {
  it('names only the word that tells the stones apart, not the one they share', async () => {
    const h = await start();
    castDeathless(h, 2);
    h.channel(ALDREN, WARD_LEFT, 3);
    h.frame();
    // A banner gets about a second of attention mid-fight, so "Right Wardstone and Threshold
    // Wardstone unheld" is a sentence nobody finishes.
    expect(banner()).toContain('Right');
    expect(banner()).not.toContain('Wardstone');
  });

  it('reads the mark call as an instruction, with your own name first', async () => {
    const h = await start();
    for (const pid of [PLAYER_ID, VOSS]) {
      h.give(pid, aura(MARKS.aura, { remaining: 6 }));
      h.giveRow(pid, MARKS.aura, 6);
    }
    h.frame();
    expect(banner()).toContain('STACK');
    // Whether it is on you is the one thing worth reading before any other word of it.
    expect(banner()).toContain('You, Voss');
  });

  it('reads the tank call as the action rather than as a stack count', async () => {
    const h = await start();
    h.give(BRONN, aura(TANK.aura, { stacks: 9, remaining: 45, duration: 45 }));
    h.frame();
    expect(banner()).toContain('TAUNT');
    expect(banner()).toContain('Bronn, 9 stacks');
  });

  it('holds the call until the lead the player asked for', async () => {
    const h = await start({ settings: { 'alert-lead': 4 } });
    // Eight seconds of cast left is early: the raid still has time to walk, and a display
    // that shouted the moment a stone was empty would shout on every cast.
    castDeathless(h, 8);
    h.frame();
    expect(banner()).toBe('');
    castDeathless(h, 3);
    h.frame();
    expect(banner()).toContain('UNHELD');
  });

  /**
   * The failure this is written against is a mechanic whose clock never gets re-armed: it
   * clamps at zero and the call is then made every re-warn floor, eight seconds apart, for the
   * rest of the pull, against a cadence the raid reads as forty-five.
   */
  it('calls Deathless Rage once a cycle rather than every re-warn floor', async () => {
    const lead = 4;
    const h = await start({ hp: 500, settings: { 'alert-lead': lead } });
    h.frame();
    // The pull's first Rage is what starts this clock, since the cast is what arms the cadence.
    castDeathless(h, CHANNELS.castSeconds);
    h.frame();
    clearCast(h.boss);
    h.frame();
    h.advance((DEATHLESS.every - lead - 1) * 1000);
    h.frame();
    expect(banner()).toBe('');
    h.advance(1000);
    h.frame();
    expect(banner()).toContain(DEATHLESS.label);
    const called = bannerCard();
    // The game opens the next cast on the tick the cadence runs out and the clock is re-armed
    // there, so nine seconds on, well past the re-warn floor the repeat used to ride, the card
    // is still the one the lead put up rather than another saying the same thing.
    h.advance(lead * 1000);
    castDeathless(h, CHANNELS.castSeconds);
    h.frame();
    h.advance(9000);
    h.frame();
    expect(bannerCard()).toBe(called);
  });

  /**
   * A clock the game is holding back sits at zero honestly: a Deathless Rage waits for the
   * Soul Rend marks to clear and retries every second. What must not happen is the call being
   * made again for a cycle already announced.
   */
  it('makes one call for one armed cycle, even where the clock sits at zero', async () => {
    const lead = 4;
    const h = await start({ hp: 500, settings: { 'alert-lead': lead } });
    h.frame();
    // Nothing else is seeded in this fixture, so the deathless clock is the only one that can
    // speak and the case is about it alone.
    castDeathless(h, CHANNELS.castSeconds);
    h.frame();
    clearCast(h.boss);
    h.frame();
    h.advance((DEATHLESS.every - lead) * 1000);
    h.frame();
    expect(banner()).toContain(DEATHLESS.label);
    const called = bannerCard();
    // The clock is now past due and stays there, which is what a deferred cast looks like.
    h.advance(13_000);
    h.frame();
    expect(bannerCard()).toBe(called);
  });

  /**
   * Two mechanics coming due inside one re-warn floor is the ordinary case at a phase change,
   * where the game re-seeds all three at once. A floor shared across every mechanic drops the
   * second call entirely, which is a mechanic nobody was told about.
   */
  it('gives each mechanic its own floor rather than one between them all', async () => {
    const h = await start({ hp: 500, settings: { 'alert-lead': 4 } });
    h.give(BOSS_ID, aura(ENCOUNTER.phases.transitionAura, { kind: 'stun', remaining: 21 }));
    h.frame();
    h.strip(BOSS_ID, ENCOUNTER.phases.transitionAura);
    h.frame();
    expect(banner()).toContain(GRAVEBREAKER.label);
    // Past the first card's own four seconds, so what is read here is the slot being free
    // rather than the floor having expired: Soul Rend is still inside its lead.
    h.advance(4500);
    h.frame();
    expect(banner()).toContain(SOUL_REND.label);
  });

  it('sends on no path at all when the player has switched banners off', async () => {
    const h = await start({ settings: { alerts: false } });
    castDeathless(h, 2);
    h.channel(ALDREN, WARD_LEFT, 3);
    h.frame();
    expect(banner()).toBe('');
    // The console is unaffected: switching the banner off takes the screen back, not the
    // reading, which is the whole reason it is a setting of its own.
    expect(h.rows('channels')).toHaveLength(3);
  });
});

describe('the mechanic timers', () => {
  it('says a clock is armed rather than counting one it has never seen', async () => {
    const h = await start();
    h.frame();
    expect(h.detailOf('mechanics', 'raise-fallen')).toBe('armed, not seen yet');
    expect(h.valueOf('mechanics', 'raise-fallen')).toBe('');
  });

  it('anchors Gravebreaker on the damage record the game actually sends', async () => {
    const h = await start();
    h.frame();
    h.damage('Gravebreaker');
    h.frame();
    expect(h.valueOf('mechanics', 'gravebreaker')).toBe(`~${GRAVEBREAKER.every.toFixed(1)}s`);
  });

  it('draws Gravebreaker as charged once due, because the release waits for a swing', async () => {
    const h = await start();
    // The fight is under way before the record lands, which is the order a session has: the
    // pull is opened by the frame that first sees the boss with a target, and a record
    // arriving before that frame is dropped rather than opening one.
    h.frame();
    h.damage('Gravebreaker');
    h.frame();
    h.advance(GRAVEBREAKER.every * 1000 + 100);
    h.frame();
    expect(h.valueOf('mechanics', 'gravebreaker')).toBe('next swing');
  });

  it('holds every clock through a Deathless Rage cast', async () => {
    const h = await start({ hp: 500 });
    h.frame();
    h.damage('Soul Rend');
    h.frame();
    const before = h.valueOf('mechanics', 'soul-rend');
    expect(before).toBe(`~${SOUL_REND.every.toFixed(1)}s`);
    // Four seconds pass inside the cast. The game's own driver returns early for the whole
    // of it, so a clock that moved here would be ahead of the encounter by that much for the
    // rest of the pull.
    castDeathless(h, 9);
    h.advance(4000);
    h.frame();
    expect(h.valueOf('mechanics', 'soul-rend')).toBe(before);
  });

  it('holds them through the stun a successful interrupt leaves behind', async () => {
    const h = await start({ hp: 500 });
    h.frame();
    h.damage('Soul Rend');
    h.frame();
    const before = h.valueOf('mechanics', 'soul-rend');
    // The raid interrupted the cast, so the boss wears the stun for five seconds and the
    // driver returns early for all of it, exactly as it does during the cast itself.
    h.give(BOSS_ID, aura(FREEZE_AURA, { kind: 'stun', remaining: 5, duration: 5 }));
    h.advance(4000);
    h.frame();
    expect(h.valueOf('mechanics', 'soul-rend')).toBe(before);
  });

  it('does let a clock run when nothing is preempting it', async () => {
    const h = await start({ hp: 500 });
    h.frame();
    h.damage('Soul Rend');
    h.frame();
    h.advance(4000);
    h.frame();
    const left = SOUL_REND.every - 4;
    expect(h.valueOf('mechanics', 'soul-rend')).toBe(`~${left.toFixed(1)}s`);
  });

  it('seeds phase two from the transition ending, with the game’s own numbers', async () => {
    const h = await start({ hp: 500 });
    h.give(
      BOSS_ID,
      aura(ENCOUNTER.phases.transitionAura, { kind: 'stun', remaining: 21, duration: 21 }),
    );
    h.frame();
    h.strip(BOSS_ID, ENCOUNTER.phases.transitionAura);
    h.frame();
    expect(h.valueOf('mechanics', 'soul-rend')).toBe(`~${SEED_SOUL_REND.toFixed(1)}s`);
    const deathless = SEED_DEATHLESS;
    expect(h.valueOf('mechanics', 'deathless')).toBe(`~${deathless.toFixed(1)}s`);
    // Gravebreaker's is the one that is NOT the settle delay the other two are timed off.
    expect(h.valueOf('mechanics', 'gravebreaker')).toBe(`~${SEED_GRAVEBREAKER.toFixed(1)}s`);
  });

  /**
   * The game starts every clock when the fight does, so a pull this addon watched open needs
   * no observation to count the first of anything. It matters most for Gravebreaker, whose
   * only anchor is a SPLASH record: a raid standing where it should be takes none, so without
   * this the row reads "armed, not seen yet" for the whole pull.
   */
  it('counts from the game’s own opening values on a pull it watched start', async () => {
    const h = await start({ engaged: false });
    h.frame();
    h.setBossField('aggroTargetId', BRONN);
    h.frame();
    expect(h.valueOf('mechanics', 'gravebreaker')).toBe(`~${PULL_GRAVEBREAKER.toFixed(1)}s`);
    expect(h.valueOf('mechanics', 'raise-fallen')).toBe(`~${PULL_RAISE_FALLEN.toFixed(1)}s`);
  });

  it('invents nothing for a fight it arrived in the middle of', async () => {
    const h = await start();
    h.frame();
    expect(h.detailOf('mechanics', 'gravebreaker')).toBe('armed, not seen yet');
  });

  it('draws the live Deathless Rage bar from the game’s own remaining time', async () => {
    const h = await start({ hp: 500 });
    castDeathless(h, 7.5);
    h.frame();
    expect(h.valueOf('mechanics', 'deathless')).toBe('7.5s');
  });

  /**
   * The game re-arms this one where it STARTS the cast, and a cast start is the only edge
   * there is: the damage a Deathless Rage deals is not dealt at all on the cycles the raid
   * answers, so a damage anchor would leave the clock dead for exactly the pulls that go well.
   */
  it('re-arms the Deathless Rage clock from the cast starting', async () => {
    const h = await start({ hp: 500 });
    h.frame();
    castDeathless(h, CHANNELS.castSeconds);
    h.frame();
    // The whole cast is frozen, in the game and here, so the clock comes out of it at its
    // full length rather than the cast eating a fifth of the cycle.
    h.advance(CHANNELS.castSeconds * 1000);
    h.frame();
    clearCast(h.boss);
    h.frame();
    expect(h.valueOf('mechanics', 'deathless')).toBe(`~${DEATHLESS.every.toFixed(1)}s`);
  });
});
