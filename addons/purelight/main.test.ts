// @vitest-environment happy-dom

// Purelight, run through the real loader.
//
// The subject is one decision: whether an effect can be removed. It is the game's own rule and
// the loader publishes it, so what this suite pins is that the addon asks the right question of
// the right shape.
//
// Three cases carry most of that weight. The same stun twice, once owned by an encounter and
// once not, because an addon that skips `unbreakableControl` passes everything else here and
// tells a healer to spend a global on something nothing can remove. A root, because a root
// carries a magnitude of 0 and a dot carries a positive one, so any display that reads polarity
// off a magnitude drops both while looking entirely correct. And a hostile target, because
// there the question is reversed: what can be stripped is the benefit.
//
// The party rows in the fixture exist to be ignored. The addon reads entities only, since a row
// carries neither a school nor `unbreakableControl` and those are the two clauses whose absence
// costs a player a global. A row is carried here anyway so that a future version that starts
// reading them fails on the member who has a row and no entity.

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
 * A frost mage's own proc, which is a benefit and therefore a purge tile on an enemy. The game
 * applies it to the mage itself with the bare ability id and no tail, which makes it the case
 * `artId` must not trim: `brain_freeze` is a file and `brain` is not.
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
 * What the addon marks a cell with. The caster is in it, which is the whole point: two players
 * carrying the same debuff on one unit are two effects and must be two tiles.
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
 * Who the player is, for the two things read off them rather than off an effect: the class an
 * ally's art is filed under, and the spellbook.
 *
 * A healer by default, since that is who installs this. The mage is here for the one branch a
 * healer cannot reach: no paladin, priest, druid or shaman ability id ends in anything
 * `AURA_SUFFIXES` would trim.
 */
interface SelfSpec {
  cls: string;
  known: readonly unknown[];
}

const A_PALADIN: SelfSpec = { cls: 'paladin', known: [] };

/**
 * A frost mage, who knows the one ability in this file whose id ends in a tail. `brain_freeze`
 * is a real proc the game applies to the mage itself, with the bare ability id and no tail, and
 * it is a benefit, so on an enemy mage it is a purge tile. A frost mage looking at another frost
 * mage therefore has it in their own spellbook, which is the only way the guard in `artId` can
 * fire.
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
  /** False starts the player solo, which is the case that used to draw nothing. */
  grouped?: boolean;
  /** Defaults to the paladin every other case here is written against. */
  self?: SelfSpec;
  /**
   * Frame state as a previous session saved it, seeded before the addon loads. The restore is
   * the same path a drag takes: the loader clamps the box and reports it through `onMove`.
   */
  frames?: Record<string, { box: FrameBox; visible: boolean }>;
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

/**
 * Every entity the world holds, and the aura arrays they are actually carrying. `live` holds the
 * very arrays the entities carry, so an effect landing mutates what the game would be mutating.
 */
/** The roster the loader reads, or null for a player standing on their own. */
function partyOf(grouped: boolean, members: MemberRow[]) {
  if (!grouped) {
    return null;
  }
  return { leader: ME, raid: false, members };
}

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

  // The rows are built either way, so an ungrouped run still has them to be
  // ignored: nothing here should be reachable except through `world.party`.
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
 * Start the addon, optionally solo and optionally with settings stored. Settings are seeded
 * before the addon loads, because the loader hydrates them and then evaluates.
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
    // The target is resolved from the player's own `targetId` through the roster,
    // which is the route the loader takes, so this is where a selection lives.
    select: (id) => {
      selection.targetId = id;
    },
    poll: () => harness.shared.world.watcher.poll(),
    frame: () => harness.frames.tick(),
    // Read off the attribute rather than the dataset, which is an index
    // signature: the linter wants dot access there and the compiler forbids it.
    drawn: () =>
      [...document.querySelectorAll('[data-effect]')].map(
        (el) => el.getAttribute('data-effect') ?? '',
      ),
    captions: () =>
      [...document.querySelectorAll('.woc-pl-name')].map((el) => el.textContent ?? ''),
    labelOf: (cellKey) =>
      cellFor(cellKey)?.querySelector('.woc-tile')?.getAttribute('aria-label') ?? '',
    valueOf: (cellKey) => textIn(cellKey, '.woc-tile-value'),
    sweepOf: (cellKey) =>
      cellFor(cellKey)
        ?.querySelector<HTMLElement>('.woc-tile-sweep')
        ?.style.getPropertyValue('--woc-tile-sweep') ?? '',
    countOf: (cellKey) => textIn(cellKey, '.woc-tile-count'),
    artOf: (cellKey) => cellFor(cellKey)?.querySelector('.woc-tile-art')?.getAttribute('src') ?? '',
  };
}

