// The globals an addon's closure shadows. They stay reachable through the page realm; a
// shadow makes a habitual reach fail at once and name the sanctioned API.

import { describe, expect, it } from 'vitest';
import { createShadows, SHADOWED, shadowError } from '../loader/src/runtime/shadow.ts';

const SHADOWED_MESSAGE = /is shadowed inside an addon/;

/** Computed access, since the shadow throws on any property name. */
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

  // Names and values are positional parameters of the generated function.
  it('pairs one value with each name', () => {
    const shadows = createShadows();

    expect(shadows.values).toHaveLength(shadows.names.length);
  });

  // A shared proxy would be reachable by every addon through the error it throws. Compared
  // with Object.is because toBe inspects both values for its diff, which throws.
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

  // It is a guardrail, and the message an author reads must say so.
  it('does not claim to be a security boundary', () => {
    expect(shadowError('localStorage').message).toContain('not as a security boundary');
  });
});

// Logging one while debugging must not throw a second error.
describe('inspecting one', () => {
  it.each([...SHADOWED])('lets %s stringify', (name) => {
    expect(String(shadowFor(name))).toBe(`[shadowed ${name}]`);
  });

  it('stays a function to typeof', () => {
    expect(typeof shadowFor('WebSocket')).toBe('function');
  });
});
