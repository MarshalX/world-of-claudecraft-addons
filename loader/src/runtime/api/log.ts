// The woc.log surface, mirroring packages/types/log.d.ts. One call goes to the console, prefixed
// with the fqid, and to the manager's per-addon tail, where a player can read it without devtools.

import type { LogBuffer, LogLevel } from '../log/buffer.ts';
import { formatArgs } from '../log/buffer.ts';

interface LogApi {
  log: (...args: readonly unknown[]) => void;
  warn: (...args: readonly unknown[]) => void;
  error: (...args: readonly unknown[]) => void;
}

interface LogDeps {
  fqid: string;
  buffer: LogBuffer;
  /** Wall-clock milliseconds, for the timestamp the manager renders. */
  now: () => number;
  /** The console sink, injected so a Node test can read what was written. */
  sink: Record<LogLevel, (prefix: string, ...args: readonly unknown[]) => void>;
}

function createLog(deps: LogDeps): LogApi {
  const prefix = `[${deps.fqid}]`;

  const write = (level: LogLevel, args: readonly unknown[]): void => {
    // The console gets the originals to inspect; the buffer gets text, retaining nothing.
    deps.sink[level](prefix, ...args);
    deps.buffer.append(deps.fqid, level, deps.now(), formatArgs(args));
  };

  return {
    log: (...args) => {
      write('info', args);
    },
    warn: (...args) => {
      write('warn', args);
    },
    error: (...args) => {
      write('error', args);
    },
  };
}

export type { LogApi, LogDeps };
export { createLog };
