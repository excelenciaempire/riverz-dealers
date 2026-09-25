import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ key: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/integrations/workspace-key', () => ({
  resolveWorkspaceKeyConOrigen: mocks.key,
}));
vi.mock('@/lib/wallet/puerta', () => ({ puedeUsarIa: async () => true }));
import {
  classifyApifyFailure,
  enrichExternalProfile,
  externalEnrichFailureReason,
  type ExternalEnrichResult,
} from './external-enrich';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('failed enrichment billing and retry', () => {
  it('does not charge or call Apify again for another contact with a rejected key', async () => {
    vi.stubEnv('APIFY_PROFILE_MAX_USAGE_USD', '0.05');
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.key.mockResolvedValue({
      key: 'rejected-enrichment-test',
      propia: false,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    for (const contactId of ['one', 'two']) {
      expect(
        await enrichExternalProfile({ rpc: mocks.rpc } as never, {
          contactId,
          workspaceId: 'workspace',
          username: '@test',
        })
      ).toBe('failed:authentication:http_401');
    }
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual([
      'wallet_reservar',
      'wallet_cancelar_reserva',
    ]);
    expect(mocks.rpc.mock.calls.some((c) => c[0] === 'wallet_liquidar')).toBe(
      false
    );
  });

  it('treats an unconfigured optional provider as skipped', async () => {
    mocks.key.mockResolvedValue(null);
    expect(
      await enrichExternalProfile({ rpc: mocks.rpc } as never, {
        contactId: 'one',
        username: '@test',
      })
    ).toBe('skipped');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

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
