import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ insert: vi.fn(), locale: 'en', user: { id: 'admin' } as { id: string } | null, role: 'admin', csrf: false }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => h.csrf ? new Response(null, { status: 403 }) : null }));
vi.mock('@/lib/i18n/server', () => ({ safeLocale: async () => h.locale }));
vi.mock('@/lib/instagram-agent/workspace', () => ({ resolveWorkspaceId: async () => 'server-business' }));
vi.mock('@/lib/webhooks/outbound', () => ({ WEBHOOK_EVENTS: ['message.sent', 'message.received'] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) }, from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: h.role } }) }; return q;
} }) }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ from: () => ({ insert: (row: unknown) => {
  h.insert(row); return { select: () => ({ single: async () => ({ data: { id: 'new-endpoint' }, error: null }) }) };
} }) }) }));
import { POST } from './route';
beforeEach(() => { h.insert.mockClear(); h.user = { id: 'admin' }; h.role = 'admin'; h.csrf = false; h.locale = 'en'; });
const run = (body: unknown) => POST(new Request('https://riverz.test/api/integrations/webhooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const valid = () => ({ name: 'Automation receiver', url: 'https://receiver.test/events', events: ['message.sent'] });
it.each(['https://localhost', 'https://10.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://user:secret@receiver.test', 'http://receiver.test'])('does not store a forbidden destination: %s', async url => {
  const response = await run({ ...valid(), url }); expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'invalid_webhook', error: 'Check the name, HTTPS URL and events.' }); expect(h.insert).not.toHaveBeenCalled();
});
it.each([null, {}, { name: 123 }, { ...valid(), events: 'message.sent' }, { ...valid(), name: 'x'.repeat(81) }])('rejects malformed input without throwing or writing', async body => {
  expect((await run(body)).status).toBe(400); expect(h.insert).not.toHaveBeenCalled();
});
it('deduplicates events, generates its own signing secret and ignores caller workspace/secret', async () => {
  expect((await run({ ...valid(), events: ['message.sent', 'message.sent', 'unknown'], workspace_id: 'other', secret: 'caller-secret' })).status).toBe(201);
  expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: 'server-business', created_by: 'admin', events: ['message.sent'] }));
  const row = h.insert.mock.calls[0][0]; expect(row.secret).toMatch(/^[a-f0-9]{64}$/); expect(row.secret).not.toBe('caller-secret');
});
it('localizes rejected input in Spanish', async () => {
  h.locale = 'es'; const response = await run(null);
  expect((await response.json()).error).toBe('Revisa el nombre, la URL HTTPS y los eventos.');
});
it('stores the canonical HTTPS URL accepted by the existing database constraint', async () => {
  expect((await run({ ...valid(), url: 'HTTPS://RECEIVER.TEST:443/events' })).status).toBe(201);
  expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://receiver.test/events' }));
});
it('rejects a URL that exceeds the send limit after canonical encoding', async () => {
  expect((await run({ ...valid(), url: `https://receiver.test/${'é'.repeat(400)}` })).status).toBe(400);
  expect(h.insert).not.toHaveBeenCalled();
});
it.each(['csrf', 'anonymous', 'member'])('preserves the %s guard before inserting', async state => {
  if (state === 'csrf') h.csrf = true; if (state === 'anonymous') h.user = null; if (state === 'member') h.role = 'member';
  expect((await run(valid())).status).toBe(state === 'csrf' ? 403 : 401); expect(h.insert).not.toHaveBeenCalled();
});
