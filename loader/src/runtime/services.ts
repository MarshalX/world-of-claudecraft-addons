// Everything built once and shared by every addon. The per-addon object in api/index.ts binds
// these to the addon's disposal bag, so disabling an addon releases only its hold on them.

import type { Channel } from '../shared/hosts.ts';
import type { RegistryApi, StorageApi } from '../shared/protocol.ts';
import type { SharedServices } from './api/index.ts';
import { type BusHub, createBusHub } from './bus/hub.ts';
import { createFrameLoop, type FrameLoop } from './frame-loop.ts';
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

interface ServicesDeps {
  scope: Window;
  surfaces: GameSurfaces;
  channel: Channel;
  /** Null when the bridge handshake failed. Storage then rejects rather than lying. */
  storage: StorageApi | null;
  /** Null when the bridge handshake failed. woc.data then rejects rather than lying. */
  registry: Pick<RegistryApi, 'data'> | null;
}

/** Built before the UI, since the manager reads this storage hub, so the kit is attached after. */
interface RuntimeServices {
  /** Complete the shared services once the UI kit exists. */
  withKit: (kit: UiKit) => SharedServices;
  storage: StorageHub;
  bus: BusHub;
  dispatcher: KeyDispatcher;
  sound: SoundEngine;
  logs: LogBuffer;
  gameBindings: GameBindings;
  /** The one animation-frame loop, shared by world anchors and every `woc.onFrame`. */
  frames: FrameLoop;
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
    pick: (count) => Math.floor(Math.random() * count),
  });
}

function readGameVersion(doc: Document): { version: string | null; build: string | null } {
  const parsed = parseGameVersion(doc.querySelector(ANCHORS.gameVersion)?.textContent);
  // `build` is legitimately null on a parsed version before the footer fills in.
  if (parsed === null) {
    return { version: null, build: null };
  }
  return { version: parsed.version, build: parsed.build };
}

/**
 * Read off the backend, the one derivation, so `world.characterKey` and `woc.storage.character`
 * agree. Resolved per call: there is no character at document-start.
 */
function characterKey(surfaces: GameSurfaces): string | null {
  return surfaces.world.backend()?.characterKey ?? null;
}

/** Rejects without a host rather than returning '', which reads as the addon's own file broken. */
function addonDataReader(
  registry: Pick<RegistryApi, 'data'> | null,
): (fqid: string, name: string) => Promise<string> {
  return async (fqid, name) => {
    if (registry === null) {
      throw new Error(`${fqid}: woc.data is unavailable, the loader never connected to its host`);
    }
    return await registry.data(fqid, name);
  };
}

/**
 * Resolves the first time there is a character to key per-character state on. Every `player`
 * change re-asks, since the realm arrives separately on the hello.
 *
 * Memoised and built on demand, never at boot: a subscription keeps the world watcher's frame
 * loop running, and a session nobody asked this in must cost nothing. No timeout: a player can sit
 * on the login screen indefinitely.
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

/** The memo behind `characterKnown`. */
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
  'bus' | 'dispatcher' | 'frames' | 'gameBindings' | 'logs' | 'sound' | 'storage'
>;

/** Every reader is a function: at document-start a captured value would be null forever. */
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

    addonData: addonDataReader(deps.registry),

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

  const frames = createFrameLoop({
    schedule: (frame) => scope.requestAnimationFrame(frame),
    cancel: (id) => {
      scope.cancelAnimationFrame(id);
    },
    now: () => scope.performance.now(),
  });

  const withoutKit = sharedServices(deps, {
    storage,
    bus,
    sound,
    dispatcher,
    gameBindings,
    logs,
    frames,
  });

  return {
    withKit: (kit) => ({ ...withoutKit, kit }),
    storage,
    bus,
    dispatcher,
    sound,
    logs,
    gameBindings,
    frames,
    dispose: () => {
      // First, or a scheduled frame runs against half a runtime.
      frames.dispose();
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
