// Tocsin on the stage: the two moments a Nythraxis raid has to be told something.
//
// Every id comes off the SHIPPED table rather than being typed out, so a regenerated
// `bosses.json` moves this fixture with it. This addon draws no skill or item art, so the
// usual live-versus-pbe hazard does not apply: there is no file for a channel to be missing.
//
// The ward panel is deliberately NOT heroic, because a preview that never showed the
// difficulty caveat would sell a display more certain than it is. The other panel is, and
// drops the caveat on its own.

import type { Fake, Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame } from '../../tests/fakes/frames.ts';
import TABLE from './bosses.json' with { type: 'json' };

const TABLE_FILE = 'bosses.json';
const DATA = { [TABLE_FILE]: JSON.stringify(TABLE) };

type Encounter = (typeof TABLE.encounters)[number];

function only(rows: readonly Encounter[]): Encounter {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${TABLE_FILE} carries no encounter, so there is nothing to stage`);
  }
  return row;
}

const ENCOUNTER = only(TABLE.encounters);

/**
 * Written out rather than narrowed off the JSON import: a `with { type: 'json' }` import
 * infers every `kind` as `string`, so the union cannot discriminate and `Extract` collapses
 * to `never`. A table that stops carrying one of these fails the typecheck here.
 */
interface ChannelsBlock {
  duringCast: string;
  castSeconds: number;
  channelCast: string;
  channelSeconds: number;
  objectTemplateId: string;
  objects: Array<{ name: string; x: number; z: number }>;
}
interface AuraBlock {
  aura: string;
}
interface AddsBlock {
  rows: Array<{ templateId: string; name: string; answer: string; heroicTell?: boolean }>;
}

function blockOf<T>(kind: string): T {
  const found = ENCOUNTER.blocks.find((block) => block.kind === kind);
  if (found === undefined) {
    throw new Error(`${TABLE_FILE} declares no ${kind} block, so there is nothing to stage`);
  }
  return found as T;
}

const CHANNELS = blockOf<ChannelsBlock>('channels');
const MARKS = blockOf<AuraBlock>('marks');
const TANK = blockOf<AuraBlock>('tankStacks');
const ADDS = blockOf<AddsBlock>('adds');
const COURT = ADDS.rows.filter((row) => row.heroicTell === true);
const WAVE_ADD = ADDS.rows.find((row) => row.heroicTell !== true) ?? {
  templateId: '',
  name: 'Unknown',
};

/**
 * A computed key because the two checkers want opposite things: the linter asks for dot
 * access on a literal key and the compiler forbids it on an index signature.
 */
function readField<T>(target: Fake, field: string): T {
  return target[field] as T;
}

function subgroup(pid: number): number {
  if (pid > 905) {
    return 2;
  }
  return 1;
}

const BOSS = 900;
const PLAYER = 1;
/** The two who take a stone in the ward panel. */
const KETHRA = 902;
const ORVELD = 903;
/** The main tank, who is what the boss is hitting in both panels. */
const BRONN = 901;
const WARD_IDS = [950, 951, 952];
const COURT_IDS = [960, 961, 962];
const WAVE_IDS = [970, 971];

/** How tall the game draws the boss, for the model the camera needs. */
const BOSS_HEIGHT = 3.6;

/**
 * Ten rows because that is what this encounter is authored for, and because the readings are
 * about a group: marks are counted against the whole roster and the tank block needs a SECOND
 * tank to have anything to say. Positions are the arena's own, in yards, from a boss at (0, 96).
 */
const ROSTER = [
  { pid: PLAYER, name: 'Marshal', cls: 'warrior', role: 'dps', x: -3, z: 88 },
  { pid: BRONN, name: 'Bronn', cls: 'warrior', role: 'tank', x: 0, z: 93 },
  { pid: KETHRA, name: 'Kethra', cls: 'rogue', role: 'dps', x: -40, z: 79 },
  { pid: ORVELD, name: 'Orveld', cls: 'mage', role: 'dps', x: 0, z: 63 },
  // Sunna and Yrsa are inside the game's own five yard stack range of each other and Corin
  // is not, which is the whole of what the Soul Rend block draws: two rows sharing the
  // damage and one taking all of it.
  { pid: 904, name: 'Sunna', cls: 'priest', role: 'healer', x: -6, z: 86 },
  { pid: 905, name: 'Faldric', cls: 'paladin', role: 'tank', x: 5, z: 87 },
  { pid: 906, name: 'Yrsa', cls: 'druid', role: 'healer', x: -4, z: 85 },
  { pid: 907, name: 'Corin', cls: 'hunter', role: 'dps', x: -8, z: 84 },
  { pid: 908, name: 'Delvaine', cls: 'warlock', role: 'dps', x: 7, z: 83 },
  { pid: 909, name: 'Hesk', cls: 'shaman', role: 'dps', x: -2, z: 82 },
];

interface RowAura {
  id: string;
  kind: string;
  remaining: number;
}

function partyRow(spec: (typeof ROSTER)[number], auras: RowAura[]) {
  return {
    pid: spec.pid,
    name: spec.name,
    cls: spec.cls,
    level: 20,
    hp: 3400,
    mhp: 3800,
    res: 800,
    mres: 1000,
    rtype: 'mana',
    x: spec.x,
    z: spec.z,
    dead: 0,
    inCombat: 1,
    group: subgroup(spec.pid),
    role: spec.role,
    connected: 1,
    auras,
  };
}

function aura(id: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: id,
    kind: 'vulnerability',
    remaining: 8,
    duration: 8,
    value: 0,
    sourceId: BOSS,
    school: 'shadow',
    ...over,
  };
}

function addBoss(draft: WorldDraft): Fake {
  const boss = draft.mob(BOSS, {
    name: ENCOUNTER.name,
    templateId: ENCOUNTER.templateId,
    pos: { x: 0, y: 0, z: 96 },
    hp: 1400,
    maxHp: 3800,
    aggroTargetId: BRONN,
  });
  draft.model(BOSS, { height: BOSS_HEIGHT });
  return boss;
}

/**
 * Placed from the table rather than at made-up points: the addon decides who is channelling
 * which stone by DISTANCE, so a fixture that put them anywhere would test nothing.
 */
function addWardstones(draft: WorldDraft): void {
  CHANNELS.objects.forEach((stone, index) => {
    draft.mob(WARD_IDS[index] ?? 0, {
      name: stone.name,
      kind: 'object',
      hostile: false,
      templateId: CHANNELS.objectTemplateId,
      pos: { x: stone.x, y: 0, z: stone.z },
    });
  });
}

function addMember(draft: WorldDraft, pid: number): Fake {
  const spec = ROSTER.find((one) => one.pid === pid);
  return draft.mob(pid, {
    name: spec?.name ?? 'Unknown',
    kind: 'player',
    hostile: false,
    templateId: spec?.cls ?? 'warrior',
    pos: { x: spec?.x ?? 0, y: 0, z: spec?.z ?? 0 },
  });
}

function setRoster(draft: WorldDraft, auras: Map<number, RowAura[]>): void {
  draft.set(draft.world, 'partyInfo', {
    leader: PLAYER,
    raid: true,
    members: ROSTER.map((spec) => partyRow(spec, auras.get(spec.pid) ?? [])),
  });
}

/** A channel where the game writes one, which is on the PLAYER doing it. */
function channel(draft: WorldDraft, unit: Fake, remaining: number): void {
  draft.set(unit, 'castingAbility', CHANNELS.channelCast);
  draft.set(unit, 'castRemaining', remaining);
  draft.set(unit, 'castTotal', CHANNELS.channelSeconds);
  draft.set(unit, 'channeling', true);
}

/**
 * Seated at their stones in `world` rather than sent there in `run`, because a raid that has
 * already reacted is what the panel is a picture of.
 */
function aDeathlessRage(draft: WorldDraft): void {
  const boss = addBoss(draft);
  addWardstones(draft);
  setRoster(draft, new Map());
  const kethra = addMember(draft, KETHRA);
  const orveld = addMember(draft, ORVELD);
  // Kethra is a tick from finishing, so `run` can let her channel land and the panel shows
  // all three states at once: one done, one in progress, one nobody is on.
  channel(draft, kethra, 0.05);
  channel(draft, orveld, 1.8);
  // Two guards from the last Raise Fallen wave are still up, which is why the raid is short a
  // body for the third stone. Raise Fallen runs in phase one and the wave outlives it, so a
  // Deathless Rage with adds still on the floor is the ordinary case rather than a contrived
  // one, and it is what makes this panel a picture of a raid rather than of one mechanic.
  WAVE_IDS.forEach((id, index) => {
    draft.mob(id, {
      name: WAVE_ADD.name,
      templateId: WAVE_ADD.templateId,
      pos: { x: -4 + index * 8, y: 0, z: 100 },
      hp: 620 - index * 180,
      maxHp: 1200,
    });
  });
  draft.set(boss, 'castingAbility', CHANNELS.duringCast);
  draft.set(boss, 'castRemaining', 4.6);
  draft.set(boss, 'castTotal', CHANNELS.castSeconds);
}

/**
 * The tank's stacks are what tell the addon this is heroic, so the caveat drops on its own
 * rather than being switched off.
 */
function aHeroicPress(draft: WorldDraft): void {
  addBoss(draft);
  addWardstones(draft);
  const marked = [{ id: MARKS.aura, kind: 'vulnerability', remaining: 5 }];
  setRoster(
    draft,
    new Map([
      [904, marked],
      [906, marked],
      [907, marked],
      [905, [{ id: TANK.aura, kind: 'vulnerability', remaining: 31 }]],
    ]),
  );
  const tank = addMember(draft, BRONN);
  draft.set(tank, 'auras', [
    aura(TANK.aura, { name: 'Dread Curse', stacks: 6, remaining: 41, duration: 45 }),
  ]);
  for (const [index, id] of COURT_IDS.entries()) {
    const add = COURT[index];
    draft.mob(id, {
      name: add?.name ?? 'Unknown',
      templateId: add?.templateId ?? '',
      pos: { x: -8 + index * 8, y: 0, z: 104 },
      hp: 900 - index * 220,
      maxHp: 1200,
    });
  }
}

function scatterOneMark(stage: Stage): void {
  const party = readField<{ members: Array<{ pid: number; x: number }> }>(stage.world, 'partyInfo');
  const corin = party.members.find((row) => row.pid === 907);
  if (corin !== undefined) {
    corin.x = -26;
  }
}

function fired(stage: Stage, ability: string): void {
  stage.inbound(
    eventsFrame([{ type: 'damage', sourceId: BOSS, targetId: PLAYER, amount: 900, ability }]),
  );
}

/**
 * The order is the session's own and it matters: a record arriving before the frame that first
 * sees the boss engaged is dropped rather than opening a pull.
 */
async function underWay(stage: Stage): Promise<void> {
  await stage.settle();
  stage.frame();
  fired(stage, 'Gravebreaker');
  fired(stage, 'Soul Rend');
  stage.frame();
  stage.advance(2500);
  stage.frame();
}

const WARD_ALT =
  'A raid panel: mechanic timers with Deathless Rage casting live, and the three wardstones in all three states, one done and named with who held it, one being channelled, and the third drawn red and reading UNHELD.';

const PRESS_ALT =
  'The same panel with no cast in flight: three Soul Rend marks, two stacked and one drawn red standing alone, the tank at six stacks with the other tank not yet clear, and the heroic court listed interrupt first.';

const WARD_FRAME = { raid: { box: { x: 40, y: 40, w: 320, h: 440 }, visible: true } };
const PRESS_FRAME = { raid: { box: { x: 40, y: 40, w: 320, h: 520 }, visible: true } };

/**
 * The banner is drawn in the overlay band, across the middle of the screen, so in a shot it
 * lands over the panel it is telling you to read. The `banner` scenario shows it instead.
 */
const PANELS_ONLY = { alerts: false };

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'wardstones',
    label: 'Deathless Rage with a stone unheld',
    preview: true,
    caption: 'A wardstone nobody is on',
    alt: WARD_ALT,
    data: DATA,
    settings: PANELS_ONLY,
    frames: WARD_FRAME,
    world: aDeathlessRage,
    run: async (stage) => {
      await underWay(stage);
      // The game clears the cast on the tick the channel completes, which is all a client
      // ever sees of it.
      const kethra = stage.entities.get(KETHRA);
      if (kethra !== undefined) {
        stage.set(kethra, 'castingAbility', null);
        stage.set(kethra, 'castRemaining', 0);
      }
      stage.frame();
    },
  },
  {
    id: 'press',
    label: 'Marks, tank stacks and the heroic court',
    preview: true,
    caption: 'Marks, stacks and adds',
    alt: PRESS_ALT,
    data: DATA,
    settings: PANELS_ONLY,
    frames: PRESS_FRAME,
    world: aHeroicPress,
    run: async (stage) => {
      scatterOneMark(stage);
      await underWay(stage);
    },
  },
  {
    // The alert at full size, which is what the two photographed panels switch off. An
    // unheld wardstone is the loudest thing this addon says, and the only one drawn large.
    id: 'banner',
    label: 'The unheld wardstone alert',
    data: DATA,
    frames: WARD_FRAME,
    world: aDeathlessRage,
    run: underWay,
  },
  {
    // What a pull looks like before anything has happened: the clocks are armed and say so
    // rather than counting something nobody has seen fire.
    id: 'opening',
    label: 'A pull with nothing seen yet',
    data: DATA,
    frames: WARD_FRAME,
    world: (draft) => {
      addBoss(draft);
      addWardstones(draft);
      setRoster(draft, new Map());
    },
    run: async (stage) => {
      await stage.settle();
      stage.frame();
    },
  },
];

export { SCENARIOS };
