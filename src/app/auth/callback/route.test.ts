import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { exchange } = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({
  auth: { exchangeCodeForSession: exchange },
}) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
import { GET } from './route';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://riverz.co');
  exchange.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('auth callback behind Render proxy', () => {
  it('redirects implicit recovery to the public origin, preserving browser hash inheritance', async () => {
    const response = await GET(new NextRequest('http://localhost:10000/auth/callback?next=/nueva-clave'));
    expect(response.headers.get('location')).toBe('https://riverz.co/nueva-clave');
    expect(exchange).not.toHaveBeenCalled();
  });
  it('exchanges a PKCE code and redirects to the public password form', async () => {
    const response = await GET(new NextRequest('http://localhost:10000/auth/callback?code=example&next=/nueva-clave'));
    expect(exchange).toHaveBeenCalledWith('example');
    expect(response.headers.get('location')).toBe('https://riverz.co/nueva-clave');
  });
  it('keeps failed exchanges on the public login page', async () => {
    exchange.mockResolvedValue({ error: { message: 'expired' } });
    const response = await GET(new NextRequest('http://localhost:10000/auth/callback?code=expired'));
    expect(response.headers.get('location')).toBe('https://riverz.co/ingresar?error=expired');
  });
  it('does not accept an external next destination', async () => {
    const response = await GET(new NextRequest('http://localhost:10000/auth/callback?next=https://example.com'));
    expect(response.headers.get('location')).toBe('https://riverz.co/panel');
  });
});
