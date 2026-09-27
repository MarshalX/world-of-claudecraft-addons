// biome-ignore-all lint/suspicious/noConsole: this module is the console sink for addon logging, which is what keeps every other module console-free
// The console half of woc.log, the one place the runtime names console for addon output.

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
