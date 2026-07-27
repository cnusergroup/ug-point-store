/**
 * Feature: property-test-await-reliability, Property 1: Async property assertions are observable
 *
 * Regression guard for Bug Condition A. The detector runs over the whole corpus - the file set
 * matched by the `include` patterns in `vitest.config.ts` - and this test fails with the
 * `file:line` list of every un-awaited `fc.assert(fc.asyncProperty(...))` call it finds.
 *
 * On unfixed code this test FAILS: that failure is the evidence that the bug exists. It passes
 * once every occurrence has been converted to `async` callback + `await fc.assert(...)`, and it
 * keeps failing for any new or modified file that reintroduces the shape.
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.9**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  auditCorpus,
  collectCorpusFiles,
  countFindings,
  findRepoRoot,
  formatAudit,
} from './property-await-audit';

const ROOT = findRepoRoot();

// Files whose async assertions are already correctly awaited. They must never be reported.
// This guards against the 400-character window-scan misclassification seen during analysis.
const KNOWN_CLEAN_PREFIXES = [
  'packages/backend/src/admin/roles-permission.property.test.ts',
  'packages/backend/src/travel/settings.property.test.ts',
  'packages/backend/src/email/send.property.test.ts',
  'packages/backend/src/ugl-exit/',
  'packages/backend/src/digest/',
];

describe('Feature: property-test-await-reliability, Property 1: Async property assertions are observable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers a non-empty corpus from the vitest include patterns', () => {
    const files = collectCorpusFiles(ROOT);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('packages/backend/src/travel/apply.property.test.ts');
    expect(files).toContain('packages/backend/src/travel/review.property.test.ts');
  });

  it('reports zero un-awaited fc.assert(fc.asyncProperty(...)) calls in the corpus', () => {
    const audit = auditCorpus(ROOT);
    const total = countFindings(audit);
    expect(
      total,
      total === 0
        ? ''
        : `${total} un-awaited fc.assert(fc.asyncProperty(...)) call(s) found:\n${formatAudit(audit)}`,
    ).toBe(0);
  });

  it('reports no findings for files whose async assertions are already awaited', () => {
    const audit = auditCorpus(ROOT);
    const falsePositives = audit.filter((entry) =>
      KNOWN_CLEAN_PREFIXES.some((prefix) => entry.file.startsWith(prefix)),
    );
    expect(
      falsePositives.map((entry) => entry.file),
      `false positives reported:\n${formatAudit(falsePositives)}`,
    ).toEqual([]);
  });
});
