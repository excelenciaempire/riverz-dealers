import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readApi, type ReadResource } from './read-api';
const state = vi.hoisted(() => ({ visible: true, run: vi.fn(), report: vi.fn(), rate: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return state.visible; } }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: state.admin }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: state.rate }));
vi.mock('@/lib/dashboard/case-reason-report', () => ({ loadCaseReasonReport: state.report }));
vi.mock('@/lib/capabilities/registry', () => ({ findCapability: (key: string) => ({ key, description: key,
  risk: 'lectura', schema: { type: 'object', properties: {} }, run: state.run }), withWorkspaceArg: (schema: unknown) => schema }));
import { hashToken } from '@/lib/mcp/tokens';
const WS = '11111111-1111-4111-8111-111111111111', ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333', TOKEN = 'rvz_read_api_fixture';
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>, errors: Set<string>, audits: Row[], executed: string[], filters: Array<[string, string, unknown]>;
function database() {
  return { from: (table: string) => {
    const predicates: Array<(row: Row) => boolean> = []; let inserted: Row | undefined;
    const result = () => {
      executed.push(table);
      if (inserted && !errors.has(table)) audits.push(inserted);
      return { data: (tables[table] ?? []).filter(row => predicates.every(test => test(row))), error: errors.has(table) ? { message: 'PRIVATE_SQL_SECRET' } : null };
    };
    const q = { select: () => q, update: () => q, insert: (row: Row) => { inserted = row; return q; },
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); predicates.push(row => row[key] === value); return q; },
      is: (key: string, value: unknown) => { predicates.push(row => (row[key] ?? null) === value); return q; },
      or: () => { predicates.push(row => !row.expires_at || Date.parse(String(row.expires_at)) > Date.now()); return q; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    }; return q;
  } };
}
const request = (query = '', headers: Record<string, string> = {}) => new Request(`https://riverz.test/api/v1/resource${query}`, {
  headers: { Authorization: `Bearer ${TOKEN}`, 'X-Riverz-Locale': 'en', ...headers },
});
beforeEach(() => {
  vi.clearAllMocks(); state.visible = true; errors = new Set(); audits = []; executed = []; filters = [];
  tables = { mcp_tokens: [{ id: ID, token_hash: hashToken(TOKEN), workspace_id: WS, name: 'Untrusted key label',
    created_by: 'owner', scope: 'lectura', origin: 'manual' }], workspaces: [{ id: WS, owner_id: 'owner' }],
    conversations: [{ id: ID, workspace_id: WS, channel: 'whatsapp' }], channel_connections: [] };
  state.admin.mockImplementation(database);
  state.rate.mockResolvedValue({ success: true, reset: Date.now() + 60_000 });
  state.run.mockResolvedValue({ conversaciones: [{ conversation_id: ID, contacto: 'Customer', private_field: 'secret' }] });
  state.report.mockResolvedValue({ observed_at: '2026-10-01T00:00:00Z', rows: [] });
});

