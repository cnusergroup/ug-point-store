import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { selectEarliestMakeupRecord, evaluateGracePeriodOutcome } from './grace-evaluation';
import type { ExitQualifyingRecord } from './eligibility';

// ============================================================
// Arbitraries
// ============================================================

const isoDateArb = fc
  .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-12-31').getTime() })
  .map((ts) => new Date(ts).toISOString());

const recordIdArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `r_${s}`);
const userIdArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `u_${s}`);

const recordArb: fc.Arbitrary<ExitQualifyingRecord> = fc.record({
  recordId: recordIdArb,
  userId: userIdArb,
  targetRole: fc.constant('UserGroupLeader' as const),
  activityDate: fc.option(isoDateArb.map((d) => d.substring(0, 10)), { nil: undefined }),
  createdAt: isoDateArb,
});

const candidatesArb = fc.array(recordArb, { minLength: 0, maxLength: 15 });

/** Same shape as candidatesArb, but with createdAt values forced to be distinct. */
const distinctCreatedAtCandidatesArb = fc
  .array(recordArb, { minLength: 1, maxLength: 15 })
  .map((records) => {
    // De-duplicate createdAt by offsetting collisions by 1ms increments, preserving order.
    const seen = new Set<string>();
    return records.map((r) => {
      let ts = new Date(r.createdAt).getTime();
      let candidate = new Date(ts).toISOString();
      while (seen.has(candidate)) {
        ts += 1;
        candidate = new Date(ts).toISOString();
      }
      seen.add(candidate);
      return { ...r, createdAt: candidate };
    });
  });

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 6: Grace-period evaluation outcome correctness
//
// For any set of candidate qualifying records for a user's grace period window,
// evaluateGracePeriodOutcome(candidates) returns remedied: true if and only if candidates
// is non-empty, and in that case the returned record is a member of candidates; it returns
// remedied: false if and only if candidates is empty.
//
// **Validates: Requirements 5.2, 5.3, 5.5**
// ============================================================
describe('Property 6: Grace-period evaluation outcome correctness', () => {
  it('remedied is true iff candidates is non-empty, and the returned record is a member of candidates', () => {
    fc.assert(
      fc.property(candidatesArb, (candidates) => {
        const outcome = evaluateGracePeriodOutcome(candidates);

        if (candidates.length === 0) {
          expect(outcome).toEqual({ remedied: false });
        } else {
          expect(outcome.remedied).toBe(true);
          if (outcome.remedied) {
            expect(candidates).toContainEqual(outcome.record);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('remedied is false iff candidates is empty', () => {
    fc.assert(
      fc.property(candidatesArb, (candidates) => {
        const outcome = evaluateGracePeriodOutcome(candidates);
        expect(outcome.remedied).toBe(candidates.length > 0);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 7: Earliest makeup record selection
//
// For any non-empty set of candidate qualifying records with distinct createdAt values,
// selectEarliestMakeupRecord returns the single record whose createdAt is the minimum among
// all candidates; every other candidate in the set is excluded from the returned value (and
// therefore remains available, unconsumed, for a later Detection_Quarter's evaluation).
//
// **Validates: Requirements 5.4**
// ============================================================
describe('Property 7: Earliest makeup record selection', () => {
  it('returns the candidate with the minimum createdAt among distinct-createdAt candidates', () => {
    fc.assert(
      fc.property(distinctCreatedAtCandidatesArb, (candidates) => {
        const result = selectEarliestMakeupRecord(candidates);
        expect(result).not.toBeNull();

        const expectedEarliest = candidates.reduce((min, r) => (r.createdAt < min.createdAt ? r : min));
        expect(result).toEqual(expectedEarliest);

        // Every other candidate is excluded from the returned value.
        for (const candidate of candidates) {
          if (candidate.recordId !== result!.recordId) {
            expect(result).not.toEqual(candidate);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns null for an empty candidate set', () => {
    expect(selectEarliestMakeupRecord([])).toBeNull();
  });
});
