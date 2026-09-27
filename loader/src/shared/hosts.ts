// The supported game deployments and the channel each origin maps to.

export const CHANNELS = ['live', 'pbe', 'pbe2'] as const;

export type Channel = (typeof CHANNELS)[number];

/** The userscript @match list in vite.config.ts must stay in step with these origins. */
export const HOST_CHANNELS: Readonly<Record<string, Channel>> = Object.freeze({
  'https://worldofclaudecraft.com': 'live',
  'https://pbe.worldofclaudecraft.com': 'pbe',
  'https://pbe2.worldofclaudecraft.com': 'pbe2',
});

export function channelForOrigin(origin: string): Channel | null {
  // A bare index walks the prototype chain, so '__proto__' would resolve to an object.
  if (!Object.hasOwn(HOST_CHANNELS, origin)) {
    return null;
  }
  return HOST_CHANNELS[origin] as Channel;
}

/** Whether an origin is a game host the loader should activate on. */
export function isGameHost(origin: string): boolean {
  return channelForOrigin(origin) !== null;
}

/**
 * The scope key for per-character UI state. Carries the channel because character ids are not
 * comparable across deployments.
 */
export function characterScope(channel: Channel, characterId: string | number): string {
  return `${channel}:${characterId}`;
}
