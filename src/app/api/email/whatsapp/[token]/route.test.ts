import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  missing: false,
  disconnected: false,
  error: false,
  calls: [] as unknown[],
}));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          error: state.error ? { code: 'unavailable' } : null,
          data:
            table === 'email_whatsapp_links'
              ? state.missing
                ? null
                : {
                    workspace_id: 'ws',
                    whatsapp_connection_id: 'wa',
                    prefill: 'Hola [RZ-abcdef012345abcdef012345]',
                  }
              : state.disconnected
                ? null
                : { config: { display_phone_number: '+54 9 2255 62-9123' } },
        }),
      };
      return q;
    },
    rpc: async (...args: unknown[]) => {
      state.calls.push(args);
      return { error: null };
    },
  }),
}));
import { GET } from './route';
beforeEach(() => {
  state.missing = false;
  state.disconnected = false;
  state.error = false;
  state.calls = [];
});
const token = 'abcdef012345abcdef012345';
const open = (value = token, method = 'GET') =>
  GET(
    new Request('https://riverzai.com/api/email/whatsapp/' + value, { method }),
    { params: Promise.resolve({ token: value }) }
  );
describe('email WhatsApp redirect', () => {
  it('opens only the connected line, with the source reference and no cache', async () => {
    const response = await open();
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location')!);
    expect(target.origin).toBe('https://wa.me');
    expect(target.pathname).toBe('/5492255629123');
    expect(target.searchParams.get('text')).toBe(`Hola [RZ-${token}]`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.calls).toEqual([
      ['count_email_whatsapp_click', { p_token: token }],
    ]);
  });
  it('does not count HEAD checks as clicks', async () => {
    expect((await open(token, 'HEAD')).status).toBe(302);
    expect(state.calls).toHaveLength(0);
  });
  it('rejects forged or unknown references without accepting a user-supplied destination', async () => {
    expect((await open('evil?phone=123')).status).toBe(404);
    state.missing = true;
    expect((await open()).status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
  it('does not redirect to a disconnected line or when storage is unavailable', async () => {
    state.disconnected = true;
    expect((await open()).status).toBe(503);
    state.error = true;
    expect((await open()).status).toBe(503);
    expect(state.calls).toHaveLength(0);
  });
});
