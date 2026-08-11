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
import type { BusApi } from '../loader/src/runtime/api/bus.ts';
import type { FmtApi } from '../loader/src/runtime/api/fmt.ts';
import type { AddonIdentity, GameIdentity, WocApi } from '../loader/src/runtime/api/index.ts';
import type { KeysApi } from '../loader/src/runtime/api/keys.ts';
import type { NetApi } from '../loader/src/runtime/api/net.ts';
import type { SoundApi } from '../loader/src/runtime/api/sound.ts';
import type { AddonStorageApi } from '../loader/src/runtime/api/storage.ts';
import type { UiApi } from '../loader/src/runtime/api/ui.ts';
import type { WorldApi } from '../loader/src/runtime/api/world.ts';
import type { EventPayloads } from '../loader/src/runtime/net/events.ts';
import type { ProfessionInfo, ToolEffectSlot } from '../loader/src/runtime/world/character.ts';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import type { WorldKey } from '../loader/src/runtime/world/signature.ts';
import type { WorldValues } from '../loader/src/runtime/world/values.ts';
import type { AddonInfo, GameInfo } from '../packages/types/addon.js';
import type { BusApi as PublicBusApi } from '../packages/types/bus.js';
import type {
  ProfessionInfo as PublicProfessionInfo,
  ToolEffectSlot as PublicToolEffectSlot,
} from '../packages/types/character.js';
import type { Entity as PublicEntity } from '../packages/types/entity.js';
import type { EventPayloads as PublicEventPayloads } from '../packages/types/events.js';
import type { FmtApi as PublicFmtApi } from '../packages/types/fmt.js';
import type { WocApi as PublicWocApi } from '../packages/types/index.js';
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

/**
 * Which field NAMES a record carries, which assignability alone cannot compare.
 *
 * Two-way `Assignable` is blind to an OPTIONAL field present on one side only: the
 * extra field leaves the record assignable in both directions, so a field added to
 * one catalogue and forgotten in the other typechecks clean. Measured rather than
 * assumed, on the 0.34.0 pass that added these fields: deleting `effectDepleted`
 * from the published `gatherResult`, and `abilityId` from the published `damage`,
 * each left `tsc --noEmit` green while the loader still declared them. Comparing
 * key sets is what sees it, and it matters because every field the game has added
 * to an existing event so far has arrived optional.
 */
type SameFields<A, B> = [keyof A, keyof B] extends [keyof B, keyof A] ? true : false;

/** The kinds whose two declarations disagree about which fields exist. */
type EventFieldDrift = {
  [K in keyof EventPayloads]: K extends keyof PublicEventPayloads
    ? SameFields<EventPayloads[K], PublicEventPayloads[K]> extends true
      ? never
      : K
    : K;
}[keyof EventPayloads];

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

/**
 * The event catalogues field by field, which the two checks above do not reach.
 *
 * They compare the catalogues only through `onEvent`, which is enough for a kind
 * appearing on one side and for a field whose TYPE moved (dropping `'evade'` from
 * the published `DamageKind` fails `netIsPublished`), and is not enough for a
 * field being added to one side alone. Both halves are pinned here: the kind sets
 * against each other, then every record's fields.
 */
const kindsArePublished: Assignable<keyof EventPayloads, keyof PublicEventPayloads> = true;
const publishedAreKinds: Assignable<keyof PublicEventPayloads, keyof EventPayloads> = true;
const noEventFieldDrift: Assignable<EventFieldDrift, never> = true;

const soundIsPublished: Assignable<SoundApi, PublicSoundApi> = true;
const publishedIsSound: Assignable<PublicSoundApi, SoundApi> = true;

const keysIsPublished: Assignable<KeysApi, PublicKeysApi> = true;
const publishedIsKeys: Assignable<PublicKeysApi, KeysApi> = true;

const storageIsPublished: Assignable<AddonStorageApi, PublicStorageApi> = true;
const publishedIsStorage: Assignable<PublicStorageApi, AddonStorageApi> = true;

/**
 * `duration`'s style is a named `DurationStyle` here and an inline union in the
 * package, so a third style added to the alias would reach every internal caller
 * and reach an author as an option their editor refuses to offer.
 */
const fmtIsPublished: Assignable<FmtApi, PublicFmtApi> = true;
const publishedIsFmt: Assignable<PublicFmtApi, FmtApi> = true;

/**
 * The loader returns `Teardown` and the package `Unsubscribe`, both `() => void`,
 * so nothing structural connects the two subscriber signatures.
 */
const busIsPublished: Assignable<BusApi, PublicBusApi> = true;
const publishedIsBus: Assignable<PublicBusApi, BusApi> = true;

/**
 * Every field is `readonly` in the package and bare in the loader, which is right
 * on both sides and which assignability is blind to, hence the field comparison.
 */
const addonIsPublished: Assignable<AddonIdentity, AddonInfo> = true;
const publishedIsAddon: Assignable<AddonInfo, AddonIdentity> = true;
const addonFieldsAgree: SameFields<AddonIdentity, AddonInfo> = true;

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
/**
 * Every field of an entity is required today, so a one-sided drop already fails
 * one direction above. This is here for the day one arrives OPTIONAL, which is
 * how every field the game has added to an existing EVENT has arrived.
 */
