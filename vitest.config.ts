import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only this repo's source — never the node_modules or .claude worktrees.
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**', 'dist/**'],
  },
});
