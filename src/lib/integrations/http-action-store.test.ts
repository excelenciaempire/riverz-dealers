import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ seal: vi.fn(), open: vi.fn() }));
vi.mock('./http-action-credentials', () => ({ sealHttpCredential: h.seal, openHttpCredential: h.open }));
import { loadHttpAction, manageHttpAction } from './http-action-store';
const WS = '11111111-1111-4111-8111-111111111111', ID = '22222222-2222-4222-8222-222222222222';
const definition = { name: 'Action', description: 'Configured lookup', url: 'https://integration.test/path', method: 'GET',
  credential_kind: 'bearer', parameters: [], outputs: [] };
const publicRow = { id: ID, definition, state: 'draft', revision: 1, updated_at: '2026-10-01T00:00:00Z', has_secret: true };
const input = (extra: Record<string, unknown> = {}) => ({ definition, expected_version: 1, ...extra });
type ReadResult = { data: Record<string, unknown> | null; error: { message: string } | null };
let rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
let read = vi.fn<() => Promise<ReadResult>>();
let filters: Array<[string, unknown]>;
function db(): SupabaseClient {
  return { rpc, from: () => {
    const q = { select: () => q, eq: (name: string, value: unknown) => { filters.push([name, value]); return q; }, maybeSingle: read }; return q;
  } } as unknown as SupabaseClient;
}
beforeEach(() => {
  vi.clearAllMocks(); filters = [];
  read = vi.fn<() => Promise<ReadResult>>().mockResolvedValue({ data: { id: ID, workspace_id: WS, definition, state: 'draft', revision: 1,
    updated_at: publicRow.updated_at, credential_ciphertext: 'sealed' }, error: null });
  rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>()
    .mockImplementation(async (_name, args) => ({ data: { ...publicRow, id: args.p_action_id }, error: null }));
  h.seal.mockReturnValue('new-sealed'); h.open.mockReturnValue({ kind: 'bearer', value: 'existing-fixture-secret' });
});
describe('HTTP action configuration store', () => {
  it('requires a newly bound credential when switching the API-key header', async () => {
    const make = { ...definition, credential_kind: 'api-key', api_key_header: 'x-make-apikey' };
    h.open.mockImplementation(() => { throw new Error('changed_credential_binding'); });
    await expect(manageHttpAction(db(), WS, 'owner', 'save', ID, input({ definition: make }))).rejects.toThrow('http_action_credential_required');
    expect(h.open).toHaveBeenCalledWith(WS, ID, make, 'sealed'); expect(rpc).not.toHaveBeenCalled();
    await manageHttpAction(db(), WS, 'owner', 'save', ID, input({ definition: make, secret: 'fixture-make-key' }));
    expect(h.seal).toHaveBeenCalledWith(WS, ID, make, 'fixture-make-key');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('fixture-make-key');
  });
  it('creates a server ID, encrypts the secret and sends only ciphertext to the transactional RPC', async () => {
    const result = await manageHttpAction(db(), WS, 'owner', 'create', undefined, input({ expected_version: 0, secret: 'fixture-secret' }));
    expect(result).not.toHaveProperty('credential_ciphertext'); expect(JSON.stringify(rpc.mock.calls)).not.toContain('fixture-secret');
    expect(rpc).toHaveBeenCalledWith('manage_http_action', expect.objectContaining({ p_workspace_id: WS, p_actor_id: 'owner',
      p_operation: 'create', p_revision: 0, p_ciphertext: 'new-sealed', p_replace_credential: true }));
    expect(h.seal).toHaveBeenCalledWith(WS, expect.any(String), definition, 'fixture-secret');
  });
  it('validates a retained credential against the new destination rather than the previous one', async () => {
    const changed = { ...definition, url: 'https://other.test/query' }; h.open.mockImplementation(() => { throw new Error('private-key-error'); });
    await expect(manageHttpAction(db(), WS, 'owner', 'save', ID, input({ definition: changed }))).rejects.toThrow('http_action_credential_required');
    expect(h.open).toHaveBeenCalledWith(WS, ID, changed, 'sealed'); expect(rpc).not.toHaveBeenCalled();
  });
  it('preserves an unchanged credential without sending it back to the database', async () => {
    await manageHttpAction(db(), WS, 'owner', 'save', ID, input());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_ciphertext: null, p_replace_credential: false });
    expect(filters).toContainEqual(['workspace_id', WS]); expect(filters).toContainEqual(['id', ID]);
  });
  it('clears authentication explicitly and rejects a redundant plaintext secret for no-auth', async () => {
    const noAuth = { ...definition, credential_kind: 'none' };
    await manageHttpAction(db(), WS, 'owner', 'save', ID, input({ definition: noAuth }));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_ciphertext: null, p_replace_credential: true });
    await expect(manageHttpAction(db(), WS, 'owner', 'save', ID, input({ definition: noAuth, secret: 'fixture-secret' }))).rejects.toThrow('http_action_invalid');
  });
  it('does not expose a credential accidentally copied into model-visible description or destination', async () => {
    await expect(manageHttpAction(db(), WS, 'owner', 'create', undefined, input({ expected_version: 0, secret: 'fixture-secret',
      definition: { ...definition, description: 'Use fixture-secret' } }))).rejects.toThrow('http_action_invalid');
    await expect(manageHttpAction(db(), WS, 'owner', 'save', ID, input({ definition: { ...definition, description: 'existing-fixture-secret' } }))).rejects.toThrow('http_action_invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('requires a decryptable, correctly bound credential before activation', async () => {
    h.open.mockImplementation(() => { throw new Error('secret-error'); });
    await expect(manageHttpAction(db(), WS, 'owner', 'activate', ID, { expected_version: 1 })).rejects.toThrow('http_action_credential_required');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects credential echoes after JSON or URL escaping rather than relying on serialized substring matching', async () => {
    const secret = 'fixture"secret/path';
    for (const def of [{ ...definition, description: secret }, { ...definition, url: 'https://integration.test/fixture%22secret/path' }]) {
      await expect(manageHttpAction(db(), WS, 'owner', 'create', undefined, input({ definition: def, expected_version: 0, secret }))).rejects.toThrow('http_action_invalid');
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it('allows withdrawal without requiring the old encryption key or a network test', async () => {
    await manageHttpAction(db(), WS, 'owner', 'withdraw', ID, { expected_version: 1 });
    expect(read).not.toHaveBeenCalled(); expect(h.open).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_operation: 'withdraw', p_revision: 1 });
  });
  it.each(['scope', 'read-error', 'absent', 'malformed'])('rejects %s action reads before changing configuration', async mode => {
    const response = await read();
    if (!response.data) throw new Error('Missing fixture');
    if (mode === 'scope') response.data.workspace_id = ID;
    else if (mode === 'read-error') response.error = { message: 'PRIVATE_SQL_SECRET' };
    else if (mode === 'absent') response.data = null;
    else if (mode === 'malformed') response.data.definition = {};
    read.mockResolvedValue(response);
    const error = await loadHttpAction(db(), WS, ID).catch(reason => reason);
    expect(error.message).toMatch(/^http_action_(?:not_found|unavailable)$/); expect(error.message).not.toContain('PRIVATE');
  });
  it('does not trust another action ID or ciphertext returned in a public RPC payload', async () => {
    rpc.mockResolvedValue({ data: { ...publicRow, id: WS }, error: null });
    await expect(manageHttpAction(db(), WS, 'owner', 'withdraw', ID, { expected_version: 1 })).rejects.toThrow('http_action_unavailable');
    rpc.mockResolvedValue({ data: { ...publicRow, credential_ciphertext: 'PRIVATE' }, error: null });
    await expect(manageHttpAction(db(), WS, 'owner', 'withdraw', ID, { expected_version: 1 })).rejects.toThrow('http_action_unavailable');
  });
  it.each([['http_action_changed', 'changed'], ['http_action_admin_required', 'forbidden'], ['subscription_read_only', 'read_only'],
    ['PRIVATE_SQL_SECRET', 'unavailable']])('maps database failure %s to the bounded code %s', async (message, code) => {
    rpc.mockResolvedValue({ error: { message }, data: null });
    await expect(manageHttpAction(db(), WS, 'owner', 'list')).rejects.toThrow(`http_action_${code}`);
  });
  it('never turns a failed list or history into an empty result', async () => {
    rpc.mockResolvedValue({ data: { actions: null }, error: null });
    await expect(manageHttpAction(db(), WS, 'owner', 'list')).rejects.toThrow('http_action_unavailable');
    rpc.mockResolvedValue({ data: { history: [{ credential_ciphertext: 'PRIVATE' }] }, error: null });
    await expect(manageHttpAction(db(), WS, 'owner', 'history', ID)).rejects.toThrow('http_action_unavailable');
  });
});