describe('reserved read REST API', () => {
  it('does not initialize auth, rate limits or data when the comparison is disabled', async () => {
    state.visible = false;
    const response = await readApi(request(), 'conversationSearch');
    expect(response.status).toBe(404); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(state.admin).not.toHaveBeenCalled(); expect(state.run).not.toHaveBeenCalled();
  });
  it.each(['', TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN}, Bearer rvz_other`])('requires one bearer token: %s', async header => {
    expect((await readApi(request('', { Authorization: header }), 'conversationSearch')).status).toBe(401);
    expect(state.run).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'expired', 'issuerless', 'oauth', 'unknown-origin', 'invalid'])('rejects a %s key without reading a resource', async kind => {
    const key = tables.mcp_tokens[0];
    if (kind === 'revoked') key.revoked_at = '2026-01-01T00:00:00Z';
    if (kind === 'expired') key.expires_at = '2020-01-01T00:00:00Z';
    if (kind === 'issuerless') key.created_by = null;
    if (kind === 'oauth') key.origin = 'oauth';
    if (kind === 'unknown-origin') key.origin = 'legacy';
    if (kind === 'invalid') tables.mcp_tokens = [];
    expect((await readApi(request(), 'conversationSearch')).status).toBe(401);
    expect(state.run).not.toHaveBeenCalled(); expect(executed).not.toContain('conversations');
  });
  it('rejects a platform key even if it uses the token prefix', async () => {
    vi.stubEnv('MCP_ADMIN_TOKEN', TOKEN);
    try { expect((await readApi(request(), 'conversationSearch')).status).toBe(401); }
    finally { vi.unstubAllEnvs(); }
    expect(state.run).not.toHaveBeenCalled();
  });
  it('derives workspace and actor from the key and omits search text and contents from the audit', async () => {
    const response = await readApi(request('?q=Customer+private&limit=50&status=open&channel=whatsapp'), 'conversationSearch');
    expect(response.status).toBe(200);
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS,
      actor: { type: 'mcp', id: 'Untrusted key label', userId: 'owner' }, locale: 'en' }),
    { texto: 'Customer private', limite: 50, estado: 'open', canal: 'whatsapp' });
    expect(await response.json()).toEqual({ data: { conversaciones: [{ conversation_id: ID, contacto: 'Customer' }] } });
    expect(JSON.stringify(audits)).not.toMatch(/Customer|private|rvz_read_api_fixture|Untrusted/);
    expect(audits[0]).toMatchObject({ workspace_id: WS, actor: `rest:${ID}`, risk: 'lectura', ok: true, summary: 'HTTP 200' });
    expect(state.rate).toHaveBeenCalledWith(`mcp:${ID}`, { limit: 60, windowMs: 60_000 });
  });
  it.each(['?workspace_id=other', '?user_id=other', '?limit=51', '?limit=0', '?limit=-1', '?limit=1.5',
    '?limit=01', '?q=a&q=b', '?channel=unknown', '?status=deleted', `?q=${'x'.repeat(101)}`])('rejects unknown, duplicate and out-of-bounds inputs: %s', async query => {
    expect((await readApi(request(query), 'conversationSearch')).status).toBe(400);
    expect(state.run).not.toHaveBeenCalled(); expect(audits[0]).toMatchObject({ ok: false, summary: 'HTTP 400' });
  });
  it('rechecks membership and section permissions on every request', async () => {
    tables.workspaces[0].owner_id = 'other';
    tables.workspace_members = [{ workspace_id: WS, user_id: 'owner', role: 'agent', allowed_sections: ['/bandeja'] }];
    expect((await readApi(request(), 'conversationSearch')).status).toBe(200);
    tables.workspace_members[0].allowed_sections = ['/contactos'];
    expect((await readApi(request(), 'conversationSearch')).status).toBe(403);
    tables.workspace_members = [];
    expect((await readApi(request(), 'contactSearch')).status).toBe(403);
    expect(state.run).toHaveBeenCalledTimes(1);
  });
  it('does not allow an admin with restricted sections to bypass them', async () => {
    tables.workspaces[0].owner_id = 'other';
    tables.workspace_members = [{ workspace_id: WS, user_id: 'owner', role: 'admin', allowed_sections: [] }];
    tables.mcp_tokens[0].scope = 'total';
    expect((await readApi(request(), 'conversationSearch')).status).toBe(403);
    expect(state.run).not.toHaveBeenCalled();
  });
  it.each(['workspaces', 'workspace_members'])('denies permission on a %s lookup error', async table => {
    tables.workspaces[0].owner_id = 'other'; errors.add(table);
    expect((await readApi(request(), 'conversationSearch')).status).toBe(403);
    expect(state.run).not.toHaveBeenCalled();
  });
  it('returns 429 with Retry-After without querying resources', async () => {
    state.rate.mockResolvedValue({ success: false, reset: Date.now() + 10_000 });
    const response = await readApi(request(), 'conversationSearch');
    expect(response.status).toBe(429); expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(state.run).not.toHaveBeenCalled(); expect(executed).not.toContain('conversations');
  });
  it.each(['conversation', 'messages'] as ReadResource[])('hides absent or other-workspace %s IDs', async resource => {
    tables.conversations[0].workspace_id = 'other';
    expect((await readApi(request(), resource, ID)).status).toBe(404);
    expect(state.run).not.toHaveBeenCalled(); expect(filters).toContainEqual(['conversations', 'workspace_id', WS]);
  });
  it.each(['gmail', 'outlook', 'zoho'])('rechecks the owner and business before returning a %s transcript', async channel => {
    tables.conversations[0] = { id: ID, workspace_id: WS, channel, connection_id: CONNECTION };
    tables.channel_connections = [{ id: CONNECTION, workspace_id: WS, channel, created_by: 'someone-else' }];
    expect((await readApi(request(), 'messages', ID)).status).toBe(404); expect(state.run).not.toHaveBeenCalled();
    tables.channel_connections[0].created_by = 'owner';
    state.run.mockResolvedValue({ conversation_id: ID, mensajes: [{ message_id: ID, texto: 'Own body', error: 'INTERNAL', hidden_by: 'internal-user' }] });
    expect((await readApi(request('?limit=1'), 'messages', ID)).status).toBe(200);
    tables.channel_connections[0].workspace_id = 'other';
    expect((await readApi(request(), 'messages', ID)).status).toBe(404);
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(filters).toContainEqual(['channel_connections', 'workspace_id', WS]);
    expect(JSON.stringify(audits)).not.toContain('Own body');
  });
  it.each(['bad-id', undefined])('validates the record ID before database lookup: %s', async id => {
    expect((await readApi(request(), 'conversation', id)).status).toBe(400);
    expect(executed).not.toContain('conversations');
  });
  it('rejects a detail query and caps transcript length', async () => {
    expect((await readApi(request('?q=anything'), 'conversation', ID)).status).toBe(400);
    expect((await readApi(request('?limit=51'), 'messages', ID)).status).toBe(400);
  });
  it('projects contacts without amounts that lack currency', async () => {
    state.run.mockResolvedValue({ contactos: [{ id: ID, nombre: 'Customer', pedidos: 2, gastado: '999', internal_secret: 'PRIVATE' }] });
    const response = await readApi(request('?limit=2'), 'contactSearch');
    expect(await response.json()).toEqual({ data: { contactos: [{ id: ID, nombre: 'Customer', pedidos: 2 }] } });
  });
  it('projects detail without internal AI traces or drafts', async () => {
    state.run.mockResolvedValue({ conversation_id: ID, estado: 'open', resumen: 'Summary', ultima_pasada_de_la_ia: { error: 'PRIVATE' }, borrador_esperando: { texto: 'Draft' } });
    const response = await readApi(request(), 'conversation', ID);
    expect(await response.json()).toEqual({ data: { conversation_id: ID, estado: 'open', resumen: 'Summary' } });
  });
  it('reuses the validated case report with trusted workspace and user', async () => {
    const query = '?start=2026-09-01T00:00:00Z&end=2026-10-01T00:00:00Z&previous_start=2026-08-01T00:00:00Z&previous_end=2026-09-01T00:00:00Z';
    expect((await readApi(request(query), 'caseReport')).status).toBe(200);
    expect(state.report).toHaveBeenCalledWith(expect.anything(), WS, 'owner', {
      start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z', previous_start: '2026-08-01T00:00:00Z', previous_end: '2026-09-01T00:00:00Z' });
    expect(state.run).not.toHaveBeenCalled();
    tables.workspaces[0].owner_id = 'other';
    tables.workspace_members = [{ workspace_id: WS, user_id: 'owner', role: 'agent', allowed_sections: ['/bandeja'] }];
    expect((await readApi(request(query), 'caseReport')).status).toBe(403);
    expect(state.report).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete report ranges and cursor without reason', async () => {
    expect((await readApi(request('?start=2026-09-01T00:00:00Z'), 'caseReport')).status).toBe(400);
    expect(state.report).not.toHaveBeenCalled();
  });
  it.each(['capability', 'audit', 'lookup', 'malformed-data'])('returns a safe failure rather than unconfirmed data after %s failure', async failure => {
    if (failure === 'capability') state.run.mockRejectedValue(new Error('PRIVATE_SQL_SECRET'));
    if (failure === 'audit') errors.add('platform_audit_log');
    if (failure === 'lookup') errors.add('conversations');
    if (failure === 'malformed-data') state.run.mockResolvedValue({ conversaciones: null });
    const response = await readApi(request(), failure === 'lookup' ? 'conversation' : 'conversationSearch', failure === 'lookup' ? ID : undefined);
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toMatch(/PRIVATE|Customer|data/);
  });
  it.each(['es', 'en'])('localizes errors in %s and never caches authenticated data', async locale => {
    const response = await readApi(request('?limit=0', { 'X-Riverz-Locale': locale }), 'conversationSearch');
    const body = await response.json();
    expect(body.message).toBe(locale === 'es' ? 'Parámetros de consulta inválidos' : 'Invalid query parameters');
    expect(response.headers.get('Vary')).toContain('Authorization'); expect(response.headers.get('Content-Language')).toBe(locale);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
