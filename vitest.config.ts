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
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
