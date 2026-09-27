// @vitest-environment happy-dom

// Purelight, run through the real loader. The rule is the game's and the loader publishes it, so
// this pins that the addon asks the right question of the right shape.
//
// Three cases carry most of the weight: the same stun with and without `unbreakableControl`, a root
// (magnitude 0) and a dot (positive magnitude), since reading polarity off a magnitude drops both,
// and a hostile target, where the removable thing is the benefit. The party rows exist to be
// ignored, so a version that starts reading them fails on the member with a row and no entity.

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
import TABLE_TEXT from './refused.json?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);

/** One row of the shipped table: an aura id the game refuses, and why. */
interface RefusedRow {
  id: string;
  reason: string;
}

interface RefusedTable {
  gameVersion: string;
  auras: RefusedRow[];
}

/** The shipped table, not a stub, so a case fails when what `generate.mjs` writes moves. */
const TABLE = JSON.parse(TABLE_TEXT) as RefusedTable;

function firstRefused(reason: string): string {
  const row = TABLE.auras.find((one) => one.reason === reason);
  if (row === undefined) {
    throw new Error(`refused.json carries no ${reason} row to write a case against`);
  }
  return row.id;
}

/** A raid mechanic the game will refuse, taken from the shipped table. */
const OWNED_ID = firstRefused('encounter');
/** The other refusal that has no route on the wire: an id shown on the debuff surface. */
const DISPLAY_ID = firstRefused('display');

/** The storage namespace this addon's frame state is saved under. */
const FQID = 'official/purelight';
/** What tests/fakes/shared-services.ts says the player is called. */
const CHARACTER = 'Claudemoon/Marshal';

/** The box the loader owns and hands back through `FrameOpts.onMove`. */
interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One tap-target square and the caption band under it, which is the strip at rest. */
const FLOOR_HEIGHT = 54;
/** A box a player has dragged 24 pixels taller, which is a 64 pixel square. */
const DRAGGED: FrameBox = { x: 20, y: 20, w: 300, h: FLOOR_HEIGHT + 24 };
/** A box saved narrower and shorter than the strip has any business being. */
const CRAMPED: FrameBox = { x: 20, y: 20, w: 90, h: 20 };

/** The player, who is a party member like anyone else. */
const ME = PLAYER_ENTITY.id;
/** A member standing close enough to have an entity. */
const NEAR = 662;
/** A member out of interest scope: a party row and no entity at all. */
const FAR = 663;
/** The player's own wolf, which nothing but `ownerId` tells from any other. */
const PET = 670;
/** What the player has selected, and it is trying to kill them. */
const FOE = 680;
/** Another player, near enough to have an entity, so their art resolves. */
const ALLY = 690;
/** A hostile PLAYER, which is the only kind of unit a purge tile can draw art from. */
const RIVAL = 691;

/** An id no entity in scope answers to, which is what a mob's aura looks like here. */
const MOB_SOURCE = 5000;
/** A second one, for the pair of casters that must not collapse into one tile. */
const OTHER_SOURCE = 5001;
/** An ordinary positive magnitude. A dot's per-tick figure looks exactly like this. */
const MAGNITUDE = 40;
/** What a drain reusing a `buff_*` kind carries, and the only reason it is harmful. */
const DRAIN = -20;

interface MemberSpec {
  pid: number;
  name: string;
  cls: string;
  /** Whether the game holds an entity for them. */
  near: boolean;
}

const ROSTER: readonly MemberSpec[] = [
  { pid: ME, name: 'Marshal', cls: 'paladin', near: true },
  { pid: NEAR, name: 'Bragg', cls: 'warrior', near: true },
  { pid: FAR, name: 'Wisp', cls: 'druid', near: false },
];

/** A party row's compact aura: no school, no source, whole seconds, a `neg` flag. */
interface AuraRow {
  id: string;
  kind: string;
  remaining: number;
  neg?: 1;
}

/** An entity's aura, which is the only shape that can answer the whole question. */
interface FullAura {
  id: string;
  name: string;
  kind: string;
  remaining: number;
  duration: number;
  value: number;
  sourceId: number;
  school: string;
  stacks?: number;
  unbreakableControl?: boolean;
}

interface MemberRow {
  pid: number;
  name: string;
  cls: string;
  level: number;
  hp: number;
  mhp: number;
  res: number;
  mres: number;
  rtype: null;
  x: number;
  z: number;
  dead: number;
  inCombat: number;
  group: 1;
  auras: AuraRow[];
}

/** One effect as a suite describes it, before it is split into the two shapes. */
interface Effect {
  id: string;
  name: string;
  kind: string;
  school: string;
  remaining: number;
  duration: number;
  /** The RAW magnitude. Only a negative one on a `buff_*` kind makes it harmful. */
  value?: number;
  sourceId?: number;
  unbreakableControl?: boolean;
  stacks?: number;
}

