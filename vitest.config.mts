import { defineConfig } from 'vitest/config';

// Dashboard unit tests only; the bot in bot/ has its own Jest suite.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
