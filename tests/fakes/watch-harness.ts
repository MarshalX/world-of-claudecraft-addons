// A world watcher over a backend whose reads follow a mutable object, the way
// the real one follows the game's live state.
//
// The frame clock is manual: the sampler schedules itself, so a real one would
// make every assertion a race.

import {
  type AbilityIndex,
  createAbilityReader,
} from '../../loader/src/runtime/world/abilities.ts';
import type { WorldBackend } from '../../loader/src/runtime/world/backend.ts';
import {
  type CharacterInfo,
  type ProfessionInfo,
  readCharacter,
  readProfessions,
  readTalents,
  type TalentInfo,
} from '../../loader/src/runtime/world/character.ts';
import { type CombatState, readCombat } from '../../loader/src/runtime/world/combat.ts';
import { castsOf, type EntityCast, type Hazard } from '../../loader/src/runtime/world/derived.ts';
import { type EncounterInfo, readEncounter } from '../../loader/src/runtime/world/encounter.ts';
import type { Aura, Entity, WorldQuests } from '../../loader/src/runtime/world/game-types.ts';
import type { CorpseView } from '../../loader/src/runtime/world/ground.ts';
import { type GroupInfo, readGroup } from '../../loader/src/runtime/world/group.ts';
import { UNKNOWN } from '../../loader/src/runtime/world/proximity.ts';
import { type Reaction, reactionOf } from '../../loader/src/runtime/world/reaction.ts';
import { readThreat, type ThreatTable } from '../../loader/src/runtime/world/threat.ts';
import { createWorldWatcher, type WorldWatcher } from '../../loader/src/runtime/world/watch.ts';
import { PLAYER_ENTITY } from './frames.ts';

/** Roughly one animation frame at 60 Hz, which is what the sampler rides. */
const FRAME_MS = 16.7;

export interface LiveWorld {
  player: Record<string, unknown>;
  entities: Map<number, unknown>;
  hazards: Hazard[] | null;
  /** The minimap's zone label, which the loader reads from the DOM in the real one. */
  zone: string | null;
  /** The sim clock, which the loader tracks off the snapshot head in the real one. */
  simNow: number | null;
  markers: Map<number, number> | null;
  /** The game's resolved ability list, in its own shape: entries carrying a `def`. */
  known: unknown[];
}

export interface WatchHarness {
  watcher: WorldWatcher;
  live: LiveWorld;
  errors: unknown[];
  /** Frames currently scheduled. Zero means the sampler is not running. */
  frames: () => number;
  /**
   * Run the scheduled frame, having moved the clock on by one.
   *
   * The clock moves because a real animation frame carries a new timestamp, and the
   * sampler has a floor between samples: a `frame()` that did not advance time would
   * model a browser that fires rAF twice in the same instant, which is a thing no
   * browser does and would make the floor untestable.
   */
  frame: () => void;
  /** Stands in for the game arriving or never having arrived. */
  setAttached: (on: boolean) => void;
}

