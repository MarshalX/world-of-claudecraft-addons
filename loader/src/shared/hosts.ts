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
  // Object.hasOwn, not a bare index: a plain read walks the prototype chain, so
  // an origin of '__proto__' or 'constructor' resolves to a truthy object.
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
 * The scope key for per-character UI state such as frame positions.
 *
 * Character ids are not comparable across deployments, so the channel is part of
 * the key. Addon settings and enable state are shared across hosts and do not
 * use this.
 */
export function characterScope(channel: Channel, characterId: string | number): string {
  return `${channel}:${characterId}`;
}
