// Wiring the page's globals into the runtime's shared readers.
//
// Everything with a decision in it lives in the modules below; this file only
// says which global each one reads. Reflect.set rather than an assignment cast
// keeps the WebSocket swap from needing a type that names a global.

import { fieldValue } from './net/frames.ts';
import { installSocketHook, type SocketCtor } from './net/hook.ts';
import { createNetHub, type NetHub } from './net/hub.ts';
import { waitForGame } from './ready.ts';
import { createWorldHub, type WorldHub } from './world/hub.ts';

const GAME_GLOBAL = '__game';
const SOCKET_GLOBAL = 'WebSocket';

export interface GameSurfaces {
  net: NetHub;
  world: WorldHub;
  dispose: () => void;
}

/**
 * The socket hook goes in first.
 *
 * It has to be installed before ClientWorld opens its socket, and the runtime is
 * at document-start while that happens at world entry, so the ordering has room
 * to spare. Everything else here is lazy.
 */
export function createGameSurfaces(): GameSurfaces {
  const net = createNetHub({
    now: () => performance.now(),
    install: (taps) =>
      installSocketHook({
        read: () => Reflect.get(globalThis, SOCKET_GLOBAL) as SocketCtor,
        write: (ctor) => {
          Reflect.set(globalThis, SOCKET_GLOBAL, ctor);
        },
        base: globalThis.location.origin,
        taps,
      }),
  });

  const wait = waitForGame({
    doc: globalThis.document,
    readGame: () => fieldValue(globalThis, GAME_GLOBAL),
    setTimer: (handler, ms) => globalThis.setTimeout(handler, ms),
    clearTimer: (id) => globalThis.clearTimeout(id),
  });

  const world = createWorldHub({
    game: wait.ready,
    schedule: (frame) => globalThis.requestAnimationFrame(frame),
    cancel: (id) => globalThis.cancelAnimationFrame(id),
  });

  return {
    net,
    world,
    dispose: () => {
      wait.cancel();
      world.dispose();
      net.dispose();
    },
  };
}
