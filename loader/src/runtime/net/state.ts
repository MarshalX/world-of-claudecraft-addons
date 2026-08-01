// Connection state, derived entirely from observed frames and socket lifecycle.

import { type Frame, fieldNumber, fieldString, fieldValue } from './frames.ts';
import { createLatencyTracker, type LatencyTracker } from './latency.ts';

/** The sim's fixed rate (DT = 1/20). Snapshots carry the measured rate only every ~2s. */
const DEFAULT_TICK_HZ = 20;

interface Mutable {
  connected: boolean;
  tick: number;
  tickHz: number;
  pid: number | null;
  realm: string | null;
  seed: number | null;
  reconnects: number;
  /** Whether any socket has opened yet, which is what makes the next one a reconnect. */
  opened: boolean;
  /**
   * The server's own clock in seconds, off the snapshot head. Null before the first.
   *
   * Not on `NetState`, which is the addon-facing reading: a raw sim time is a number
   * whose only correct use is a subtraction against a deadline the addon would also
   * have to be handed. `world.group` does that subtraction and publishes the answer
   * in seconds remaining, the way everything else on the world API reports a time.
   */
  simTime: number | null;
}

function blank(): Mutable {
  return {
    connected: false,
    tick: 0,
    tickHz: DEFAULT_TICK_HZ,
    pid: null,
    realm: null,
    seed: null,
    reconnects: 0,
    opened: false,
    simTime: null,
  };
}

function applyHello(state: Mutable, frame: Frame, latency: LatencyTracker): void {
  state.connected = true;
  state.pid = fieldNumber(frame, 'pid');
  state.seed = fieldNumber(frame, 'seed');
  state.realm = fieldString(frame, 'realm');
  // A hello means a fresh transport: the server restarts input acking at zero,
  // so samples timed against the old sequence would pair the wrong frames.
  latency.reset();
}

function applySnap(state: Mutable, frame: Frame, latency: LatencyTracker, at: number): void {
  const tick = fieldNumber(frame, 'tick');
  if (tick !== null) {
    state.tick = tick;
  }
  const tickHz = fieldNumber(frame, 'tickHz');
  if (tickHz !== null && tickHz > 0) {
    state.tickHz = tickHz;
  }
  // Some of what the game sends is a DEADLINE rather than a duration, and a deadline
  // is meaningless without the clock it was measured against. A loot roll expires at
  // `ctx.time + 30`, where `ctx.time` is this, and nothing on the client keeps it:
  // the client reads it off each snapshot, uses it while decoding, and drops it.
  const time = fieldNumber(frame, 'time');
  if (time !== null) {
    state.simTime = time;
  }
  // The ack rides the self record, not the snapshot head, and the server omits
  // `self` on a snapshot that carries no self state. Read at the head it is
  // always absent, which costs no error and silently never measures anything.
  const ack = fieldNumber(fieldValue(frame, 'self'), 'ack');
  if (ack !== null) {
    latency.noteAck(ack, at);
  }
}

export interface NetState {
  readonly connected: boolean;
  readonly tick: number;
  readonly tickHz: number;
  readonly pid: number | null;
  readonly realm: string | null;
  readonly seed: number | null;
  readonly latencyMs: number | null;
  readonly reconnects: number;
}

export interface NetStateTracker {
  noteOpen: () => void;
  noteClose: () => void;
  noteFrame: (frame: Frame, at: number) => void;
  noteSend: (frame: Frame, at: number) => void;
  snapshot: () => NetState;
  /** The sim's clock in seconds, or null before the first snapshot. */
  simNow: () => number | null;
}

/**
 * `connected` follows the game's own meaning: an open socket is not enough, the
 * server has to have accepted the session with a hello. An `error` frame clears
 * it, because that is what the server sends before closing.
 */
export function createNetStateTracker(
  latency: LatencyTracker = createLatencyTracker(),
): NetStateTracker {
  const state = blank();

  return {
    noteOpen: () => {
      // The first socket is the session; every one after it is a reconnect.
      if (state.opened) {
        state.reconnects += 1;
      }
      state.opened = true;
    },

    noteClose: () => {
      state.connected = false;
    },

    noteFrame: (frame, at) => {
      if (frame.t === 'hello') {
        applyHello(state, frame, latency);
      } else if (frame.t === 'snap') {
        applySnap(state, frame, latency, at);
      } else if (frame.t === 'error') {
        state.connected = false;
      }
    },

    noteSend: (frame, at) => {
      if (frame.t !== 'input') {
        return;
      }
      const seq = fieldNumber(frame, 'seq');
      if (seq !== null) {
        latency.noteSent(seq, at);
      }
    },

    snapshot: () =>
      Object.freeze({
        connected: state.connected,
        tick: state.tick,
        tickHz: state.tickHz,
        pid: state.pid,
        realm: state.realm,
        seed: state.seed,
        latencyMs: latency.value,
        reconnects: state.reconnects,
      }),

    simNow: () => state.simTime,
  };
}
