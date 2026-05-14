import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to source (no build step required in tests)
      '@forge/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@horus/search': path.resolve(__dirname, '../../../../packages/search/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    // Use pool:forks so each test file runs in a real Node worker process,
    // which handles CJS packages (like semver) via native require() rather
    // than vite's bundler. This avoids the ./internal/re resolution failure.
    pool: 'forks',
    poolOptions: {
      forks: {
        // Let Node handle CJS packages natively
        execArgv: [],
      },
    },
    server: {
      deps: {
        // Don't inline CJS packages that use relative require() paths internally
        // (semver, typesense) — let native Node require handle them.
        external: [/.*semver.*/, /.*typesense.*/],
      },
    },
  },
});
