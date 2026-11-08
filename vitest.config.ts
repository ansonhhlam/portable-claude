import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/server/**/*.ts', 'src/cli/**/*.ts', 'src/shared/**/*.ts'],
      // The real SDK adapter and process entry points are exercised by the
      // packaged smoke test rather than unit tests.
      exclude: ['src/server/sdk/real.ts', 'src/cli/bin.ts'],
      thresholds: { lines: 80 },
    },
  },
});