/** The shape the "Done when" is written against: an ordinary stun on a party member. */
const GRAVEBIND: Effect = {
  id: 'gravebind',
  name: 'Gravebind',
  kind: 'stun',
  school: 'shadow',
  remaining: 8,
  duration: 8,
};

const CORRUPTION: Effect = {
  id: 'corruption',
  name: 'Corruption',
  kind: 'dot',
  school: 'shadow',
  remaining: 12,
  duration: 12,
};

/** A plain benefit: the thing a friendly dispel must never offer to take away. */
const BLESSING: Effect = {
  id: 'blessing',
  name: 'Blessing of Haste',
  kind: 'buff_haste',
  school: 'holy',
  remaining: 30,
  duration: 30,
};

/**
 * A frost mage's own proc: a benefit, so a purge tile on an enemy. The game applies it with the
 * bare ability id, which `artId` must not trim: `brain_freeze` is a file and `brain` is not.
 */
const BRAIN_FREEZE: Effect = {
  id: 'brain_freeze',
  name: 'Brain Freeze',
  kind: 'brain_freeze',
  school: 'frost',
  remaining: 12,
  duration: 15,
};

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

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

/**
 * What the addon marks a cell with. The caster is in it: two players' copies of one debuff are two
 * tiles.
 */
function key(unitId: number, abilityId: string, source: number = MOB_SOURCE): string {
  return `${String(unitId)}:${abilityId}:${String(source)}`;
}

function memberRow(spec: MemberSpec): MemberRow {
  return {
    pid: spec.pid,
    name: spec.name,
    cls: spec.cls,
    level: 20,
    hp: 900,
    mhp: 1000,
    res: 0,
    mres: 0,
    rtype: null,
    x: 0,
    z: 0,
    dead: 0,
    inCombat: 1,
    group: 1,
    auras: [],
  };
}

/** The wire's half. Carried so a version that goes back to reading rows fails. */
function rowAura(effect: Effect): AuraRow {
  const row: AuraRow = {
    id: effect.id,
    kind: effect.kind,
    remaining: Math.ceil(effect.remaining),
  };
  if ((effect.value ?? MAGNITUDE) < 0) {
    row.neg = 1;
  }
  return row;
}

/** The entity's half: the school, the exact remaining, the caster, the encounter flag. */
function fullAura(effect: Effect): FullAura {
  const aura: FullAura = {
    id: effect.id,
    name: effect.name,
    kind: effect.kind,
    remaining: effect.remaining,
    duration: effect.duration,
    value: effect.value ?? MAGNITUDE,
    sourceId: effect.sourceId ?? MOB_SOURCE,
    school: effect.school,
  };
  if (effect.unbreakableControl === true) {
    aura.unbreakableControl = true;
  }
  if (effect.stacks !== undefined) {
    aura.stacks = effect.stacks;
  }
  return aura;
}

/** The one field of the player fixture this suite writes: what they have selected. */
interface Selection {
  targetId: number | null;
}

/**
 * Who the player is: the class ally art is filed under, and the spellbook. A healer by default; the
 * mage reaches the one branch no healer ability id reaches in `AURA_SUFFIXES`.
 */
interface SelfSpec {
  cls: string;
  known: readonly unknown[];
}

const A_PALADIN: SelfSpec = { cls: 'paladin', known: [] };

/**
 * A frost mage looking at another frost mage has `brain_freeze` in their own spellbook, which is
 * the only way the guard in `artId` fires.
 */
const A_MAGE: SelfSpec = {
  cls: 'mage',
  known: [
    {
      def: { id: 'brain_freeze', name: 'Brain Freeze', school: 'frost', requiresTarget: false },
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
    },
  ],
};

interface StartOpts {
  settings?: Record<string, unknown>;
  /** False starts the player solo. */
  grouped?: boolean;
  /** Defaults to the paladin every other case here is written against. */
  self?: SelfSpec;
  /**
   * Frame state a previous session saved, seeded before the addon loads. The restore takes the same
   * path as a drag: clamped by the loader and reported through `onMove`.
   */
  frames?: Record<string, { box: FrameBox; visible: boolean }>;
  /** A refusal table other than the shipped one, for the cases about a broken table. */
  table?: string;
}

