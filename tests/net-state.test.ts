import { describe, expect, it } from 'vitest';

import type { Frame } from '../loader/src/runtime/net/frames.ts';
import { createLatencyTracker } from '../loader/src/runtime/net/latency.ts';
import { createNetStateTracker } from '../loader/src/runtime/net/state.ts';
import { AUTH_FRAME, ackSnap, HELLO_FRAME, inputFrame, snapFrame } from './fakes/frames.ts';

const frame = (value: Record<string, unknown>): Frame => value as Frame;

describe('createNetStateTracker', () => {
  it('starts disconnected and knows nothing', () => {
    const state = createNetStateTracker().snapshot();

    expect(state).toEqual({
      connected: false,
      tick: 0,
      tickHz: 20,
      pid: null,
      realm: null,
      seed: null,
      latencyMs: null,
      reconnects: 0,
    });
  });

  // An open socket is not a session: the server can still reject it. The game
  // draws the same distinction, and `connected` has to mean the same thing.
  it('stays disconnected on socket open until a hello arrives', () => {
    const tracker = createNetStateTracker();

    tracker.noteOpen();
    expect(tracker.snapshot().connected).toBe(false);

    tracker.noteFrame(frame(HELLO_FRAME), 0);
    expect(tracker.snapshot().connected).toBe(true);
  });

  it('reads the session out of the hello frame', () => {
    const tracker = createNetStateTracker();

    tracker.noteFrame(frame(HELLO_FRAME), 0);

    expect(tracker.snapshot()).toMatchObject({ pid: 661, realm: 'Claudemoon', seed: 20_061 });
  });

  it('clears connected on an error frame, which is what precedes a close', () => {
    const tracker = createNetStateTracker();
    tracker.noteFrame(frame(HELLO_FRAME), 0);

    tracker.noteFrame(frame({ t: 'error', error: 'kicked' }), 0);

    expect(tracker.snapshot().connected).toBe(false);
  });

  it('clears connected when the socket closes', () => {
    const tracker = createNetStateTracker();
    tracker.noteFrame(frame(HELLO_FRAME), 0);

    tracker.noteClose();

    expect(tracker.snapshot().connected).toBe(false);
  });

  describe('reconnects', () => {
    it('does not count the first socket', () => {
      const tracker = createNetStateTracker();
      tracker.noteOpen();

      expect(tracker.snapshot().reconnects).toBe(0);
    });

    it('counts every socket after it', () => {
      const tracker = createNetStateTracker();
      tracker.noteOpen();
      tracker.noteClose();
      tracker.noteOpen();
      tracker.noteClose();
      tracker.noteOpen();

      expect(tracker.snapshot().reconnects).toBe(2);
    });
  });

  describe('tick', () => {
    it('follows the snapshot head', () => {
      const tracker = createNetStateTracker();

      tracker.noteFrame(frame(snapFrame({ tick: 242_554 })), 0);

      expect(tracker.snapshot().tick).toBe(242_554);
    });

    // The server rides tickHz at about 2 Hz and omits it in between, so the last
    // measured value has to be held rather than reset to the default.
    it('holds the measured rate across the snapshots that omit it', () => {
      const tracker = createNetStateTracker();

      tracker.noteFrame(frame(snapFrame({ tickHz: 19.96 })), 0);
      tracker.noteFrame(frame(snapFrame({ tick: 3 })), 0);

      expect(tracker.snapshot().tickHz).toBe(19.96);
    });

    it('falls back to the sim rate before any snapshot measures it', () => {
      expect(createNetStateTracker().snapshot().tickHz).toBe(20);
    });
  });

  // The sim's own clock, which deadlines the game sends are measured against. It is
  // tracked HERE, off the snapshot head beside the tick and the ack, rather than by
  // something subscribed to the hub. A loader-owned subscription is indistinguishable
  // from an addon's, so the one this replaced kept every snapshot of every session on
  // the hub's freezing path whether or not any addon had asked for snapshots.
  describe('the sim clock', () => {
    it('follows the snapshot head', () => {
      const tracker = createNetStateTracker();

      tracker.noteFrame(frame(snapFrame({ time: 12_127.7 })), 0);

      expect(tracker.simNow()).toBe(12_127.7);
    });

    // A deadline the game never set is not a deadline of zero, and before the first
    // snapshot there is no clock to measure one against. Those have to stay apart.
    it('answers null before any snapshot has carried one', () => {
      expect(createNetStateTracker().simNow()).toBeNull();
    });

    // Written out rather than taken from `snapFrame`, whose default fixture carries
    // a time: the whole subject here is a snapshot that does not.
    it('holds the last one across a frame that carries no time', () => {
      const tracker = createNetStateTracker();

      tracker.noteFrame(frame(snapFrame({ time: 900 })), 0);
      tracker.noteFrame(frame({ t: 'snap', tick: 3 }), 0);

      expect(tracker.simNow()).toBe(900);
    });

    // It is not on `net.state()`, which is what an addon reads. A raw sim time is a
    // number whose only correct use is a subtraction against a deadline the addon
    // would also have to be handed; `world.group` does that and publishes seconds.
    it('stays off the addon-facing reading', () => {
      const tracker = createNetStateTracker();

      tracker.noteFrame(frame(snapFrame({ time: 900 })), 0);

      expect(Object.hasOwn(tracker.snapshot(), 'simTime')).toBe(false);
    });
  });

  // Latency is measured by pairing an outbound input frame's seq against the
  // ack a later snapshot carries. Nothing is sent to obtain it.
  describe('latency', () => {
    it('pairs an input frame with the snapshot that acks it', () => {
      const tracker = createNetStateTracker();

      tracker.noteSend(frame(inputFrame(1)), 1000);
      tracker.noteFrame(frame(ackSnap(1)), 1150);

      expect(tracker.snapshot().latencyMs).toBe(150);
    });

    // The regression this exists for: the ack rides `self`, not the head. Read
    // at the head it is simply never found, and latency stays null forever with
    // no error to notice.
    it('finds the ack on the self record and not on the head', () => {
      const onSelf = createNetStateTracker();
      onSelf.noteSend(frame(inputFrame(1)), 0);
      onSelf.noteFrame(frame(snapFrame({ self: { ack: 1 } })), 100);
      expect(onSelf.snapshot().latencyMs).toBe(100);

      const onHead = createNetStateTracker();
      onHead.noteSend(frame(inputFrame(1)), 0);
      onHead.noteFrame(frame({ t: 'snap', tick: 1, ack: 1 }), 100);
      expect(onHead.snapshot().latencyMs).toBeNull();
    });

    it('survives a snapshot that carries no self record', () => {
      const tracker = createNetStateTracker();
      tracker.noteSend(frame(inputFrame(1)), 0);

      expect(() => tracker.noteFrame(frame({ t: 'snap', tick: 9 }), 50)).not.toThrow();
      expect(tracker.snapshot().latencyMs).toBeNull();
    });

    it('ignores an outbound frame that is not input', () => {
      const tracker = createNetStateTracker();

      tracker.noteSend(frame(AUTH_FRAME), 0);
      tracker.noteFrame(frame(ackSnap(1)), 100);

      expect(tracker.snapshot().latencyMs).toBeNull();
    });

    // A hello means a fresh transport and the server restarts acking at zero, so
    // a held sample would pair a new ack against an old send.
    it('drops pending sends when a hello restarts the sequence', () => {
      const tracker = createNetStateTracker();
      tracker.noteSend(frame(inputFrame(1)), 0);

      tracker.noteFrame(frame(HELLO_FRAME), 500);
      tracker.noteFrame(frame(ackSnap(1)), 600);

      expect(tracker.snapshot().latencyMs).toBeNull();
    });

    it('reads through the shared tracker it was given', () => {
      const latency = createLatencyTracker();
      const tracker = createNetStateTracker(latency);

      latency.noteSent(1, 0);
      latency.noteAck(1, 42);

      expect(tracker.snapshot().latencyMs).toBe(42);
    });
  });

  it('hands out a frozen snapshot, so a reader cannot edit the state', () => {
    const state = createNetStateTracker().snapshot();

    expect(Object.isFrozen(state)).toBe(true);
  });
});
