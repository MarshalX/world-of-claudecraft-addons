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

// The table's shape, written out with the keys this suite reads rather than as a `Record`, so
// a regenerated table that drops one fails the TYPECHECK here instead of reading `undefined`
// into a fixture and producing a case that quietly asserts nothing.

type ConditionKind = 'aura' | 'cast' | 'hazard' | 'belowHp';

interface Condition {
  kind: ConditionKind;
  id?: string;
  hp?: number;
}

type AnchorKind = 'damage' | 'spawn' | 'cast' | 'partyAura' | 'hazard' | 'boss';

interface Anchor {
  kind: AnchorKind;
  id?: string;
  when?: Condition;
}

interface Seed {
  id: string;
  seconds: number;
  mode?: 'floor' | 'cap';
}

interface Mechanic {
  id: string;
  label: string;
  every: number;
  detail?: string;
  phase?: 'one' | 'two' | 'both';
  charge?: true;
  group?: string;
  when?: Condition[];
  unless?: Condition[];
  freeze?: Condition[];
  cadences?: Array<{ when: Condition; every: number }>;
  anchor?: Anchor[];
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
  countdown?: true;
  seconds?: number;
}

interface DebuffsBlock {
  kind: 'debuffs';
  label: string;
  aura: string;
  durationSeconds?: number;
  apart?: number;
  count?: number;
  note?: string;
}

interface SoakBlock {
  kind: 'soak';
  label: string;
  aura: string;
  radius: number;
  seconds: number;
  required: number;
  total: number;
  perMissing: number;
}

interface StationsBlock {
  kind: 'stations';
  label: string;
  ready: string;
  active: string;
  spent: string;
  activeSeconds: number;
  count: number;
  use: string;
}

interface GatesBlock {
  kind: 'gates';
  label: string;
  rows: Array<{ id: string; name: string; hp: number; cast?: string; detail?: string }>;
}

type Block =
  | ChannelsBlock
  | MarksBlock
  | TankBlock
  | AddsBlock
  | EnrageBlock
  | DebuffsBlock
  | SoakBlock
  | StationsBlock
  | GatesBlock;

