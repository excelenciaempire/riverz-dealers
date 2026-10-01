import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ visible: true, locale: 'en', user: 'owner', workspace: 'workspace',
  access: { admin: true, sections: null as string[] | null } as { admin: boolean; sections: string[] | null } | null,
  manage: vi.fn(), createClient: vi.fn(), csrf: vi.fn(), rate: vi.fn(), grants: vi.fn(), load: vi.fn(), choices: vi.fn(), runs: vi.fn(),
  StoreError: class extends Error { constructor(readonly code: string) { super(`http_action_${code}`); } } }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => h.locale }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: h.csrf }));
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ service: true }) }));
vi.mock('@/lib/mcp/access', () => ({ userAccess: async () => h.access }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => h.workspace }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: h.rate }));
vi.mock('./http-action-store', () => ({ HttpActionStoreError: h.StoreError, manageHttpAction: h.manage, loadHttpAction: h.load }));
vi.mock('./http-action-run-history', async original => ({...await original<typeof import('./http-action-run-history')>(),loadHttpRunHistory:h.runs}));
vi.mock('./http-action-assistant-grants', async original => ({ ...await original<typeof import('./http-action-assistant-grants')>(), manageHttpAssistantGrant: h.grants }));
vi.mock('./http-action-grant-catalog', () => ({ httpAssistantGrantChoices: h.choices,
  HTTP_ASSISTANT_CHANNELS: ['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat'] }));
import { GET as list, POST as create } from '@/app/api/integrations/http-actions/route';
import { PATCH as update } from '@/app/api/integrations/http-actions/[id]/route';
import { GET as history } from '@/app/api/integrations/http-actions/[id]/history/route';
import { GET as runs } from '@/app/api/integrations/http-actions/[id]/runs/route';
import { GET as grants, PATCH as grantUpdate } from '@/app/api/integrations/http-actions/[id]/assistant-grants/route';
const ID = '22222222-2222-4222-8222-222222222222';
const params = () => ({ params: Promise.resolve({ id: ID }) });
const request = (method = 'GET', body?: string, headers: Record<string, string> = {}) => new Request('https://riverz.test/api/integrations/http-actions',
  { method, ...(body === undefined ? {} : { body }), headers: { 'content-type': 'application/json', ...headers } });
beforeEach(() => {
  vi.clearAllMocks(); h.visible = true; h.locale = 'en'; h.user = 'owner'; h.workspace = 'workspace'; h.access = { admin: true, sections: null };
  h.createClient.mockImplementation(async () => ({ auth: { getUser: async () => ({ data: { user: h.user ? { id: h.user } : null }, error: null }) } }));
  h.csrf.mockResolvedValue(null); h.rate.mockResolvedValue({ success: true }); h.manage.mockResolvedValue({ actions: [] });
  h.grants.mockResolvedValue({ grants: [] }); h.load.mockResolvedValue({ revision: 2, credential_ciphertext: 'PRIVATE_KEY', definition: { url: 'https://PRIVATE.test' } });
  h.choices.mockResolvedValue([{ id: ID, name: 'Existing assistant', is_active: true, channels: ['whatsapp'] }]);
  h.runs.mockResolvedValue({runs:[],next_cursor:null,observed_at:'2026-10-01T00:00:00Z'});
});

describe('private HTTP receipt history API',()=>{
 it('stays disabled before authentication and never executes an action',async()=>{
  h.visible=false;expect((await runs(request(),params())).status).toBe(404);
  expect(h.createClient).not.toHaveBeenCalled();expect(h.runs).not.toHaveBeenCalled();expect(h.manage).not.toHaveBeenCalled();
 });
 it('requires current Settings and Automations administration',async()=>{
  for(const sections of [['/ajustes'],['/automatizaciones'],[]]){h.access={admin:true,sections};expect((await runs(request(),params())).status).toBe(403);}
  expect(h.runs).not.toHaveBeenCalled();
  h.access={admin:true,sections:['/ajustes','/automatizaciones']};expect((await runs(request(),params())).status).toBe(200);
  expect(h.runs).toHaveBeenCalledExactlyOnceWith({service:true},'workspace','owner',ID,null);
 });
 it('rejects a switched workspace, query-supplied scope and malformed cursor before reads',async()=>{
  expect((await runs(request('GET',undefined,{'x-riverz-workspace':ID}),params())).status).toBe(409);
  for(const query of ['actor_id=owner','workspace_id=other','cursor=bad','cursor={}&cursor={}'])expect((await runs(new Request('https://riverz.test/api?'+query),params())).status).toBe(400);
  expect(h.runs).not.toHaveBeenCalled();
 });
 it('uses server identity, private caching and rate limits without CSRF mutations',async()=>{
  const cursor={created_at:'2026-10-01T12:30:00.123456+00:00',id:ID};
  const response=await runs(new Request('https://riverz.test/api?cursor='+encodeURIComponent(JSON.stringify(cursor))),params());
  expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(h.runs).toHaveBeenCalledWith({service:true},'workspace','owner',ID,cursor);expect(h.csrf).not.toHaveBeenCalled();expect(h.manage).not.toHaveBeenCalled();
  h.rate.mockResolvedValue({success:false});expect((await runs(request(),params())).status).toBe(429);expect(h.runs).toHaveBeenCalledOnce();
 });
});

