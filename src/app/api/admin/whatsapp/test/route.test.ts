import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ csrf: false, admin: true, allowed: true, configured: true, template: 'approved', phone: 'owner-configured', send: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => m.csrf ? new Response(null, { status: 403 }) : null }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: async () => m.admin ? { ok: true, actor: { email: 'owner@example.test' } } : { ok: false, res: new Response(null, { status: 403 }) } }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: async () => ({ success: m.allowed }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: m.audit }));
vi.mock('@/lib/admin/platform-whatsapp', () => ({
  platformTechnicalAlertRecipients: async () => ({ phone: m.phone }),
  platformWhatsAppStatus: async () => ({ configured: m.configured, templateName: m.template, templateLanguage: 'es' }),
  sendPlatformAlert: m.send,
}));
import { POST } from './route';
const request = () => new Request('https://admin.riverz.co/api/admin/whatsapp/test', { method: 'POST', body: JSON.stringify({ to: 'attacker', body: 'arbitrary content' }) });
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(m, { csrf: false, admin: true, allowed: true, configured: true, template: 'approved', phone: 'owner-configured' });
  m.send.mockResolvedValue({ ok: true, messageId: 'wamid.test' });
});
it('rejects unsigned or unauthorized requests without sending a WhatsApp', async () => {
  m.csrf = true; expect((await POST(request())).status).toBe(403);
  m.csrf = false; m.admin = false; expect((await POST(request())).status).toBe(403);
  expect(m.send).not.toHaveBeenCalled();
});
it('ignores caller-supplied recipients and contents; sends only the fixed owner test', async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner-configured', title: 'Prueba de alertas' }));
  expect(m.send.mock.calls[0][0].body).not.toContain('arbitrary content');
  expect(m.audit).toHaveBeenCalled();
});
it('requires a configured approved-template path and applies a sending rate limit', async () => {
  m.template = ''; expect((await POST(request())).status).toBe(409);
  m.template = 'approved'; m.allowed = false; expect((await POST(request())).status).toBe(429);
  expect(m.send).not.toHaveBeenCalled();
});
it('does not call a failed or unidentified Meta response a successful test', async () => {
  m.send.mockResolvedValue({ ok: true }); expect((await POST(request())).status).toBe(502);
  m.send.mockResolvedValue({ ok: false }); expect((await POST(request())).status).toBe(502);
});