interface Encounter {
  id: string;
  templateId: string;
  name: string;
  phases?: { transitionAura: string; phaseTwoHp: number; seeds: Seed[] };
  pullSeeds: Seed[];
  freeze: Condition[];
  spacing?: { group: string; seconds: number };
  rates?: Array<{ when: Condition; multiplier: number }>;
  reseeds?: Array<{ on: Condition; edge?: 'enters' | 'leaves'; seeds: Seed[] }>;
  yells?: Array<{ text: string; edge: 'pull' | 'kill' }>;
  wipes?: Array<{ ability: string }>;
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

/** By id rather than position, so a regenerated table can reorder. */
function encounterOf(id: string): Encounter {
  const found = TABLE.encounters.find((one) => one.id === id);
  if (found === undefined) {
    throw new Error(`bosses.json carries no ${id} encounter, so there is nothing to test against`);
  }
  return found;
}

const ENCOUNTER: Encounter = encounterOf('nythraxis');
const IGNIVAR: Encounter = encounterOf('ignivar');
const VARKHUL: Encounter = encounterOf('varkhul');

function blockIn<K extends Block['kind']>(row: Encounter, kind: K): Extract<Block, { kind: K }> {
  const found = row.blocks.find((block) => block.kind === kind);
  if (found === undefined) {
    throw new Error(`bosses.json declares no ${kind} block on ${row.id}`);
  }
  return found as Extract<Block, { kind: K }>;
}

function blockOf<K extends Block['kind']>(kind: K): Extract<Block, { kind: K }> {
  return blockIn(ENCOUNTER, kind);
}

/**
 * A helper rather than a find with a fallback: a missing seed throws by name rather than
 * defaulting to a zero that would make a case assert nothing.
 */
function seedIn(seeds: Seed[] | undefined, id: string, what: string): number {
  const found = (seeds ?? []).find((one) => one.id === id);
  if (found === undefined) {
    throw new Error(`bosses.json declares no ${what} for ${id}`);
  }
  return found.seconds;
}

function seedOf(id: string): number {
  return seedIn(ENCOUNTER.phases?.seeds, id, 'phase-two seed');
}

/** What the game's own initialiser starts a clock at, which is not always its cadence. */
function pullSeedOf(id: string): number {
  return seedIn(ENCOUNTER.pullSeeds, id, 'pull seed');
}

function mechanicIn(row: Encounter, id: string): Mechanic {
  const found = row.mechanics.find((one) => one.id === id);
  if (found === undefined) {
    throw new Error(`bosses.json declares no ${id} mechanic on ${row.id}`);
  }
  return found;
}

function mechanicOf(id: string): Mechanic {
  return mechanicIn(ENCOUNTER, id);
}

function transitionAura(): string {
  const { phases } = ENCOUNTER;
  if (phases === undefined) {
    throw new Error('bosses.json no longer gives nythraxis a transition to seed phase two from');
  }
  return phases.transitionAura;
}

const CHANNELS = blockOf('channels');
function auraIdsIn(conditions: Condition[]): string[] {
  const found: string[] = [];
  for (const one of conditions) {
    if (one.kind === 'aura' && one.id !== undefined) {
      found.push(one.id);
    }
  }
  return found;
}

const FREEZE_AURA = only(auraIdsIn(ENCOUNTER.freeze), 'freeze condition');
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
  /** A second magnitude, which is where one mechanic puts the damage it will split. */
  value2?: number;
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
   * A mechanic with neither an anchor nor a seed counts down once, clamps at zero and calls
   * the same banner every re-warn floor for the rest of the pull. Drawing the game's own bar
   * is NOT a way to start a clock; a cast ANCHOR both draws the bar and re-arms.
   */
  it('gives every mechanic a way to start its clock', () => {
    const phaseSeeds = (row: Encounter): Seed[] => {
      const { phases } = row;
      if (phases === undefined) {
        return [];
      }
      return phases.seeds;
    };
    const reseedSeeds = (row: Encounter): Seed[] =>
      (row.reseeds ?? []).flatMap((rule) => rule.seeds);
    const seeded = (row: Encounter, id: string): boolean =>
      [...row.pullSeeds, ...phaseSeeds(row), ...reseedSeeds(row)].some((seed) => seed.id === id);
    const stuck = TABLE.encounters.flatMap((row) =>
      row.mechanics
        .filter((one) => (one.anchor ?? []).length === 0 && !seeded(row, one.id))
        .map((one) => `${row.id}/${one.id}`),
    );
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
    h.give(BOSS_ID, aura(transitionAura(), { kind: 'stun', remaining: 21 }));
    h.frame();
    h.strip(BOSS_ID, transitionAura());
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
    h.give(BOSS_ID, aura(transitionAura(), { kind: 'stun', remaining: 21, duration: 21 }));
    h.frame();
    h.strip(BOSS_ID, transitionAura());
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

// The two raid encounters. Three readings come off surfaces the dungeon boss never touches
// (the ground-warning list, an aura EVENT rather than an aura, and the boss's own yell), and
// each case drives the one its mechanic actually uses.

const RAID_BOSS_ID = 800;
const CONDUIT_IDS = [860, 861, 862, 863];
const CONDUIT_NAMES = ['north_west', 'north_east', 'south_east', 'south_west'];
const APOCALYPSE_ADD_ID = 870;

const IG_STATIONS = blockIn(IGNIVAR, 'stations');
const IG_BRAND = blockIn(IGNIVAR, 'debuffs');
const IG_ENRAGE = blockIn(IGNIVAR, 'enrage');
const IG_GATES = blockIn(IGNIVAR, 'gates');
const IG_TANK = blockIn(IGNIVAR, 'tankStacks');
const IG_ADDS = blockIn(IGNIVAR, 'adds');
const IG_BRAND_MECHANIC = mechanicIn(IGNIVAR, 'brand');
const IG_SEARING = mechanicIn(IGNIVAR, 'searing');
const IG_RAYS = mechanicIn(IGNIVAR, 'rays');
const IG_METEORS = mechanicIn(IGNIVAR, 'meteors');

const VK_SOAK = blockIn(VARKHUL, 'soak');
const VK_ENRAGE = blockIn(VARKHUL, 'enrage');
const VK_SWEEP = mechanicIn(VARKHUL, 'sweep');
const VK_ORBS = mechanicIn(VARKHUL, 'orbs');

function castAnchorOf(mechanic: Mechanic): string {
  const found = (mechanic.anchor ?? []).find((one) => one.kind === 'cast');
  if (found?.id === undefined) {
    throw new Error(`bosses.json no longer anchors ${mechanic.id} on a cast`);
  }
  return found.id;
}

function auraAnchorOf(mechanic: Mechanic): string {
  const found = (mechanic.anchor ?? []).find((one) => one.kind === 'partyAura');
  if (found?.id === undefined) {
    throw new Error(`bosses.json no longer anchors ${mechanic.id} on an aura landing`);
  }
  return found.id;
}

function hazardAnchorOf(mechanic: Mechanic): string {
  const found = (mechanic.anchor ?? []).find((one) => one.kind === 'hazard');
  if (found?.id === undefined) {
    throw new Error(`bosses.json no longer anchors ${mechanic.id} on a ground warning`);
  }
  return found.id;
}

function yellOf(row: Encounter, edge: 'pull' | 'kill'): string {
  const found = (row.yells ?? []).find((one) => one.edge === edge);
  if (found === undefined) {
    throw new Error(`bosses.json declares no ${edge} yell for ${row.id}`);
  }
  return found.text;
}

function cadenceUnder(mechanic: Mechanic, auraId: string): number {
  const found = (mechanic.cadences ?? []).find(
    (one) => one.when.kind === 'aura' && one.when.id === auraId,
  );
  if (found === undefined) {
    throw new Error(`bosses.json gives ${mechanic.id} no cadence under ${auraId}`);
  }
  return found.every;
}

function enrageAuraOf(block: EnrageBlock): string {
  return block.aura;
}

interface RaidHarness extends TocsinHarness {
  /** Put a ground warning of one kind on the snapshot, which is what the loader reads. */
  hazard: (kind: string, count: number) => void;
  /** Deliver an aura landing, which is the only clean edge Brand of the Pyre has. */
  auraEvent: (name: string, targetId: number) => void;
  /** Deliver a boss yell, the one exact pull edge the wire carries. */
  yell: (text: string) => void;
  /** The same, from some other entity, which is what a second instance's copy would be. */
  yellFrom: (text: string, entityId: number) => void;
  /** Swap one conduit's template, which is how its whole state reaches a client. */
  conduit: (index: number, templateId: string) => void;
  /** Deliver one damage record of any size, for the wipe cases. */
  hit: (ability: string, amount: number) => void;
}

/** Which snapshot list the loader reads one ground-warning family from. */
function hazardField(kind: string): string {
  if (kind === 'ignivarMeteor') {
    return 'activeIgnivarMeteors';
  }
  return 'activeVarkhulForgestormWarnings';
}

function raidTarget(opts: RaidOpts): number | null {
  if (opts.engaged === false) {
    return null;
  }
  return BRONN;
}

interface RaidOpts {
  hp?: number;
  engaged?: boolean;
  settings?: Record<string, unknown>;
  /** Whether the four conduits are in the room at all. */
  conduits?: boolean;
  /** What state each is in, in the arena's own order. Every one is ready by default. */
  conduitStates?: readonly string[];
}

async function startRaid(row: Encounter, opts: RaidOpts = {}): Promise<RaidHarness> {
  const entities = new Map<number, Fake>();
  const rows = ROSTER.map(memberRow);
  const player = liveEntity({ set: { id: PLAYER_ID, name: 'Marshal', templateId: 'warrior' } });
  entities.set(PLAYER_ID, player);
  for (const spec of ROSTER) {
    if (spec.near === true && spec.pid !== PLAYER_ID) {
      entities.set(
        spec.pid,
        liveEntity({
          set: {
            id: spec.pid,
            name: spec.name,
            kind: 'player',
            pos: { x: spec.x, y: 0, z: spec.z },
          },
        }),
      );
    }
  }
  const boss = liveEntity({
    set: {
      id: RAID_BOSS_ID,
      name: row.name,
      kind: 'mob',
      hostile: true,
      templateId: row.templateId,
      hp: opts.hp ?? 1000,
      maxHp: 1000,
      pos: { x: 0, y: 0, z: 0 },
      aggroTargetId: raidTarget(opts),
    },
  });
  entities.set(RAID_BOSS_ID, boss);
  if (opts.conduits !== false) {
    CONDUIT_IDS.forEach((id, index) => {
      entities.set(
        id,
        liveEntity({
          set: {
            id,
            name: `${CONDUIT_NAMES[index] ?? 'corner'} Water Conduit`,
            kind: 'object',
            templateId: opts.conduitStates?.[index] ?? IG_STATIONS.ready,
            pos: { x: 0, y: 0, z: 0 },
          },
        }),
      );
    });
  }
  const world: Fake = {
    entities,
    player,
    partyInfo: { leader: PLAYER_ID, raid: true, members: rows },
    activeIgnivarMeteors: [] as unknown[],
    activeVarkhulForgestormWarnings: [] as unknown[],
  };
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    settings: opts.settings ?? {},
    data: { 'bosses.json': TABLE_TEXT },
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);
  await settle();

  const entityOf = (pid: number): Fake => entities.get(pid) as Fake;
  const base = {
    ...harness,
    boss,
    entityOf,
    spawn: (id: number, templateId: string, over: Fake = {}) => {
      const entity = liveEntity({
        set: { id, kind: 'mob', hostile: true, templateId, name: templateId, ...over },
      });
      entities.set(id, entity);
      return entity;
    },
    setBossField: (field: string, value: unknown) => {
      setField(boss, field, value);
    },
    despawn: (id: number) => {
      entities.delete(id);
    },
    give: (pid: number, one: Aura) => {
      const entity = entityOf(pid);
      const held = readField<Aura[]>(entity, 'auras').filter((each) => each.id !== one.id);
      setField(entity, 'auras', [...held, one]);
    },
    strip: (pid: number, id: string) => {
      const entity = entityOf(pid);
      setField(
        entity,
        'auras',
        readField<Aura[]>(entity, 'auras').filter((each) => each.id !== id),
      );
    },
    giveRow: (pid: number, id: string, remaining: number) => {
      rows.find((each) => each.pid === pid)?.auras.push({ id, kind: 'vulnerability', remaining });
    },
    move: (pid: number, x: number, z: number) => {
      const memberOf = rows.find((each) => each.pid === pid);
      if (memberOf !== undefined) {
        memberOf.x = x;
        memberOf.z = z;
      }
      const entity = entities.get(pid);
      if (entity !== undefined) {
        setField(entity, 'pos', { x, y: 0, z });
      }
    },
    channel: () => undefined,
    damage: (ability: string) => {
      harness.inbound(
        eventsFrame([
          { type: 'damage', sourceId: RAID_BOSS_ID, targetId: PLAYER_ID, amount: 10, ability },
        ]),
      );
    },
    frame: (times = 1) => {
      for (let step = 0; step < times; step += 1) {
        harness.frames.tick();
      }
    },
    rows: (block: string) =>
      [...(blockEl(block)?.querySelectorAll('[data-row]') ?? [])].map(
        (el) => el.getAttribute('data-row') ?? '',
      ),
    labelOf: (block: string, one: string) => textIn(block, one, '.woc-bar-label'),
    detailOf: (block: string, one: string) => textIn(block, one, '.woc-bar-detail'),
    valueOf: (block: string, one: string) => textIn(block, one, '.woc-bar-value'),
    shows: (block: string) => {
      const el = blockEl(block);
      return el !== null && !el.hasAttribute('hidden');
    },
    headingOf: (block: string) =>
      blockEl(block)?.querySelector('.woc-layout-line')?.textContent ?? '',
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
  return {
    ...base,
    hazard: (kind, count) => {
      const field = hazardField(kind);
      setField(
        world,
        field,
        Array.from({ length: count }, (_, index) => ({
          id: `${kind}:${String(index)}`,
          x: 0,
          z: 0,
          radius: 3,
          innerRadius: 0,
          duration: 2.5,
          remaining: 2.5,
        })),
      );
    },
    auraEvent: (name, targetId) => {
      harness.inbound(
        eventsFrame([{ type: 'aura', targetId, name, gained: true, sourceId: RAID_BOSS_ID }]),
      );
    },
    yell: (text) => {
      harness.inbound(
        eventsFrame([
          {
            type: 'chat',
            fromPid: RAID_BOSS_ID,
            from: row.name,
            text,
            channel: 'yell',
            entityId: RAID_BOSS_ID,
          },
        ]),
      );
    },
    yellFrom: (text, entityId) => {
      harness.inbound(
        eventsFrame([
          { type: 'chat', fromPid: entityId, from: row.name, text, channel: 'yell', entityId },
        ]),
      );
    },
    conduit: (index, templateId) => {
      const id = CONDUIT_IDS[index] ?? 0;
      const entity = entities.get(id);
      if (entity !== undefined) {
        setField(entity, 'templateId', templateId);
      }
    },
    hit: (ability, amount) => {
      harness.inbound(
        eventsFrame([
          { type: 'damage', sourceId: RAID_BOSS_ID, targetId: PLAYER_ID, amount, ability },
        ]),
      );
    },
  };
}

describe('the raid rows in the shipped table', () => {
  it('carries both encounters with the ids every reading joins on', () => {
    expect(IGNIVAR.templateId).toBe('ignivar_herald_of_the_last_flame');
    expect(VARKHUL.templateId).toBe('varkhul_forgefather_of_the_last_flame');
    expect(IG_BRAND.aura).toBe('ignivar_brand_of_the_pyre');
    expect(VK_SOAK.aura).toBe('varkhul_shared_pyre');
  });

  /** A kind added by a regenerated table lands here rather than in a silently blank panel. */
  it('declares no block kind the addon has no renderer for', () => {
    const kinds = new Set(TABLE.encounters.flatMap((row) => row.blocks.map((one) => one.kind)));
    expect([...kinds].sort(byName)).toEqual([
      'adds',
      'channels',
      'debuffs',
      'enrage',
      'gates',
      'marks',
      'soak',
      'stations',
      'tankStacks',
    ]);
  });

  /**
   * Its damage LABEL is worn by its own tick and by the proximity pulse too, so a damage
   * anchor would re-arm it several times a second.
   */
  it('anchors the brand on the aura landing rather than on its damage label', () => {
    expect((IG_BRAND_MECHANIC.anchor ?? []).map((one) => one.kind)).toEqual(['partyAura']);
  });

  /**
   * Neither of these sets a cast on the boss and both deal damage only to whoever failed to
   * move, so a damage anchor would leave the clock dead on exactly the cycles the raid
   * answered correctly.
   */
  it('anchors the two silent mechanics on their ground warnings', () => {
    expect(hazardAnchorOf(IG_METEORS)).toBe('ignivarMeteor');
    expect(hazardAnchorOf(mechanicIn(VARKHUL, 'forgestorm'))).toBe('varkhulForgestorm');
  });

  it('ships normal tuning only, with no heroic-only mechanic in either row', () => {
    const heroicOnly = [IGNIVAR, VARKHUL].flatMap((row) =>
      row.mechanics.filter((one) => one.id.includes('chain') || one.id.includes('worldfire')),
    );
    expect(heroicOnly).toEqual([]);
  });
});

describe('Ignivar', () => {
  it('counts a mechanic down from the game’s own opening value on a pull it watched', async () => {
    const h = await startRaid(IGNIVAR, { engaged: false });
    h.frame();
    h.setBossField('aggroTargetId', BRONN);
    h.frame();
    const opener = seedIn(IGNIVAR.pullSeeds, 'searing', 'pull seed');
    expect(h.valueOf('mechanics', 'searing')).toBe(`~${opener.toFixed(1)}s`);
  });

  /** A yell is the only EXACT pull edge the wire carries: nobody watches a raid boss stand idle. */
  it('seeds the clocks off the engage yell for a player who never saw the boss idle', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    expect(h.detailOf('mechanics', 'searing')).toBe('armed, not seen yet');
    h.yell(yellOf(IGNIVAR, 'pull'));
    h.frame();
    const opener = seedIn(IGNIVAR.pullSeeds, 'searing', 'pull seed');
    expect(h.valueOf('mechanics', 'searing')).toBe(`~${opener.toFixed(1)}s`);
  });

  /**
   * The same words from a second copy of the boss in another instance would otherwise seed
   * this raid's clocks, so the line is matched against the entity as well as against the text.
   */
  it('ignores the engage line when it came from a different entity', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    h.yellFrom(yellOf(IGNIVAR, 'pull'), RAID_BOSS_ID + 50);
    h.frame();
    expect(h.detailOf('mechanics', 'searing')).toBe('armed, not seen yet');
  });

  it('ignores a line this encounter does not declare', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    h.yell(yellOf(VARKHUL, 'pull'));
    h.frame();
    expect(h.detailOf('mechanics', 'searing')).toBe('armed, not seen yet');
  });

  /**
   * The four paced abilities keep ticking through each other's casts and the brand does not,
   * because the game's driver returns before the brand's clock and after theirs.
   */
  it('holds the brand through a paced cast while the paced clocks keep running', async () => {
    const h = await startRaid(IGNIVAR, { engaged: false });
    h.frame();
    h.setBossField('aggroTargetId', BRONN);
    h.frame();
    const brand = seedIn(IGNIVAR.pullSeeds, 'brand', 'pull seed');
    const skyfire = seedIn(IGNIVAR.pullSeeds, 'skyfire', 'pull seed');
    writeCast(h.boss, castAnchorOf(IG_SEARING), 3, 3);
    h.frame();
    h.advance(2000);
    h.frame();
    expect(h.valueOf('mechanics', 'brand')).toBe(`~${brand.toFixed(1)}s`);
    expect(h.valueOf('mechanics', 'skyfire')).toBe(`~${(skyfire - 2).toFixed(1)}s`);
  });

  it('re-arms a paced mechanic from its own cast starting', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    writeCast(h.boss, castAnchorOf(IG_SEARING), 3, 3);
    h.frame();
    clearCast(h.boss);
    h.frame();
    expect(h.valueOf('mechanics', 'searing')).toBe(`~${IG_SEARING.every.toFixed(1)}s`);
  });