interface PurelightHarness extends SharedHarness {
  /** Land an effect on whoever has an entity, and on their party row if they have one. */
  afflict: (id: number, effect: Effect) => void;
  /** Take one off again, from both halves. */
  cure: (id: number, abilityId: string) => void;
  /** Move an effect's remaining, which is what ticking looks like. */
  tickTo: (id: number, abilityId: string, remaining: number) => void;
  /** Point the player at something, or at nothing. */
  select: (id: number | null) => void;
  /** Re-read the world, which is what settles the frame's stored position. */
  poll: () => void;
  /** Run the loader's frame loop once, which is what the addon draws on. */
  frame: () => void;
  /** The cells on the strip, in the order they are drawn. */
  drawn: () => string[];
  /** The names captioned under the tiles, in order. */
  captions: () => string[];
  /** One tile's accessible name. */
  labelOf: (cellKey: string) => string;
  /** One tile's countdown figure. */
  valueOf: (cellKey: string) => string;
  /** One tile's sweep, as the style string the kit wrote. */
  sweepOf: (cellKey: string) => string;
  /** One tile's stack corner. */
  countOf: (cellKey: string) => string;
  /** One tile's art, as the URL the kit pointed the image at. */
  artOf: (cellKey: string) => string;
  /** The figure on the held tile, or '' when it is not on the strip at all. */
  heldCount: () => string;
  /** What the held tile is announced as, which is the only place the count is spelt out. */
  heldLabel: () => string;
}

function cellFor(cellKey: string): Element | null {
  return document.querySelector(`[data-effect="${cellKey}"]`);
}

function textIn(cellKey: string, selector: string): string {
  return cellFor(cellKey)?.querySelector(selector)?.textContent ?? '';
}

/** Let the async frame restore land before reading what it did. */
async function settleFrames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** The roster the loader reads, or null for a player standing on their own. */
function partyOf(grouped: boolean, members: MemberRow[]) {
  if (!grouped) {
    return null;
  }
  return { leader: ME, raid: false, members };
}

/**
 * Every entity the world holds and the aura arrays they carry. `live` holds the same arrays, so
 * landing an effect mutates what the game would.
 */
function buildWorld(grouped: boolean, self: SelfSpec) {
  const live = new Map<number, FullAura[]>();
  const entities = new Map<number, unknown>();
  const spawn = (id: number, over: Record<string, unknown>): Record<string, unknown> => {
    const auras: FullAura[] = [];
    live.set(id, auras);
    const entity = liveEntity({ set: { id, auras, ...over } });
    entities.set(id, entity);
    return entity;
  };

  const player = spawn(ME, { name: 'Marshal', kind: 'player', templateId: self.cls });
  for (const spec of ROSTER.filter((member) => member.near && member.pid !== ME)) {
    spawn(spec.pid, { name: spec.name, kind: 'player', templateId: spec.cls });
  }
  spawn(PET, { name: 'Grizzle', kind: 'mob', templateId: 'wolf', ownerId: ME });
  spawn(FOE, { name: 'Grimjaw', kind: 'mob', templateId: 'gnoll', hostile: true });
  spawn(ALLY, { name: 'Sunna', kind: 'player', templateId: 'paladin' });
  spawn(RIVAL, { name: 'Emberlash', kind: 'player', templateId: 'mage', hostile: true });

  // The rows are built either way, so nothing is reachable except through `world.party`.
  const members = ROSTER.map(memberRow);
  const partyInfo = partyOf(grouped, members);
  return {
    live,
    members,
    selection: player as unknown as Selection,
    world: { entities, player, partyInfo, known: self.known },
  };
}

/**
 * Start the addon. Settings are seeded first, because the loader hydrates them and then evaluates.
 */
