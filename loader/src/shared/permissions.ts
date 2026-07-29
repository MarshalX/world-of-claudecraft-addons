// What an addon may declare it needs.
//
// Alone in its own module, and not in shared/schema.ts where the schema that
// validates it lives, for the same reason API_VERSION is: a VALUE import of
// anything in a zod module drags zod and its fifty locale files with it, and the
// manager renders one line per permission, so it needs the list at runtime in
// the page realm. loader/build-runtime.mjs caught exactly this when the install
// confirmation was written, which is the second time that guard has earned its
// place. A type import from schema.ts costs nothing; a value import costs the
// library.

export const PERMISSIONS = ['net.read', 'world.read', 'ui', 'sound', 'keys', 'storage'] as const;

export type Permission = (typeof PERMISSIONS)[number];
