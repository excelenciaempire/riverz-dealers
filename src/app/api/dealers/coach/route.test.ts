import { beforeEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), limit: vi.fn() };
  for (const key of (['select', 'eq'] as const)) query[key].mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [], error: null });
  const db = { from: vi.fn(() => query) },
    admin = {
      from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) })),
    };
  return { db, admin, data: vi.fn(), context: vi.fn(), client: vi.fn() };
});
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }));
vi.mock('@/lib/dealers/server', () => ({
  dealerContext: m.context,
  readDealerData: m.data,
  checkDb: (e: unknown) => {
    if (e) throw e;
  },
  dealerFailure: (e: Error) =>
    new Response(JSON.stringify({ error: e.message }), { status: 404 }),
}));
vi.mock('@/lib/dealers/settings-server', () => ({
  readDealerSettings: async () => ({
    settings: {
      coach: {
        enabled: true,
        language: 'es',
        tone: 'professional',
        instructions: '',
        practice_objections: [],
      },
    },
  }),
}));
vi.mock('@/lib/ai/platform-key', () => ({
  resolveAnthropicKey: async () => ({ key: 'test-key', source: 'platform' }),
}));
vi.mock('@/lib/ai/anthropic-client', () => ({ getAnthropic: m.client }));
vi.mock('@/lib/ai/rate-limit', () => ({ aiBudgetGuard: async () => null }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => m.admin,
}));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.clearAllMocks();
  m.context.mockResolvedValue({
    db: m.db,
    workspaceId: 'verified-workspace',
    userId: 'verified-user',
  });
  m.data.mockResolvedValue({
    opportunities: [{ id, contact_id: 'buyer' }],
    vehicles: [],
    interests: [],
    appointments: [],
    activities: [],
  });
  m.client.mockReturnValue({
    messages: {
      create: vi.fn(async () => ({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: 'A useful seller brief based on actual buyer facts.',
          },
        ],
      })),
    },
  });
});
describe('dealer coach billing and tenant boundary', () => {
  it('reads buyer context with member permissions and meters with the verified workspace service client', async () => {
    const response = await POST(
      new Request('https://dealers.test/api/dealers/coach', {
        method: 'POST',
        body: JSON.stringify({ mode: 'brief', opportunity_id: id, input: '' }),
      })
    );
    expect(response.status).toBe(200);
    expect(m.data).toHaveBeenCalledWith(
      m.db,
      'verified-workspace',
      'verified-user'
    );
    expect(m.client).toHaveBeenCalledWith(
      'test-key',
      expect.objectContaining({
        db: m.admin,
        workspaceId: 'verified-workspace',
      })
    );
    expect(m.admin.from).toHaveBeenCalledWith('dealer_coaching');
  });
  it('rejects a foreign buyer before calling the provider', async () => {
    m.data.mockResolvedValue({
      opportunities: [],
      vehicles: [],
      interests: [],
      appointments: [],
      activities: [],
    });
    expect(
      (
        await POST(
          new Request('https://dealers.test/api/dealers/coach', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'brief',
              opportunity_id: id,
              input: '',
            }),
          })
        )
      ).status
    ).toBe(404);
    expect(m.client).not.toHaveBeenCalled();
  });
});