async function start(opts: StartOpts = {}): Promise<PurelightHarness> {
  const { live, members, selection, world } = buildWorld(
    opts.grouped !== false,
    opts.self ?? A_PALADIN,
  );
  const storage = createFakeStorage();
  await Promise.all(
    Object.entries(opts.frames ?? {}).map(([frameId, state]) =>
      storage.set(uiNamespace(FQID), perCharacterKey('pbe', CHARACTER, frameId), state),
    ),
  );
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    storage,
    settings: opts.settings ?? {},
    data: { 'refused.json': opts.table ?? TABLE_TEXT },
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  const rowsOf = (pid: number): AuraRow[] =>
    members.find((member) => member.pid === pid)?.auras ?? [];

  return {
    ...harness,
    afflict: (id, effect) => {
      rowsOf(id).push(rowAura(effect));
      live.get(id)?.push(fullAura(effect));
    },
    cure: (id, abilityId) => {
      const rows = rowsOf(id);
      const at = rows.findIndex((row) => row.id === abilityId);
      if (at >= 0) {
        rows.splice(at, 1);
      }
      const auras = live.get(id) ?? [];
      auras.splice(
        auras.findIndex((aura) => aura.id === abilityId),
        1,
      );
    },
    tickTo: (id, abilityId, remaining) => {
      const aura = live.get(id)?.find((row) => row.id === abilityId);
      if (aura !== undefined) {
        aura.remaining = remaining;
      }
    },
    // The target resolves from the player's own `targetId`, as the loader does.
    select: (id) => {
      selection.targetId = id;
    },
    poll: () => harness.shared.world.watcher.poll(),
    frame: () => harness.frames.tick(),
    // Read off the attribute: the dataset is an index signature, where the linter wants dot access
    // and the compiler forbids it.
    drawn: () =>
      [...document.querySelectorAll('[data-effect]')].map(
        (el) => el.getAttribute('data-effect') ?? '',
      ),
    // Scoped past the held tile, which wears the same caption band.
    captions: () =>
      [...document.querySelectorAll('.woc-pl-cell:not([data-held]) .woc-pl-name')].map(
        (el) => el.textContent ?? '',
      ),
    labelOf: (cellKey) =>
      cellFor(cellKey)?.querySelector('.woc-tile')?.getAttribute('aria-label') ?? '',
    valueOf: (cellKey) => textIn(cellKey, '.woc-tile-value'),
    sweepOf: (cellKey) =>
      cellFor(cellKey)
        ?.querySelector<HTMLElement>('.woc-tile-sweep')
        ?.style.getPropertyValue('--woc-tile-sweep') ?? '',
    countOf: (cellKey) => textIn(cellKey, '.woc-tile-count'),
    artOf: (cellKey) => cellFor(cellKey)?.querySelector('.woc-tile-art')?.getAttribute('src') ?? '',
    // Through the display style: the tile is built once and hidden.
    heldCount: () => {
      const cell = document.querySelector<HTMLElement>('[data-held]');
      if (cell === null || cell.style.display === 'none') {
        return '';
      }
      return cell.querySelector('.woc-tile-value')?.textContent ?? '';
    },
    heldLabel: () =>
      document.querySelector('[data-held] .woc-tile')?.getAttribute('aria-label') ?? '',
  };
}

/**
 * `start`, plus the wait for the overlay. A saved frame starts hidden until its per-character state
 * loads, and the addon skips drawing while hidden.
 */
async function run(opts: StartOpts = {}): Promise<PurelightHarness> {
  const harness = await start(opts);
  harness.poll();
  await settleFrames();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // It never touches the socket, so it must not ask for that permission.
  it('asks for no network permission', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'sound', 'keys']);
  });

  // The highest minor among the members it reads: `world.dispellable` and `woc.onFrame` at 2,
  // `ui.list` with `shown`, `fmt.duration` and `toggleKey` at 4, and `ui.units` at 6. Declaring
  // less loads against a loader missing them.
  it('declares the minor the members it calls arrived in', () => {
    expect(manifest().apiMinor).toBe(6);
  });
});

// `unbreakableControl` separates a scripted mechanic's control from an ordinary one. It is absent
// on almost every aura, so an addon that never reads it is wrong only on the effects a player most
// wants to act on.
describe('whether an effect can actually be removed', () => {
  it('shows an ordinary stun', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'gravebind')]);
  });

  it('hides the same stun when the encounter owns it', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, unbreakableControl: true });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('hides a physical effect', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, id: 'hamstring', school: 'physical' });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('hides a helpful effect', async () => {
    const h = await run();

    h.afflict(NEAR, BLESSING);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // A root's magnitude is 0 and a dot's is positive, the same sign as a heal over time. Reading
  // polarity off a magnitude, or off a row's `neg`, drops most of what a healer dispels.
  it('shows a root, which carries no negative magnitude at all', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, id: 'entangle', kind: 'root', value: 0 });
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'entangle')]);
  });

  it('shows a dot, whose magnitude is positive per tick', async () => {
    const h = await run();

    h.afflict(NEAR, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'corruption')]);
  });

  // A mob sapping attack power reuses the ORDINARY buff kind with a negative sign, so its kind
  // alone does not say it is harmful.
  it('shows a drain that reuses a buff kind with a negative magnitude', async () => {
    const h = await run();

    h.afflict(NEAR, { ...BLESSING, id: 'sap', kind: 'buff_ap', value: DRAIN });
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'sap')]);
  });

  // A member with a party row and no entity. The row cannot answer the question, so a version that
  // reads rows fails here.
  it('leaves off an effect on a member too far away to have an entity', async () => {
    const h = await run();

    h.afflict(FAR, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('drops the tile when the effect falls off', async () => {
    const h = await run();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    h.cure(NEAR, 'gravebind');
    h.frame();

    expect(h.drawn()).toEqual([]);
  });
});

// Every case is GRAVEBIND, drawn above, with only the id changed: `wireAura` does not send
// `encounterOwned`, so the id is all that separates a raid mechanic on the wire.
describe('an effect the game will refuse for a reason the wire does not carry', () => {
  it('holds a mechanic the encounter owns back off the strip', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, id: OWNED_ID });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // Without this the case above passes for an addon that draws nothing.
  it('still draws the same effect under an ordinary id', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'gravebind')]);
  });

  // A display-override id is a BENEFIT, so the purge direction is the one that would offer it.
  it('holds a display-override id back from a purge', async () => {
    const h = await run();
    h.select(RIVAL);

    h.afflict(RIVAL, { ...BLESSING, id: DISPLAY_ID });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('purges the same benefit under an ordinary id', async () => {
    const h = await run();
    h.select(RIVAL);

    h.afflict(RIVAL, BLESSING);
    h.frame();

    expect(h.drawn()).toEqual([key(RIVAL, 'blessing')]);
  });
});

