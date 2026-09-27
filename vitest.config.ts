import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest 4 transforms with oxc and silently ignores an `esbuild` key. Keep in
  // step with tsconfig.json and loader/build-runtime.mjs.
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
    // An addon's suite lives beside it; `tests/` is for the loader.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'addons/*/*.test.ts'],
  },
});
