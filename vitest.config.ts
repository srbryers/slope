import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Several CLI integration tests create temp git repositories; Windows
    // process startup under full-suite contention can exceed Vitest's 5s default.
    testTimeout: 15_000,
  },
});
