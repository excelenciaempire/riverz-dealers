import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ guard: vi.fn(), csrf: vi.fn(), plans: vi.fn(), existing: vi.fn(), insert: vi.fn(), invite: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: h.csrf }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: h.guard }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.audit }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/workspaces/ensure', () => ({ ensureWorkspace: async () => 'w' }));
vi.mock('@/lib/billing/plan', async original => ({ ...await original<typeof import('@/lib/billing/plan')>(), listarPlanes: h.plans }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({
  auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'u', email: 'merchant@example.com' }] } }), inviteUserByEmail: h.invite } },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: h.existing }) }), insert: h.insert }),
}) }));
import { POST } from './route';
const req = (body: object) => new Request('https://admin.riverz.co/api/admin/billing/cuenta-nueva', {
  method: 'POST', body: JSON.stringify({ email: 'merchant@example.com', ...body }) });
beforeEach(() => {
  vi.resetAllMocks();
  h.guard.mockResolvedValue({ ok: true, actor: { userId: 'admin' } });
  h.csrf.mockResolvedValue(null);
  h.existing.mockResolvedValue({ data: null, error: null });
  h.insert.mockResolvedValue({ error: null });
  h.plans.mockResolvedValue([
    { id: 'contacts', slug: 'contactos-500', activo: true, incluidas: 500, precioCentavos: 19900 },
    { id: 'saldo', slug: 'saldo-ilimitado', activo: true, incluidas: 0, precioCentavos: 39900 },
    { id: 'byok', slug: 'byok', activo: true, incluidas: 0, precioCentavos: 0 },
  ]);
});
it.each(['oficial', 'saldo', 'byok'])('creates a %s agreement waiting for its paid activation', async model => {
  expect((await POST(req({ modelo_cobro: model, precio_centavos: 29900 }))).status).toBe(200);
  expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({
    workspace_id: 'w', modelo_cobro: model, estado: 'cortesia', precio_centavos_override: 29900,
    plan_id: model === 'oficial' ? 'contacts' : model,
  }));
});
it('does not overwrite an existing merchant agreement through account creation', async () => {
  h.existing.mockResolvedValue({ data: { workspace_id: 'w' }, error: null });
  expect((await POST(req({ modelo_cobro: 'byok' }))).status).toBe(409);
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.audit).not.toHaveBeenCalled();
});
it('rejects incompatible plans before inviting anyone', async () => {
  expect((await POST(req({ modelo_cobro: 'byok', plan_id: 'contacts' }))).status).toBe(400);
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.invite).not.toHaveBeenCalled();
});