const entityFieldsAgree: SameFields<Entity, PublicEntity> = true;
const valuesArePublished: Assignable<WorldValues, PublicWorldValues> = true;
const publishedAreValues: Assignable<PublicWorldValues, WorldValues> = true;

/**
 * The professions sheet and the tool-effect row it now carries.
 *
 * `WorldApi` reaches `ProfessionInfo` structurally and would report a drop as an
 * error deep inside a `world.professions` return type, naming the sheet rather
 * than the row. Both shapes are compared directly for the reason the entity is:
 * so the message names the thing that moved.
 */
const professionsArePublished: Assignable<ProfessionInfo, PublicProfessionInfo> = true;
const publishedAreProfessions: Assignable<PublicProfessionInfo, ProfessionInfo> = true;
const professionFieldsAgree: SameFields<ProfessionInfo, PublicProfessionInfo> = true;
const toolSlotIsPublished: Assignable<ToolEffectSlot, PublicToolEffectSlot> = true;
const publishedIsToolSlot: Assignable<PublicToolEffectSlot, ToolEffectSlot> = true;
const toolSlotFieldsAgree: SameFields<ToolEffectSlot, PublicToolEffectSlot> = true;

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
const wocCarriesFmt: Assignable<WocApi['fmt'], PublicFmtApi> = true;
const wocCarriesBus: Assignable<WocApi['bus'], PublicBusApi> = true;
const wocCarriesAddon: Assignable<WocApi['addon'], AddonInfo> = true;
const wocCarriesGame: Assignable<WocApi['game'], GameInfo> = true;

/**
 * ONE direction on purpose. `PaintOpts.frame` is `{ visible: boolean }` where the
 * package publishes the whole `Frame`, so the loader accepts strictly more and
 * the reverse is false and should be. This direction is the load-bearing one: it
 * fails when the package promises a `paint` the loader cannot honour.
 */
const wocCarriesPaint: Assignable<WocApi['paint'], PublicWocApi['paint']> = true;

/**
 * A backstop for every root member nobody named: `settings`, `onSettingsChange`,
 * `onDispose`, `onFrame`, the timers, the log functions, both version numbers.
 *
 * The reverse is absent because two differences are deliberate rather than drift:
 * `settings` is the schema's three types here and `unknown` in the package, and
 * `paint` is the narrowing above.
 */
const wocSatisfiesPublished: Assignable<WocApi, PublicWocApi> = true;

/**
 * The two ROOT members that are not facets, and both are the same kind of trap.
 *
 * `data` and `wallClock` are functions on `woc` itself rather than objects, so
 * the per-facet checks above cannot reach them: a published signature drifting
 * from the loader's would typecheck everywhere and be wrong at the addon.
 *
 * Both directions, like every surface here. One alone would let the published
 * package promise a `data` that resolves something the loader never returns,
 * which is exactly the shape of the `keys.capture()` drift this file was written
 * for.
 */
const wocCarriesData: Assignable<WocApi['data'], PublicWocApi['data']> = true;
const publishedIsData: Assignable<PublicWocApi['data'], WocApi['data']> = true;
const wocCarriesWallClock: Assignable<WocApi['wallClock'], PublicWocApi['wallClock']> = true;
const publishedIsWallClock: Assignable<PublicWocApi['wallClock'], WocApi['wallClock']> = true;

/**
 * The monotonic clock, checked against the wall clock it must NOT be.
 *
 * They are both `() => number`, so nothing structural tells them apart and no
 * assertion here can. What this pins is that the published surface still carries
 * two of them: collapsing them back into one is the change that would make the
 * documented choice meaningless, and it would otherwise pass silently.
 */
const publishedHasBothClocks: Assignable<
  PublicWocApi,
  { now: () => number; wallClock: () => number }
> = true;

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
      fmtIsPublished,
      publishedIsFmt,
      busIsPublished,
      publishedIsBus,
      addonIsPublished,
      publishedIsAddon,
      addonFieldsAgree,
      gameIsPublished,
      publishedIsGame,
      worldIsPublished,
      publishedIsWorld,
    ]).not.toContain(false);
  });

  it('describe the same event kinds, carrying the same fields', () => {
    expect([kindsArePublished, publishedAreKinds, noEventFieldDrift]).not.toContain(false);
  });

  it('describe the world shapes and the keys that watch them', () => {
    expect([
      entityIsPublished,
      publishedIsEntity,
      entityFieldsAgree,
      professionsArePublished,
      publishedAreProfessions,
      professionFieldsAgree,
      toolSlotIsPublished,
      publishedIsToolSlot,
      toolSlotFieldsAgree,
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
      wocCarriesFmt,
      wocCarriesBus,
      wocCarriesAddon,
      wocCarriesGame,
      wocCarriesPaint,
      wocSatisfiesPublished,
      wocCarriesData,
      publishedIsData,
      wocCarriesWallClock,
      publishedIsWallClock,
      publishedHasBothClocks,
    ]).not.toContain(false);
  });
});
