/**
 * Vitest config used only by the fixture-driven exploration runs of the
 * `property-test-await-reliability` spec.
 *
 * Fixture specs are named `*.fixture.ts`, so they are deliberately OUTSIDE the corpus that
 * `vitest.config.ts` discovers (the `include` patterns only match `.test.ts` / `.test.tsx`).
 * Two reasons:
 *   1. A fixture spec contains a deliberately violated property and a deliberately un-awaited
 *      `fc.assert(fc.asyncProperty(...))`. If it were part of the corpus it would add findings to
 *      the audit in `property-await-guard.test.ts` and break that guard.
 *   2. The exploration tests need to observe a whole child run in isolation (exit code, failure
 *      count, unhandled-rejection noise), which is only meaningful when the fixture is the only
 *      file in the run.
 *
 * Settings mirror the root `vitest.config.ts` (globals, node environment, shared alias) so the
 * child run behaves like a real repo run. Nothing outside `packages/backend/src` is imported, to
 * keep `tsc -b packages/backend` (rootDir: ./src) happy.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../../../..');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: repoRoot,
    include: ['packages/*/src/**/*.fixture.ts'],
  },
  resolve: {
    alias: {
      '@points-mall/shared': path.resolve(repoRoot, 'packages/shared/src'),
    },
  },
});
