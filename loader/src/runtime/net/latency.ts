// Round-trip time, measured by watching traffic rather than by producing any.
//
// The client stamps every outbound input frame with a sequence number and the
// server echoes the highest one it has processed as `ack` on the next snapshot
// (src/net/online.ts). Timing that pairing needs nothing sent, which is what
// keeps net read-only.

/** Samples kept for the median. Small enough to track a route change quickly. */
const WINDOW = 8;

/** Unacked sequence numbers held before the oldest is dropped, as the client caps its own. */
const MAX_PENDING = 120;

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[mid - 1] ?? 0;
  return (lower + upper) / 2;
}

export interface LatencyTracker {
  noteSent: (seq: number, at: number) => void;
  /** Resolves every sequence number the server has now acknowledged. */
  noteAck: (ack: number, at: number) => void;
  /** Median of the recent samples, or null before the first pairing. */
  readonly value: number | null;
  /** Called on a fresh transport, where sequence numbers restart at zero. */
  reset: () => void;
}

/**
 * The median rather than the mean: a single GC pause or a tab that was
 * backgrounded produces one enormous sample, and a mean would carry it for the
 * whole window.
 */
export function createLatencyTracker(): LatencyTracker {
  const pending = new Map<number, number>();
  let samples: number[] = [];

  return {
    noteSent: (seq, at) => {
      pending.set(seq, at);
      if (pending.size > MAX_PENDING) {
        const oldest = pending.keys().next();
        if (!oldest.done) {
          pending.delete(oldest.value);
        }
      }
    },

    noteAck: (ack, at) => {
      for (const [seq, sentAt] of pending) {
        if (seq <= ack) {
          pending.delete(seq);
          samples.push(at - sentAt);
        }
      }
      if (samples.length > WINDOW) {
        samples = samples.slice(-WINDOW);
      }
    },

    get value(): number | null {
      return median([...samples].sort((a, b) => a - b));
    },

    reset: () => {
      pending.clear();
      samples = [];
    },
  };
}
