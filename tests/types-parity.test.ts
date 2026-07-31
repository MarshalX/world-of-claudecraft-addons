// The public API surface against the implementation.
//
// `packages/types` is what addon authors compile against, and nothing links it
// to the runtime: it is hand-written declarations describing another file's
// behaviour. That is exactly the shape of thing that drifts silently, and it
// already had, twice at once: the published `keys.capture()` promised
// `Promise<string>` where the loader resolves null on a cancelled prompt, and
// `ui.alert()` promised `Promise<string>` where the loader resolves null when
// there is no cancel button. An author would have written code that never
// handled the case that actually happens.
//
// The assertions below are TYPE level: they cost nothing at runtime and fail
// `tsc --noEmit` the moment the two disagree. The `it()` around them exists so
// the suite reports that the check is present, not to do the checking.

import { describe, expect, it } from 'vitest';
import type { GameIdentity, WocApi } from '../loader/src/runtime/api/index.ts';
import type { KeysApi } from '../loader/src/runtime/api/keys.ts';
import type { NetApi } from '../loader/src/runtime/api/net.ts';
import type { SoundApi } from '../loader/src/runtime/api/sound.ts';
import type { AddonStorageApi } from '../loader/src/runtime/api/storage.ts';
import type { UiApi } from '../loader/src/runtime/api/ui.ts';
import type { WorldApi } from '../loader/src/runtime/api/world.ts';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import type { WorldKey } from '../loader/src/runtime/world/signature.ts';
import type { WorldValues } from '../loader/src/runtime/world/values.ts';
import type { GameInfo } from '../packages/types/addon.js';
import type { Entity as PublicEntity } from '../packages/types/entity.js';
import type { KeysApi as PublicKeysApi } from '../packages/types/keys.js';
import type { NetApi as PublicNetApi } from '../packages/types/net.js';
import type { SoundApi as PublicSoundApi } from '../packages/types/sound.js';
import type { StorageApi as PublicStorageApi } from '../packages/types/storage.js';
import type { UiApi as PublicUiApi } from '../packages/types/ui.js';
import type {
  WorldApi as PublicWorldApi,
  WorldKey as PublicWorldKey,
  WorldValues as PublicWorldValues,
} from '../packages/types/world.js';

/**
 * True only when every member of `From` satisfies `To`.
 *
 * Asserted in BOTH directions per surface. One direction alone would let the
 * published types promise something the loader does not implement, or hide
 * something it does.
 */
type Assignable<From, To> = [From] extends [To] ? true : false;

/** Each of these is a compile error the moment the two shapes disagree. */
const uiIsPublished: Assignable<UiApi, PublicUiApi> = true;
const publishedIsUi: Assignable<PublicUiApi, UiApi> = true;

/**
 * `net` was the one surface with no check at all, which is how its published
 * `onEvent` could have promised a typed payload the loader never narrowed. The
 * two event catalogues are written separately on purpose, so this is also what
 * proves they still describe the same records.
 */
const netIsPublished: Assignable<NetApi, PublicNetApi> = true;
const publishedIsNet: Assignable<PublicNetApi, NetApi> = true;

const soundIsPublished: Assignable<SoundApi, PublicSoundApi> = true;
const publishedIsSound: Assignable<PublicSoundApi, SoundApi> = true;

const keysIsPublished: Assignable<KeysApi, PublicKeysApi> = true;
const publishedIsKeys: Assignable<PublicKeysApi, KeysApi> = true;

const storageIsPublished: Assignable<AddonStorageApi, PublicStorageApi> = true;
const publishedIsStorage: Assignable<PublicStorageApi, AddonStorageApi> = true;

const gameIsPublished: Assignable<GameIdentity, GameInfo> = true;
const publishedIsGame: Assignable<GameInfo, GameIdentity> = true;

const worldIsPublished: Assignable<WorldApi, PublicWorldApi> = true;
const publishedIsWorld: Assignable<PublicWorldApi, WorldApi> = true;

/**
 * The world's own shapes, checked separately from the API that returns them.
 *
 * `WorldApi` compares structurally, so an entity field declared here and dropped
 * there would surface as one confusing error deep inside a map type. Comparing
 * the shapes directly names the thing that actually moved.
 *
 * These declarations are the one part of the published surface that describes
 * ANOTHER repository. Nothing at compile time can confirm the game still looks
 * like this; `loader/src/runtime/world/shape.ts` is what checks it against a
 * live game, and the hub reports drift once per session.
 */
const entityIsPublished: Assignable<Entity, PublicEntity> = true;
const publishedIsEntity: Assignable<PublicEntity, Entity> = true;
const valuesArePublished: Assignable<WorldValues, PublicWorldValues> = true;
const publishedAreValues: Assignable<PublicWorldValues, WorldValues> = true;

/**
 * The watchable keys against the runtime's own list.
 *
 * `signature.ts` owns the keys: it holds the array `world.on` validates against
 * and the capture logic behind each one. The published `WorldKey` derives from
 * `WorldValues` instead, so this is what stops a key being added to one and not
 * the other, which would typecheck everywhere and throw at the addon.
 */
const keysArePublished: Assignable<WorldKey, PublicWorldKey> = true;
const publishedAreKeys: Assignable<PublicWorldKey, WorldKey> = true;

/**
 * The whole object an addon receives satisfies each published facet.
 *
 * Catches a domain being dropped from the assembly, which the per-facet checks
 * above would not: they compare two type declarations, not what is handed over.
 */
const wocCarriesUi: Assignable<WocApi['ui'], PublicUiApi> = true;
const wocCarriesSound: Assignable<WocApi['sound'], PublicSoundApi> = true;
const wocCarriesKeys: Assignable<WocApi['keys'], PublicKeysApi> = true;
const wocCarriesStorage: Assignable<WocApi['storage'], PublicStorageApi> = true;
const wocCarriesWorld: Assignable<WocApi['world'], PublicWorldApi> = true;
const wocCarriesNet: Assignable<WocApi['net'], PublicNetApi> = true;

describe('the published types', () => {
  it('match the implementation in both directions', () => {
    expect([
      uiIsPublished,
      publishedIsUi,
      netIsPublished,
      publishedIsNet,
      soundIsPublished,
      publishedIsSound,
      keysIsPublished,
      publishedIsKeys,
      storageIsPublished,
      publishedIsStorage,
      gameIsPublished,
      publishedIsGame,
      worldIsPublished,
      publishedIsWorld,
    ]).not.toContain(false);
  });

  it('describe the world shapes and the keys that watch them', () => {
    expect([
      entityIsPublished,
      publishedIsEntity,
      valuesArePublished,
      publishedAreValues,
      keysArePublished,
      publishedAreKeys,
    ]).not.toContain(false);
  });

  it('describe every domain the assembled woc object carries', () => {
    expect([
      wocCarriesUi,
      wocCarriesSound,
      wocCarriesKeys,
      wocCarriesStorage,
      wocCarriesNet,
      wocCarriesWorld,
    ]).not.toContain(false);
  });
});