export function watchHarness(): WatchHarness {
  const live: LiveWorld = {
    player: { ...PLAYER_ENTITY } as Record<string, unknown>,
    entities: new Map<number, unknown>(),
    hazards: null,
    zone: null,
    simNow: null,
    markers: null,
    known: [],
  };
  const readAbilities = createAbilityReader();
  let attached = true;
  const errors: unknown[] = [];
  const scheduled = new Map<number, () => void>();
  let nextFrame = 1;
  let clock = 0;

  // `live` stays loose so a test can move one field at a time, including into a
  // shape the game would never produce, which is half of what these suites are
  // for. The backend asserts at its own boundary exactly as the real one does.
  const backend = {
    kind: 'test',
    get player(): Entity | null {
      return live.player as unknown as Entity;
    },
    get target(): Entity | null {
      return null;
    },
    get entities(): ReadonlyMap<number, Entity> {
      return live.entities as ReadonlyMap<number, Entity>;
    },
    get party(): null {
      return null;
    },
    get inventory(): null {
      return null;
    },
    get equipment(): null {
      return null;
    },
    get bags(): null {
      return null;
    },
    get bagCapacity(): null {
      return null;
    },
    get copper(): null {
      return null;
    },
    get zone(): string | null {
      return live.zone;
    },
    // Through the real readers, like `abilities` and `combat`: a test that moves
    // a progression field on the fixture has to see what an addon would.
    get character(): CharacterInfo | null {
      return readCharacter(live);
    },
    get talents(): TalentInfo | null {
      return readTalents(live);
    },
    get professions(): ProfessionInfo | null {
      return readProfessions(live);
    },
    get group(): GroupInfo | null {
      return readGroup(live, live.simNow);
    },
    get encounter(): EncounterInfo | null {
      return readEncounter(live);
    },
    threat: (entityId: number): ThreatTable =>
      readThreat(
        (live.entities.get(entityId) as Entity | undefined) ?? null,
        (live.player as { id?: number }).id ?? null,
      ),
    get quests(): WorldQuests {
      return { log: null, done: null };
    },
    get cooldowns(): null {
      return null;
    },
    get auras(): readonly Aura[] | null {
      return null;
    },
    // Derived from `live.entities` through the real function, not stubbed: a test
    // that moves a cast field on a fixture entity has to see what an addon would.
    get casts(): ReadonlyMap<number, EntityCast> {
      return castsOf(live.entities as ReadonlyMap<number, Entity>);
    },
    get targetAuras(): readonly Aura[] | null {
      return null;
    },
    get hazards(): readonly Hazard[] | null {
      return live.hazards;
    },
    get markers(): ReadonlyMap<number, number> | null {
      return live.markers;
    },
    // Through the real reader, like `casts` and for the same reason: a test that
    // moves the fixture's known list has to see what an addon would, including
    // the memoization, since that is the part with behaviour worth regressing on.
    get abilities(): AbilityIndex {
      return readAbilities(live);
    },
    // Read through the real rule, so a test that puts a hate table on a fixture
    // mob sees the same answer an addon would. No party and no damage clock, so
    // what this exercises is the entity branches, which are the ones a watcher
    // test can actually move.
    get combat(): CombatState {
      return readCombat({
        player: live.player as unknown as Entity,
        party: null,
        entities: live.entities as ReadonlyMap<number, Entity>,
        match: null,
        lastDamageAt: null,
        now: 0,
      });
    },
    // The keys this harness carries no fixture for. Plain values rather than
    // getters because nothing here moves: a suite that wants one of them moving
    // should give `live` a field for it and turn the entry into a getter, the
    // way `hazards` and `markers` already are.
    equipmentInstances: null,
    characterKey: null,
    spectating: null,
    match: null,
    arena: null,
    battleground: null,
    finder: null,
    finderBoard: null,
    deathZones: null,
    corpses: new Map<number, CorpseView>(),
    nodeCooldowns: null,
    corpse: null,
    corpseLoot: (): CorpseView | null => null,
    // Through the real rule for the reason `combat` is: a suite that puts a pet
    // or a bout in `live` sees the answer an addon would. No bout here, so every
    // player reads friendly, which is what a world with no match is.
    reaction: (entityId: number): Reaction | null => {
      const roster = live.entities as ReadonlyMap<number, Entity>;
      const entity = roster.get(entityId);
      if (entity === undefined) {
        return null;
      }
      return reactionOf(entity, roster, null);
    },
    market: UNKNOWN,
    marketCollectPending: null,
    mail: UNKNOWN,
    mailUnread: null,
    bank: UNKNOWN,
    buyback: null,
    recipes: [],
    stations: [],
    civicServices: [],
    raw: live,
  } satisfies WorldBackend;

  const readBackend = (): WorldBackend | null => {
    if (attached) {
      return backend;
    }
    return null;
  };

  const watcher = createWorldWatcher({
    backend: readBackend,
    schedule: (frame) => {
      const id = nextFrame;
      nextFrame += 1;
      scheduled.set(id, frame);
      return id;
    },
    cancel: (id) => {
      scheduled.delete(id);
    },
    now: () => clock,
    onError: (_key, err) => errors.push(err),
  });

  return {
    watcher,
    live,
    errors,
    frames: () => scheduled.size,
    frame: () => {
      clock += FRAME_MS;
      for (const run of [...scheduled.values()]) {
        scheduled.clear();
        run();
      }
    },
    setAttached: (on) => {
      attached = on;
    },
  };
}