describe('comparison-only assistant grant endpoints', () => {
  it('denies both routes before authentication, CSRF or configuration without the flag', async () => {
    h.visible = false;
    for (const response of [await grants(request(), params()), await grantUpdate(request('PATCH', '{}'), params())]) {
      expect(response.status).toBe(404); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
    expect(h.createClient).not.toHaveBeenCalled(); expect(h.csrf).not.toHaveBeenCalled(); expect(h.grants).not.toHaveBeenCalled();
  });
  it('requires current Settings, Automations and Inbox administration before profile or grant reads', async () => {
    for (const sections of [['/ajustes'], ['/ajustes', '/automatizaciones'], ['/bandeja', '/automatizaciones']]) {
      h.access = { admin: true, sections }; expect((await grants(request(), params())).status).toBe(403);
    }
    expect(h.choices).not.toHaveBeenCalled(); expect(h.grants).not.toHaveBeenCalled();
  });
  it('returns bounded grant/profile metadata and action version without destinations or credentials', async () => {
    const response = await grants(request(), params()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ grants: [], assistants: [{ id: ID, name: 'Existing assistant', is_active: true, channels: ['whatsapp'] }], action_revision: 2 });
    expect(h.grants).toHaveBeenCalledWith({ service: true }, 'workspace', 'owner', ID, 'list');
  });
  it('blocks selected-workspace changes and query-supplied scope before grants or profiles', async () => {
    h.workspace = '11111111-1111-4111-8111-111111111111';
    expect((await grants(request('GET', undefined, { 'x-riverz-workspace': ID }), params())).status).toBe(409);
    expect((await grants(new Request('https://riverz.test/api/integrations/http-actions?workspace_id=other'), params())).status).toBe(400);
    expect(h.grants).not.toHaveBeenCalled(); expect(h.choices).not.toHaveBeenCalled();
  });
  it('passes strict grant input with the authenticated actor and workspace, without invoking external actions', async () => {
    const input = { agent_id: ID, channel: 'whatsapp', context_scope: 'contact', action_revision: 2, expected_version: 0 };
    await grantUpdate(request('PATCH', JSON.stringify({ operation: 'save', ...input })), params());
    expect(h.grants).toHaveBeenCalledWith({ service: true }, 'workspace', 'owner', ID, 'save', input);
    expect(h.manage).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled();
  });
  it('allows withdrawal of a stored unsupported channel without allowing its new activation', async () => {
    const input = { agent_id: ID, channel: 'voice', expected_version: 1 };
    expect((await grantUpdate(request('PATCH', JSON.stringify({ operation: 'save', ...input })), params())).status).toBe(400);
    expect(h.grants).not.toHaveBeenCalled();
    expect((await grantUpdate(request('PATCH', JSON.stringify({ operation: 'withdraw', ...input })), params())).status).toBe(200);
    expect(h.grants).toHaveBeenLastCalledWith({ service: true }, 'workspace', 'owner', ID, 'withdraw', input);
  });
  it('applies CSRF and streaming body limits before grant mutation', async () => {
    h.csrf.mockResolvedValue(new Response('{}', { status: 403 })); expect((await grantUpdate(request('PATCH', '{}'), params())).status).toBe(403);
    h.csrf.mockResolvedValue(null); expect((await grantUpdate(request('PATCH', 'x'.repeat(16385)), params())).status).toBe(400);
    expect(h.grants).not.toHaveBeenCalled();
  });
});
describe('reserved HTTP action configuration endpoints', () => {
  it('rejects a form or list from another selected workspace before a service mutation or read', async () => {
    h.workspace = '11111111-1111-4111-8111-111111111111';
    const headers = { 'x-riverz-workspace': ID };
    expect((await list(request('GET', undefined, headers))).status).toBe(409);
    expect((await create(request('POST', '{}', headers))).status).toBe(409);
    expect(h.manage).not.toHaveBeenCalled();
  });
  it('keeps every route disabled before auth or CSRF without the comparison flag', async () => {
    h.visible = false;
    const responses = [await list(request()), await create(request('POST', '{}')), await update(request('PATCH', '{}'), params()), await history(request(), params())];
    for (const response of responses) { expect(response.status).toBe(404); expect(response.headers.get('Cache-Control')).toBe('private, no-store'); }
    expect(h.createClient).not.toHaveBeenCalled(); expect(h.csrf).not.toHaveBeenCalled(); expect(h.manage).not.toHaveBeenCalled();
  });
  it('requires a cookie-authenticated current workspace administrator with settings permission', async () => {
    h.user = ''; expect((await list(request())).status).toBe(401);
    h.user = 'owner'; h.workspace = ''; expect((await list(request())).status).toBe(404);
    h.workspace = 'workspace'; h.access = { admin: false, sections: null }; expect((await list(request())).status).toBe(403);
    h.access = { admin: true, sections: ['/bandeja'] }; expect((await list(request())).status).toBe(403);
    h.access = null; expect((await list(request())).status).toBe(403);
    expect(h.manage).not.toHaveBeenCalled();
  });
  it('applies current permissions to the next request without retaining an earlier grant', async () => {
    h.access = { admin: true, sections: ['/ajustes'] }; expect((await list(request())).status).toBe(200);
    h.access.sections = []; expect((await list(request())).status).toBe(403); expect(h.manage).toHaveBeenCalledOnce();
  });
  it('blocks writes at CSRF before body or management calls', async () => {
    h.csrf.mockResolvedValue(new Response('{}', { status: 403 }));
    expect((await create(request('POST', 'invalid-json'))).status).toBe(403);
    expect(h.createClient).not.toHaveBeenCalled(); expect(h.manage).not.toHaveBeenCalled();
  });
  it('routes list and history through the scoped configuration manager', async () => {
    await list(request()); expect(h.manage).toHaveBeenCalledWith({ service: true }, 'workspace', 'owner', 'list', undefined, undefined);
    await history(request(), params()); expect(h.manage).toHaveBeenLastCalledWith({ service: true }, 'workspace', 'owner', 'history', ID, undefined);
  });
  it('normalizes a valid UUID to the database spelling before loading its bound credential', async () => {
    await history(request(), { params: Promise.resolve({ id: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF' }) });
    expect(h.manage).toHaveBeenCalledWith({ service: true }, 'workspace', 'owner', 'history', 'abcdefab-cdef-4abc-8def-abcdefabcdef', undefined);
  });
  it('creates a draft via the manager without accepting workspace or actor from query parameters', async () => {
    const body = { definition: { name: 'Draft' }, expected_version: 0 };
    expect((await create(request('POST', JSON.stringify(body)))).status).toBe(201);
    expect(h.manage).toHaveBeenCalledWith({ service: true }, 'workspace', 'owner', 'create', undefined, body);
    const hostile = new Request('https://riverz.test/api/integrations/http-actions?workspace_id=other');
    expect((await list(hostile)).status).toBe(400);
  });
  it.each(['save', 'activate', 'withdraw'])('routes the explicit %s transition without changing the current business', async operation => {
    await update(request('PATCH', JSON.stringify({ operation, expected_version: 1 })), params());
    expect(h.manage).toHaveBeenCalledWith({ service: true }, 'workspace', 'owner', operation, ID, { expected_version: 1 });
  });
  it('rejects unknown operations and malformed IDs', async () => {
    expect((await update(request('PATCH', '{"operation":"run"}'), params())).status).toBe(400);
    expect((await history(request(), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(404);
    expect(h.manage).not.toHaveBeenCalled();
  });
  it.each([['bad-json', 'application/json'], ['{}', 'text/plain'], ['x'.repeat(16385), 'application/json']])('rejects malformed or oversized %s input', async (body, type) => {
    expect((await create(request('POST', body, { 'content-type': type }))).status).toBe(400);
    expect(h.manage).not.toHaveBeenCalled();
  });
  it('enforces the actual byte limit on a streamed body without Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(10000)); controller.enqueue(new Uint8Array(10000)); controller.close(); } });
    const req = new Request('https://riverz.test/api/integrations/http-actions', { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json' } } as RequestInit);
    expect((await create(req)).status).toBe(400); expect(h.manage).not.toHaveBeenCalled();
  });
  it.each([['changed', 409], ['read_only', 402], ['unavailable', 503], ['credential_required', 400], ['limit', 409]])('returns bounded failure %s with status %s', async (code, status) => {
    h.manage.mockRejectedValue(new h.StoreError(code));
    const response = await list(request()); expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE');
  });
  it('sanitizes unexpected errors without confirming a change', async () => {
    h.manage.mockRejectedValue(new Error('PRIVATE_CIPHERTEXT_OR_SQL'));
    const response = await create(request('POST', '{}')); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'http_action_unavailable', message: 'The change could not be confirmed' });
  });
  it('enforces the configuration budget before reads or writes', async () => {
    h.rate.mockResolvedValue({ success: false }); expect((await list(request())).status).toBe(429); expect(h.manage).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'])('localizes configuration errors in %s', async locale => {
    h.locale = locale; h.manage.mockRejectedValue(new h.StoreError('changed'));
    const response = await list(request()), body = await response.json();
    expect(body.message).toBe(locale === 'es' ? 'La acción cambió. Recarga su versión actual' : 'The action changed. Reload its current version');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
