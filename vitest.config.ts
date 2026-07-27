import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx', 'packages/cdk/lambda/**/*.test.ts', 'packages/cdk/test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=8192'],
        maxForks: 3,
      },
    },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/cdk/**'],
    },
  },
  resolve: {
    alias: {
      '@points-mall/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
});
