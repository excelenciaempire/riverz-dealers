import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ save: vi.fn(), serverError: vi.fn(), csrf: vi.fn(), locale: 'en' as 'es' | 'en' }));
const workspace = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const flow = '33333333-3333-4333-8333-333333333333';
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: actor } } }) },
  from: () => { const q: Record<string, unknown> = {};
    for (const key of ['select', 'eq']) q[key] = () => q;
    q.maybeSingle = async () => ({ data: { id: flow, workspace_id: workspace }, error: null }); return q; },
}) }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/flows/write', () => ({ guardarGrafo: m.save }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: m.csrf }));
vi.mock('@/lib/api/errors', () => ({ serverError: m.serverError }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => m.locale }));
import { HttpFlowReviewRequiredError } from '@/lib/flows/http-activation';
import { PUT } from './route';
const request = () => new Request('https://riverz.co/api/flows/abcd1234', { method: 'PUT',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lookup', nodes: [] }) });
const context = () => ({ params: Promise.resolve({ id: 'abcd1234' }) });
beforeEach(() => { vi.clearAllMocks(); m.locale = 'en'; m.csrf.mockResolvedValue(null);
  m.save.mockResolvedValue({ flow: { id: flow }, nodes: [] });
  m.serverError.mockReturnValue(Response.json({ error: 'Unavailable' }, { status: 500 })); });
describe('manual flow editing exposes actionable HTTP review errors', () => {
  it.each(['es', 'en'] as const)('returns localized review guidance with 422: %s', async locale => {
    m.locale = locale; const error = new HttpFlowReviewRequiredError(locale); m.save.mockRejectedValue(error);
    const response = await PUT(request(), context());
    expect(response.status).toBe(422); expect(await response.json()).toEqual({ error: error.message });
    expect(error.message).toContain(locale === 'en' ? 'Pause the flow' : 'Pausa el flujo');
    expect(m.serverError).not.toHaveBeenCalled();
  });
  it('passes current actor, resolved workspace and locale to the shared writer', async () => {
    const response = await PUT(request(), context()); expect(response.status).toBe(200);
    expect(m.save).toHaveBeenCalledWith(expect.anything(), { flowId: flow, workspaceId: workspace,
      userId: actor, locale: 'en', campos: { name: 'Lookup' }, nodos: [] });
  });
  it('keeps private failures in the existing server error path', async () => {
    const error = new Error('private failure'); m.save.mockRejectedValue(error);
    const response = await PUT(request(), context()); expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unavailable' }); expect(m.serverError).toHaveBeenCalledWith(error);
  });
  it('retains CSRF before any write', async () => {
    m.csrf.mockResolvedValue(new Response('', { status: 403 }));
    expect((await PUT(request(), context())).status).toBe(403); expect(m.save).not.toHaveBeenCalled();
  });
});