describe('saying how much was held back', () => {
  it('counts the held effects on a tile of their own', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, id: OWNED_ID });
    h.afflict(ME, { ...CORRUPTION, id: OWNED_ID });
    h.frame();

    expect(h.heldCount()).toBe('2');
  });

  // Pinned as the string a reader announces: the kit says the label and then the value.
  it('spells the count out in the accessible name', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, id: OWNED_ID });
    h.frame();

    expect(h.heldLabel()).toBe('1 effect held back, which no dispel will remove, 1');
  });

  it('says nothing when nothing was held', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.heldCount()).toBe('');
  });

  it('takes the tile back down when the mechanic falls off', async () => {
    const h = await run();
    h.afflict(NEAR, { ...GRAVEBIND, id: OWNED_ID });
    h.frame();

    h.cure(NEAR, OWNED_ID);
    h.frame();

    expect(h.heldCount()).toBe('');
  });

  it('does not count a held effect the floor would have dropped anyway', async () => {
    const h = await run({ settings: { 'min-seconds': 10 } });

    h.afflict(NEAR, { ...GRAVEBIND, id: OWNED_ID, remaining: 3, duration: 8 });
    h.frame();

    expect(h.heldCount()).toBe('');
  });
});

// The loader refuses an undeclared data file, which would leave the addon with an empty set and no
// way to know.
describe('the table it reads', () => {
  it('is declared on the manifest', () => {
    expect(manifest().data).toEqual(['refused.json']);
  });

  it('stamps the game version it was read at', () => {
    expect(TABLE.gameVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('carries an id and a known reason on every row', () => {
    expect(TABLE.auras.length).toBeGreaterThan(0);
    for (const row of TABLE.auras) {
      expect(typeof row.id).toBe('string');
      expect(row.id.length).toBeGreaterThan(0);
      expect(['encounter', 'display']).toContain(row.reason);
    }
  });

  // No held tile over an unreadable table: a tile saying nothing was held is a claim.
  it('goes back to offering everything when the table is unreadable', async () => {
    const h = await run({ table: '{"gameVersion":"0.41.0"}' });

    h.afflict(NEAR, { ...GRAVEBIND, id: OWNED_ID });
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, OWNED_ID)]);
    expect(h.heldCount()).toBe('');
  });
});

// A unit outside the group has no party row, so none of this works if polarity comes off a row.
describe('the units it answers for', () => {
  it('reads the player as a unit like anyone else', async () => {
    const h = await run();

    h.afflict(ME, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key(ME, 'gravebind')]);
    expect(h.captions()).toEqual(['Marshal']);
  });

  it('reads your pet', async () => {
    const h = await run();

    h.afflict(PET, GRAVEBIND);
    h.frame();

    expect(h.captions()).toEqual(['Grizzle']);
  });

  it('reads your target', async () => {
    const h = await run();
    h.select(FOE);

    h.afflict(FOE, BLESSING);
    h.frame();

    expect(h.captions()).toEqual(['Grimjaw']);
  });

  // On a hostile unit the removable effect is the BENEFIT; one direction everywhere would offer to
  // dispel the player's own dot.
  it('offers a benefit on a hostile target and not its debuffs', async () => {
    const h = await run();
    h.select(FOE);

    h.afflict(FOE, BLESSING);
    h.afflict(FOE, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([key(FOE, 'blessing')]);
  });

  // Your target is often in your own group. The tile cache would hide a double read, so this is
  // measured against the tile budget, where a duplicate pushes another effect off the end.
  it('reads a unit once when it is both in your group and your target', async () => {
    const h = await run({ settings: { 'max-tiles': 2 } });
    h.select(NEAR);

    h.afflict(NEAR, GRAVEBIND);
    h.afflict(ME, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'gravebind'), key(ME, 'corruption')]);
  });

  // Solo has to work: a party-row reading answers nothing for a player on their own.
  it('works with no group at all', async () => {
    const h = await run({ grouped: false });

    h.afflict(ME, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key(ME, 'gravebind')]);
  });

  it('leaves you and your pet out when the setting says so', async () => {
    const h = await run({ settings: { 'include-player': false } });

    h.afflict(ME, GRAVEBIND);
    h.afflict(PET, GRAVEBIND);
    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'gravebind')]);
  });

  it('leaves the target out when the setting says so', async () => {
    const h = await run({ settings: { 'include-target': false } });
    h.select(FOE);

    h.afflict(FOE, BLESSING);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });
});

