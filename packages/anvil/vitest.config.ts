import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/**'],
      exclude: ['src/index.ts'],
    },
    testTimeout: 10000,
  },
  resolve: {
    conditions: ['node'],
  },
});
