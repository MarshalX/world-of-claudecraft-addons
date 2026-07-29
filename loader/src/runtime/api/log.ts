// The woc.log surface handed to addons. Mirrors packages/types/log.d.ts.
//
// Two destinations for one call: the browser console, where an author is
// already looking, and a bounded per-addon buffer the manager shows, where a
// PLAYER can read what an addon said without opening devtools. The second is
// the point. "It stopped working" is the whole bug report a player can give,
// and the manager's log tail is what turns it into one an author can act on.
//
// The console line carries the addon's fqid rather than the loader's own
// prefix, so a page with several addons running says which one spoke.

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
    // The console gets the original arguments, so an object is still
    // inspectable; the buffer gets text, so nothing is retained. See
    // log/buffer.ts.
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
