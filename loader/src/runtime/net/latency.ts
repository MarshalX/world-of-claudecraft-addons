// Round-trip time from observed traffic alone: each input frame carries a `seq` and the server
// echoes the highest processed as `ack` on a snapshot, so timing the pair sends nothing.

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

/** The median, since one GC pause or backgrounded tab would skew a mean for the whole window. */
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
