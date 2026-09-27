// What an addon may declare it needs. Kept out of shared/schema.ts because the manager needs
// the list as a value in the page realm, and a value import from schema.ts drags zod along.

export const PERMISSIONS = ['net.read', 'world.read', 'ui', 'sound', 'keys', 'storage'] as const;

export type Permission = (typeof PERMISSIONS)[number];