  /**
   * The game floors every paced ability at a fixed gap once any one resolves, so without this
   * the other three read up to that gap early.
   */
  it('leaves the game’s own gap between one paced ability and the next', async () => {
    const h = await startRaid(IGNIVAR, { engaged: false });
    h.frame();
    h.setBossField('aggroTargetId', BRONN);
    h.frame();
    const { spacing } = IGNIVAR;
    if (spacing === undefined) {
      throw new Error('bosses.json no longer spaces Ignivar’s paced abilities apart');
    }
    const gap = spacing.seconds;
    // Run the skyfire clock down to under the gap, then resolve a DIFFERENT paced ability.
    h.advance((seedIn(IGNIVAR.pullSeeds, 'skyfire', 'pull seed') - 1) * 1000);
    writeCast(h.boss, castAnchorOf(IG_SEARING), 3, 3);
    h.frame();
    clearCast(h.boss);
    h.frame();
    expect(h.valueOf('mechanics', 'skyfire')).toBe(`~${gap.toFixed(1)}s`);
  });

  it('arms the brand from an aura landing and not from its own tick damage', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    h.damage(auraAnchorOf(IG_BRAND_MECHANIC));
    h.frame();
    expect(h.detailOf('mechanics', 'brand')).toBe('armed, not seen yet');
    h.auraEvent(auraAnchorOf(IG_BRAND_MECHANIC), PLAYER_ID);
    h.frame();
    expect(h.valueOf('mechanics', 'brand')).toBe(`~${IG_BRAND_MECHANIC.every.toFixed(1)}s`);
  });

  it('arms the meteor clock from a ground warning appearing, once per rain', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    h.hazard('ignivarMeteor', 5);
    h.frame();
    expect(h.valueOf('mechanics', 'meteors')).toBe(`~${IG_METEORS.every.toFixed(1)}s`);
    h.advance(2000);
    // The same rain still on screen is not a second one, so nothing re-arms.
    h.frame();
    const left = IG_METEORS.every - 2;
    expect(h.valueOf('mechanics', 'meteors')).toBe(`~${left.toFixed(1)}s`);
  });

  it('names who is branded and how close the nearest body is', async () => {
    const h = await startRaid(IGNIVAR);
    h.give(ALDREN, aura(IG_BRAND.aura, { kind: 'dot', remaining: 600, duration: 600 }));
    h.giveRow(ALDREN, IG_BRAND.aura, 600);
    h.move(ALDREN, 0, 0);
    h.move(MALRIC, 1, 0);
    h.frame();
    expect(h.rows('debuffs')).toEqual([String(ALDREN)]);
    expect(h.detailOf('debuffs', String(ALDREN))).toBe('Malric is 1.0yd away');
  });

  it('says the branded player is clear once everyone has moved off them', async () => {
    const h = await startRaid(IGNIVAR);
    h.give(ALDREN, aura(IG_BRAND.aura, { kind: 'dot', remaining: 600, duration: 600 }));
    h.giveRow(ALDREN, IG_BRAND.aura, 600);
    h.move(ALDREN, 0, 0);
    for (const pid of [PLAYER_ID, VOSS, MALRIC, BRONN]) {
      h.move(pid, 60, 60);
    }
    h.frame();
    expect(h.detailOf('debuffs', String(ALDREN))).toBe(`nobody within ${String(IG_BRAND.apart)}yd`);
  });

  /** The brand is removed by water rather than by expiring, so a bar under it would sit full. */
  it('draws no bar under a debuff that does not expire', () => {
    expect(IG_BRAND.durationSeconds).toBeUndefined();
  });
});

