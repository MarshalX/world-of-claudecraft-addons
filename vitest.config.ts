import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // A DOM-touching test opts in per file with:
    //   // @vitest-environment happy-dom
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
