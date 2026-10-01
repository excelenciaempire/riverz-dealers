import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m = vi.hoisted(() => ({ shown: true, rpc: vi.fn(), refresh: vi.fn(), download: vi.fn(), extract: vi.fn(), decrypt: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return m.shown; } }));
vi.mock('@/lib/channels/encryption', () => ({ decrypt: m.decrypt, encrypt: () => 'encrypted-new-credential' }));
vi.mock('./drive-provider', async () => {
  const actual = await vi.importActual<typeof import('./drive-provider')>('./drive-provider');
  return { ...actual, refreshDriveToken: m.refresh, downloadDriveDocument: m.download };
});
vi.mock('./document-extraction', async () => ({ ...await vi.importActual<typeof import('./document-extraction')>('./document-extraction'), extractDocument: m.extract }));
import { syncDriveDocuments } from './drive-sync';
import { DriveProviderError } from './drive-provider';
import { DocumentExtractionError } from './document-extraction';
const id = '11111111-1111-4111-8111-111111111111';
const token = { access_token: 'access', refresh_token: 'refresh', expires_at: 2e12, account_id: 'account', email: 'owner@example.com' };
const row = { id, workspace_id: id, agent_id: id, actor_id: id, file_id: 'abcdefghijklmnop', connection_revision: 1,
  state: 'processing', lease_id: id, credential_ciphertext: 'encrypted-credential' };
const db = { rpc: m.rpc } as unknown as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks(); m.shown = true; m.decrypt.mockReturnValue(JSON.stringify(token)); m.refresh.mockResolvedValue(token);
  m.download.mockResolvedValue({ file: new File(['safe'], 'Policy.docx'), remoteVersion: '1', modifiedAt: '2026-10-01T00:00:00Z' });
  m.extract.mockResolvedValue({ name: 'Policy.docx', format: 'docx', text: 'Reviewed facts', bytes: 4, sha256: 'a'.repeat(64) });
  m.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_ai_drive_sources' ? [row] : true, error: null }));
});
describe('Drive worker lease, version publication and private failures', () => {
  it('does no work while comparison is hidden', async () => {
    m.shown = false; expect(await syncDriveDocuments(db)).toEqual({ imported: 0, superseded: 0, failed: 0 }); expect(m.rpc).not.toHaveBeenCalled(); expect(m.download).not.toHaveBeenCalled();
  });
  it('imports through the exact selected file and leased source', async () => {
    expect(await syncDriveDocuments(db)).toEqual({ imported: 1, superseded: 0, failed: 0 });
    expect(m.download).toHaveBeenCalledExactlyOnceWith(token, row.file_id);
    expect(m.rpc).toHaveBeenCalledWith('finish_ai_drive_source', expect.objectContaining({ p_id: id, p_lease_id: id, p_connection_revision: 1, p_remote_version: '1' }));
    expect(m.rpc.mock.calls.map(call => call[0])).toEqual(['claim_ai_drive_sources','finish_ai_drive_source']);
  });
  it('rotates only with the original encrypted credential CAS', async () => {
    m.refresh.mockResolvedValue({ ...token, access_token: 'fresh' }); await syncDriveDocuments(db);
    expect(m.rpc).toHaveBeenCalledWith('update_ai_drive_credentials', expect.objectContaining({ p_previous: row.credential_ciphertext, p_next: 'encrypted-new-credential', p_lease_id: id }));
    expect(m.rpc.mock.calls.map(call => call[0])).toEqual(['claim_ai_drive_sources','update_ai_drive_credentials','finish_ai_drive_source']);
  });
  it('does not download after a credential CAS race', async () => {
    m.refresh.mockResolvedValue({ ...token, access_token: 'fresh' });
    m.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_ai_drive_sources' ? [row] : name !== 'update_ai_drive_credentials', error: null }));
    expect(await syncDriveDocuments(db)).toEqual({ imported: 0, superseded: 0, failed: 1 }); expect(m.download).not.toHaveBeenCalled();
    expect(m.rpc).toHaveBeenCalledWith('fail_ai_drive_source', { p_id: id, p_lease_id: id, p_error_code: 'drive_changed' });
  });
  it.each(['permission','parser','database'])('records a bounded private %s failure', async kind => {
    if (kind === 'permission') m.download.mockRejectedValue(new DriveProviderError('drive_denied'));
    if (kind === 'parser') m.extract.mockRejectedValue(new DocumentExtractionError('document_formulas'));
    if (kind === 'database') m.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_ai_drive_sources' ? [row] : true, error: name === 'finish_ai_drive_source' ? { message: 'private SQL with credential' } : null }));
    expect(await syncDriveDocuments(db)).toEqual({ imported: 0, superseded: 0, failed: 1 });
    expect(m.rpc).toHaveBeenCalledWith('fail_ai_drive_source', { p_id: id, p_lease_id: id, p_error_code: kind === 'permission' ? 'drive_denied' : kind === 'parser' ? 'document_formulas' : 'drive_unavailable' });
  });
  it('does not present a superseded lease as imported', async () => {
    m.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_ai_drive_sources' ? [row] : false, error: null }));
    expect(await syncDriveDocuments(db)).toEqual({ imported: 0, superseded: 1, failed: 0 });
  });
  it('limits concurrent parsers to two and continues independent failures', async () => {
    m.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_ai_drive_sources' ? Array(6).fill(row) : true, error: null }));
    let active = 0, maximum = 0;
    m.extract.mockImplementation(async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return { name: 'Policy.docx', text: 'Facts' }; });
    m.download.mockRejectedValueOnce(new DriveProviderError('drive_denied'));
    expect(await syncDriveDocuments(db)).toEqual({ imported: 5, superseded: 0, failed: 1 }); expect(maximum).toBe(2);
  });
  it.each([null, Array(7).fill(row), [{ ...row, workspace_id: 'wrong' }]])('refuses malformed or unbounded claimed batches', async data => {
    m.rpc.mockResolvedValue({ data, error: null }); await expect(syncDriveDocuments(db)).rejects.toThrow('drive_sync_unavailable'); expect(m.download).not.toHaveBeenCalled();
  });
});