describe('the water conduits', () => {
  it('draws every conduit in its own state, with the corner it is in', async () => {
    const h = await startRaid(IGNIVAR);
    h.conduit(1, IG_STATIONS.active);
    h.conduit(2, IG_STATIONS.spent);
    h.frame();
    // Sorted by the game's own name, so the layout is the same every pull: north east, north
    // west, south east, south west.
    expect(h.rows('stations')).toEqual([861, 860, 862, 863].map(String));
    expect(h.valueOf('stations', String(CONDUIT_IDS[0]))).toBe('READY');
    expect(h.valueOf('stations', String(CONDUIT_IDS[2]))).toBe('SPENT');
    expect(h.labelOf('stations', String(CONDUIT_IDS[0]))).toBe('North West');
  });

  /**
   * A conduit's own seconds are not on the wire; the template swap is, because `templateId`
   * is an identity field re-broadcast on change.
   */
  it('counts a conduit down from the swap it watched, not from a figure on the wire', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    h.conduit(0, IG_STATIONS.active);
    h.frame();
    expect(h.valueOf('stations', String(CONDUIT_IDS[0]))).toBe(
      `~${IG_STATIONS.activeSeconds.toFixed(1)}s`,
    );
    h.advance(4000);
    h.frame();
    const left = IG_STATIONS.activeSeconds - 4;
    expect(h.valueOf('stations', String(CONDUIT_IDS[0]))).toBe(`~${left.toFixed(1)}s`);
  });

  it('says a conduit was already running rather than inventing a countdown for it', async () => {
    const h = await startRaid(IGNIVAR);
    h.conduit(0, IG_STATIONS.active);
    h.frame(2);
    expect(h.valueOf('stations', String(CONDUIT_IDS[0]))).toBe('LIVE');
    expect(h.detailOf('stations', String(CONDUIT_IDS[0]))).toBe(
      'running, started before this was watching',
    );
  });

  it('says how many are out of range rather than letting a short list stand in', async () => {
    const h = await startRaid(IGNIVAR, { conduits: false });
    h.frame();
    expect(h.rows('stations')).toEqual(['out-of-range']);
    expect(h.labelOf('stations', 'out-of-range')).toBe(
      `0 of ${String(IG_STATIONS.count)} in range`,
    );
  });
});

