import { describe, expect, it } from 'vitest';
import {
  CRON_ERROR_GRACE_MS,
  isActionableCronFailure,
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

  it('alerts after two consecutive failures', () => {
    expect(
      isActionableCronFailure(
        [
          { status: 'error', started_at: new Date(now - 2_000).toISOString() },
          { status: 'error', started_at: new Date(now - 5_000).toISOString() },
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