// Two players' copies of one debuff on one unit (see `AuraQuery.mine`). Keying on ability id alone
// collapses the pair and draws one aura's stacks.
describe('two of the same effect on one unit', () => {
  it('draws one tile per aura rather than one per ability id', async () => {
    const h = await run();

    h.afflict(NEAR, { ...CORRUPTION, sourceId: MOB_SOURCE, stacks: 2 });
    h.afflict(NEAR, { ...CORRUPTION, sourceId: OTHER_SOURCE, stacks: 5 });
    h.frame();

    expect(h.drawn()).toHaveLength(2);
    expect(h.countOf(key(NEAR, 'corruption', MOB_SOURCE))).toBe('2');
    expect(h.countOf(key(NEAR, 'corruption', OTHER_SOURCE))).toBe('5');
  });

  // `sourceId` is 0 when the game did not say who applied something, so two of those share every
  // field.
  it('still draws both when the game named no caster for either', async () => {
    const h = await run();

    h.afflict(NEAR, { ...CORRUPTION, sourceId: 0 });
    h.afflict(NEAR, { ...CORRUPTION, sourceId: 0 });
    h.frame();

    expect(h.drawn()).toHaveLength(2);
  });
});

describe('the art on a tile', () => {
  it('draws the applying ability when a player applied it', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, sourceId: ALLY });
    h.frame();

    expect(h.artOf(key(NEAR, 'gravebind', ALLY))).toContain('paladin/gravebind');
  });

  // Skill art is filed per player class and a mob has none, so its aura has no file; its PORTRAIT
  // does.
  it('draws the portrait of the mob that applied it', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, sourceId: FOE });
    h.frame();

    expect(h.artOf(key(NEAR, 'gravebind', FOE))).toBe('/ui/mobs/gnoll.webp');
  });

  // A portrait answers a different question from an ability icon, and a screen reader gets nothing
  // off the square unless the name carries it.
  it('says whose face it is, in the tooltip and in the accessible name', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, sourceId: FOE });
    h.frame();
    const cell = key(NEAR, 'gravebind', FOE);
    cellFor(cell)?.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById('woc-tooltip')?.textContent ?? '').toContain(
      'Pictured: the mob that applied it',
    );
    expect(h.labelOf(cell)).toContain('from Grimjaw');
  });

  // A player's own art is the effect's, so there is no face to explain.
  it('explains nothing when the art is the ability', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, sourceId: ALLY });
    h.frame();
    cellFor(key(NEAR, 'gravebind', ALLY))?.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById('woc-tooltip')?.textContent ?? '').not.toContain('Pictured');
  });

  // The caster is the only route to a picture, so a source out of interest scope has none.
  it('draws none for a caster no entity answers to', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.artOf(key(NEAR, 'gravebind'))).toBe('');
  });

  // A player's control aura is `${ability.id}_stun` or similar: the whole id has no art and the
  // ability under it does. These tiles rank first.
  it('takes the tail off a control aura before asking for a file', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, id: 'hammer_of_justice_stun', sourceId: ALLY });
    h.frame();

    const art = h.artOf(key(NEAR, 'hammer_of_justice_stun', ALLY));
    expect(art).toContain('paladin/hammer_of_justice');
    expect(art).not.toContain('_stun');
  });

  // Real ability ids end in what reads as a tail, so an id the spellbook names is left whole.
  it('leaves an ability whose own id ends in a suffix alone', async () => {
    const h = await run({ self: A_MAGE });

    h.select(RIVAL);
    h.afflict(RIVAL, { ...BRAIN_FREEZE, sourceId: RIVAL });
    h.frame();

    expect(h.artOf(key(RIVAL, 'brain_freeze', RIVAL))).toContain('mage/brain_freeze');
  });
});

describe('who is carrying it', () => {
  it('captions each tile with the unit', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.captions()).toEqual(['Bragg']);
  });

  // A tile is all art, so the accessible name carries both who and what.
  it('announces the unit and the effect together', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.labelOf(key(NEAR, 'gravebind'))).toContain('Bragg: Gravebind');
  });
});

