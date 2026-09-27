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
   * The server clock in seconds, off the snapshot head. Not on `NetState`: its only use is a
   * subtraction against a deadline, which `world.group` does and publishes as seconds remaining.
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
  // A fresh transport restarts input acking at zero, so old samples would mispair.
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
  // Kept because some fields are deadlines against this clock (a loot roll expires at
  // `time + 30`), and the client itself drops it after decoding.
  const time = fieldNumber(frame, 'time');
  if (time !== null) {
    state.simTime = time;
  }
  // The ack rides `self`, not the head; read at the head it is silently always absent.
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
  /** The hello frame's realm. Not `snapshot().realm`, which allocates on every sampler read. */
  realm: () => string | null;
}

/**
 * `connected` means the server accepted the session with a hello, not merely an open socket. An
 * `error` frame clears it, since the server sends one before closing.
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

    realm: () => state.realm,
  };
}
