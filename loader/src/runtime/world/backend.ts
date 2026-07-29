// Where world state is read from.
//
// Backend A reads __game.world, the same IWorld the game's own renderer and HUD
// consume, so it is already delta-merged and interest-pruned. It is the only
// backend built. Backend B, rebuilding state from snap frames, is the
// contingency if the __game hook ever goes away; addons written against this
// interface would not notice the swap, which is the point of having it.

import { fieldValue } from '../net/frames.ts';
import { readonlyMapView } from './readonly-map.ts';

const NO_ENTITIES: ReadonlyMap<number, unknown> = new Map<number, unknown>();

/**
 * The entity view, rebuilt only when the game swaps the map behind it.
 *
 * The watcher reads this every animation frame and an addon may read it far more
 * often, so building a fresh wrapper per access would allocate for nothing. The
 * game keeps one map for the life of a session, so the cache almost always hits.
 */
function entityMapReader(world: unknown): () => ReadonlyMap<number, unknown> {
  let source: unknown = null;
  let view: ReadonlyMap<number, unknown> = NO_ENTITIES;
  return () => {
    const entities = fieldValue(world, 'entities');
    if (!(entities instanceof Map)) {
      return NO_ENTITIES;
    }
    if (entities !== source) {
      source = entities;
      view = readonlyMapView<number, unknown>(entities);
    }
    return view;
  };
}

export interface WorldQuests {
  /** questId to QuestProgress, the game's live quest log. */
  readonly log: unknown;
  /** The ids of finished quests. */
  readonly done: unknown;
}

export interface WorldBackend {
  /** Which backend answered, so the manager's diagnostics can show it. */
  readonly kind: string;
  readonly player: unknown;
  readonly target: unknown;
  readonly entities: ReadonlyMap<number, unknown>;
  readonly party: unknown;
  readonly inventory: unknown;
  readonly quests: WorldQuests;
  readonly cooldowns: unknown;
  readonly auras: unknown;
  /** The real IWorld the game is running. */
  readonly raw: unknown;
}

/**
 * Read __game.world, or null when the hook does not carry one.
 *
 * Every member is a getter: the game mutates these objects in place, so reading
 * on access is what makes the facade live rather than a stale copy.
 */
export function createGameBackend(game: unknown): WorldBackend | null {
  const world = fieldValue(game, 'world');
  if (world === null) {
    return null;
  }
  const entities = entityMapReader(world);

  return {
    kind: 'game',

    get player(): unknown {
      return fieldValue(world, 'player');
    },

    get target(): unknown {
      const id = fieldValue(fieldValue(world, 'player'), 'targetId');
      if (typeof id !== 'number') {
        return null;
      }
      return entities().get(id) ?? null;
    },

    get entities(): ReadonlyMap<number, unknown> {
      return entities();
    },

    get party(): unknown {
      return fieldValue(world, 'partyInfo');
    },

    get inventory(): unknown {
      return fieldValue(world, 'inventory');
    },

    get quests(): WorldQuests {
      return {
        log: fieldValue(world, 'questLog'),
        done: fieldValue(world, 'questsDone'),
      };
    },

    get cooldowns(): unknown {
      return fieldValue(fieldValue(world, 'player'), 'cooldowns');
    },

    get auras(): unknown {
      return fieldValue(fieldValue(world, 'player'), 'auras');
    },

    raw: world,
  };
}