describe('the order they are drawn in', () => {
  // Control first: it is the one an ordinary effect cannot be worse than.
  it('puts control ahead of damage', async () => {
    const h = await run();

    h.afflict(NEAR, CORRUPTION);
    h.afflict(ME, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key(ME, 'gravebind'), key(NEAR, 'corruption')]);
  });

  // Every kind here is one the game classifies. `fear`, `sleep`, `charm` and `horror` are not aura
  // kinds, so a list naming them sorts a real polymorph below a dot with no error.
  it.each(['incapacitate', 'polymorph', 'silence', 'root'])(
    'ranks a %s as control rather than as ordinary',
    async (kind) => {
      const h = await run();

      h.afflict(NEAR, CORRUPTION);
      h.afflict(ME, { ...GRAVEBIND, id: 'grasp', kind, remaining: 4 });
      h.frame();

      expect(h.drawn()).toEqual([key(ME, 'grasp'), key(NEAR, 'corruption')]);
    },
  );

  // Within a rank, longest left first: an effect about to expire is NOT worth a global.
  it('puts the longest remaining first within a rank', async () => {
    const h = await run();

    h.afflict(NEAR, { ...CORRUPTION, remaining: 3 });
    h.afflict(ME, { ...CORRUPTION, remaining: 11 });
    h.frame();

    expect(h.drawn()).toEqual([key(ME, 'corruption'), key(NEAR, 'corruption')]);
  });

  it('shows no more tiles than the setting allows', async () => {
    const h = await run({ settings: { 'max-tiles': 1 } });

    h.afflict(NEAR, CORRUPTION);
    h.afflict(ME, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key(ME, 'gravebind')]);
  });

  // An effect with less left than a global takes cannot be acted on.
  it('leaves off anything with less left than the floor', async () => {
    const h = await run({ settings: { 'min-seconds': 4 } });

    h.afflict(NEAR, { ...CORRUPTION, remaining: 2 });
    h.afflict(ME, { ...CORRUPTION, remaining: 6 });
    h.frame();

    expect(h.drawn()).toEqual([key(ME, 'corruption')]);
  });
});

// The strip reads on the frame loop: `world.on('party')` covers only group members, not the target
// or pet, and does not fire as an effect ticks down.
describe('the countdown on a tile', () => {
  it('follows the effect down with nothing else changing at all', async () => {
    const h = await run();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();
    expect(h.valueOf(key(NEAR, 'gravebind'))).toBe('8');

    h.tickTo(NEAR, 'gravebind', 4);
    h.frame();

    expect(h.valueOf(key(NEAR, 'gravebind'))).toBe('4');
  });

  // The sweep takes the ELAPSED share while the addon holds a remaining, so a half-spent effect
  // tells a correct conversion from an inverted one.
  it('sweeps the square against the published duration', async () => {
    const h = await run();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    h.tickTo(NEAR, 'gravebind', 4);
    h.frame();

    expect(h.sweepOf(key(NEAR, 'gravebind'))).toBe('50.00%');
  });

  it('puts a stack count in the corner and nothing there for a single one', async () => {
    const h = await run();

    h.afflict(NEAR, { ...CORRUPTION, stacks: 3 });
    h.afflict(ME, CORRUPTION);
    h.frame();

    expect(h.countOf(key(NEAR, 'corruption'))).toBe('3');
    expect(h.countOf(key(ME, 'corruption'))).toBe('');
  });
});

// `appendChild` on an element already in the document MOVES it, which strands a tooltip on the tile
// under the pointer, so unchanged rows are left alone.
describe('how tiles are placed', () => {
  it('leaves a tile alone when its position has not changed', async () => {
    const h = await run();
    h.afflict(NEAR, GRAVEBIND);
    h.afflict(ME, CORRUPTION);
    h.frame();
    const first = cellFor(key(NEAR, 'gravebind'));
    const strip = document.querySelector('.woc-pl-list') as HTMLElement;
    const observer = new MutationObserver(() => undefined);
    observer.observe(strip, { childList: true });

    h.frame();
    h.frame();

    expect(observer.takeRecords()).toEqual([]);
    expect(cellFor(key(NEAR, 'gravebind'))).toBe(first);
    observer.disconnect();
  });

  it('still reorders when the order actually changes', async () => {
    const h = await run();
    h.afflict(NEAR, { ...CORRUPTION, remaining: 4 });
    h.afflict(ME, { ...CORRUPTION, remaining: 9 });
    h.frame();
    expect(h.drawn()).toEqual([key(ME, 'corruption'), key(NEAR, 'corruption')]);

    h.tickTo(ME, 'corruption', 2);
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'corruption'), key(ME, 'corruption')]);
  });
});

