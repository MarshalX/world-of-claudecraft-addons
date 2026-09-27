// The per-addon log tail the manager shows. Bounded PER ADDON, or a chatty 20 Hz handler would push
// out the quiet addon that failed. Entries hold formatted text, never a reference to the arguments.

const MAX_ENTRIES_PER_ADDON = 100;

/** How much formatted text is kept. A logged snapshot is enormous. */
const MAX_TEXT_LENGTH = 2000;

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  /** A stable render key, unique per session: timestamps and text both repeat. */
  seq: number;
  level: LogLevel;
  /** Milliseconds since the epoch, for the manager to render. */
  at: number;
  text: string;
}

interface LogBuffer {
  append: (fqid: string, level: LogLevel, at: number, text: string) => void;
  /** Oldest first. Empty for an addon that has never logged. */
  tail: (fqid: string) => readonly LogEntry[];
  clear: (fqid: string) => void;
  dispose: () => void;
}

/** Format one logged argument without holding on to it. */
function describe(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular, or a getter that threw. Both are ordinary for a game object.
    return String(value);
  }
}

function formatArgs(args: readonly unknown[]): string {
  return args.map(describe).join(' ').slice(0, MAX_TEXT_LENGTH);
}

function createLogBuffer(): LogBuffer {
  const byAddon = new Map<string, LogEntry[]>();
  let seq = 0;

  return {
    append: (fqid, level, at, text) => {
      const entries = byAddon.get(fqid) ?? [];
      seq += 1;
      entries.push({ seq, level, at, text });
      // shift(), not a ring index, so the manager can render the array as it is.
      while (entries.length > MAX_ENTRIES_PER_ADDON) {
        entries.shift();
      }
      byAddon.set(fqid, entries);
    },

    tail: (fqid) => byAddon.get(fqid) ?? [],

    clear: (fqid) => {
      byAddon.delete(fqid);
    },

    dispose: () => {
      byAddon.clear();
    },
  };
}

export type { LogBuffer, LogEntry, LogLevel };
export { createLogBuffer, formatArgs, MAX_ENTRIES_PER_ADDON, MAX_TEXT_LENGTH };
