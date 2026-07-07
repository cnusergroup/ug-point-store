import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mock AWS SDK clients (module-level singletons in handler.ts) — same pattern as
// digest/handler.test.ts.
// ============================================================

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({})),
}));

// ============================================================
// Mock the job modules so this test only exercises dispatch/routing logic in
// handler.ts, not the job orchestration itself (that's covered by
// detection-job/grace-period-job's own tests).
// ============================================================

const mockResolveDetectionQuarter = vi.fn();
vi.mock('./quarter', () => ({
  resolveDetectionQuarter: (...args: any[]) => mockResolveDetectionQuarter(...args),
}));

const mockRunUGLDetectionJob = vi.fn();
vi.mock('./detection-job', () => ({
  runUGLDetectionJob: (...args: any[]) => mockRunUGLDetectionJob(...args),
}));

const mockRunGracePeriodEvaluationJob = vi.fn();
vi.mock('./grace-period-job', () => ({
  runGracePeriodEvaluationJob: (...args: any[]) => mockRunGracePeriodEvaluationJob(...args),
}));

import { handler } from './handler';
import type { UGLExitJobEvent } from './handler';

// ============================================================
// EventBridge event dispatch — Requirements: 1.5
// ============================================================

describe('UGLExit handler event dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveDetectionQuarter.mockReturnValue({ valid: true, quarter: '2025-Q2' });
    mockRunUGLDetectionJob.mockResolvedValue({
      quarter: '2025-Q2',
      eligibleCount: 0,
      fullyInactiveCount: 0,
      remindersSent: 0,
      remindersSkippedAlreadyClaimed: 0,
      errors: 0,
    });
    mockRunGracePeriodEvaluationJob.mockResolvedValue({
      evaluated: 0,
      remedied: 0,
      markedPendingExit: 0,
      skippedAlreadyTransitioned: 0,
      errors: 0,
    });
  });

  it('routes jobType="detection" to resolveDetectionQuarter + runUGLDetectionJob', async () => {
    const event: UGLExitJobEvent = { jobType: 'detection', quarter: '2025-Q2' };

    await handler(event);

    expect(mockResolveDetectionQuarter).toHaveBeenCalledWith('2025-Q2');
    expect(mockRunUGLDetectionJob).toHaveBeenCalledTimes(1);
    expect(mockRunUGLDetectionJob).toHaveBeenCalledWith('2025-Q2', expect.any(Object));
    expect(mockRunGracePeriodEvaluationJob).not.toHaveBeenCalled();
  });

  it('routes jobType="detection" with omitted quarter (auto-resolved)', async () => {
    const event: UGLExitJobEvent = { jobType: 'detection' };

    await handler(event);

    expect(mockResolveDetectionQuarter).toHaveBeenCalledWith(undefined);
    expect(mockRunUGLDetectionJob).toHaveBeenCalledTimes(1);
  });

  it('logs and returns without calling runUGLDetectionJob when the resolved quarter is invalid', async () => {
    mockResolveDetectionQuarter.mockReturnValue({
      valid: false,
      error: { code: 'INVALID_QUARTER_FORMAT', message: 'bad format' },
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const event: UGLExitJobEvent = { jobType: 'detection', quarter: 'not-a-quarter' };

    await expect(handler(event)).resolves.toBeUndefined();

    expect(mockRunUGLDetectionJob).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('routes jobType="graceEvaluation" to runGracePeriodEvaluationJob', async () => {
    const event: UGLExitJobEvent = { jobType: 'graceEvaluation' };

    await handler(event);

    expect(mockRunGracePeriodEvaluationJob).toHaveBeenCalledTimes(1);
    expect(mockRunGracePeriodEvaluationJob).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
    expect(mockRunUGLDetectionJob).not.toHaveBeenCalled();
    expect(mockResolveDetectionQuarter).not.toHaveBeenCalled();
  });

  it('handles an unrecognized jobType gracefully: logs and does not throw', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const event = { jobType: 'somethingElse' } as unknown as UGLExitJobEvent;

    await expect(handler(event)).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(mockRunUGLDetectionJob).not.toHaveBeenCalled();
    expect(mockRunGracePeriodEvaluationJob).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
