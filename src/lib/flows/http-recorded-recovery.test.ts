import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m = vi.hoisted(() => ({ shown: true, rpc: vi.fn(), resume: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return m.shown; } }));
vi.mock('./http-approval-resume', () => ({ continueHttpApprovalFlow: m.resume }));
import { recoverRecordedHttpFlows } from './http-recorded-recovery';
const id = '11111111-1111-4111-8111-111111111111';
const row = { workspace_id: id, approval_id: id, payload: {
  tool: `http_flow_action_${id.replaceAll('-', '')}_v1`, input: {}, contact_id: id, conversation_id: id, dedupe_key: 'test',
  http_action_context: { contact_id: id, conversation_id: id, phone: null, email: null },
  http_flow: { run_id: id, flow_id: id, node_key: 'request', visit_at: '2026-10-01T00:00:00Z', grant_revision: 1,
    node_config: { action_id: id, action_revision: 1, input_vars: {}, output_prefix: 'system', next_node_key: 'end' } },
} };
const db = { rpc: m.rpc } as unknown as SupabaseClient;
beforeEach(() => { vi.clearAllMocks(); m.shown = true; m.rpc.mockResolvedValue({ data: [row], error: null }); m.resume.mockResolvedValue(true); });
describe('durable recorded response recovery', () => {
  it('makes no queries outside comparison', async () => {
    m.shown = false; expect(await recoverRecordedHttpFlows(db)).toEqual({ attempted: 0, skipped: 0, failed: 0 });
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.resume).not.toHaveBeenCalled();
  });
  it('passes the exact stored approval to the protected replay path', async () => {
    expect(await recoverRecordedHttpFlows(db)).toEqual({ attempted: 1, skipped: 0, failed: 0 });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('list_http_flow_post_recoveries', { p_limit: 20 });
    expect(m.resume).toHaveBeenCalledExactlyOnceWith(db, id, row.payload, id);
  });
  it('continues the batch after a failed or superseded visit', async () => {
    m.rpc.mockResolvedValue({ data: [row, row, row], error: null });
    m.resume.mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await recoverRecordedHttpFlows(db)).toEqual({ attempted: 1, skipped: 1, failed: 1 });
  });
  it('does not resume malformed or unscoped payloads', async () => {
    m.rpc.mockResolvedValue({ data: [{ ...row, payload: { ...row.payload, contact_id: 'other' } }, { ...row, workspace_id: 'other' }], error: null });
    expect(await recoverRecordedHttpFlows(db)).toEqual({ attempted: 0, skipped: 0, failed: 2 }); expect(m.resume).not.toHaveBeenCalled();
  });
  it.each([{ data: null }, { data: [row], error: { message: 'private' } }, { data: Array(21).fill(row) }])('fails closed on an unavailable or unbounded batch', async result => {
    m.rpc.mockResolvedValue(result); await expect(recoverRecordedHttpFlows(db)).rejects.toThrow('http_flow_recovery_unavailable'); expect(m.resume).not.toHaveBeenCalled();
  });
});
