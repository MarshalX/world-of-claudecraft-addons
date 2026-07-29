// The per-addon log tail the manager shows.
//
// Bounded on purpose, and bounded per addon rather than globally: an addon
// logging from a 20 Hz handler would otherwise push every other addon's lines
// out of a shared buffer, and the addon a player is trying to debug is usually
// the quiet one that failed.
//
// Entries hold pre-formatted text rather than the original arguments. Keeping
// the arguments would mean holding a reference to whatever an addon logged,
// which for a logged entity is the game's live object and for a logged closure
// is its entire scope.

const MAX_ENTRIES_PER_ADDON = 100;

/** How much of one formatted argument is kept. A logged snapshot is enormous. */
const MAX_TEXT_LENGTH = 2000;

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  /**
   * Monotonic within one loader session, and unique across every addon.
   *
   * Timestamps do not identify a line: two identical lines a millisecond apart
   * are ordinary, and so is the same text logged twice from a 20 Hz handler.
   * The manager renders these as a list and needs a key that does not shift when
   * the buffer drops its oldest entry.
   */
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
      // shift() rather than a ring index: the tail is read far less often than
      // it is written, but it is read in order, and an array the manager can
      // hand straight to a render is worth more than the constant factor.
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
