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

function encounterOf(id: string): Encounter {
  const row = TABLE.encounters.find((one) => one.id === id);
  if (row === undefined) {
    throw new Error(`${TABLE_FILE} carries no ${id}, so there is nothing to stage`);
  }
  return row;
}

const ENCOUNTER = only(TABLE.encounters);
const IGNIVAR = encounterOf('ignivar');
const VARKHUL = encounterOf('varkhul');

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

function blockIn<T>(row: Encounter, kind: string, at = 0): T {
  const found = row.blocks.filter((block) => block.kind === kind)[at];
  if (found === undefined) {
    throw new Error(`${TABLE_FILE} declares no ${kind} block on ${row.id}, nothing to stage`);
  }
  return found as T;
}

function blockOf<T>(kind: string): T {
  return blockIn<T>(ENCOUNTER, kind);
}

const CHANNELS = blockOf<ChannelsBlock>('channels');
const MARKS = blockOf<AuraBlock>('marks');
const TANK = blockOf<AuraBlock>('tankStacks');
const ENRAGE = blockOf<AuraBlock>('enrage');
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

/**
 * The last stretch of the fight. The boss carries the aura here rather than gaining it in
 * `run`, because a scenario states what a session would already have found true, and a raid
 * this deep into a boss did not watch it land a moment ago.
 */