describe('Ignivar’s last phase', () => {
  function enrage(h: RaidHarness, remaining: number): void {
    h.give(
      RAID_BOSS_ID,
      aura(enrageAuraOf(IG_ENRAGE), {
        kind: 'buff_haste',
        remaining,
        duration: IG_ENRAGE.seconds ?? 45,
      }),
    );
  }

  it('draws the game’s own countdown rather than a share of the boss’s health', async () => {
    const h = await startRaid(IGNIVAR, { hp: 150 });
    enrage(h, 31);
    h.frame();
    expect(h.valueOf('enrage', 'enrage')).toBe('31s');
    expect(h.detailOf('enrage', 'enrage')).toBe('15% left, then the raid dies');
  });

  it('takes away the mechanics the phase replaces and puts up the one it adds', async () => {
    const h = await startRaid(IGNIVAR, { hp: 150 });
    h.frame();
    expect(h.rows('mechanics')).toContain('forge-wave');
    expect(h.rows('mechanics')).not.toContain('last-flame');
    enrage(h, 40);
    h.frame();
    expect(h.rows('mechanics')).not.toContain('forge-wave');
    expect(h.rows('mechanics')).toContain('last-flame');
  });

  it('re-arms what survives the phase at the phase’s own cadence, not the opening one', async () => {
    const h = await startRaid(IGNIVAR, { hp: 150 });
    enrage(h, 40);
    h.frame();
    writeCast(h.boss, castAnchorOf(IG_RAYS), 10, 10);
    h.frame();
    clearCast(h.boss);
    h.frame();
    const fast = cadenceUnder(IG_RAYS, enrageAuraOf(IG_ENRAGE));
    expect(fast).toBeLessThan(IG_RAYS.every);
    expect(h.valueOf('mechanics', 'rays')).toBe(`~${fast.toFixed(1)}s`);
  });

  /** The phase change rewrites several clocks at once, and it does it on an EDGE. */
  it('re-seeds the clocks the game re-seeds when the phase opens', async () => {
    const h = await startRaid(IGNIVAR, { hp: 150 });
    h.frame();
    enrage(h, 45);
    h.frame();
    const opening = (IGNIVAR.reseeds ?? []).find(
      (rule) => rule.on.kind === 'aura' && rule.on.id === enrageAuraOf(IG_ENRAGE),
    );
    const brand = (opening?.seeds ?? []).find((seed) => seed.id === 'brand');
    expect(brand).toBeDefined();
    expect(h.valueOf('mechanics', 'brand')).toBe(`~${(brand?.seconds ?? 0).toFixed(1)}s`);
  });
});

