// biome-ignore-all lint/suspicious/noConsole: this module is the console channel, which is what keeps every other module console-free
// The loader's own diagnostic channel, for failures before it has any UI to show them in.

const PREFIX = '[woc-addons]';

export function diagInfo(message: string, ...details: unknown[]): void {
  console.info(PREFIX, message, ...details);
}

export function diagError(message: string, ...details: unknown[]): void {
  console.error(PREFIX, message, ...details);
}

/** One line of text for anything that was thrown, which is often not an Error. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
