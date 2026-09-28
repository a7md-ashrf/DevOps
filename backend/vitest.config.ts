import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // All integration tests share ONE test database (appdb_test). Running test
    // files concurrently would let two files truncate/insert the same rows at
    // the same time, so files run one after another. The suite is small — the
    // wall-clock cost is negligible next to the flakiness it prevents.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
