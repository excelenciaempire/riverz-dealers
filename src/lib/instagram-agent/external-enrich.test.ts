import { describe, expect, it } from 'vitest';
import {
  classifyApifyFailure,
  externalEnrichFailureReason,
  type ExternalEnrichResult,
} from './external-enrich';

describe('Apify failure classification', () => {
  it('separates credentials, billing, limits and provider outages', () => {
    expect(classifyApifyFailure(401)).toBe('authentication');
    expect(classifyApifyFailure(402)).toBe('billing');
    expect(
      classifyApifyFailure(400, 'not-enough-usage-to-run-paid-actor')
    ).toBe('billing');
    expect(classifyApifyFailure(429)).toBe('rate_limit');
    expect(classifyApifyFailure(503)).toBe('provider');
    expect(classifyApifyFailure(400)).toBe('request');
  });

  it('extracts a stable reason without exposing provider response bodies', () => {
    expect(
      externalEnrichFailureReason(
        'failed:authentication:http_401' as ExternalEnrichResult
      )
    ).toBe('authentication');
    expect(externalEnrichFailureReason('enriched')).toBeNull();
  });
});
