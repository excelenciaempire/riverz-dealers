import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const flag = vi.hoisted(() => ({ shown: true }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return flag.shown; } }));
import { httpFlowActivationIssues } from './http-activation';
import { aplicarPatches, cambiarEstado, guardarGrafo } from './write';

const workspace = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const action = '33333333-3333-4333-8333-333333333333', flow = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
const config = { action_id: action, action_revision: 2, input_vars: { reference: 'order' }, output_prefix: 'system', next_node_key: 'end' };
const definition = { name: 'Lookup', description: 'Own system', method: 'GET', url: 'https://example.com/read', credential_kind: 'none',
  parameters: [{ key: 'contact', type: 'string', source: 'contact_id', required: true },
    { key: 'reference', type: 'string', source: 'input', required: true }], outputs: [] };
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>, failing: string, writable: unknown;
let queries: Array<{ table: string; selected: string; filters: Array<[string, unknown]> }>;
let writes: Array<{ table: string; op: string; payload: unknown }>;
function fakeDb(): SupabaseClient {
  return { rpc: vi.fn(async (name, args) => {
    expect(name).toBe('workspace_billing_write_allowed'); expect(args).toEqual({ p_workspace: workspace });
    return { data: writable, error: failing === 'billing' ? { message: 'unavailable' } : null };
  }), from(table: string) {
    const query = { table, selected: '', filters: [] as Array<[string, unknown]> };
    queries.push(query);
    let op = '', payload: unknown, limit = Infinity;
    const selected = () => (rows[table] ?? []).filter(row => query.filters.every(([key, value]) =>
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
    const execute = () => {
      if (failing === table) return { data: null, error: { message: 'private backend detail' } };
      let result = selected();
      if (op) {
        writes.push({ table, op, payload });
        if (op === 'update') result.forEach(row => Object.assign(row, payload));
        if (op === 'insert') { result = (Array.isArray(payload) ? payload : [payload]) as Row[]; rows[table].push(...result); }
        if (op === 'delete') rows[table] = rows[table].filter(row => !result.includes(row));
      }
      return { data: result.slice(0, limit), error: null };
    };
    const chain: Record<string, unknown> = {
      select(columns = '') { query.selected = columns; return chain; }, order: () => chain,
      eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
      is(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
      in(key: string, value: unknown[]) { query.filters.push([key, value]); return chain; },
      limit(value: number) { limit = value; return chain; },
      update(value: unknown) { op = 'update'; payload = value; return chain; },
      insert(value: unknown) { op = 'insert'; payload = value; return chain; },
      delete() { op = 'delete'; return chain; },
      maybeSingle: async () => { const answer = execute(); return { ...answer, data: answer.data?.[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject),
    };
    return chain;
  } } as unknown as SupabaseClient;
}
beforeEach(() => {
  flag.shown = true; failing = ''; writable = true; queries = []; writes = [];
  rows = {
    workspaces: [{ id: workspace, owner_id: actor, deleted_at: null }], workspace_members: [],
    flows: [{ id: flow, workspace_id: workspace, short_id: 'abcd1234', name: 'System lookup', status: 'draft',
      trigger_type: 'manual', trigger_config: {}, entry_node_id: 'lookup', deleted_at: null }],
    flow_nodes: [{ flow_id: flow, node_key: 'lookup', node_type: 'http_action', config: structuredClone(config), position_x: 0, position_y: 0 },
      { flow_id: flow, node_key: 'end', node_type: 'end', config: {} }], flow_versions: [],
    http_actions: [{ id: action, workspace_id: workspace, revision: 2, state: 'active', definition: structuredClone(definition) }],
    http_action_flow_grants: [{ workspace_id: workspace, flow_id: flow, node_key: 'lookup', action_id: action,
      action_revision: 2, revision: 1, state: 'active', granted_by: actor, node_config: structuredClone(config) }],
  };
});
const nodes = () => rows.flow_nodes as Array<{ node_key: string; node_type: string; config: Record<string, unknown> }>;
const preflight = (options: { actorId?: string | null; locale?: 'es' | 'en' } = {}) => httpFlowActivationIssues(fakeDb(), {
  workspaceId: workspace, flowId: flow, actorId: actor, nodes: nodes(), ...options,
});

describe('native HTTP activation preflight', () => {
  it('accepts the exact authorized current configuration without querying credentials or customer records', async () => {
    expect(await preflight()).toEqual([]);
    expect(queries.map(query => query.table)).toEqual(['workspaces', 'http_action_flow_grants', 'http_actions']);
    for (const query of queries.filter(query => query.table.startsWith('http_'))) {
      expect(query.filters).toContainEqual(['workspace_id', workspace]);
      expect(query.selected).not.toMatch(/ciphertext|secret|credential/);
    }
    expect(queries.find(query => query.table === 'http_action_flow_grants')!.filters).toContainEqual(['flow_id', flow]);
    expect(writes).toEqual([]);
  });
  it('leaves existing flows without HTTP nodes free of new queries, even outside comparison', async () => {
    flag.shown = false; rows.flow_nodes[0].node_type = 'send_message';
    expect(await preflight({ actorId: null })).toEqual([]); expect(queries).toEqual([]);
  });
  it('blocks hidden HTTP nodes before making queries', async () => {
    flag.shown = false; expect(await preflight()).toHaveLength(1); expect(queries).toEqual([]);
  });
  it.each([null, other, 'invalid'])('requires the activating actor to be a current authorized administrator: %s', async actorId => {
    expect(await preflight({ actorId })).toHaveLength(1); expect(queries.some(query => query.table === 'http_actions')).toBe(false);
  });
  it.each([['agent', null], ['admin', ['/automatizaciones']], ['admin', ['/bandeja']]])('blocks insufficient role/sections %s %s', async (role, sections) => {
    rows.workspaces[0].owner_id = other; rows.workspace_members = [{ workspace_id: workspace, user_id: actor, role, allowed_sections: sections }];
    expect(await preflight()).toHaveLength(1);
  });
  it('accepts a current administrator with both sections', async () => {
    rows.workspaces[0].owner_id = other; rows.workspace_members = [{ workspace_id: workspace, user_id: actor,
      role: 'admin', allowed_sections: ['/automatizaciones', '/bandeja'] }];
    expect(await preflight()).toEqual([]);
  });
  it.each([false, null, 'true'])('fails closed for non-writable or unverified billing: %s', async value => {
    writable = value; expect(await preflight()).toHaveLength(1); expect(queries.some(query => query.table === 'http_actions')).toBe(false);
  });
  it.each(['billing', 'workspaces', 'http_actions', 'http_action_flow_grants'])('fails closed without exposing backend details: %s', async table => {
    failing = table; const result = await preflight(); expect(result).toHaveLength(1); expect(result[0].message).not.toContain('private backend');
  });
  it.each(['missing', 'withdrawn', 'version', 'config', 'foreign', 'former_admin'])('requires current exact grant: %s', async change => {
    const grant = rows.http_action_flow_grants[0];
    if (change === 'missing') rows.http_action_flow_grants = [];
    if (change === 'withdrawn') grant.state = 'withdrawn';
    if (change === 'version') grant.action_revision = 1;
    if (change === 'config') grant.node_config = { ...config, output_prefix: 'different' };
    if (change === 'foreign') grant.workspace_id = other;
    if (change === 'former_admin') grant.granted_by = other;
    expect(await preflight()).toHaveLength(1);
  });
  it.each(['paused', 'version', 'foreign', 'malformed', 'write', 'unscoped', 'phone'])('rejects unavailable or unauthorized actions: %s', async change => {
    const row = rows.http_actions[0], def = row.definition as typeof definition;
    if (change === 'paused') row.state = 'draft';
    if (change === 'version') row.revision = 3;
    if (change === 'foreign') row.workspace_id = other;
    if (change === 'malformed') row.definition = {};
    if (change === 'write') def.method = 'POST';
    if (change === 'unscoped') def.parameters = [];
    if (change === 'phone') def.parameters.push({ key: 'phone', type: 'string', source: 'phone', required: false });
    expect(await preflight()).toHaveLength(1);
  });
  it.each([{}, { contact: 'order' }, { reference: 'order', removed: 'order' }])('requires valid free-input mappings: %s', async input_vars => {
    rows.flow_nodes[0].config = { ...config, input_vars };
    expect((await preflight())[0]).toMatchObject({ node_key: 'lookup', field: 'input_vars' });
  });
  it('accepts equivalent mapping key order and checks one grantor once', async () => {
    const def = rows.http_actions[0].definition as typeof definition;
    def.parameters.push({ key: 'extra', type: 'string', source: 'input', required: false });
    rows.flow_nodes[0].config = { ...config, input_vars: { reference: 'order', extra: 'extra' } };
    rows.http_action_flow_grants[0].node_config = { ...config, input_vars: { extra: 'extra', reference: 'order' } };
    rows.flow_nodes.push({ ...rows.flow_nodes[0], node_key: 'lookup2' });
    rows.http_action_flow_grants.push({ ...rows.http_action_flow_grants[0], node_key: 'lookup2' });
    expect(await preflight()).toEqual([]); expect(queries.filter(query => query.table === 'workspaces')).toHaveLength(1);
  });
  it('rejects a catalog over the bounded complete limit', async () => {
    rows.http_action_flow_grants = Array.from({ length: 201 }, (_, index) => ({ ...rows.http_action_flow_grants[0], node_key: 'n' + index }));
    expect(await preflight()).toHaveLength(1);
  });
  it('returns localized, node-scoped review guidance', async () => {
    rows.http_action_flow_grants = [];
    expect((await preflight({ locale: 'es' }))[0]).toMatchObject({ scope: 'node', node_key: 'lookup', message: expect.stringContaining('autoriza') });
    expect((await preflight({ locale: 'en' }))[0].message).toContain('authorize');
  });
});

describe('shared flow write paths enforce HTTP readiness', () => {
  const changeStatus = (estado: 'draft' | 'active' | 'archived') => cambiarEstado(fakeDb(), { flowId: flow, workspaceId: workspace,
    userId: actor, estado, locale: 'en' });
  it('does not activate or publish an unreviewed flow', async () => {
    rows.http_action_flow_grants = [];
    expect(await changeStatus('active')).toMatchObject({ ok: false, issues: [{ scope: 'node', node_key: 'lookup' }] });
    expect(rows.flows[0].status).toBe('draft'); expect(rows.flow_versions).toEqual([]); expect(writes).toEqual([]);
  });
  it('activates and snapshots a ready flow through the shared panel/capability path', async () => {
    expect(await changeStatus('active')).toMatchObject({ ok: true, flow: { status: 'active' } });
    expect(rows.flow_versions).toHaveLength(1); expect(rows.flow_versions[0].kind).toBe('published');
  });
  it.each(['draft', 'archived'] as const)('allows %s without grants, actor authorization or new preflight queries', async status => {
    rows.http_action_flow_grants = []; flag.shown = false;
    expect(await changeStatus(status)).toMatchObject({ ok: true });
    expect(queries.some(query => query.table.startsWith('http_') || query.table === 'workspaces')).toBe(false);
  });
  it('blocks assisted changes that invalidate an active grant before any writes', async () => {
    rows.flows[0].status = 'active';
    await expect(aplicarPatches(fakeDb(), { flowId: flow, workspaceId: workspace, userId: actor, locale: 'en',
      patches: [{ kind: 'update_node_config', node_key: 'lookup', config_patch: { output_prefix: 'different' } }] })).rejects.toThrow('Pause the flow');
    expect(writes).toEqual([]); expect(rows.flow_nodes[0].config).toEqual(config);
  });
  it('blocks manual active graph edits that invalidate review before the header or nodes are written', async () => {
    rows.flows[0].status = 'active';
    const changed = structuredClone(nodes()); changed[0].config.output_prefix = 'different';
    await expect(guardarGrafo(fakeDb(), { flowId: flow, workspaceId: workspace, userId: actor, locale: 'en',
      campos: { name: 'Do not save' }, nodos: changed })).rejects.toThrow('Pause the flow');
    expect(writes).toEqual([]); expect(rows.flows[0].name).toBe('System lookup'); expect(rows.flow_nodes[0].config).toEqual(config);
  });
  it('does not let a manual active edit remove the authorized destination', async () => {
    rows.flows[0].status = 'active';
    await expect(guardarGrafo(fakeDb(), { flowId: flow, workspaceId: workspace, userId: actor, locale: 'en',
      nodos: nodes().slice(0, 1) })).rejects.toThrow('Pause the flow');
    expect(writes).toEqual([]);
  });
  it('allows a manual position-only edit while preserving the exact authorization', async () => {
    rows.flows[0].status = 'active';
    const changed = structuredClone(nodes()); Object.assign(changed[0], { position_x: 123, position_y: 456 });
    expect(await guardarGrafo(fakeDb(), { flowId: flow, workspaceId: workspace, userId: actor, locale: 'en',
      nodos: changed })).toMatchObject({ flow: { status: 'active' } });
    expect(rows.flow_nodes[0]).toMatchObject({ position_x: 123, position_y: 456, config });
  });
  it('allows a draft to be edited before authorization', async () => {
    rows.http_action_flow_grants = [];
    expect(await aplicarPatches(fakeDb(), { flowId: flow, workspaceId: workspace, userId: actor, locale: 'en',
      patches: [{ kind: 'update_node_config', node_key: 'lookup', config_patch: { output_prefix: 'different' } }] })).toMatchObject({ aplicados: 1 });
    expect(rows.flow_nodes[0].config).toMatchObject({ output_prefix: 'different' });
    expect(queries.some(query => query.table.startsWith('http_'))).toBe(false);
  });
});
