// biome-ignore-all lint/suspicious/noConsole: this module is the console channel, which is what keeps every other module console-free
// The loader's own diagnostic channel.
//
// The loader starts at document-start, long before it has any UI of its own, so
// a failed handshake or a storage error has nowhere else to surface.

const PREFIX = '[woc-addons]';

export function diagInfo(message: string, ...details: unknown[]): void {
  console.info(PREFIX, message, ...details);
}

export function diagError(message: string, ...details: unknown[]): void {
  console.error(PREFIX, message, ...details);
}

/**
 * One line of text for anything that was thrown.
 *
 * Both realms render caught errors into UI, and a rejection that crossed the
 * Comlink bridge arrives as an Error while one from a JSON parse may not be, so
 * the non-Error case is the ordinary one rather than a defensive branch.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
