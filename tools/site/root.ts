// Where the repository is, computed once.
//
// Its own module so that a Vitest suite can reach the site tools without knowing
// a path and without importing node:process to ask for the working directory:
// noNodejsModules is not exempt in tests/, and AGENTS.md says not to widen that.
// A default parameter here means the test calls `apiSurface()` and the node
// dependency stays on this side of the boundary, where it is already allowed.
//
// `import.meta.dirname` rather than fileURLToPath, for the same reason the tools
// already prefer it: it is not a Node module import at all.

import { join } from 'node:path';

/** The repository root, from tools/site/. */
export const ROOT = join(import.meta.dirname, '..', '..');
