import { describe, expect, it } from 'vitest';
import {
  CRON_ERROR_GRACE_MS,
  CRON_FAILURE_CONFIRMATION_GAP_MS,
  isActionableCronFailure,
  needsCronFailureConfirmation,
  shouldRetryScheduledResponse,
} from './recovery';
import type { ScheduledJob } from './schedule';

const retryableJob = { retryOnFailure: true } as ScheduledJob;

describe('scheduled job recovery', () => {
  it('retries one short partial or provider failure', () => {
    expect(
      shouldRetryScheduledResponse({
        job: retryableJob,
        status: 207,
        durationMs: 5_000,
        attempt: 1,
      })
    ).toBe(true);
    expect(
      shouldRetryScheduledResponse({
        job: retryableJob,
        status: 503,
        durationMs: 5_000,
        attempt: 1,
      })
    ).toBe(true);
  });

  it('does not repeat unsafe, completed, long or already retried work', () => {
    expect(
      shouldRetryScheduledResponse({
        job: {} as ScheduledJob,
        status: 500,
        durationMs: 10,
        attempt: 1,
      })
    ).toBe(false);
    expect(
      shouldRetryScheduledResponse({
        job: retryableJob,
        status: 200,
        durationMs: 10,
        attempt: 1,
      })
    ).toBe(false);
    expect(
      shouldRetryScheduledResponse({
        job: retryableJob,
        status: 500,
        durationMs: 61_000,
        attempt: 1,
      })
    ).toBe(false);
    expect(
      shouldRetryScheduledResponse({
        job: retryableJob,
        status: 500,
        durationMs: 10,
        attempt: 2,
      })
    ).toBe(false);
  });
});

describe('admin alert confirmation', () => {
  const now = Date.parse('2026-09-04T18:30:00.000Z');

  it('keeps checking the previous result while a recovery is running', () => {
    expect(needsCronFailureConfirmation('running')).toBe(true);
    expect(needsCronFailureConfirmation('error')).toBe(true);
    expect(needsCronFailureConfirmation('ok')).toBe(false);
  });

  it('ignores one recent failure that the recovery system can still fix', () => {
    expect(
      isActionableCronFailure(
        [
          {
            status: 'error',
            started_at: new Date(now - 5 * 60_000).toISOString(),
          },
          {
            status: 'ok',
            started_at: new Date(now - 10 * 60_000).toISOString(),
          },
        ],
        now
      )
    ).toBe(false);
  });

  it('does not treat an immediate automatic retry as another incident', () => {
    expect(
      isActionableCronFailure(
        [
          { status: 'error', started_at: new Date(now - 2_000).toISOString() },
          { status: 'error', started_at: new Date(now - 5_000).toISOString() },
        ],
        now
      )
    ).toBe(false);
  });

  it('alerts after failures in two distinct scheduled cycles', () => {
    expect(
      isActionableCronFailure(
        [
          { status: 'error', started_at: new Date(now - 2_000).toISOString() },
          {
            status: 'error',
            started_at: new Date(
              now - CRON_FAILURE_CONFIRMATION_GAP_MS - 2_000
            ).toISOString(),
          },
          { status: 'ok', started_at: new Date(now - 60_000).toISOString() },
        ],
        now
      )
    ).toBe(true);
  });

  it('alerts when a lone error remains unresolved beyond the grace period', () => {
    expect(
      isActionableCronFailure(
        [
          {
            status: 'error',
            started_at: new Date(now - CRON_ERROR_GRACE_MS).toISOString(),
          },
          {
            status: 'ok',
            started_at: new Date(now - 86_400_000).toISOString(),
          },
        ],
        now
      )
    ).toBe(true);
  });
});
