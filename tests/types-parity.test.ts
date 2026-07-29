// The public API surface against the implementation.
//
// `packages/types` is what addon authors compile against, and nothing links it
// to the runtime: it is hand-written declarations describing another file's
// behaviour. That is exactly the shape of thing that drifts silently, and it
// already had. When M4 landed, the published `keys.capture()` promised
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
import type { SoundApi } from '../loader/src/runtime/api/sound.ts';
import type { AddonStorageApi } from '../loader/src/runtime/api/storage.ts';
import type { UiApi } from '../loader/src/runtime/api/ui.ts';
import type { GameInfo } from '../packages/types/addon.js';
import type { KeysApi as PublicKeysApi } from '../packages/types/keys.js';
import type { SoundApi as PublicSoundApi } from '../packages/types/sound.js';
import type { StorageApi as PublicStorageApi } from '../packages/types/storage.js';
import type { UiApi as PublicUiApi } from '../packages/types/ui.js';

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

const soundIsPublished: Assignable<SoundApi, PublicSoundApi> = true;
const publishedIsSound: Assignable<PublicSoundApi, SoundApi> = true;

const keysIsPublished: Assignable<KeysApi, PublicKeysApi> = true;
const publishedIsKeys: Assignable<PublicKeysApi, KeysApi> = true;

const storageIsPublished: Assignable<AddonStorageApi, PublicStorageApi> = true;
const publishedIsStorage: Assignable<PublicStorageApi, AddonStorageApi> = true;

const gameIsPublished: Assignable<GameIdentity, GameInfo> = true;
const publishedIsGame: Assignable<GameInfo, GameIdentity> = true;

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

describe('the published types', () => {
  it('match the implementation in both directions', () => {
    expect([
      uiIsPublished,
      publishedIsUi,
      soundIsPublished,
      publishedIsSound,
      keysIsPublished,
      publishedIsKeys,
      storageIsPublished,
      publishedIsStorage,
      gameIsPublished,
      publishedIsGame,
    ]).not.toContain(false);
  });

  it('describe every domain the assembled woc object carries', () => {
    expect([wocCarriesUi, wocCarriesSound, wocCarriesKeys, wocCarriesStorage]).not.toContain(false);
  });
});
