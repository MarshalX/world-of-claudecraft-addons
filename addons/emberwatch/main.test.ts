// @vitest-environment happy-dom

// Emberwatch, run through the real loader.
//
// The subject is one decision: given a rule and what is actually on a unit, does this fire?
// Everything about tiles, captions and sweeps is downstream of that, so the cases below read
// the screen only as the cheapest place to observe the answer.
//
// Four cases carry most of the weight, and each is one a plausible implementation gets wrong
// while looking entirely correct on the others:
//
//  - The same debuff from two casters. Two players can carry the same dot on one target, and a
//    rule with `mine: true` is about your copy. An engine that drops `mine` from the query
//    sees the other player's full timer and stays quiet while the player's own dot expires.
//  - A root, whose magnitude is 0, against a dot, whose magnitude is a positive figure per
//    tick. Both are harmful by kind, so a polarity filter built on a sign drops both.
//  - An encounter-owned stun beside an ordinary one. A `removable` rule that skips
//    `unbreakableControl` fires on control nothing the player does will shift.
//  - A party row, which cannot answer `mine`, stacks or removability. Each has to be refused
//    rather than guessed, and the fixture carries a member with a row and no entity so a
//    version that starts answering from rows fails here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { characterNamespace, perCharacterKey } from '../../loader/src/shared/storage-keys.ts';
import { type AddonHarness, mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the cooldown-bars suite.
import SOURCE from './main.js?raw';
import RULES_TEXT from './rules.json?raw';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
const SHIPPED: unknown = JSON.parse(RULES_TEXT);

/** The storage namespace this addon's own rows are filed under. */
const FQID = 'official/emberwatch';
/** What tests/fakes/shared-services.ts says the player is called. */
const CHARACTER = 'Claudemoon/Marshal';

const ME = PLAYER_ENTITY.id;
/** What the player has selected, and it is trying to kill them. */
const FOE = 880;
/** A party member standing close enough to have an entity. */
const NEAR = 881;
/** A party member out of interest scope: a row and no entity at all. */
const FAR = 882;
/** Another player, near enough to have an entity, so their art resolves. */
const ALLY = 883;
/** An id no entity answers to, which is what a mob's effect looks like here. */
const MOB_SOURCE = 9000;

/** An ordinary positive magnitude. A dot's per-tick figure looks exactly like this. */
const MAGNITUDE = 40;
/** What a drain reusing a `buff_*` kind carries, and its only mark of being harmful. */
const DRAIN = -20;

/** One effect as a case describes it, before it becomes an aura or a row. */
interface Effect {
  id: string;
  name: string;
  kind: string;
  school?: string;
  remaining: number;
  duration?: number;
  value?: number;
  sourceId?: number;
  stacks?: number;
  unbreakableControl?: boolean;
}

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

/** A party row's compact strip: an id, a kind, whole seconds, and a sign flag. */
interface AuraRow {
  id: string;
  kind: string;
  remaining: number;
  neg?: 1;
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

const CORRUPTION: Effect = {
  id: 'corruption',
  name: 'Blackrot',
  kind: 'dot',
  school: 'shadow',
  remaining: 18,
  duration: 18,
};

const GRAVEBIND: Effect = {
  id: 'gravebind',
  name: 'Gravebind',
  kind: 'stun',
  school: 'shadow',
  remaining: 8,
  duration: 8,
};

const BLESSING: Effect = {
  id: 'blessing',
  name: 'Blessing of Haste',
  kind: 'buff_haste',
  school: 'holy',
  remaining: 30,
  duration: 30,
  value: MAGNITUDE,
};

/** A proc on you: the shape every "gained" starter rule is written against. */
const TRANCE: Effect = {
  id: 'battle_trance',
  name: 'Battle Trance',
  kind: 'battle_trance',
  school: 'physical',
  remaining: 12,
  duration: 12,
};

/**
 * A rule as a case writes one. Every optional carries `| undefined` explicitly, because
 * `exactOptionalPropertyTypes` otherwise refuses `{ ...RULE, mine: undefined }`, and spreading
 * a base rule with one clause knocked out is how the cases below vary one field at a time.
 * `JSON.stringify` drops an undefined member, so the file the addon reads carries the absence.
 */
interface RuleSpec {
  id: string;
  label: string;
  unit: string;
  on: string;
  class?: string | undefined;
  auraId?: string | undefined;
  kind?: string | undefined;
  mine?: boolean | undefined;
  harmful?: boolean | undefined;
  removable?: boolean | undefined;
  bout?: boolean | undefined;
  banner?: boolean | undefined;
  cue?: string | undefined;
  threshold?: number | undefined;
}

/** A rules file in the shape the shipped one is, so `readFile` accepts it. */
function rulesFile(rules: readonly RuleSpec[]): string {
  return JSON.stringify({ format: 'emberwatch-rules', version: 1, rules });
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

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

/** What the addon marks a cell with. The caster is in it, which is the whole point. */
function key(ruleId: string, unitKey: string, auraId: string, source: number = MOB_SOURCE): string {
  return `${ruleId}|${unitKey}|${auraId}|${String(source)}`;
}

function fullAura(effect: Effect): FullAura {
  const aura: FullAura = {
    id: effect.id,
    name: effect.name,
    kind: effect.kind,
    remaining: effect.remaining,
    duration: effect.duration ?? effect.remaining,
    value: effect.value ?? MAGNITUDE,
    sourceId: effect.sourceId ?? MOB_SOURCE,
    school: effect.school ?? 'shadow',
  };
  if (effect.stacks !== undefined) {
    aura.stacks = effect.stacks;
  }
  if (effect.unbreakableControl === true) {
    aura.unbreakableControl = true;
  }
  return aura;
}

/** The wire's smaller half: no source, no duration, no stacks, whole seconds. */
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

function memberRow(pid: number, name: string): MemberRow {
  return {
    pid,
    name,
    cls: 'warrior',
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

interface Selection {
  targetId: number | null;
}

interface StartOpts {
  settings?: Record<string, unknown>;
  /** The rules file the loader hands back, or null to seed none at all. */
  rules?: string | null;
  /** The class the player is, which is what a starter rule's `class` is matched on. */
  cls?: string;
  storage?: FakeStorage;
  /** True puts the player in a duel, which is what `world.match` reads as a bout. */
  bout?: boolean;
}

interface BusRecord {
  ruleId: string;
  unit: string;
  auraId: string;
  state: string;
}

interface Harness extends AddonHarness {
  /** Land an effect on an entity, and on that member's party row where there is one. */
  afflict: (id: number, effect: Effect) => void;
  /** Take one off again, from both halves. */
  cure: (id: number, auraId: string) => void;
  /** Move a live aura's remaining, which is what ticking looks like. */
  tickTo: (id: number, auraId: string, remaining: number) => void;
  /** Move a live aura's stack count, which no aura arriving or leaving reports. */
  stackTo: (id: number, auraId: string, stacks: number) => void;
  select: (id: number | null) => void;
  poll: () => void;
  frame: () => void;
  /** The cells on screen, in the order they are drawn. */
  drawn: () => string[];
  /** What the strip says it is not showing. */
  overflow: () => string;
  labelOf: (cellKey: string) => string;
  /** The tile's picture, or empty for a square drawing none. */
  artOf: (cellKey: string) => string;
  valueOf: (cellKey: string) => string;
  countOf: (cellKey: string) => string;
  sweepOf: (cellKey: string) => string;
  hover: (cellKey: string) => string;
  banner: () => string;
  /** Every cue played since the harness started. */
  played: () => string[];
  /** Everything published on the bus topic, oldest first. */
  publishedRules: () => BusRecord[];
  /** The rows in the rules pane, in order. */
  paneRules: () => string[];
  paneText: () => string;
  /** This character's own stored rows, read straight out of the store. */
  stored: (name: string) => Promise<unknown>;
}

function cellFor(cellKey: string): Element | null {
  return document.querySelector(`[data-alert="${cellKey}"]`);
}

function textIn(cellKey: string, selector: string): string {
  return cellFor(cellKey)?.querySelector(selector)?.textContent ?? '';
}

/**
 * Let the async frame restore and the data read land before reading what they did. Written out
 * rather than looped, for the reason `noAwaitInLoops` exists: each line is one microtask turn,
 * and the point is the count of turns.
 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function buildWorld(cls: string, bout: boolean) {
  const live = new Map<number, FullAura[]>();
  const entities = new Map<number, unknown>();
  const spawn = (id: number, over: Record<string, unknown>): Record<string, unknown> => {
    const auras: FullAura[] = [];
    live.set(id, auras);
    const entity = liveEntity({ set: { id, auras, ...over } });
    entities.set(id, entity);
    return entity;
  };
  const player = spawn(ME, { name: 'Marshal', kind: 'player', templateId: cls });
  spawn(NEAR, { name: 'Bragg', kind: 'player', templateId: 'warrior' });
  spawn(ALLY, { name: 'Sunna', kind: 'player', templateId: 'paladin' });
  spawn(FOE, { name: 'Grimjaw', kind: 'mob', templateId: 'gnoll', hostile: true });
  const members = [memberRow(ME, 'Marshal'), memberRow(NEAR, 'Bragg'), memberRow(FAR, 'Wisp')];
  const world: Record<string, unknown> = {
    entities,
    player,
    partyInfo: { leader: ME, raid: false, members },
  };
  if (bout) {
    // Assigned rather than written as a key: the linter wants dot access on a record and the
    // compiler forbids it on an index signature.
    Object.assign(world, { duelInfo: { state: 'active', otherPid: FOE, otherName: 'Grimjaw' } });
  }
  return { live, members, selection: player as unknown as Selection, world };
}

/** The rules file text a case asked for, or an empty table when it did not say. */
function rulesTextFor(opts: StartOpts): string | null {
  if (opts.rules === undefined) {
    return rulesFile([]);
  }
  return opts.rules;
}

/** Null seeds NO file at all, which is what a failed fetch leaves an addon holding. */
function dataFor(text: string | null): Record<string, string> {
  if (text === null) {
    return {};
  }
  return { 'rules.json': text };
}

async function start(opts: StartOpts = {}): Promise<Harness> {
  const { live, members, selection, world } = buildWorld(opts.cls ?? 'warlock', opts.bout === true);
  const text = rulesTextFor(opts);
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    storage: opts.storage ?? createFakeStorage(),
    settings: opts.settings ?? {},
    data: dataFor(text),
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);

  const seen: BusRecord[] = [];
  teardown.push(
    harness.shared.bus.subscribe({
      from: harness.fqid,
      topic: 'alert',
      owner: 'test/observer',
      handler: (message) => {
        seen.push(message.payload as BusRecord);
      },
      onError: () => undefined,
    }),
  );
  const cues: string[] = [];
  harness.shared.sound.play = (cue: string) => {
    cues.push(cue);
  };

  const rowsOf = (pid: number): AuraRow[] =>
    members.find((member) => member.pid === pid)?.auras ?? [];
  const find = (id: number, auraId: string): FullAura | undefined =>
    live.get(id)?.find((aura) => aura.id === auraId);

  return {
    ...harness,
    afflict: (id, effect) => {
      rowsOf(id).push(rowAura(effect));
      live.get(id)?.push(fullAura(effect));
    },
    cure: (id, auraId) => {
      const rows = rowsOf(id);
      const at = rows.findIndex((row) => row.id === auraId);
      if (at >= 0) {
        rows.splice(at, 1);
      }
      const auras = live.get(id) ?? [];
      const on = auras.findIndex((aura) => aura.id === auraId);
      if (on >= 0) {
        auras.splice(on, 1);
      }
    },
    tickTo: (id, auraId, remaining) => {
      const aura = find(id, auraId);
      if (aura !== undefined) {
        aura.remaining = remaining;
      }
      const row = rowsOf(id).find((entry) => entry.id === auraId);
      if (row !== undefined) {
        row.remaining = Math.ceil(remaining);
      }
    },
    stackTo: (id, auraId, stacks) => {
      const aura = find(id, auraId);
      if (aura !== undefined) {
        aura.stacks = stacks;
      }
    },
    select: (id) => {
      selection.targetId = id;
    },
    poll: () => harness.shared.world.watcher.poll(),
    frame: () => harness.frames.tick(),
    drawn: () =>
      [...document.querySelectorAll('[data-alert]')].map(
        (el) => el.getAttribute('data-alert') ?? '',
      ),
    overflow: () => document.querySelector('.woc-ew-overflow')?.textContent ?? '',
    labelOf: (cellKey) =>
      cellFor(cellKey)?.querySelector('.woc-tile')?.getAttribute('aria-label') ?? '',
    artOf: (cellKey) => {
      const art = cellFor(cellKey)?.querySelector<HTMLImageElement>('.woc-tile-art');
      if (art === null || art === undefined || art.hidden) {
        return '';
      }
      return art.getAttribute('src') ?? '';
    },
    valueOf: (cellKey) => textIn(cellKey, '.woc-tile-value'),
    countOf: (cellKey) => textIn(cellKey, '.woc-tile-count'),
    sweepOf: (cellKey) =>
      cellFor(cellKey)
        ?.querySelector<HTMLElement>('.woc-tile-sweep')
        ?.style.getPropertyValue('--woc-tile-sweep') ?? '',
    hover: (cellKey) => {
      cellFor(cellKey)?.dispatchEvent(new Event('pointerenter'));
      return document.getElementById('woc-tooltip')?.textContent ?? '';
    },
    banner: () => document.querySelector('.woc-banner-text')?.textContent ?? '',
    played: () => [...cues],
    publishedRules: () => [...seen],
    paneRules: () =>
      [...document.querySelectorAll('[data-rule]')].map((el) => el.getAttribute('data-rule') ?? ''),
    paneText: () => document.querySelector('.woc-ew-rules')?.textContent ?? '',
    stored: (name) =>
      (opts.storage ?? createFakeStorage()).get(
        characterNamespace(FQID),
        perCharacterKey('pbe', CHARACTER, name),
      ),
  };
}

/**
 * `start`, plus the wait for the overlay to come up and the rules file to land, plus the one
 * frame that primes the engine.
 *
 * A saved frame starts hidden and is shown once its stored state arrives, keyed per character,
 * so it takes a sample to find the character and a storage read to come back. The addon skips
 * the drawing while the frame is hidden.
 *
 * The priming frame is the third thing. The first reading of a live world is everything
 * already up, which is not news, so the addon makes no sound during it. A case that wants to
 * hear a cue has to start from the same place; the case about starting mid-fight uses `start`
 * and drives the priming frame itself.
 */
async function run(opts: StartOpts = {}): Promise<Harness> {
  const harness = await start(opts);
  harness.poll();
  await settle();
  harness.frame();
  return harness;
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // It never touches the socket, so it must not ask for it. A permission an addon
  // does not use is one every player is asked to grant for nothing.
  it('asks for no network permission', () => {
    expect(manifest().permissions).toEqual(['world.read', 'ui', 'sound', 'keys', 'storage']);
  });

  // The declaration is the smallest minor carrying every member this addon reads. Four are
  // minor 4: `ui.list` for both the strip and the pins, `fmt.titleCase` for a party row's
  // derived name, `fmt.duration` for the countdown in a square's corner, and a frame's
  // `toggleKey`. The rest are minor 2: `woc.data`, `woc.onFrame`, `world.harmful`,
  // `world.dispellable`, `world.match` and the unit form of `ui.anchor3d`. `ui.units` is the
  // one at 6, which is what solves the box back for a square under the caption band. A
  // manifest claiming less than it calls loads against a loader that has none of them and
  // throws.
  it('declares the minor its reads arrived in', () => {
    expect(manifest().apiMinor).toBe(6);
  });

  it('declares the rules table it reads', () => {
    expect(manifest().data).toEqual(['rules.json']);
  });
});

// The shipped table, checked as a table rather than through the engine: a starter rule that no
// longer parses is silently one fewer alert, which is a green run with less in it.
describe('the shipped starter rules', () => {
  function shipped(): RuleSpec[] {
    return (SHIPPED as { rules: RuleSpec[] }).rules;
  }

  it('parses every row it ships', async () => {
    const h = await run({ rules: RULES_TEXT, cls: 'warlock' });

    expect(h.shared.logs.tail(h.fqid).filter((line) => line.level === 'warn')).toEqual([]);
  });

  it('gives every row a unique id', () => {
    const ids = shipped().map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // A rule that can match nothing is a rule that fires on everything on its unit.
  it('gives every row something to match on', () => {
    const loose = shipped().filter(
      (rule) => rule.auraId === undefined && rule.kind === undefined && rule.harmful === undefined,
    );

    expect(loose).toEqual([]);
  });

  it('draws only the rows for the class in play, plus the ones for every class', async () => {
    const h = await run({ rules: RULES_TEXT, cls: 'warlock' });

    expect(h.paneRules().filter((id) => id.startsWith('warrior-'))).toEqual([]);
    expect(h.paneRules()).toContain('warlock-corruption');
    expect(h.paneRules()).toContain('stunned');
  });
});

// The decision this addon exists for.
describe('whether a rule fires', () => {
  const Gained: RuleSpec = {
    id: 'proc',
    label: 'Battle Trance',
    unit: 'player',
    auraId: 'battle_trance',
    on: 'gained',
  };

  it('fires while the effect it names is there', async () => {
    const h = await run({ rules: rulesFile([Gained]) });

    h.afflict(ME, TRANCE);
    h.frame();

    expect(h.drawn()).toEqual([key('proc', 'player', 'battle_trance')]);
  });

  it('stays quiet for an effect its rule does not name', async () => {
    const h = await run({ rules: rulesFile([Gained]) });

    h.afflict(ME, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('clears when the effect goes', async () => {
    const h = await run({ rules: rulesFile([Gained]) });
    h.afflict(ME, TRANCE);
    h.frame();

    h.cure(ME, 'battle_trance');
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // A rule watching for something to GO cannot see it in the reading that follows,
  // so the fade is the previous reading minus this one.
  it('fires the other way round for a rule that watches a fade', async () => {
    const h = await run({
      rules: rulesFile([{ ...Gained, id: 'gone', on: 'faded' }]),
    });
    h.afflict(ME, TRANCE);
    h.frame();
    expect(h.drawn()).toEqual([]);

    h.cure(ME, 'battle_trance');
    h.frame();

    expect(h.drawn()).toEqual([key('gone', 'player', 'battle_trance')]);
  });

  it('takes a faded alert down again once it has had its time', async () => {
    const h = await run({ rules: rulesFile([{ ...Gained, id: 'gone', on: 'faded' }]) });
    h.afflict(ME, TRANCE);
    h.frame();
    h.cure(ME, 'battle_trance');
    h.frame();

    h.advance(5000);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });
});

// The one field a dot tracker cannot skip. Two players carrying the same debuff on one target
// is the case the published `AuraQuery.mine` documentation calls out: without it a display
// shows the other player's full timer while the player's own copy quietly expires.
describe('your own copy of an effect two people applied', () => {
  const MineExpiring: RuleSpec = {
    id: 'dot',
    label: 'Blackrot fading',
    unit: 'target',
    auraId: 'corruption',
    mine: true,
    on: 'expiring',
    threshold: 5,
  };

  async function twoCasters(rule: RuleSpec): Promise<Harness> {
    const h = await run({ rules: rulesFile([rule]) });
    h.select(FOE);
    h.afflict(FOE, { ...CORRUPTION, sourceId: ALLY, remaining: 18 });
    h.afflict(FOE, { ...CORRUPTION, sourceId: ME, remaining: 3 });
    h.frame();
    return h;
  }

  it('fires on yours running out while somebody else keeps theirs up', async () => {
    const h = await twoCasters(MineExpiring);

    expect(h.drawn()).toEqual([key('dot', 'target', 'corruption', ME)]);
    expect(h.valueOf(key('dot', 'target', 'corruption', ME))).toBe('3');
  });

  // The clause itself, on the condition that cannot hide it. Both copies are up, so an engine
  // that drops `mine` from the query draws the other player's as well.
  it('watches only your copy when the rule asks for yours', async () => {
    const h = await twoCasters({ ...MineExpiring, on: 'gained', threshold: undefined });

    expect(h.drawn()).toEqual([key('dot', 'target', 'corruption', ME)]);
  });

  // Without `mine` the ally's copy matches too, and its timer is nowhere near the
  // threshold, so the strip carries a row that says the effect is fine.
  it('carries the other player copy as well when the rule does not ask for yours', async () => {
    const h = await twoCasters({ ...MineExpiring, mine: undefined, threshold: 20 });

    expect(h.drawn()).toHaveLength(2);
    expect(h.valueOf(key('dot', 'target', 'corruption', ALLY))).toBe('18');
  });
});

// A square is the whole display, so what is in it is the addon's answer to "what is this".
// Ability art exists for a player's kit and for nothing a mob casts, and the two cases below are
// the pair a version that resolved everything through `icon.ability` would pass on one of.
describe('the picture on a tile', () => {
  const Silenced: RuleSpec = {
    id: 'silenced',
    label: 'Silenced',
    unit: 'player',
    kind: 'silence',
    on: 'gained',
  };

  const MyDot: RuleSpec = {
    id: 'dot',
    label: 'Blackrot',
    unit: 'target',
    auraId: 'corruption',
    on: 'gained',
  };

  /** A mob's, so its id is in no class manifest and never will be. */
  const Shriek: Effect = {
    id: 'silence_gnoll',
    name: 'Silencing Shriek',
    kind: 'silence',
    remaining: 3,
  };

  const FromFoe = key('silenced', 'player', 'silence_gnoll', FOE);

  it('carries the portrait of the mob that applied it', async () => {
    const h = await run({ rules: rulesFile([Silenced]) });
    h.afflict(ME, { ...Shriek, sourceId: FOE });
    h.frame();

    expect(h.artOf(FromFoe)).toBe('/ui/mobs/gnoll.webp');
  });

  // A portrait answers a different question from an ability icon, so the square has to say which
  // it is drawing. Both routes, because a tile is art and a screen reader gets none of it.
  it('says whose face it is, in the tooltip and in the accessible name', async () => {
    const h = await run({ rules: rulesFile([Silenced]) });
    h.afflict(ME, { ...Shriek, sourceId: FOE });
    h.frame();

    expect(h.hover(FromFoe)).toContain('Pictured: Grimjaw');
    expect(h.labelOf(FromFoe)).toContain('from Grimjaw');
  });

  it('carries the ability art for an effect you applied, and pictures nobody', async () => {
    const h = await run({ rules: rulesFile([MyDot]) });
    h.select(FOE);
    h.afflict(FOE, { ...CORRUPTION, sourceId: ME });
    h.frame();

    const mine = key('dot', 'target', 'corruption', ME);
    expect(h.artOf(mine)).toBe('/ui/skills/warlock/corruption.webp');
    expect(h.hover(mine)).not.toContain('Pictured');
  });

  // The caster is the only route to a picture, so a source out of interest scope has none.
  it('draws no picture for a caster no entity answers to', async () => {
    const h = await run({ rules: rulesFile([Silenced]) });
    h.afflict(ME, Shriek);
    h.frame();

    expect(h.artOf(key('silenced', 'player', 'silence_gnoll'))).toBe('');
  });
});

describe('a rule that watches for an effect running out', () => {
  const Expiring: RuleSpec = {
    id: 'fading',
    label: 'Blackrot fading',
    unit: 'target',
    auraId: 'corruption',
    on: 'expiring',
    threshold: 5,
  };

  it('stays quiet above the threshold and fires at it', async () => {
    const h = await run({ rules: rulesFile([Expiring]) });
    h.select(FOE);
    h.afflict(FOE, { ...CORRUPTION, remaining: 6 });
    h.frame();
    expect(h.drawn()).toEqual([]);

    h.tickTo(FOE, 'corruption', 5);
    h.frame();

    expect(h.drawn()).toEqual([key('fading', 'target', 'corruption')]);
  });

  it('takes the threshold from the setting when the rule names none', async () => {
    const h = await run({
      rules: rulesFile([{ ...Expiring, threshold: undefined }]),
      settings: { 'expiring-seconds': 10 },
    });
    h.select(FOE);

    h.afflict(FOE, { ...CORRUPTION, remaining: 9 });
    h.frame();

    expect(h.drawn()).toEqual([key('fading', 'target', 'corruption')]);
  });

  it('runs no expiring rule at all when the player switched them off', async () => {
    const h = await run({
      rules: rulesFile([Expiring]),
      settings: { expiring: false },
    });
    h.select(FOE);

    h.afflict(FOE, { ...CORRUPTION, remaining: 1 });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });
});

// A stack landing is a refresh of the aura already there, so nothing arrives and nothing
// leaves. It is invisible to the entity set and, on your own auras, to `world.on('auras')` as
// well, which is why the engine reads on the frame tick.
describe('a rule that watches a stack count', () => {
  const Ramping: RuleSpec = {
    id: 'ramp',
    label: 'Stacking up',
    unit: 'player',
    auraId: 'corruption',
    on: 'stacks',
    threshold: 3,
  };

  it('stays quiet under the threshold and fires at it', async () => {
    const h = await run({ rules: rulesFile([Ramping]) });
    h.afflict(ME, { ...CORRUPTION, stacks: 2 });
    h.frame();
    expect(h.drawn()).toEqual([]);

    h.stackTo(ME, 'corruption', 3);
    h.frame();

    expect(h.drawn()).toEqual([key('ramp', 'player', 'corruption')]);
    expect(h.countOf(key('ramp', 'player', 'corruption'))).toBe('3');
  });
});

// Polarity is the loader's predicate, never arithmetic here. A root's magnitude is 0 and a
// dot's is a positive figure per tick, so both look identical to a heal over time by sign; and
// a mob sapping attack power reuses the ordinary buff kind with a negative magnitude.
describe('a rule that filters on polarity', () => {
  const Harmful: RuleSpec = {
    id: 'bad',
    label: 'Something harmful',
    unit: 'player',
    harmful: true,
    on: 'gained',
  };

  it('fires on a root, which carries no negative magnitude at all', async () => {
    const h = await run({ rules: rulesFile([Harmful]) });

    h.afflict(ME, { ...GRAVEBIND, id: 'entangle', kind: 'root', value: 0 });
    h.frame();

    expect(h.drawn()).toEqual([key('bad', 'player', 'entangle')]);
  });

  it('fires on a drain that reuses a buff kind with a negative magnitude', async () => {
    const h = await run({ rules: rulesFile([Harmful]) });

    h.afflict(ME, { ...BLESSING, id: 'sap', kind: 'buff_ap', value: DRAIN });
    h.frame();

    expect(h.drawn()).toEqual([key('bad', 'player', 'sap')]);
  });

  it('leaves an ordinary benefit alone', async () => {
    const h = await run({ rules: rulesFile([Harmful]) });

    h.afflict(ME, BLESSING);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('turns round for a rule asking for benefits', async () => {
    const h = await run({ rules: rulesFile([{ ...Harmful, harmful: false }]) });

    h.afflict(ME, BLESSING);
    h.afflict(ME, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([key('bad', 'player', 'blessing')]);
  });
});

// `unbreakableControl` is absent on almost every aura in the game, so an engine that never
// reads it looks correct on every ordinary effect and is wrong on exactly the ones a player
// would be reaching for a cooldown during.
describe('a rule that filters on removability', () => {
  const Removable: RuleSpec = {
    id: 'dispel',
    label: 'Removable control',
    unit: 'player',
    kind: 'stun',
    removable: true,
    on: 'gained',
  };

  it('fires on an ordinary stun', async () => {
    const h = await run({ rules: rulesFile([Removable]) });

    h.afflict(ME, GRAVEBIND);
    h.frame();

    expect(h.drawn()).toEqual([key('dispel', 'player', 'gravebind')]);
  });

  it('stays quiet on the same stun when the encounter owns it', async () => {
    const h = await run({ rules: rulesFile([Removable]) });

    h.afflict(ME, { ...GRAVEBIND, unbreakableControl: true });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('stays quiet on a physical effect, which no dispel reaches', async () => {
    const h = await run({ rules: rulesFile([Removable]) });

    h.afflict(ME, { ...GRAVEBIND, id: 'hamstring', school: 'physical' });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // The direction is per unit: on a hostile one the removable effect is the BENEFIT.
  it('turns round on a hostile target', async () => {
    const h = await run({
      rules: rulesFile([
        { ...Removable, id: 'purge', unit: 'target', kind: undefined, harmful: false },
      ]),
    });
    h.select(FOE);

    h.afflict(FOE, BLESSING);
    h.frame();

    expect(h.drawn()).toEqual([key('purge', 'target', 'blessing')]);
  });
});

// A party row reaches a member on the far side of the map where an entity does not, and it
// pays for that reach by carrying almost nothing. Each refusal below is a clause that would
// otherwise be answered from a field the row does not have.
describe('a rule over the party rows', () => {
  const OverParty: RuleSpec = {
    id: 'group',
    label: 'Something harmful in the group',
    unit: 'party',
    harmful: true,
    on: 'gained',
  };

  function far(auraId: string): string {
    return key('group', `party:${String(FAR)}`, auraId, 0);
  }

  it('reads a member who has a row and no entity at all', async () => {
    const h = await run({ rules: rulesFile([OverParty]) });

    h.afflict(FAR, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([far('corruption')]);
  });

  // A row carries no source, so "only mine" cannot be asked. Dropping it silently
  // would mean a rule that reads as scoped and is not.
  it('drops "only mine" rather than answering it, and says so', async () => {
    const h = await run({ rules: rulesFile([{ ...OverParty, mine: true }]) });
    h.afflict(FAR, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([far('corruption')]);
    expect(h.hover(far('corruption'))).toContain('"Only mine" was dropped');
  });

  // A row carries no school and no `unbreakableControl`, which are the two clauses
  // whose absence costs a player a global cooldown.
  it('refuses a removability rule outright rather than guessing at one', async () => {
    const h = await run({ rules: rulesFile([{ ...OverParty, removable: true }]) });

    h.afflict(FAR, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // A threshold of one, because that is the only threshold that tells a refusal from an assumed
  // single stack: at two or more, "the row says nothing" and "the row says one" give the same
  // answer.
  it('refuses a stacks rule, because a row carries no stack count', async () => {
    const h = await run({
      rules: rulesFile([{ ...OverParty, on: 'stacks', threshold: 1, harmful: true }]),
    });

    h.afflict(FAR, { ...CORRUPTION, stacks: 5 });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  // No duration on a row, so there is nothing to sweep against. A full square plus
  // the line saying so beats an empty one, which reads as already expired.
  it('draws a full square and names the reading as a row', async () => {
    const h = await run({ rules: rulesFile([OverParty]) });

    h.afflict(FAR, CORRUPTION);
    h.frame();

    expect(h.sweepOf(far('corruption'))).toBe('0.00%');
    expect(h.hover(far('corruption'))).toContain('Read off a party row');
  });

  // A row carries no name either, so the label is derived from the id and the tooltip says it
  // was. `world.abilities` is deliberately not consulted: it would answer for the handful in
  // your own kit and leave the rest guessed.
  it('labels a row from its id and marks the label as derived', async () => {
    const h = await run({ rules: rulesFile([OverParty]) });

    h.afflict(FAR, { ...CORRUPTION, id: 'shadow_word_pain' });
    h.frame();

    expect(h.labelOf(far('shadow_word_pain'))).toContain('Shadow Word Pain');
    expect(h.hover(far('shadow_word_pain'))).toContain('not read from the wire');
  });
});

// The second placement the entry asks for: the alert drawn over the unit carrying
// the effect rather than on a strip in the middle of the screen.
describe('drawing an alert over the unit', () => {
  const OnMe: RuleSpec = {
    id: 'proc',
    label: 'Battle Trance',
    unit: 'player',
    auraId: 'battle_trance',
    on: 'gained',
  };

  it('puts the tile in a world anchor rather than on the strip', async () => {
    const h = await run({ rules: rulesFile([OnMe]), settings: { placement: 'unit' } });

    h.afflict(ME, TRANCE);
    h.frame();

    const cell = document.querySelector('[data-alert]');
    expect(cell?.parentElement?.classList.contains('woc-ew-pin')).toBe(true);
    expect(document.querySelector('.woc-ew-list [data-alert]')).toBeNull();
  });

  // A party row has no entity, so there is no model for an anchor to follow. That is
  // a limit of the reading rather than a choice, and the alert stays on the strip.
  it('leaves a party row on the strip, because it has no unit to sit over', async () => {
    const h = await run({
      rules: rulesFile([
        { id: 'group', label: 'Harmful in the group', unit: 'party', harmful: true, on: 'gained' },
      ]),
      settings: { placement: 'unit' },
    });

    h.afflict(FAR, CORRUPTION);
    h.frame();

    expect(document.querySelector('.woc-ew-list [data-alert]')).not.toBeNull();
    expect(document.querySelectorAll('.woc-ew-pin')).toHaveLength(0);
  });

  it('takes the anchor down again when the alert goes', async () => {
    const h = await run({ rules: rulesFile([OnMe]), settings: { placement: 'unit' } });
    h.afflict(ME, TRANCE);
    h.frame();

    h.cure(ME, 'battle_trance');
    h.frame();

    expect(document.querySelectorAll('.woc-ew-pin')).toHaveLength(0);
  });
});

describe('a rule scoped to a bout', () => {
  const InBout: RuleSpec = {
    id: 'arena',
    label: 'Target untouchable',
    unit: 'target',
    kind: 'stasis',
    on: 'gained',
    bout: true,
  };

  it('stays quiet out in the world', async () => {
    const h = await run({ rules: rulesFile([InBout]) });
    h.select(FOE);

    h.afflict(FOE, { ...GRAVEBIND, id: 'ice_block', kind: 'stasis' });
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('fires inside one', async () => {
    const h = await run({ rules: rulesFile([InBout]), bout: true });
    h.select(FOE);

    h.afflict(FOE, { ...GRAVEBIND, id: 'ice_block', kind: 'stasis' });
    h.frame();

    expect(h.drawn()).toEqual([key('arena', 'target', 'ice_block')]);
  });
});

// The noise. Everything already up when the engine starts is not news, and the same
// alert must not chime again for continuing to be true.
describe('the cue and the banner', () => {
  const Loud: RuleSpec = {
    id: 'loud',
    label: 'Stunned',
    unit: 'player',
    kind: 'stun',
    on: 'gained',
    cue: 'ui_error',
    banner: true,
  };

  it('sounds once when the alert arrives', async () => {
    const h = await run({ rules: rulesFile([Loud]) });

    h.afflict(ME, GRAVEBIND);
    h.frame();
    h.frame();

    expect(h.played()).toEqual(['ui_error']);
    expect(h.banner()).toBe('Stunned');
  });

  // The first reading of a live world is everything already on the player. Without the priming
  // pass, an addon enabled mid-fight opens with a chime and a banner per effect already up.
  it('says nothing about what was already up when it started', async () => {
    const h = await start({ rules: rulesFile([Loud]) });
    h.afflict(ME, GRAVEBIND);
    h.poll();
    await settle();

    h.frame();

    expect(h.played()).toEqual([]);
    expect(h.banner()).toBe('');
  });

  it('honours the volume the player set', async () => {
    const volumes: Array<number | undefined> = [];
    const h = await run({ rules: rulesFile([Loud]), settings: { volume: 0.25 } });
    h.shared.sound.play = (_cue: string, opts?: { volume?: number }) => {
      volumes.push(opts?.volume);
    };

    h.afflict(ME, GRAVEBIND);
    h.frame();

    expect(volumes).toEqual([0.25]);
  });
});

describe('what it publishes on the bus', () => {
  const Gained: RuleSpec = {
    id: 'proc',
    label: 'Battle Trance',
    unit: 'player',
    auraId: 'battle_trance',
    on: 'gained',
  };

  it('says when an alert arrives and when it goes', async () => {
    const h = await run({ rules: rulesFile([Gained]) });
    h.afflict(ME, TRANCE);
    h.frame();

    h.cure(ME, 'battle_trance');
    h.frame();

    expect(h.publishedRules()).toEqual([
      { ruleId: 'proc', unit: 'player', auraId: 'battle_trance', state: 'active' },
      { ruleId: 'proc', unit: 'player', auraId: 'battle_trance', state: 'cleared' },
    ]);
  });
});

// A budget nobody can see is a budget that lies: an eight-effect pull drawn as six
// tiles reads as six effects.
describe('the tile budget', () => {
  const AnyHarm: RuleSpec = {
    id: 'harm',
    label: 'Harmful',
    unit: 'player',
    harmful: true,
    on: 'gained',
  };

  it('says how many it is not showing', async () => {
    const h = await run({ rules: rulesFile([AnyHarm]), settings: { 'max-tiles': 1 } });

    h.afflict(ME, CORRUPTION);
    h.afflict(ME, { ...GRAVEBIND, id: 'entangle', kind: 'root' });
    h.frame();

    expect(h.drawn()).toHaveLength(1);
    expect(h.overflow()).toBe('+1 more');
  });

  it('says nothing when everything fits', async () => {
    const h = await run({ rules: rulesFile([AnyHarm]) });

    h.afflict(ME, CORRUPTION);
    h.frame();

    expect(h.overflow()).toBe('');
  });
});

// A table nothing validated is a table that is right only until somebody edits it.
describe('reading the rules file', () => {
  const Good: RuleSpec = {
    id: 'proc',
    label: 'Battle Trance',
    unit: 'player',
    auraId: 'battle_trance',
    on: 'gained',
  };

  it('drops a row that is not a rule and keeps the rest', async () => {
    const bad = JSON.stringify({
      format: 'emberwatch-rules',
      version: 1,
      rules: [{ id: 'broken' }, Good],
    });
    const h = await run({ rules: bad });

    h.afflict(ME, TRANCE);
    h.frame();

    expect(h.drawn()).toEqual([key('proc', 'player', 'battle_trance')]);
  });

  // A rule that can match nothing would fire on every effect on its unit, which is
  // the loudest possible failure for a file somebody hand-edited.
  it('drops a row with nothing to match on', async () => {
    const loose = rulesFile([{ id: 'loose', label: 'Loose', unit: 'player', on: 'gained' }]);
    const h = await run({ rules: loose });

    h.afflict(ME, CORRUPTION);
    h.frame();

    expect(h.drawn()).toEqual([]);
  });

  it('keeps running with no starter table at all', async () => {
    const h = await run({ rules: null });

    h.afflict(ME, TRANCE);

    expect(() => h.frame()).not.toThrow();
    expect(h.drawn()).toEqual([]);
  });
});

// The player's own rows, which are the half of the rule set the addon writes.
describe('capturing a rule off your target', () => {
  const Combo = 'Alt+Shift+KeyE';

  it('writes the effect on your target down as a rule of your own', async () => {
    const storage = createFakeStorage();
    const h = await run({ storage });
    h.select(FOE);
    h.afflict(FOE, { ...CORRUPTION, sourceId: ME });
    h.frame();

    h.press(Combo);
    await settle();

    expect(await h.stored('rows')).toMatchObject([
      { auraId: 'corruption', mine: true, unit: 'target' },
    ]);
  });

  // Harmful before helpful, then the copy you applied, then longest remaining.
  it('picks the harmful effect over the benefit beside it', async () => {
    const storage = createFakeStorage();
    const h = await run({ storage });
    h.select(FOE);
    h.afflict(FOE, BLESSING);
    h.afflict(FOE, { ...CORRUPTION, sourceId: ME });
    h.frame();

    h.press(Combo);
    await settle();

    expect(await h.stored('rows')).toMatchObject([{ auraId: 'corruption' }]);
  });

  // `mine` is the one clause a captured rule cannot be asked for afterwards, so it
  // is stamped from whether the player actually applied the effect.
  it('leaves "only mine" off an effect somebody else applied', async () => {
    const storage = createFakeStorage();
    const h = await run({ storage });
    h.select(FOE);
    h.afflict(FOE, { ...CORRUPTION, sourceId: ALLY });
    h.frame();

    h.press(Combo);
    await settle();

    expect(await h.stored('rows')).toMatchObject([{ mine: false }]);
  });

  it('says so rather than writing nothing down when there is nothing to capture', async () => {
    const h = await run();
    h.select(null);

    h.press(Combo);
    await settle();

    expect(document.querySelector('.woc-toast')?.textContent ?? '').toContain(
      'Nothing on your target',
    );
  });

  it('starts firing the captured rule without a reload', async () => {
    const h = await run();
    h.select(FOE);
    h.afflict(FOE, { ...CORRUPTION, sourceId: ME, remaining: 2 });
    h.frame();

    h.press(Combo);
    await settle();
    h.frame();

    expect(h.drawn()).toHaveLength(1);
  });
});

// The pane is where the two things this addon cannot answer are said. An engine that
// alerts on control and stays quiet about break-on-damage is read as denying it.
describe('the rules pane', () => {
  it('says what a party row cannot carry', async () => {
    const h = await run({ rules: RULES_TEXT });

    expect(h.paneText()).toContain('No source, so "only mine" is dropped');
  });

  it('says that how much a control will take before breaking is unanswerable', async () => {
    const h = await run({ rules: RULES_TEXT });

    expect(h.paneText()).toContain('how much damage a control will take before it breaks');
  });

  // An empty list reads as "nothing is being watched", which is one of two very
  // different facts.
  it('says why it is empty rather than drawing an empty list', async () => {
    const h = await run({ rules: rulesFile([]) });

    expect(h.paneRules()).toEqual([]);
    expect(h.paneText()).toContain('No rules for this character');
  });

  it('stops firing a rule the player switched off, and writes that down', async () => {
    const storage = createFakeStorage();
    const rule: RuleSpec = {
      id: 'proc',
      label: 'Battle Trance',
      unit: 'player',
      auraId: 'battle_trance',
      on: 'gained',
    };
    const h = await run({ rules: rulesFile([rule]), storage });
    const box = document.querySelector<HTMLInputElement>('[data-rule="proc"] input');

    box?.click();
    await settle();
    h.afflict(ME, TRANCE);
    h.frame();

    expect(h.drawn()).toEqual([]);
    expect(await h.stored('disabled')).toEqual(['proc']);
  });
});

describe('disabling it', () => {
  it('leaves no frame, no keybind, and no frame loop behind', async () => {
    const h = await run({ rules: RULES_TEXT });
    h.afflict(ME, GRAVEBIND);
    h.frame();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('[data-woc-frame="alerts"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-woc-frame="rules"]')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
    expect(() => h.frame()).not.toThrow();
  });
});
