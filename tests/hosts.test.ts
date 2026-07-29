import { describe, expect, it } from 'vitest';

import {
  CHANNELS,
  channelForOrigin,
  characterScope,
  isGameHost,
} from '../loader/src/shared/hosts.ts';

describe('channelForOrigin', () => {
  it.each([
    ['https://worldofclaudecraft.com', 'live'],
    ['https://pbe.worldofclaudecraft.com', 'pbe'],
    ['https://pbe2.worldofclaudecraft.com', 'pbe2'],
  ])('maps %s to %s', (origin, channel) => {
    expect(channelForOrigin(origin)).toBe(channel);
  });

  // An unknown origin must not resolve to a channel, or the loader would inject
  // its DOM into an unrelated page.
  it.each([
    'https://evil.example',
    'http://worldofclaudecraft.com',
    'https://worldofclaudecraft.com.evil.example',
    'https://pbe3.worldofclaudecraft.com',
    '',
  ])('returns null for %j', (origin) => {
    expect(channelForOrigin(origin)).toBeNull();
    expect(isGameHost(origin)).toBe(false);
  });

  it('never resolves via prototype keys', () => {
    expect(channelForOrigin('__proto__')).toBeNull();
    expect(channelForOrigin('constructor')).toBeNull();
  });

  it('covers every declared channel', () => {
    const mapped = new Set(CHANNELS.map((c) => c));
    for (const channel of CHANNELS) {
      expect(mapped.has(channel)).toBe(true);
    }
    expect(CHANNELS).toHaveLength(3);
  });
});

describe('characterScope', () => {
  // Character ids are not comparable across deployments, so the channel has to
  // be part of the key or live and pbe frames would collide.
  it('separates the same character id across channels', () => {
    expect(characterScope('live', 42)).not.toBe(characterScope('pbe', 42));
  });

  it('is stable for the same pair', () => {
    expect(characterScope('live', 42)).toBe(characterScope('live', 42));
    expect(characterScope('live', '42')).toBe('live:42');
  });
});
