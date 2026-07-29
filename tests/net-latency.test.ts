import { describe, expect, it } from 'vitest';

import { createLatencyTracker } from '../loader/src/runtime/net/latency.ts';

describe('createLatencyTracker', () => {
  it('reports nothing before a send has been acked', () => {
    const tracker = createLatencyTracker();
    tracker.noteSent(1, 0);

    expect(tracker.value).toBeNull();
  });

  it('measures the gap between the send and its ack', () => {
    const tracker = createLatencyTracker();

    tracker.noteSent(1, 1000);
    tracker.noteAck(1, 1120);

    expect(tracker.value).toBe(120);
  });

  // The server acks the highest sequence it has processed, so one ack settles
  // every send at or below it rather than only the exact match.
  it('resolves every sequence at or below the ack', () => {
    const tracker = createLatencyTracker();
    tracker.noteSent(1, 0);
    tracker.noteSent(2, 10);
    tracker.noteSent(3, 20);

    tracker.noteAck(2, 100);

    // Samples of 100 and 90; the third is still outstanding.
    expect(tracker.value).toBe(95);
    tracker.noteAck(3, 120);
    expect(tracker.value).toBe(100);
  });

  it('ignores an ack for a sequence it never saw sent', () => {
    const tracker = createLatencyTracker();

    tracker.noteAck(99, 100);

    expect(tracker.value).toBeNull();
  });

  it('does not resolve the same send twice', () => {
    const tracker = createLatencyTracker();
    tracker.noteSent(1, 0);
    tracker.noteAck(1, 50);

    tracker.noteAck(1, 5000);

    expect(tracker.value).toBe(50);
  });

  // A backgrounded tab or one GC pause produces a single enormous sample. A mean
  // would carry it for the whole window; the median does not notice it.
  it('is not moved by one outlier', () => {
    const tracker = createLatencyTracker();
    for (let seq = 1; seq <= 5; seq += 1) {
      tracker.noteSent(seq, 0);
      tracker.noteAck(seq, 100);
    }

    tracker.noteSent(6, 0);
    tracker.noteAck(6, 30_000);

    expect(tracker.value).toBe(100);
  });

  it('averages the two middles on an even count', () => {
    const tracker = createLatencyTracker();
    tracker.noteSent(1, 0);
    tracker.noteAck(1, 100);
    tracker.noteSent(2, 0);
    tracker.noteAck(2, 200);

    expect(tracker.value).toBe(150);
  });

  it('follows a route change out of the window rather than averaging it forever', () => {
    const tracker = createLatencyTracker();
    let seq = 0;
    const sample = (ms: number): void => {
      seq += 1;
      tracker.noteSent(seq, 0);
      tracker.noteAck(seq, ms);
    };

    for (let i = 0; i < 8; i += 1) {
      sample(50);
    }
    expect(tracker.value).toBe(50);

    for (let i = 0; i < 8; i += 1) {
      sample(300);
    }
    expect(tracker.value).toBe(300);
  });

  it('forgets everything on reset, which is what a fresh transport needs', () => {
    const tracker = createLatencyTracker();
    tracker.noteSent(1, 0);
    tracker.noteAck(1, 100);

    tracker.reset();

    expect(tracker.value).toBeNull();
  });

  it('drops a pending send on reset so it cannot pair with a restarted sequence', () => {
    const tracker = createLatencyTracker();
    tracker.noteSent(1, 0);

    tracker.reset();
    tracker.noteAck(1, 9999);

    expect(tracker.value).toBeNull();
  });

  // The client sends input at 20 Hz. An unacked run must not grow without bound,
  // which is why it caps the same way the client's own map does.
  it('bounds the unacked set, dropping the oldest first', () => {
    const tracker = createLatencyTracker();
    for (let seq = 1; seq <= 130; seq += 1) {
      tracker.noteSent(seq, seq);
    }

    tracker.noteAck(130, 1000);

    // Sequence 1 was evicted, so the oldest surviving sample is not 999.
    expect(tracker.value).not.toBe(999);
    expect(tracker.value).not.toBeNull();
  });
});