function aFinalStand(draft: WorldDraft): void {
  const boss = addBoss(draft);
  addWardstones(draft);
  setRoster(draft, new Map());
  draft.set(boss, 'hp', 150);
  draft.set(boss, 'auras', [
    aura(ENRAGE.aura, { name: 'Final Stand', kind: 'buff_haste', remaining: 600, duration: 600 }),
  ]);
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

// The two raid encounters. Every id comes off the shipped table, so a regenerated
// `bosses.json` moves these fixtures with it.

interface StationsBlock {
  ready: string;
  active: string;
  spent: string;
  activeSeconds: number;
}
interface SoakBlock {
  aura: string;
  radius: number;
  seconds: number;
}
interface EnrageBlock {
  aura: string;
  seconds?: number;
}

const IG_BRAND = blockIn<AuraBlock>(IGNIVAR, 'debuffs');
const IG_STATIONS = blockIn<StationsBlock>(IGNIVAR, 'stations');
const IG_ENRAGE = blockIn<EnrageBlock>(IGNIVAR, 'enrage');
const VK_SOAK = blockIn<SoakBlock>(VARKHUL, 'soak');
const VK_ORBS = blockIn<AuraBlock>(VARKHUL, 'debuffs');
const VK_WOUND = blockIn<AuraBlock>(VARKHUL, 'debuffs', 1);
const VK_TANK = blockIn<AuraBlock>(VARKHUL, 'tankStacks');

const RAID_BOSS = 800;
const CONDUIT_IDS: readonly number[] = [860, 861, 862, 863];
/** The one `run` lights. */
const LIT_CONDUIT = 861;
const CONDUIT_CORNERS = ['north_west', 'north_east', 'south_east', 'south_west'];

function addRaidBoss(draft: WorldDraft, row: Encounter, hp: number): Fake {
  const boss = draft.mob(RAID_BOSS, {
    name: row.name,
    templateId: row.templateId,
    pos: { x: 0, y: 0, z: 6 },
    hp,
    maxHp: 3800,
    aggroTargetId: BRONN,
  });
  draft.model(RAID_BOSS, { height: BOSS_HEIGHT });
  return boss;
}

/** The name is what the panel labels a row with, and the template is its whole state. */
function addConduits(draft: WorldDraft, states: readonly string[]): void {
  CONDUIT_IDS.forEach((id, index) => {
    draft.mob(id, {
      name: `${CONDUIT_CORNERS[index] ?? 'corner'} Water Conduit`,
      kind: 'object',
      hostile: false,
      templateId: states[index] ?? IG_STATIONS.ready,
      pos: { x: -16 + index * 11, y: 0, z: -16 + index * 11 },
    });
  });
}

/**
 * The phase is NOT stated here: its re-seeds fire on the aura's EDGE, so seated in `world` the
 * panel would count the opening clocks of a fight that started minutes ago. No Brand carrier:
 * the frame clips rather than growing and a brand row would push the last conduit off the
 * bottom, so the `shared-pyre` panel photographs a carrier row instead.
 */
function aLastInferno(draft: WorldDraft): void {
  addRaidBoss(draft, IGNIVAR, 340);
  // The lit one is left READY for `run`: a countdown is drawn from the swap the addon watched,
  // and seated running it photographs the fallback line instead of the clock.
  addConduits(draft, [IG_STATIONS.spent, IG_STATIONS.ready, IG_STATIONS.ready, IG_STATIONS.spent]);
  setRoster(draft, new Map());
}

/** A frontal lights one, which is the only edge a client sees the water open on. */
function lightOneConduit(stage: Stage): void {
  const conduit = stage.entities.get(LIT_CONDUIT);
  if (conduit !== undefined) {
    stage.set(conduit, 'templateId', IG_STATIONS.active);
  }
}

const BEFORE_THE_INFERNO_MS = 6000;
/** Keeps every row off a round seed value. */
const INTO_THE_INFERNO_MS = 1000;
const INFERNO_LEFT = 27;

function theInfernoLands(stage: Stage): void {
  const boss = stage.entities.get(RAID_BOSS);
  if (boss === undefined) {
    return;
  }
  stage.set(boss, 'auras', [
    aura(IG_ENRAGE.aura, {
      name: 'Last Inferno',
      kind: 'buff_haste',
      remaining: INFERNO_LEFT,
      duration: IG_ENRAGE.seconds ?? INFERNO_LEFT,
    }),
  ]);
}

/** The soakers it wants ride the aura's `stacks` and the damage it splits rides `value2`. */
function aSharedPyre(draft: WorldDraft): void {
  const boss = addRaidBoss(draft, VARKHUL, 2100);
  const marked = [{ id: VK_ORBS.aura, kind: 'vulnerability', remaining: 3 }];
  setRoster(
    draft,
    new Map([
      [907, [{ id: VK_SOAK.aura, kind: 'vulnerability', remaining: 4 }]],
      [904, marked],
      [906, marked],
      [909, [{ id: VK_WOUND.aura, kind: 'vulnerability', remaining: 22 }]],
    ]),
  );
  const carrier = addMember(draft, 907);
  draft.set(carrier, 'auras', [
    aura(VK_SOAK.aura, {
      name: 'Shared Pyre',
      remaining: 4,
      duration: VK_SOAK.seconds,
      stacks: 4,
      value2: 1.4,
    }),
  ]);
  const tank = addMember(draft, BRONN);
  draft.set(tank, 'auras', [
    aura(VK_TANK.aura, { name: "Maker's Brand", kind: 'vuln_source', stacks: 2, remaining: 24 }),
  ]);
  draft.set(boss, 'castingAbility', 'Shared Pyre');
  draft.set(boss, 'castRemaining', 4);
  draft.set(boss, 'castTotal', VK_SOAK.seconds);
}

function scatterOffThePyre(stage: Stage): void {
  const party = readField<{ members: Array<{ pid: number; x: number; z: number }> }>(
    stage.world,
    'partyInfo',
  );
  for (const row of party.members) {
    if (row.pid !== 907) {
      row.x = 40;
      row.z = 40;
    }
  }
}

/** The engage line is how a raid pull is seen to open: nobody watches a raid boss stand idle. */
async function heardTheEngage(stage: Stage, row: Encounter): Promise<void> {
  await stage.settle();
  stage.frame();
  const yell = row.yells?.find((one) => one.edge === 'pull');
  if (yell !== undefined) {
    stage.inbound(
      eventsFrame([
        {
          type: 'chat',
          fromPid: RAID_BOSS,
          from: row.name,
          text: yell.text,
          channel: 'yell',
          entityId: RAID_BOSS,
        },
      ]),
    );
  }
  stage.frame();
  stage.advance(3000);
  stage.frame();
}

const INFERNO_ALT =
  'A raid panel during Ignivar’s last phase, in three sections and nine rows. The mechanic timers: Brand of the Pyre in three seconds, Revolving Inferno in fourteen, Falling Cinders drawn red at one, and the alternating Searing Torrent or Rain of Cinders slot in five. Under them an Enrage row reading Last Inferno, 27 seconds, nine percent left and then the raid dies. Under that the four water conduits: North East running with three seconds of water, North West spent, South East ready, and South West spent.';

const INFERNO_FRAME = { raid: { box: { x: 40, y: 40, w: 320, h: 420 }, visible: true } };
const PYRE_FRAME = { raid: { box: { x: 40, y: 40, w: 320, h: 560 }, visible: true } };

const RAID_SCENARIOS: readonly Scenario[] = [
  {
    id: 'last-inferno',
    label: 'Ignivar’s last forty-five seconds',
    preview: true,
    caption: 'A countdown to the wipe',
    alt: INFERNO_ALT,
    data: DATA,
    settings: PANELS_ONLY,
    frames: INFERNO_FRAME,
    world: aLastInferno,
    run: async (stage) => {
      await heardTheEngage(stage, IGNIVAR);
      lightOneConduit(stage);
      stage.frame();
      stage.advance(BEFORE_THE_INFERNO_MS);
      stage.frame();
      theInfernoLands(stage);
      stage.frame();
      stage.advance(INTO_THE_INFERNO_MS);
      stage.frame();
    },
  },
  {
    // The conduits on their own, which is the one state machine in the table: ready until a
    // frontal lights it, ten seconds of water, then spent for the rest of the attempt.
    id: 'conduits',
    label: 'The water conduits mid-fight',
    data: DATA,
    settings: PANELS_ONLY,
    frames: INFERNO_FRAME,
    world: (draft) => {
      addRaidBoss(draft, IGNIVAR, 2600);
      addConduits(draft, [
        IG_STATIONS.ready,
        IG_STATIONS.ready,
        IG_STATIONS.ready,
        IG_STATIONS.spent,
      ]);
      setRoster(draft, new Map([[907, [{ id: IG_BRAND.aura, kind: 'dot', remaining: 600 }]]]));
    },
    run: async (stage) => {
      await heardTheEngage(stage, IGNIVAR);
      lightOneConduit(stage);
      stage.frame();
      stage.advance(2500);
      stage.frame();
    },
  },
  {
    id: 'shared-pyre',
    label: 'Varkhul with a Shared Pyre short of bodies',
    data: DATA,
    settings: PANELS_ONLY,
    frames: PYRE_FRAME,
    world: aSharedPyre,
    run: async (stage) => {
      scatterOffThePyre(stage);
      await heardTheEngage(stage, VARKHUL);
    },
  },
  {
    // The intermission: he is immune and every clock holds.
    id: 'assembly',
    label: 'Varkhul’s intermission',
    data: DATA,
    settings: PANELS_ONLY,
    frames: PYRE_FRAME,
    world: (draft) => {
      const boss = addRaidBoss(draft, VARKHUL, 1800);
      setRoster(draft, new Map());
      draft.set(boss, 'auras', [
        aura('varkhul_masters_assembly', {
          name: "The Master's Assembly",
          kind: 'absorb',
          remaining: 999,
          duration: 999,
        }),
      ]);
    },
    run: (stage) => heardTheEngage(stage, VARKHUL),
  },
];

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
    // The enrage, which is the one thing on this fight nothing is done about. The panel is
    // otherwise quiet on purpose: at 4% there is no mechanic left worth reading past it.
    id: 'enrage',
    label: 'The last four percent',
    data: DATA,
    frames: WARD_FRAME,
    world: aFinalStand,
    run: async (stage) => {
      await stage.settle();
      stage.frame();
    },
  },
  {
    // A fight this addon walked in on: it cannot know how far through any cadence is, so the
    // clocks say they are armed rather than counting something nobody has seen fire.
    id: 'opening',
    label: 'A fight joined in progress',
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
  ...RAID_SCENARIOS,
];

export { SCENARIOS };
