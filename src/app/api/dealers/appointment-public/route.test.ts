import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/dealers/server', () => ({
  dealerFailure: (e: { message: string; status: number }) =>
    new Response(JSON.stringify({ error: e.message }), { status: e.status }),
  checkDb: vi.fn(),
}));
vi.mock('@/lib/dealers/appointment-links', () => ({
  resolveDealerAppointment: m.resolve,
  dealerAvailableSlots: async () => [],
  dealerLinkHash: (token: string) => token,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
import { POST } from './route';
const token = 'a'.repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dealers.test');
  m.resolve.mockResolvedValue({
    ap: {
      starts_at: '2026-10-05T14:00:00Z',
      ends_at: '2026-10-05T14:30:00Z',
      status: 'requested',
      customer_confirmed: false,
      location: 'Showroom',
      kind: 'visit',
    },
    settings: {
      business: {
        timezone: 'America/New_York',
        name: 'Demo',
        seller_name: 'Demo seller',
        maps_url: '',
        video_url: '',
      },
      appointments: { allow_reschedule: true },
    },
    vehicle: { year: 2026, make: 'Toyota', model: 'Camry', photos: [] },
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('buyer portal behind the production reverse proxy', () => {
  it('accepts the configured public origin despite an internal HTTP request URL', async () => {
    const r = await POST(
      new Request('http://127.0.0.1:10000/api/dealers/appointment-public', {
        method: 'POST',
        headers: { Origin: 'https://dealers.test' },
        body: JSON.stringify({ token, action: 'view' }),
      })
    );
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.vehicle.title).toBe('2026 Toyota Camry');
    expect(b).not.toHaveProperty('phone');
    expect(b).not.toHaveProperty('contact_id');
  });
  it('rejects a foreign browser origin before resolving a token', async () => {
    const r = await POST(
      new Request('http://127.0.0.1:10000/api/dealers/appointment-public', {
        method: 'POST',
        headers: { Origin: 'https://attacker.test' },
        body: JSON.stringify({ token, action: 'confirm' }),
      })
    );
    expect(r.status).toBe(403);
    expect(m.resolve).not.toHaveBeenCalled();
  });
});
