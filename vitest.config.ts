import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The manager UI is preact. Vitest 4 transforms with oxc rather than esbuild,
  // so the pair lives here rather than under an `esbuild` key, which it would
  // silently ignore. Kept in step with tsconfig.json and loader/build-runtime.mjs.
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'preact',
    },
  },
  test: {
    globals: true,
    // A DOM-touching test opts in per file with:
    //   // @vitest-environment happy-dom
    environment: 'node',
    // An addon's suite lives in the addon's own directory, next to the file it
    // runs. `tests/` holds everything about the LOADER, plus the shared fakes
    // both halves import; a suite about one addon belongs with that addon, and
    // travels with the directory a third-party marketplace would copy.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'addons/*/*.test.ts'],
  },
});
