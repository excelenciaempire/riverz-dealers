import { describe, expect, it } from 'vitest';
import { getProviderCooldown, setProviderCooldown } from './provider-cooldown';

describe('provider cooldown', () => {
  it('backs off rejected credentials without hiding the failure or extending the deadline', () => {
    setProviderCooldown('rejected', 'authentication', 401, 1_000);
    expect(getProviderCooldown('rejected', 2_000)?.status).toBe(401);
    expect(getProviderCooldown('rejected', 900_999)?.reason).toBe('authentication');
    expect(getProviderCooldown('rejected', 901_000)).toBeNull();
  });

  it('retries immediately after a credential change and isolates other accounts', () => {
    setProviderCooldown('old', 'billing', 402, 1_000);
    expect(getProviderCooldown('new', 2_000)).toBeNull();
    expect(getProviderCooldown('other-workspace', 2_000)).toBeNull();
  });

  it('uses a shorter rate limit delay and leaves transient failures retryable', () => {
    setProviderCooldown('limited', 'rate_limit', 429, 1_000);
    expect(getProviderCooldown('limited', 60_999)).not.toBeNull();
    expect(getProviderCooldown('limited', 61_000)).toBeNull();
    setProviderCooldown('transient', 'provider', 503, 1_000);
    expect(getProviderCooldown('transient', 2_000)).toBeNull();
  });
});