describe('the gates block', () => {
  it('says nothing while the boss is a long way above the threshold', async () => {
    const h = await startRaid(IGNIVAR, { hp: 1000 });
    h.frame();
    expect(h.shows('gates')).toBe(false);
  });

  it('names the next hard change once the boss is inside the band', async () => {
    const gate = only(IG_GATES.rows, 'gate');
    const h = await startRaid(IGNIVAR, { hp: Math.round((gate.hp + 0.05) * 1000) });
    h.frame();
    expect(h.rows('gates')).toContain(gate.id);
    expect(h.labelOf('gates', gate.id)).toBe(gate.name);
  });

  it('goes live off the game’s own bar while the gate is casting', async () => {
    const withCast = IG_GATES.rows.find((one) => one.cast !== undefined);
    expect(withCast).toBeDefined();
    const h = await startRaid(IGNIVAR, { hp: 1000 });
    writeCast(h.boss, withCast?.cast ?? '', 7.5, 12);
    h.frame();
    expect(h.valueOf('gates', withCast?.id ?? '')).toBe('7.5s');
  });
});

describe('the Apocalypse add', () => {
  it('draws the cast it is racing rather than the health it happens to have', async () => {
    const add = only(IG_ADDS.rows, 'add');
    const h = await startRaid(IGNIVAR, { hp: 600 });
    const entity = h.spawn(APOCALYPSE_ADD_ID, add.templateId, {
      name: add.name,
      hp: 400,
      maxHp: 1000,
    });
    writeCast(entity, 'Apocalypse', 12.5, 20);
    h.frame();
    expect(h.valueOf('adds', String(APOCALYPSE_ADD_ID))).toBe('12.5s');
    expect(h.detailOf('adds', String(APOCALYPSE_ADD_ID))).toContain('40% health');
  });

  it('falls back to its health when it is not channelling at all', async () => {
    const add = only(IG_ADDS.rows, 'add');
    const h = await startRaid(IGNIVAR, { hp: 600 });
    h.spawn(APOCALYPSE_ADD_ID, add.templateId, { name: add.name, hp: 400, maxHp: 1000 });
    h.frame();
    expect(h.valueOf('adds', String(APOCALYPSE_ADD_ID))).toBe('40%');
  });
});

describe('Ignivar’s tank stacks', () => {
  it('reads Molten Armor off the boss’s own target with no heroic tell needed', async () => {
    const h = await startRaid(IGNIVAR);
    h.give(BRONN, aura(IG_TANK.aura, { kind: 'vuln_source', stacks: 2 }));
    h.frame();
    expect(h.valueOf('tankStacks', 'tank')).toBe('2 stacks');
    expect(h.detailOf('tankStacks', 'tank')).toBe(
      `+${String(Math.round(2 * IG_TANK.perStack * 100))}% damage taken`,
    );
  });
});

