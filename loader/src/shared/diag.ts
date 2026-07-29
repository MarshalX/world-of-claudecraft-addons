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
