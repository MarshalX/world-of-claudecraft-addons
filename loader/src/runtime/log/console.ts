// biome-ignore-all lint/suspicious/noConsole: this module is the console sink for addon logging, which is what keeps every other module console-free
// The console half of woc.log.
//
// Separated from api/log.ts so that file stays testable without a console
// suppression of its own, and so there is exactly one place in the runtime that
// names console for addon output. shared/diag.ts is the equivalent for the
// loader's own diagnostics.

import type { LogLevel } from './buffer.ts';

type ConsoleSink = Record<string, (prefix: string, ...args: readonly unknown[]) => void>;

const CONSOLE_SINK: Record<LogLevel, (prefix: string, ...args: readonly unknown[]) => void> = {
  info: (prefix, ...args) => {
    console.info(prefix, ...args);
  },
  warn: (prefix, ...args) => {
    console.warn(prefix, ...args);
  },
  error: (prefix, ...args) => {
    console.error(prefix, ...args);
  },
};

export type { ConsoleSink };
export { CONSOLE_SINK };
