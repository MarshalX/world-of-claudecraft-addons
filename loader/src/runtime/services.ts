// Everything built once and shared by every addon.
//
// One storage hub, one sound engine and AudioContext, one keydown listener, one
// log buffer. The per-addon object in api/index.ts is a facade over these
// bound to that addon's disposal bag, which is what makes disabling an addon
// cheap and complete: nothing here is torn down, only the addon's hold on it.
//
// Built after the UI kit, because the kit is part of it, and before any addon
// exists, because the socket hook and the keydown listener both have to be in
// place before the thing they observe happens.

import type { Channel } from '../shared/hosts.ts';
import type { StorageApi } from '../shared/protocol.ts';
import type { SharedServices } from './api/index.ts';
import { type BusHub, createBusHub } from './bus/hub.ts';
import { characterId } from './character.ts';
import { parseGameVersion } from './game-version.ts';
import { createKeyDispatcher, type KeyDispatcher } from './keys/dispatcher.ts';
import { createGameBindings, type GameBindings } from './keys/game-bindings.ts';
import { createLogBuffer, type LogBuffer } from './log/buffer.ts';
import { createSoundEngine, type SoundEngine } from './sound/engine.ts';
import { createVolumeReader, SETTINGS_KEY } from './sound/volume.ts';
import { createWebAudioSink, fetchBytes, fetchJson } from './sound/web-audio.ts';
import { createStorageHub, type StorageHub } from './storage/hub.ts';
import type { GameSurfaces } from './surfaces.ts';
import { ANCHORS } from './ui/anchors.ts';
import type { UiKit } from './ui/mount.ts';
import type { WorldBackend } from './world/backend.ts';

interface ServicesDeps {
  scope: Window;
  surfaces: GameSurfaces;
  channel: Channel;
  /** Null when the bridge handshake failed. Storage then rejects rather than lying. */
  storage: StorageApi | null;
}

/**
 * Built before the UI, because the manager reads addon settings and keybinds out
 * of the same storage hub an addon does, and the UI kit is itself a service. The
 * kit is therefore attached afterwards rather than passed in.
 */
interface RuntimeServices {
  /** Complete the shared services once the UI kit exists. */
  withKit: (kit: UiKit) => SharedServices;
  storage: StorageHub;
  bus: BusHub;
  dispatcher: KeyDispatcher;
  sound: SoundEngine;
  logs: LogBuffer;
  gameBindings: GameBindings;
  dispose: () => void;
}

/** localStorage throws rather than returning null in a locked-down profile. */
function safeLocalStorage(scope: Window): Storage | null {
  try {
    return scope.localStorage;
  } catch {
    return null;
  }
}

function buildSoundEngine(scope: Window): SoundEngine {
  return createSoundEngine({
    sink: createWebAudioSink(),
    fetchJson,
    fetchBytes,
    volume: createVolumeReader({
      read: () => safeLocalStorage(scope)?.getItem(SETTINGS_KEY) ?? null,
    }),
    now: () => scope.performance.now(),
    // A family cue picks a variant the way the game does. There is no
    // determinism requirement here: this is the loader, not the sim.
    pick: (count) => Math.floor(Math.random() * count),
  });
}

function readGameVersion(doc: Document): { version: string | null; build: string | null } {
  const parsed = parseGameVersion(doc.querySelector(ANCHORS.gameVersion)?.textContent);
  // `build` is legitimately null on a parsed version, before the game has filled
  // the footer in, so the two nulls are told apart rather than coalesced into
  // one shape.
  if (parsed === null) {
    return { version: null, build: null };
  }
  return { version: parsed.version, build: parsed.build };
}

/** The live player's name, or null before the player entity exists. */
function playerName(backend: WorldBackend): unknown {
  const player = backend.player as { name?: unknown } | null;
  if (player === null) {
    return null;
  }
  return player.name;
}

/**
 * The character in play, or null before world entry.
 *
 * Resolved per call: the loader boots at document-start, long before there is a
 * character, and every consumer of this reads it lazily for that reason.
 */
