// The two-realm bootstrap contract, shared by both halves.
//
// The host writes a boot payload onto the page's global scope and injects the
// runtime bundle in the same <script>, so the runtime reads and removes the
// payload before any other page code can run. The two then negotiate a
// MessagePort by nonce over window.postMessage, and all further traffic is on
// the port.
//
// The nonce is the only authenticator. An origin check on receipt would add
// nothing: a same-window postMessage is not delivered to frames, and a 128-bit
// CSPRNG value is not guessable by anything that could receive it. It would also
// be unreliable, because a userscript sandbox may hand out a proxied window
// whose identity does not compare equal to the event's source.

const NONCE_BYTES = 16;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;
const HELLO_KEY = '__wocHello';
const PORT_KEY = '__wocPort';

function ownString(data: unknown, key: string): string | null {
  if (typeof data !== 'object' || data === null || !Object.hasOwn(data, key)) {
    return null;
  }
  const value = (data as Record<string, unknown>)[key];
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

/**
 * The global surface the handshake uses.
 *
 * Narrower than Window on purpose. A userscript sandbox may hand out a proxied
 * global that is not the page's Window, and neither half needs more than this.
 */
export interface MessageScope {
  readonly addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  readonly removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  readonly postMessage: (message: unknown, targetOrigin: string, transfer?: Transferable[]) => void;
  readonly setTimeout: (handler: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly location: { readonly origin: string };
}

/** How long either side waits for its counterpart before giving up. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** The transient global the host writes and the runtime immediately removes. */
export const BOOT_GLOBAL = '__wocBoot';

export interface BootPayload {
  nonce: string;
}

export interface HelloMessage {
  __wocHello: string;
}

export interface PortOfferMessage {
  __wocPort: string;
}

export function createNonce(entropy: Pick<Crypto, 'getRandomValues'>): string {
  const bytes = entropy.getRandomValues(new Uint8Array(NONCE_BYTES));
  return Array.from(bytes, (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0'),
  ).join('');
}

/**
 * The full text of the injected script: payload, runtime, cleanup.
 *
 * The runtime claims the payload as its first act, so the `finally` is a
 * backstop for a runtime that throws before reaching it. Without it a dead
 * runtime would leave the nonce readable on the page global, and page code could
 * then replay the hello and be handed the host's port. The host cannot clear it
 * from its own side, because a sandbox global is not the page's.
 *
 * A bundle that fails to parse needs no backstop: the assignment never runs
 * either, since the whole script is one parse unit.
 */
export function bootScript(payload: BootPayload, source: string): string {
  const global = `globalThis[${JSON.stringify(BOOT_GLOBAL)}]`;
  return `${global}=${JSON.stringify(payload)};\ntry{\n${source}\n}finally{delete ${global};}`;
}

/**
 * Read the boot payload and remove it from the global scope.
 *
 * Removing rather than blanking it matters: a leftover enumerable key is both a
 * fingerprint and a handle for page code.
 */
export function takeBootPayload(scope: Record<string, unknown>): BootPayload | null {
  const raw = scope[BOOT_GLOBAL];
  Reflect.deleteProperty(scope, BOOT_GLOBAL);
  const nonce = ownString(raw, 'nonce');
  if (nonce === null || nonce.length === 0) {
    return null;
  }
  return { nonce };
}

export function helloMessage(nonce: string): HelloMessage {
  return { __wocHello: nonce };
}

export function portOfferMessage(nonce: string): PortOfferMessage {
  return { __wocPort: nonce };
}

export function isHello(data: unknown, nonce: string): boolean {
  return ownString(data, HELLO_KEY) === nonce;
}

export function isPortOffer(data: unknown, nonce: string): boolean {
  return ownString(data, PORT_KEY) === nonce;
}