// A player who hovers a tile should learn why that one is on the strip.
describe('the tooltip on a tile', () => {
  function hover(cellKey: string): string {
    cellFor(cellKey)?.dispatchEvent(new Event('pointerenter'));
    return document.getElementById('woc-tooltip')?.textContent ?? '';
  }

  it('names the effect, who has it, and why it is here', async () => {
    const h = await run();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    const said = hover(key(NEAR, 'gravebind'));

    expect(document.querySelector('.woc-tip-title')?.textContent).toBe('Gravebind');
    expect(said).toContain('On Bragg');
    expect(said).toContain('shadow');
    expect(said).toContain('nothing known holds it');
  });

  // The reason is per direction, because the rule is.
  it('says the other reason for a benefit on a hostile unit', async () => {
    const h = await run();
    h.select(FOE);
    h.afflict(FOE, BLESSING);
    h.frame();

    expect(hover(key(FOE, 'blessing'))).toContain('a benefit on a hostile unit');
  });

  // The caster tells two tiles of the same debuff apart.
  it('names the caster when the game said who it was', async () => {
    const h = await run();
    h.afflict(NEAR, { ...GRAVEBIND, sourceId: ALLY });
    h.frame();

    expect(hover(key(NEAR, 'gravebind', ALLY))).toContain('Applied by Sunna');
  });

  it('answers with what is left now, not with what was left when it landed', async () => {
    const h = await run();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();
    expect(hover(key(NEAR, 'gravebind'))).toContain('8.0s left');

    h.tickTo(NEAR, 'gravebind', 4.5);
    h.frame();

    expect(hover(key(NEAR, 'gravebind'))).toContain('4.5s left');
  });
});

// The strip's height is the tile size less the caption band. The loader owns the box and reports it
// through `onMove`; measuring the element would force a layout per pointer move. Driven by the
// saved box, which takes the same path as a drag.
describe('the size of the strip', () => {
  function frameEl(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-woc-frame="strip"]');
  }

  function cellOf(cellKey: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-effect="${cellKey}"]`);
  }

  function sizeOf(cellKey: string): string {
    const tile = cellOf(cellKey)?.querySelector<HTMLElement>('.woc-tile');
    return tile?.style.getPropertyValue('--woc-tile-size') ?? '';
  }

  // A frame with no stated height opens at the kit's fallback, several times what it draws, leaving
  // an invisible drag area over the game. Stating it also makes the frame resizable.
  it('opens at one square and its caption, and says so as a height', async () => {
    await run();

    expect(frameEl()?.style.height).toBe(`${FLOOR_HEIGHT}px`);
  });

  it('starts a tile at the tap-target floor the game holds its controls to', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(sizeOf(key(NEAR, 'gravebind'))).toBe('40px');
  });

  // The tile is built before the restore lands, so it has to be resized rather than rebuilt, or a
  // drag throws away decoded art. `start` rather than `run`, because that window is the subject.
  it('resizes a tile that was built before the box arrived', async () => {
    const h = await start({ frames: { strip: { box: DRAGGED, visible: true } } });
    h.poll();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    await settleFrames();
    h.frame();

    expect(sizeOf(key(NEAR, 'gravebind'))).toBe('64px');
  });

  // The cell is the tile's width, so the caption column follows the tile.
  it('raises a later tile at the size the strip is at now', async () => {
    const h = await run({ frames: { strip: { box: DRAGGED, visible: true } } });

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(sizeOf(key(NEAR, 'gravebind'))).toBe('64px');
    expect(cellOf(key(NEAR, 'gravebind'))?.style.width).toBe('64px');
  });

  // A frame that states neither bound takes its first paint as its floor.
  it('holds the strip at the tap-target floor when a saved box is shorter', async () => {
    const h = await run({ frames: { strip: { box: CRAMPED, visible: true } } });

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(frameEl()?.style.height).toBe(`${FLOOR_HEIGHT}px`);
    expect(sizeOf(key(NEAR, 'gravebind'))).toBe('40px');
  });

  // The width's floor is one square, so a healer can shrink the drag area to what it draws.
  it('lets the strip be dragged narrower than it opened', async () => {
    await run({ frames: { strip: { box: CRAMPED, visible: true } } });

    expect(frameEl()?.style.width).toBe(`${CRAMPED.w}px`);
  });
});

describe('disabling it', () => {
  it('leaves no frame, no keybind, and no frame loop behind', async () => {
    const h = await run();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('[data-woc-frame="strip"]')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.frame()).not.toThrow();
  });
});
