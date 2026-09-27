// Wiring the page's globals into the runtime's shared readers; the decisions live in the modules.
// Reflect.set keeps the WebSocket swap from needing a type that names a global.

import { clearTimer, setTimer } from './dom-timers.ts';
import { fieldValue } from './net/frames.ts';
import { installSocketHook, type SocketCtor } from './net/hook.ts';
import { createNetHub, type NetHub } from './net/hub.ts';
import { waitForGame } from './ready.ts';
import { createCombatClock } from './world/combat-clock.ts';
import { createWorldHub, type WorldHub } from './world/hub.ts';
import { createZoneReader } from './world/zone.ts';

const GAME_GLOBAL = '__game';
const SOCKET_GLOBAL = 'WebSocket';

export interface GameSurfaces {
  net: NetHub;
  world: WorldHub;
  dispose: () => void;
}

/** The socket hook goes in first, before the game opens its socket. Everything else is lazy. */
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
    setTimer,
    clearTimer,
  });

  // Outside the world hub because it reads the socket, so it counts from the first frame.
  const combat = createCombatClock({ net, now: () => performance.now() });

  const world = createWorldHub({
    game: wait.ready,
    schedule: (frame) => globalThis.requestAnimationFrame(frame),
    cancel: (id) => globalThis.cancelAnimationFrame(id),
    lastDamageAt: combat.lastDamageAt,
    now: () => performance.now(),
    zoneName: createZoneReader(globalThis.document),
    // Read at the tap, not by subscribing, which would put every snapshot on the freezing path.
    simNow: net.simNow,
    // Half of the character key; the realm rides the hello frame.
    realm: net.realm,
  });

  return {
    net,
    world,
    dispose: () => {
      wait.cancel();
      combat.dispose();
      world.dispose();
      net.dispose();
    },
  };
}
