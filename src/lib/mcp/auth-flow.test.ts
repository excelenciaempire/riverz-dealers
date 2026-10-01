import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({ db: null as unknown as SupabaseClient, user: 'u1', workspace: 'w1', csrf: false }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => state.db }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) } }) }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => state.workspace }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => state.csrf ? new Response(null, { status: 403 }) : null }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: async () => ({ success: true }), clientIp: () => 'test', rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock('@/lib/billing/read-only', () => ({ assertWorkspaceWritable: async () => {} }));
vi.mock('@/lib/mcp/registry', () => {
  const tools = [
    { name: 'contactos_listar', capabilityKey: 'contactos.listar', risk: 'lectura', schema: { type: 'object', properties: {} }, run: async (args: unknown) => args },
    { name: 'conversacion_mensajes', capabilityKey: 'conversaciones.mensajes', risk: 'lectura', schema: { type: 'object', properties: {} }, run: async (args: unknown) => args },
    { name: 'mensaje_enviar', capabilityKey: 'mensajes.enviar', risk: 'reversible', schema: { type: 'object', properties: {} }, run: async () => 'sent' },
    { name: 'cron_estado', platformOnly: true, risk: 'lectura', schema: { type: 'object', properties: {} }, run: async () => 'platform' },
  ];
  return { ALL_TOOLS: tools, findTool: (name: string) => tools.find(t => t.name === name) };
});
import { POST as register } from '@/app/api/oauth/register/route';
import { POST as authorize } from '@/app/api/oauth/authorize/route';
import { POST as exchange } from '@/app/api/oauth/token/route';
import { POST as revoke } from '@/app/api/oauth/revoke/route';
import { POST as mcp } from '@/app/api/mcp/route';
import { GET as checkStatus, POST as createCheck } from '@/app/api/mcp/connection-check/route';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let errors: Set<string>;
function database(): SupabaseClient {
  return { from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let operation = 'select', payload: Row | Row[] = {};
    let result: { data: Row[] | null; error: unknown } | null = null;
    const execute = () => {
      if (result) return result;
      if (errors.has(table)) return result = { data: null, error: { message: 'query_failed' } };
      const rows = tables[table] ??= [];
      let found = rows.filter(r => filters.every(f => f(r)));
      if (operation === 'insert') {
        found = (Array.isArray(payload) ? payload : [payload]).map(r => ({
          id: randomUUID(), created_at: new Date().toISOString(), revoked_at: null, used_at: null,
          ...(table === 'mcp_connection_checks' ? { verified_at: null, expires_at: new Date(Date.now() + 900_000).toISOString() } : {}), ...r,
        }));
        rows.push(...found);
      }
      if (operation === 'update') for (const row of found) Object.assign(row, payload);
      return result = { data: found.map(r => ({ ...r })), error: null };
    };
    const chain = {
      select: () => chain,
      insert: (p: Row | Row[]) => { operation = 'insert'; payload = p; return chain; },
      update: (p: Row) => { operation = 'update'; payload = p; return chain; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return chain; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return chain; },
      gt: (k: string, v: string) => { filters.push(r => String(r[k]) > v); return chain; },
      or: (s: string) => { filters.push(r => r.expires_at == null || String(r.expires_at) > s.split('expires_at.gt.')[1]); return chain; },
      maybeSingle: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      single: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(resolve(execute())),
    };
    return chain;
  } } as unknown as SupabaseClient;
}
const jsonRequest = (path: string, body: unknown, bearer?: string) => new Request(`https://riverz.co${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body),
});
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
async function client() {
  const response = await register(jsonRequest('/api/oauth/register', { client_name: 'QA client', redirect_uris: ['https://example.com/callback'] }));
  expect(response.status).toBe(201); return (await response.json()).client_id as string;
}
async function code(clientId: string, scope = 'mcp:read offline_access') {
  const response = await authorize(jsonRequest('/api/oauth/authorize', { client_id: clientId, redirect_uri: 'https://example.com/callback',
    scope, state: 'state', code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://riverz.co/api/mcp' }));
  expect(response.status).toBe(200);
  const url = new URL((await response.json()).redirect_to); expect(url.searchParams.get('state')).toBe('state');
  return url.searchParams.get('code')!;
}
async function token(clientId: string, authCode: string, overrides = {}) {
  return exchange(jsonRequest('/api/oauth/token', { grant_type: 'authorization_code', client_id: clientId, code: authCode,
    redirect_uri: 'https://example.com/callback', code_verifier: verifier, resource: 'https://riverz.co/api/mcp', ...overrides }));
}
async function connect(scope?: string) {
  const clientId = await client(); const response = await token(clientId, await code(clientId, scope));
  expect(response.status).toBe(200); return { clientId, ...(await response.json()) };
}
const rpc = (access: string | undefined, method: string, params = {}) => mcp(jsonRequest('/api/mcp', { jsonrpc: '2.0', id: 1, method, params }, access));
beforeEach(() => {
  state.user = 'u1'; state.workspace = 'w1'; state.csrf = false; errors = new Set();
  tables = { workspaces: [{ id: 'w1', owner_id: 'u1', deleted_at: null }, { id: 'w2', owner_id: 'u2', deleted_at: null }], workspace_members: [] };
  state.db = database();
});

describe('OAuth MCP transport and isolation', () => {
  it('challenges unauthenticated initialize with HTTP 401 and discovery', async () => {
    const response = await rpc(undefined, 'initialize');
    expect(response.status).toBe(401); expect(response.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource');
  });
  it('rejects another registered client without consuming the legitimate code', async () => {
    const first = await client(); const second = await client(); const c = await code(first);
    expect((await token(second, c)).status).toBe(400); expect((await token(first, c)).status).toBe(200);
    expect((await token(first, c)).status).toBe(400);
  });
  it.each([{ code_verifier: 'wrong' }, { redirect_uri: 'https://evil.example/cb' }, { resource: 'https://other.example/mcp' }])('rejects invalid token binding %j', async overrides => {
    const id = await client(); expect((await token(id, await code(id), overrides)).status).toBe(400);
  });
  it('rejects an expired authorization code', async () => {
    const id = await client(); const c = await code(id); tables.oauth_codes[0].expires_at = new Date(0).toISOString();
    expect((await token(id, c)).status).toBe(400);
  });
  it('requires a real OAuth tool call and isolates checks by user and account', async () => {
    const oauth = await connect(); const check = await (await createCheck(jsonRequest('/api/mcp/connection-check', { provider: 'claude' }))).json();
    await rpc(oauth.access_token, 'initialize'); await rpc(oauth.access_token, 'tools/list');
    const status = () => checkStatus(new Request(`https://riverz.co/api/mcp/connection-check?id=${check.id}`));
    expect((await (await status()).json()).status).toBe('authorized');
    state.user = 'u2'; state.workspace = 'w2'; expect((await status()).status).toBe(404);
    const other = await connect(); expect((await (await rpc(other.access_token, 'tools/call', { name: 'comprobar_conexion', arguments: { codigo: check.id } })).json()).result.isError).toBe(true);
    state.user = 'u1'; state.workspace = 'w1';
    const result = await (await rpc(oauth.access_token, 'tools/call', { name: 'comprobar_conexion', arguments: { codigo: check.id } })).json();
    expect(result.result.isError).toBeUndefined(); expect((await (await status()).json()).status).toBe('verified');
  });
  it('never treats an expired check as success', async () => {
    const oauth = await connect(); const check = await (await createCheck(jsonRequest('/api/mcp/connection-check', { provider: 'chatgpt' }))).json();
    tables.mcp_connection_checks[0].expires_at = new Date(0).toISOString();
    expect((await (await rpc(oauth.access_token, 'tools/call', { name: 'comprobar_conexion', arguments: { codigo: check.id } })).json()).result.isError).toBe(true);
  });
  it('does not let a teammate verify another user’s check in the same account', async () => {
    const first = await connect();
    const check = await (await createCheck(jsonRequest('/api/mcp/connection-check', { provider: 'claude' }))).json();
    tables.workspace_members.push({ workspace_id: 'w1', user_id: 'u2', role: 'admin', allowed_sections: null });
    state.user = 'u2';
    const second = await (await token(first.clientId, await code(first.clientId))).json();
    expect((await checkStatus(new Request(`https://riverz.co/api/mcp/connection-check?id=${check.id}`))).status).toBe(404);
    const response = await rpc(second.access_token, 'tools/call', { name: 'comprobar_conexion', arguments: { codigo: check.id } });
    expect((await response.json()).result.isError).toBe(true);
    expect(tables.mcp_connection_checks[0].verified_at).toBeNull();
  });
  it('rejects a refresh at another client without revoking its legitimate grant', async () => {
    const oauth = await connect(); const other = await client();
    const refresh = (id: string) => exchange(jsonRequest('/api/oauth/token', { grant_type: 'refresh_token', client_id: id, refresh_token: oauth.refresh_token }));
    expect((await refresh(other)).status).toBe(400);
    expect((await refresh(oauth.clientId)).status).toBe(200);
  });
  it('cannot prove OAuth installation with a manual credential', async () => {
    const oauth = await connect(); tables.mcp_tokens[0].origin = 'manual';
    const check = await (await createCheck(jsonRequest('/api/mcp/connection-check', { provider: 'claude' }))).json();
    const response = await rpc(oauth.access_token, 'tools/call', { name: 'comprobar_conexion', arguments: { codigo: check.id } });
    expect((await response.json()).result.isError).toBe(true);
    expect(tables.mcp_connection_checks[0].verified_at).toBeNull();
  });
  it('enforces workspace boundaries, read-only scope and platform tool restrictions', async () => {
    const oauth = await connect();
    const list = await (await rpc(oauth.access_token, 'tools/list')).json();
    expect(list.result.tools.map((t: Row) => t.name)).not.toContain('mensaje_enviar');
    for (const params of [{ name: 'contactos_listar', arguments: { workspace_id: 'w2' } }, { name: 'mensaje_enviar' }, { name: 'cron_estado' }]) {
      expect((await (await rpc(oauth.access_token, 'tools/call', params)).json()).error.code).toBe(-32003);
    }
  });
  it('caps a team member to current sections and blocks removed membership', async () => {
    tables.workspaces[0].owner_id = 'owner'; tables.workspace_members.push({ workspace_id: 'w1', user_id: 'u1', role: 'agent', allowed_sections: ['/bandeja'] });
    const oauth = await connect('mcp:read mcp:write'); expect(oauth.scope).toBe('mcp:read');
    const list = await (await rpc(oauth.access_token, 'tools/list')).json();
    expect(list.result.tools.map((t: Row) => t.name)).toEqual(['conversacion_mensajes', 'comprobar_conexion']);
    tables.workspace_members = []; expect((await rpc(oauth.access_token, 'initialize')).status).toBe(401);
  });
  it('fails closed on permission query errors', async () => {
    const oauth = await connect('mcp:read mcp:write'); errors.add('workspaces');
    expect((await rpc(oauth.access_token, 'tools/list')).status).toBe(401);
  });
  it('rotates refresh tokens, rejects replay and revokes the compromised client grant', async () => {
    const oauth = await connect();
    const refresh = () => exchange(jsonRequest('/api/oauth/token', { grant_type: 'refresh_token', client_id: oauth.clientId, refresh_token: oauth.refresh_token }));
    const response = await refresh(); expect(response.status).toBe(200);
    const next = await response.json(); expect(next.refresh_token).not.toBe(oauth.refresh_token);
    expect((await refresh()).status).toBe(400); expect((await rpc(next.access_token, 'initialize')).status).toBe(401);
  });
  it('revokes access and refresh for only the token owner, even with one shared client', async () => {
    const first = await connect(); state.user = 'u2'; state.workspace = 'w2';
    const second = await (await token(first.clientId, await code(first.clientId))).json();
    const response = await revoke(new Request('https://riverz.co/api/oauth/revoke', { method: 'POST', body: new URLSearchParams({ client_id: first.clientId, token: first.refresh_token }) }));
    expect(response.status).toBe(200); expect((await rpc(first.access_token, 'initialize')).status).toBe(401);
    expect((await rpc(second.access_token, 'initialize')).status).toBe(200);
  });
  it('rejects an expired access token', async () => {
    const oauth = await connect(); tables.mcp_tokens[0].expires_at = new Date(0).toISOString(); expect((await rpc(oauth.access_token, 'initialize')).status).toBe(401);
  });
  it('does not grant write access when a membership query fails', async () => {
    tables.workspaces[0].owner_id = 'owner'; errors.add('workspace_members');
    const id = await client(); const response = await authorize(jsonRequest('/api/oauth/authorize', { client_id: id, redirect_uri: 'https://example.com/callback', code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp:write' }));
    expect(response.status).toBe(403); expect(tables.oauth_codes).toBeUndefined();
  });
  it('protects check creation and authorization with CSRF', async () => {
    state.csrf = true; expect((await createCheck(jsonRequest('/api/mcp/connection-check', { provider: 'claude' }))).status).toBe(403);
    expect((await authorize(jsonRequest('/api/oauth/authorize', {}))).status).toBe(403);
  });
  it('returns a recoverable error if verification storage is unavailable', async () => {
    errors.add('mcp_connection_checks'); expect((await createCheck(jsonRequest('/api/mcp/connection-check', { provider: 'claude' }))).status).toBe(503);
  });
});
