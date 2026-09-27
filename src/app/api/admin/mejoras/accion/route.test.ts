import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ csrf: vi.fn(), auth: vi.fn(), remove: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: m.csrf }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: m.auth }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: m.audit }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/ai/mejoras', () => ({ aplicarReglaPropuesta: vi.fn() }));
vi.mock('@/lib/ai/mejoras-de-pruebas', () => ({ mejorarFeedbackReal: vi.fn(), mejorarSesionDePrueba: vi.fn() }));
vi.mock('@/lib/templates/cambios', () => ({ aprobarCambio: vi.fn(), descartarCambio: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/ai/borrar-mejora', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ai/borrar-mejora')>(), borrarMejora: m.remove,
}));
import { POST } from './route';
const request = (query = 'que=borrar-feedback&id=f&workspace=w') => new Request(`https://admin.riverz.co/api/admin/mejoras/accion?${query}`, { method: 'POST' });
beforeEach(() => {
  vi.clearAllMocks();
  m.csrf.mockResolvedValue(null);
  m.auth.mockResolvedValue({ ok: true, actor: { id: 'admin' } });
  m.remove.mockResolvedValue({ deleted: 1 });
  m.audit.mockResolvedValue(undefined);
});
it('requires admin authorization before deletion', async () => {
  m.auth.mockResolvedValue({ ok: false, res: new Response(null, { status: 403 }) });
  expect((await POST(request())).status).toBe(403);
  expect(m.remove).not.toHaveBeenCalled();
});
it('requires CSRF protection', async () => {
  m.csrf.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  expect(m.remove).not.toHaveBeenCalled();
});
it.each(['que=borrar-feedback&id=f', 'que=borrar-pruebas&id=other&workspace=w'])('rejects missing or inconsistent workspace: %s', async query => {
  expect((await POST(request(query))).status).toBe(400);
  expect(m.remove).not.toHaveBeenCalled();
});
it('passes the exact workspace and records the confirmed result', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, deleted: 1 });
  expect(m.remove).toHaveBeenCalledWith({}, 'w', 'borrar-feedback', 'f');
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ targetType: 'ai_feedback', targetId: 'f', meta: { workspaceId: 'w', deleted: 1 } }));
});
it('does not claim success or leak database details when deletion fails', async () => {
  m.remove.mockRejectedValue(new Error('private database detail'));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private database detail');
  expect(m.audit).not.toHaveBeenCalled();
});
