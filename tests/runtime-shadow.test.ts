// The globals an addon's closure shadows.
//
// The point of these is not that they are unreachable, which they are not: the
// closure runs in the page realm and `Function('return this')()` reaches all of
// them. The point is that reaching for one out of habit fails immediately and
// says which API to use, so an addon cannot quietly couple itself to the game's
// own storage keys or open its own socket.

import { describe, expect, it } from 'vitest';
import { createShadows, SHADOWED, shadowError } from '../loader/src/runtime/shadow.ts';

const SHADOWED_MESSAGE = /is shadowed inside an addon/;

/**
 * Computed access, because the property being read is arbitrary: the shadow is
 * meant to throw on any name at all, not on one this test chose.
 */
function read(shadow: Record<string, unknown>, prop: string): unknown {
  return shadow[prop];
}

function write(shadow: Record<string, unknown>, prop: string): void {
  shadow[prop] = 1;
}

/** The shadow value for one name, from a fresh set. */
function shadowFor(name: string): Record<string, unknown> {
  const shadows = createShadows();
  const at = shadows.names.indexOf(name);
  if (at < 0) {
    throw new Error(`${name} is not shadowed`);
  }
  return shadows.values[at] as Record<string, unknown>;
}

describe('what is shadowed', () => {
  it('covers the storage, transport, and game globals', () => {
    expect([...SHADOWED]).toEqual([
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'XMLHttpRequest',
      'WebSocket',
      '__game',
    ]);
  });

  // The names and the values are positional parameters of the generated
  // function, so a mismatch would hand an addon the wrong shadow under the wrong
  // name and every error message would point at the wrong API.
  it('pairs one value with each name', () => {
    const shadows = createShadows();

    expect(shadows.values).toHaveLength(shadows.names.length);
  });

  // A shared proxy would be one object every addon could reach through the error
  // it throws. Building six per addon costs nothing next to evaluating a file.
  // Compared through Object.is rather than through toBe: the matcher inspects
  // both values to build its diff, and inspecting one of these throws, which is
  // exactly what the rest of this suite is about.
  it('builds a fresh set per call', () => {
    const same = Object.is(createShadows().values[0], createShadows().values[0]);

    expect(same).toBe(false);
  });
});

describe('using one', () => {
  it.each([...SHADOWED])('throws when %s is read from', (name) => {
    expect(() => read(shadowFor(name), 'anything')).toThrow(SHADOWED_MESSAGE);
  });

  it.each([...SHADOWED])('throws when %s is written to', (name) => {
    expect(() => {
      write(shadowFor(name), 'anything');
    }).toThrow(SHADOWED_MESSAGE);
  });

  it('throws on a constructor call', () => {
    const Shadow = shadowFor('WebSocket') as unknown as new (url: string) => unknown;

    expect(() => new Shadow('wss://example.invalid')).toThrow(/is shadowed inside an addon/);
  });

  it('throws on a plain call', () => {
    const shadow = shadowFor('XMLHttpRequest') as unknown as () => unknown;

    expect(() => shadow()).toThrow(/is shadowed inside an addon/);
  });

  it('throws on an `in` check', () => {
    expect(() => 'length' in shadowFor('localStorage')).toThrow(SHADOWED_MESSAGE);
  });
});

describe('the message', () => {
  it.each([
    ['localStorage', 'woc.storage'],
    ['sessionStorage', 'woc.storage'],
    ['indexedDB', 'woc.storage'],
    ['XMLHttpRequest', 'fetch'],
    ['WebSocket', 'woc.net'],
    ['__game', 'woc.world'],
  ])('points %s at %s', (name, alternative) => {
    expect(shadowError(name).message).toContain(`use ${alternative} instead`);
  });

  // It is a guardrail and the loader says so everywhere else, so the one message
  // an addon author actually reads must say it too.
  it('does not claim to be a security boundary', () => {
    expect(shadowError('localStorage').message).toContain('not as a security boundary');
  });
});

// Logging one of these while debugging must print what happened rather than
// throw a second error on top of the first one being investigated.
describe('inspecting one', () => {
  it.each([...SHADOWED])('lets %s stringify', (name) => {
    expect(String(shadowFor(name))).toBe(`[shadowed ${name}]`);
  });

  it('stays a function to typeof, so a constructor check does not throw', () => {
    expect(typeof shadowFor('WebSocket')).toBe('function');
  });
});
