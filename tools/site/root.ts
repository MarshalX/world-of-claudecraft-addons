// Where the repository is, in its own module so a Vitest suite reaches the site tools through a
// default parameter without importing a Node module itself (noNodejsModules applies in tests/).

import { join } from 'node:path';

/** The repository root, from tools/site/. */
export const ROOT = join(import.meta.dirname, '..', '..');