describe('a wipe and a reset', () => {
  /**
   * A raid wipe is ordinary damage of a hundred times a player's health under the mechanic's
   * own label, with no lifecycle event beside it.
   */
  it('reads the wipe label off the damage record and says so once the boss is gone', async () => {
    const wipe = only(IGNIVAR.wipes ?? [], 'wipe');
    const h = await startRaid(IGNIVAR);
    h.frame();
    h.hit(wipe.ability, 100_000);
    h.despawn(RAID_BOSS_ID);
    h.frame();
    expect(h.notes().join(' ')).toContain(`wiped the raid on ${wipe.ability}`);
  });

  it('says the boss is down when its own death line arrives', async () => {
    const h = await startRaid(IGNIVAR);
    h.frame();
    h.yell(yellOf(IGNIVAR, 'kill'));
    h.despawn(RAID_BOSS_ID);
    h.frame();
    expect(h.notes().join(' ')).toContain(`${IGNIVAR.name} is down.`);
  });

  /**
   * A wipe restores the boss to full health and clears its threat, and it does NOT clear the
   * target field, so without this the next attempt inherits the last one's clocks.
   */
  it('starts a fresh pull when the boss comes back to full health', async () => {
    const h = await startRaid(IGNIVAR, { engaged: false });
    h.frame();
    h.setBossField('aggroTargetId', BRONN);
    h.frame();
    h.setBossField('hp', 500);
    h.frame();
    h.advance(4000);
    h.setBossField('hp', 1000);
    h.frame();
    expect(h.detailOf('mechanics', 'searing')).toBe('armed, not seen yet');
  });
});

describe('Varkhul’s Shared Pyre', () => {
  function mark(h: RaidHarness, pid: number, stacks: number, total: number): void {
    h.give(
      pid,
      aura(VK_SOAK.aura, {
        kind: 'vulnerability',
        remaining: VK_SOAK.seconds,
        duration: VK_SOAK.seconds,
        stacks,
        value2: total,
      }),
    );
    h.giveRow(pid, VK_SOAK.aura, VK_SOAK.seconds);
  }

  /**
   * Deliberately given `stacks` and `value2` the table does NOT carry, so a reading that fell
   * back to the table fails here.
   */
  it('reads how many bodies it wants and what it costs off the aura itself', async () => {
    const h = await startRaid(VARKHUL);
    h.move(ALDREN, 0, 0);
    mark(h, ALDREN, 5, 2);
    for (const pid of [PLAYER_ID, VOSS, MALRIC, BRONN]) {
      h.move(pid, 60, 60);
    }
    h.frame();
    expect(h.valueOf('soak', String(ALDREN))).toBe('1 of 5');
    expect(h.detailOf('soak', String(ALDREN))).toContain('200% of health each');
  });

  it('counts the bodies inside the radius and says what is still missing', async () => {
    const h = await startRaid(VARKHUL);
    h.move(ALDREN, 0, 0);
    mark(h, ALDREN, 4, 1.4);
    h.move(PLAYER_ID, 1, 0);
    h.move(VOSS, 2, 0);
    h.move(MALRIC, 60, 60);
    h.move(BRONN, 60, 60);
    h.frame();
    expect(h.valueOf('soak', String(ALDREN))).toBe('3 of 4');
    expect(h.detailOf('soak', String(ALDREN))).toContain('to everyone');
  });

  it('says nothing more once the mark has the bodies it asked for', async () => {
    const h = await startRaid(VARKHUL);
    h.move(ALDREN, 0, 0);
    mark(h, ALDREN, 2, 1.4);
    h.move(PLAYER_ID, 1, 0);
    for (const pid of [VOSS, MALRIC, BRONN]) {
      h.move(pid, 60, 60);
    }
    h.frame();
    expect(h.valueOf('soak', String(ALDREN))).toBe('2 of 2');
    expect(h.detailOf('soak', String(ALDREN))).not.toContain('to everyone');
  });

  it('calls the soak on the banner while it is still short of bodies', async () => {
    const h = await startRaid(VARKHUL, { settings: { 'alert-lead': 10 } });
    h.move(ALDREN, 0, 0);
    mark(h, ALDREN, 4, 1.4);
    for (const pid of [PLAYER_ID, VOSS, MALRIC, BRONN]) {
      h.move(pid, 60, 60);
    }
    h.frame();
    expect(banner()).toContain('SOAK Aldren');
    expect(banner()).toContain('1 of 4');
  });
});

describe('Varkhul’s last phase', () => {
  /** Applied where a cadence is ARMED rather than to a clock already running, as the game does. */
  it('arms a cadence at the phase’s own rate rather than the declared one', async () => {
    const rate = only(VARKHUL.rates ?? [], 'rate');
    const h = await startRaid(VARKHUL, { hp: 150 });
    h.give(RAID_BOSS_ID, aura(rate.when.id ?? '', { kind: 'enrage', remaining: 45, duration: 45 }));
    h.frame();
    writeCast(h.boss, castAnchorOf(VK_SWEEP), 2.5, 2.5);
    h.frame();
    clearCast(h.boss);
    h.frame();
    const faster = VK_SWEEP.every / rate.multiplier;
    expect(h.valueOf('mechanics', 'sweep')).toBe(`~${faster.toFixed(1)}s`);
  });

  it('draws the enrage as the countdown the aura is actually carrying', async () => {
    const h = await startRaid(VARKHUL, { hp: 150 });
    h.give(
      RAID_BOSS_ID,
      aura(enrageAuraOf(VK_ENRAGE), {
        kind: 'enrage',
        remaining: 22,
        duration: VK_ENRAGE.seconds ?? 45,
      }),
    );
    h.frame();
    expect(h.valueOf('enrage', 'enrage')).toBe('22s');
  });
});