/**
 * `start`, plus the wait for the overlay to come up. A saved frame starts hidden and is shown
 * once its stored state arrives, keyed per character, so it takes a sample and a storage read.
 * The addon skips the drawing while the frame is hidden.
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

  // It never touches the socket, so it must not ask for it. A permission an addon
  // does not use is one every player is asked to grant for nothing.
  it('asks for no network permission', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'sound', 'keys']);
  });

  // `world.dispellable` and `woc.onFrame` are both minor 2. A manifest that claims
  // less than it calls loads against a loader that has neither and throws.
  it('declares the minor the removal rule arrived in', () => {
    expect(manifest().apiMinor).toBe(2);
  });
});

// The whole addon, in a handful of assertions on one effect each. `unbreakableControl`
// separates a scripted mechanic's control from an ordinary one. It is absent on almost every
// aura in the game, so an addon that never reads it looks correct on every ordinary effect and
// is wrong on exactly the ones a player would be reaching for a cooldown during.
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

  // A root's magnitude is 0 and a dot's is a positive figure per tick, so both look identical to
  // a heal over time by sign, and both are harmful by kind. Any display that reads polarity off
  // a magnitude, or off the party row's `neg` flag which is the same sign test, silently drops
  // most of what a healer would actually dispel.
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

  // The other half of the game's rule, and the half a set-only classifier gets
  // wrong: a mob sapping attack power reuses the ORDINARY buff kind and flips the
  // sign, so nothing about its kind says it is harmful.
  it('shows a drain that reuses a buff kind with a negative magnitude', async () => {
    const h = await run();

    h.afflict(NEAR, { ...BLESSING, id: 'sap', kind: 'buff_ap', value: DRAIN });
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'sap')]);
  });

  // A member with a party row and no entity. The row carries no school and no encounter flag, so
  // it cannot answer the question. The fixture pushes the row anyway, so a version that starts
  // reading rows again fails right here.
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

// The reach. None of this is answerable while polarity comes off a party row, because a unit
// outside the group has no row.
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

  // The direction is per unit. On a hostile one the removable effect is the
  // BENEFIT, and its debuffs are somebody else's work rather than something to
  // undo. An addon that ran one direction everywhere would offer to dispel the
  // dot the player just applied.
  it('offers a benefit on a hostile target and not its debuffs', async () => {
    const h = await run();
    h.select(FOE);

    h.afflict(FOE, BLESSING);
    h.afflict(FOE, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([key(FOE, 'blessing')]);
  });

  // The same unit reached by two routes. Your target is very often somebody in your own group,
  // and reading them twice puts their effects into the reading twice. The tile cache would hide
  // that, so this is measured against the tile budget, where a duplicate pushes somebody else's
  // effect off the end.
  it('reads a unit once when it is both in your group and your target', async () => {
    const h = await run({ settings: { 'max-tiles': 2 } });
    h.select(NEAR);

    h.afflict(NEAR, GRAVEBIND);
    h.afflict(ME, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([key(NEAR, 'gravebind'), key(ME, 'corruption')]);
  });

  // Solo has to work: a reading that took polarity from a party row answers nothing at all for a
  // player standing on their own, including for their own debuffs.
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

// Two players can carry the same debuff on one unit, which is the case the
// published `AuraQuery.mine` documentation calls out. Keying a tile on the ability
// id alone collapses the pair, and the stack count drawn is then one of the two
// auras' rather than the pair's.
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

  // The residue the caster cannot separate: `sourceId` is 0 when the game did not
  // say who applied something, so two of those on one unit share every field.
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

  // Skill art is filed per player CLASS and a mob has no class directory, so there
  // is no file anywhere to point at. A blank slot here is the honest answer.
  it('draws none for an effect a mob applied', async () => {
    const h = await run();

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(h.artOf(key(NEAR, 'gravebind'))).toBe('');
  });

  // A player's control aura is `${ability.id}_stun` and fifteen more like it, so the
  // whole id is art that can never exist and the ability under it is art that does.
  // These are the tiles this addon ranks FIRST, so the tail costs exactly the icons
  // a player is looking at hardest.
  it('takes the tail off a control aura before asking for a file', async () => {
    const h = await run();

    h.afflict(NEAR, { ...GRAVEBIND, id: 'hammer_of_justice_stun', sourceId: ALLY });
    h.frame();

    const art = h.artOf(key(NEAR, 'hammer_of_justice_stun', ALLY));
    expect(art).toContain('paladin/hammer_of_justice');
    expect(art).not.toContain('_stun');
  });

  // Five real ability ids end in what would otherwise read as a tail, so an id the
  // game itself names is left whole rather than trimmed down to something else.
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

  // A tile is all art, so the name has to reach assistive technology some other
  // way, and both halves of "who has what" belong in it.
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

  // The four kinds that carry the rest of the game's control. Every one is a kind the game
  // actually classifies, which is the point: a list naming `fear`, `sleep`, `charm` and `horror`
  // names nothing that is an aura kind here, so a real polymorph sorts below a dot with nothing
  // raising anywhere. `fear` is the diminishing-returns category an `incapacitate` is filed
  // under, which is why the wrong list reads as right.
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

  // Within a rank, the one with longest left. The opposite of a cooldown list, and
  // for the opposite reason: an effect about to expire is the one NOT worth a
  // global.
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

  // The same judgement as the ordering, with the display turned off: an effect
  // with less left than a global takes is not something anyone can act on.
  it('leaves off anything with less left than the floor', async () => {
    const h = await run({ settings: { 'min-seconds': 4 } });

    h.afflict(NEAR, { ...CORRUPTION, remaining: 2 });
    h.afflict(ME, { ...CORRUPTION, remaining: 6 });
    h.frame();

    expect(h.drawn()).toEqual([key(ME, 'corruption')]);
  });
});

// The strip reads on the loader's own frame loop rather than waking on a world
// key. `world.on('party')` reports an effect landing on a GROUP member and this
// display also answers for the target and the pet, which no key covers, and it
// deliberately does not fire as an effect ticks down, which the countdown needs.
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

  // The sweep takes the ELAPSED share while the addon holds a remaining, so a
  // half-spent effect is the case that tells a correct conversion from an inverted
  // one. The denominator is the entity's published duration, so it is exact from
  // the first frame rather than measured from a first sighting.
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

// Rows are re-ordered, not re-appended. `appendChild` on an element already in the
// document MOVES it, which drops whatever the browser was tracking on it, and
// doing that to every tile every frame strands a tooltip on the one under the
// pointer.
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

// The display shows its working, because the rule is the product: a player who
// hovers a tile should come away knowing why that one is on the strip and the
// stun that just landed on the tank is not.
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
    expect(said).toContain('no encounter owns it');
  });

  // The reason is per direction, because the rule is. A tile on a hostile unit is
  // there for the opposite reason to one on an ally.
  it('says the other reason for a benefit on a hostile unit', async () => {
    const h = await run();
    h.select(FOE);
    h.afflict(FOE, BLESSING);
    h.frame();

    expect(hover(key(FOE, 'blessing'))).toContain('a benefit on a hostile unit');
  });

  // What tells two tiles of the same debuff on one unit apart, when the game said
  // who applied them.
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

// Resizing the strip, which is how a player picks the tile size. The same arrangement Cooldown
// Bars draws its tile strip with, on purpose: both are bare strips of kit tiles, so a player who
// has sized one has already learned how to size the other.
//
// The height is the size, less the caption band: the loader owns a resizable frame's box and
// reports it through `onMove`, and the addon writes what is left onto every tile. Measuring the
// element instead would force a synchronous layout on every pointer move.
//
// Driven here by the saved box, because that is the same path a drag takes: the restore lands
// asynchronously and reports through the same callback.
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

  // A frame with no stated height opens at the kit's own fallback, which for a
  // strip of 40 pixel squares is several times what it draws and leaves the
  // difference as an invisible drag area sitting over the game. Stating it is also
  // what makes the frame resizable at all: a content-sized frame is never given a
  // box to drag.
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

  // The tile is built before the restore lands, which is the live path: a tile already up has to
  // be resized rather than rebuilt, or a drag would throw away the art the browser has decoded.
  // `start` rather than `run`, because that window is the subject.
  it('resizes a tile that was built before the box arrived', async () => {
    const h = await start({ frames: { strip: { box: DRAGGED, visible: true } } });
    h.poll();
    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    await settleFrames();
    h.frame();

    expect(sizeOf(key(NEAR, 'gravebind'))).toBe('64px');
  });

  // The caption column follows the tile, because the cell is the tile's width: a
  // name under a 64 pixel square that is still 40 wide truncates a name that fits.
  it('raises a later tile at the size the strip is at now', async () => {
    const h = await run({ frames: { strip: { box: DRAGGED, visible: true } } });

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(sizeOf(key(NEAR, 'gravebind'))).toBe('64px');
    expect(cellOf(key(NEAR, 'gravebind'))?.style.width).toBe('64px');
  });

  // Both bounds are stated, because a frame that states neither takes the size it
  // opened at as its floor and can never be dragged smaller than its first paint.
  it('holds the strip at the tap-target floor when a saved box is shorter', async () => {
    const h = await run({ frames: { strip: { box: CRAMPED, visible: true } } });

    h.afflict(NEAR, GRAVEBIND);
    h.frame();

    expect(frameEl()?.style.height).toBe(`${FLOOR_HEIGHT}px`);
    expect(sizeOf(key(NEAR, 'gravebind'))).toBe('40px');
  });

  // The width is only room to grow into, so its floor is one square rather than
  // the width the strip opened at: a healer watching two effects should be able to
  // take the invisible drag area back down to what it draws.
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