function characterKey(surfaces: GameSurfaces): string | null {
  const backend = surfaces.world.backend();
  if (backend === null) {
    return null;
  }
  return characterId(surfaces.net.state().realm, playerName(backend));
}

/**
 * Resolves the first time there is a character to key per-character state on.
 *
 * The loader boots at document-start and an addon builds its frames on its first
 * line, both of which are long before a player has a character. Everything keyed
 * per character therefore has a moment it becomes READABLE, and this is it.
 *
 * Watched rather than polled: `player` changing is the event, and the subscription
 * drops itself the moment it answers. The name alone is not enough, since the realm
 * comes off the socket's hello, so every change re-asks the same question rather
 * than assuming the first one is it.
 *
 * Built on demand and memoised, never at boot. The world watcher runs a frame loop
 * for as long as anything is subscribed, and `world/watch.ts` promises that an
 * addon which never calls `world.on` costs nothing at all. Subscribing here at
 * startup would quietly make that false for every session, including one with no
 * addons installed; asking for it is what an addon with a SAVED frame does.
 *
 * There is deliberately no timeout, for the reason `waitForGame` has none: a
 * player can sit on the login screen for as long as they like.
 */
function whenCharacterKnown(surfaces: GameSurfaces): Promise<void> {
  if (characterKey(surfaces) !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const off = surfaces.world.watcher.on('player', () => {
      if (characterKey(surfaces) !== null) {
        off();
        resolve();
      }
    });
  });
}

/** The memo behind `characterKnown`, so the subscription is made at most once. */
function characterWaiter(surfaces: GameSurfaces): () => Promise<void> {
  let waiting: Promise<void> | null = null;
  return () => {
    waiting ??= whenCharacterKnown(surfaces);
    return waiting;
  };
}

/** The long-lived services, before the UI kit exists to complete them. */
type BuiltServices = Pick<
  RuntimeServices,
  'bus' | 'dispatcher' | 'gameBindings' | 'logs' | 'sound' | 'storage'
>;

/**
 * The same services, in the shape the addon API reads them through.
 *
 * Every reader here is a FUNCTION rather than a value, and deliberately so: the
 * loader boots at document-start, so the game version, the character and the
 * viewport are all things that do not exist yet at the moment this object is
 * built and would each be captured as null forever.
 */
function sharedServices(deps: ServicesDeps, built: BuiltServices): Omit<SharedServices, 'kit'> {
  const { scope, surfaces } = deps;
  const doc = scope.document;
  return {
    ...built,
    doc,
    window: scope,
    net: surfaces.net,
    world: surfaces.world,
    channel: deps.channel,
    host: scope.location.origin,

    gameVersion: () => readGameVersion(doc),

    character: () => characterKey(surfaces),

    characterKnown: characterWaiter(surfaces),

    now: () => scope.performance.now(),
    wallClock: () => Date.now(),
    viewport: () => ({ w: scope.innerWidth, h: scope.innerHeight }),
    pick: (count: number) => Math.floor(Math.random() * count),
  };
}

function createRuntimeServices(deps: ServicesDeps): RuntimeServices {
  const { scope, surfaces } = deps;

  const storage = createStorageHub(deps.storage);
  const bus = createBusHub();
  const logs = createLogBuffer();
  const dispatcher = createKeyDispatcher({ target: scope, doc: scope.document });

  const sound = buildSoundEngine(scope);
  const disarm = sound.arm(scope);

  const gameBindings = createGameBindings({
    game: () => surfaces.world.game(),
    storage: () => safeLocalStorage(scope),
  });

  const withoutKit = sharedServices(deps, {
    storage,
    bus,
    sound,
    dispatcher,
    gameBindings,
    logs,
  });

  return {
    withKit: (kit) => ({ ...withoutKit, kit }),
    storage,
    bus,
    dispatcher,
    sound,
    logs,
    gameBindings,
    dispose: () => {
      bus.dispose();
      disarm();
      sound.dispose();
      dispatcher.dispose();
      logs.dispose();
    },
  };
}

export type { RuntimeServices, ServicesDeps };
export { createRuntimeServices, safeLocalStorage };