describe('Varkhul’s intermission', () => {
  it('holds every clock while he is immune, and lets them run again after', async () => {
    const held = only(
      VARKHUL.freeze.filter((one) => one.kind === 'aura'),
      'freeze aura',
    );
    const h = await startRaid(VARKHUL, { engaged: false });
    h.frame();
    h.setBossField('aggroTargetId', BRONN);
    h.frame();
    const opener = seedIn(VARKHUL.pullSeeds, 'orbs', 'pull seed');
    h.give(RAID_BOSS_ID, aura(held.id ?? '', { kind: 'absorb', remaining: 999, duration: 999 }));
    h.advance(6000);
    h.frame();
    expect(h.valueOf('mechanics', 'orbs')).toBe(`~${opener.toFixed(1)}s`);
    h.strip(RAID_BOSS_ID, held.id ?? '');
    h.advance(2000);
    h.frame();
    expect(h.valueOf('mechanics', 'orbs')).toBe(`~${(opener - 2).toFixed(1)}s`);
  });

  it('puts the intermission on screen as a mechanic only while it is running', async () => {
    const held = only(
      VARKHUL.freeze.filter((one) => one.kind === 'aura'),
      'freeze aura',
    );
    const h = await startRaid(VARKHUL, { hp: 450 });
    h.frame();
    expect(h.rows('mechanics')).not.toContain('assembly');
    h.give(RAID_BOSS_ID, aura(held.id ?? '', { kind: 'absorb', remaining: 999, duration: 999 }));
    h.frame();
    expect(h.rows('mechanics')).toContain('assembly');
    expect(h.valueOf('mechanics', 'assembly')).toBe(
      `~${mechanicIn(VARKHUL, 'assembly').every.toFixed(1)}s`,
    );
  });
});

describe('Varkhul’s two debuff rows', () => {
  const Debuffs = VARKHUL.blocks.filter((one) => one.kind === 'debuffs') as DebuffsBlock[];

  it('names everyone carrying the spread mark, with the seconds left on each', async () => {
    const orbs = only(Debuffs, 'debuff block');
    const h = await startRaid(VARKHUL);
    for (const pid of [ALDREN, VOSS]) {
      h.give(pid, aura(orbs.aura, { remaining: 3, duration: VK_ORBS.every }));
      h.giveRow(pid, orbs.aura, 3);
    }
    h.frame();
    expect(h.rows('debuffs')).toEqual([String(ALDREN), String(VOSS)]);
    expect(h.valueOf('debuffs', String(ALDREN))).toBe('3s');
    expect(h.detailOf('debuffs', String(ALDREN))).toBe(orbs.note ?? '');
  });

  /** Two blocks of one KIND: with one section per kind the second would draw over the first. */
  it('draws the second debuff row in its own section rather than over the first', async () => {
    expect(Debuffs.length).toBe(2);
    const [orbs, wound] = Debuffs as [DebuffsBlock, DebuffsBlock];
    const h = await startRaid(VARKHUL);
    h.give(ALDREN, aura(orbs.aura, { remaining: 3, duration: 4 }));
    h.giveRow(ALDREN, orbs.aura, 3);
    h.give(VOSS, aura(wound.aura, { remaining: 25, duration: wound.durationSeconds ?? 30 }));
    h.giveRow(VOSS, wound.aura, 25);
    h.frame();
    expect(h.rows('debuffs')).toEqual([String(ALDREN)]);
    expect(h.rows('debuffs-2')).toEqual([String(VOSS)]);
    expect(h.headingOf('debuffs')).toBe(orbs.label);
    expect(h.headingOf('debuffs-2')).toBe(wound.label);
    expect(h.detailOf('debuffs-2', String(VOSS))).toBe(wound.note ?? '');
  });
});

/**
 * The row set the `last-inferno` stage panel photographs, driven the same way that scenario
 * drives it. No gate looks at the picture and the frame clips rather than growing, so this
 * pins the row count and order; only opening the capture confirms they fit.
 */
describe('the panel the preview photographs', () => {
  const beforeMs = 6000;
  const afterMs = 1000;
  const infernoLeft = 27;

  async function theSamePanel(): Promise<RaidHarness> {
    const h = await startRaid(IGNIVAR, {
      hp: 340,
      settings: { alerts: false },
      conduitStates: [IG_STATIONS.spent, IG_STATIONS.ready, IG_STATIONS.ready, IG_STATIONS.spent],
    });
    h.frame();
    h.yell(yellOf(IGNIVAR, 'pull'));
    h.frame();
    h.conduit(1, IG_STATIONS.active);
    h.frame();
    h.advance(beforeMs);
    h.frame();
    h.give(
      RAID_BOSS_ID,
      aura(enrageAuraOf(IG_ENRAGE), {
        kind: 'buff_haste',
        remaining: infernoLeft,
        duration: IG_ENRAGE.seconds ?? infernoLeft,
      }),
    );
    h.frame();
    h.advance(afterMs);
    h.frame();
    return h;
  }

  it('draws four mechanics, one enrage and four conduits, and nothing else', async () => {
    const h = await theSamePanel();
    expect(h.rows('mechanics')).toEqual(['brand', 'rays', 'meteors', 'last-flame']);
    expect(h.rows('enrage')).toEqual(['enrage']);
    expect(h.rows('stations')).toEqual([861, 860, 862, 863].map(String));
    for (const empty of ['gates', 'debuffs', 'soak', 'marks', 'channels', 'tankStacks', 'adds']) {
      expect(h.shows(empty)).toBe(false);
    }
  });

  /**
   * A phase seated in `world` gives the re-seeds no edge, and a row reading `~0.0s`
   * photographs as a stalled panel.
   */
  it('counts every mechanic off the numbers the phase re-seeds, with none of them at zero', async () => {
    const h = await theSamePanel();
    expect(h.valueOf('mechanics', 'brand')).toBe('~3.0s');
    expect(h.valueOf('mechanics', 'rays')).toBe('~14.0s');
    expect(h.valueOf('mechanics', 'meteors')).toBe('~1.0s');
    expect(h.valueOf('mechanics', 'last-flame')).toBe('~5.0s');
  });

  it('draws the enrage as the game’s own seconds and the conduits in their three states', async () => {
    const h = await theSamePanel();
    expect(h.valueOf('enrage', 'enrage')).toBe(`${String(infernoLeft)}s`);
    expect(h.valueOf('stations', '861')).toBe('~3.0s');
    expect(h.valueOf('stations', '860')).toBe('SPENT');
    expect(h.valueOf('stations', '862')).toBe('READY');
    expect(h.valueOf('stations', '863')).toBe('SPENT');
  });
});
