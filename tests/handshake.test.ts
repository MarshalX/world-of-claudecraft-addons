import { describe, expect, it } from 'vitest';

import {
  BOOT_GLOBAL,
  bootScript,
  createNonce,
  helloMessage,
  isHello,
  isPortOffer,
  portOfferMessage,
  takeBootPayload,
} from '../loader/src/shared/handshake.ts';

const HEX_NONCE = /^[0-9a-f]{32}$/;
const RUNTIME_DIED = /runtime died/;
const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = '00000000000000000000000000000000';
/** Where the fake runtime stashes what it saw. */
const SEEN = 'seenByRuntime';

/** Runs the composed script the way the injected <script> does. */
function runBootScript(script: string, scope: Record<string, unknown>): void {
  new Function('globalThis', script)(scope);
}

/** Every byte the same, so the hex encoding is the only thing under test. */
const fixedEntropy: Pick<Crypto, 'getRandomValues'> = {
  getRandomValues: (array) => {
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0x05);
    return array;
  },
};

describe('createNonce', () => {
  it('produces 32 hex characters', () => {
    expect(createNonce(crypto)).toMatch(HEX_NONCE);
  });

  // A dropped leading zero would shorten the nonce and, worse, let two distinct
  // byte sequences collide on one string.
  it('pads every byte to two digits', () => {
    expect(createNonce(fixedEntropy)).toBe('05'.repeat(16));
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 64 }, () => createNonce(crypto)));
    expect(seen.size).toBe(64);
  });
});

describe('boot payload', () => {
  it('hands the runtime the payload', () => {
    const scope: Record<string, unknown> = {};
    const claim = `globalThis[${JSON.stringify(SEEN)}] = globalThis.__wocBoot;`;
    runBootScript(bootScript({ nonce: NONCE }, claim), scope);

    expect(scope[SEEN]).toEqual({ nonce: NONCE });
  });

  // A leftover key is both a fingerprint and a handle for page code, so the
  // property has to be gone rather than set to undefined.
  it('removes the global rather than blanking it', () => {
    const scope: Record<string, unknown> = {};
    runBootScript(bootScript({ nonce: NONCE }, ''), scope);

    expect(Object.hasOwn(scope, BOOT_GLOBAL)).toBe(false);
  });

  // A runtime that dies before claiming the payload would otherwise leave the
  // nonce readable, and page code could replay the hello for the host's port.
  it('removes the global when the runtime throws before claiming it', () => {
    const scope: Record<string, unknown> = {};

    expect(() => {
      runBootScript(bootScript({ nonce: NONCE }, 'throw new Error("runtime died");'), scope);
    }).toThrow(RUNTIME_DIED);
    expect(Object.hasOwn(scope, BOOT_GLOBAL)).toBe(false);
  });

  it('removes the global even when the payload is unusable', () => {
    const scope: Record<string, unknown> = { [BOOT_GLOBAL]: { nonce: 42 } };

    expect(takeBootPayload(scope)).toBeNull();
    expect(Object.hasOwn(scope, BOOT_GLOBAL)).toBe(false);
  });

  it.each([
    ['absent', {}],
    ['not an object', { [BOOT_GLOBAL]: NONCE }],
    ['null', { [BOOT_GLOBAL]: null }],
    ['missing the nonce', { [BOOT_GLOBAL]: {} }],
    ['an empty nonce', { [BOOT_GLOBAL]: { nonce: '' } }],
  ])('rejects a payload that is %s', (_label, scope) => {
    expect(takeBootPayload({ ...scope })).toBeNull();
  });

  // Object.prototype carries no `nonce`, but the guard is what keeps that true
  // for a scope whose prototype someone else populated.
  it('ignores an inherited nonce', () => {
    const scope: Record<string, unknown> = { [BOOT_GLOBAL]: Object.create({ nonce: NONCE }) };

    expect(takeBootPayload(scope)).toBeNull();
  });
});

describe('handshake messages', () => {
  it('accepts its own message with the matching nonce', () => {
    expect(isHello(helloMessage(NONCE), NONCE)).toBe(true);
    expect(isPortOffer(portOfferMessage(NONCE), NONCE)).toBe(true);
  });

  it('rejects a different nonce', () => {
    expect(isHello(helloMessage(OTHER), NONCE)).toBe(false);
    expect(isPortOffer(portOfferMessage(OTHER), NONCE)).toBe(false);
  });

  // The two messages travel on the same window, so each side has to ignore its
  // own traffic or the host would answer the offer it just sent.
  it('does not confuse the two directions', () => {
    expect(isHello(portOfferMessage(NONCE), NONCE)).toBe(false);
    expect(isPortOffer(helloMessage(NONCE), NONCE)).toBe(false);
  });

  it.each([
    ['a string', NONCE],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['an unrelated object', { hello: NONCE }],
    ['a non-string field', { __wocHello: 1 }],
  ])('rejects %s from unrelated page traffic', (_label, data) => {
    expect(isHello(data, NONCE)).toBe(false);
    expect(isPortOffer(data, NONCE)).toBe(false);
  });
});
