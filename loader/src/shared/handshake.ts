// The two-realm bootstrap contract. The host injects the boot payload and the runtime in one
// <script>, so the runtime takes the payload before other page code runs; the two then trade a
// MessagePort by nonce over window.postMessage and use only the port afterwards.
//
// The nonce is the only authenticator. An origin or source check adds nothing and is unreliable,
// since a userscript sandbox may hand out a proxied window that does not compare equal.

const NONCE_BYTES = 16;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;
const HELLO_KEY = '__wocHello';
const PORT_KEY = '__wocPort';
const UNKNOWN_VERSION = 'unknown';

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

/** The global surface the handshake uses, narrower than Window because a sandbox may proxy it. */
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
  /** The installed userscript's version from GM_info, which a compiled-in constant cannot know. */
  version: string;
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
 * The full text of the injected script: payload, runtime, cleanup. The `finally` removes the
 * payload if the runtime throws before claiming it, or page code could replay the hello and take
 * the host's port. The host cannot clear it itself, since a sandbox global is not the page's.
 */
export function bootScript(payload: BootPayload, source: string): string {
  const global = `globalThis[${JSON.stringify(BOOT_GLOBAL)}]`;
  return `${global}=${JSON.stringify(payload)};\ntry{\n${source}\n}finally{delete ${global};}`;
}

/** Read the boot payload and delete it: a blanked key would still fingerprint the loader. */
export function takeBootPayload(scope: Record<string, unknown>): BootPayload | null {
  const raw = scope[BOOT_GLOBAL];
  Reflect.deleteProperty(scope, BOOT_GLOBAL);
  const nonce = ownString(raw, 'nonce');
  if (nonce === null || nonce.length === 0) {
    return null;
  }
  // A missing nonce is fatal; a missing version only costs a Diagnostics line.
  return { nonce, version: ownString(raw, 'version') ?? UNKNOWN_VERSION };
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
