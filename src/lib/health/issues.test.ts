import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectPlatformIssues, collectWorkspaceIssues, type IssueRow } from './issues';

const base: IssueRow = {
  workspace_id: 'workspace', kind: 'channel_silent', severity: 'warning',
  count: 1, detail: null, ref_id: 'tiktok_comment', ref_child: null,
  last_at: '2026-09-24T05:00:00Z',
};

function database(rows: IssueRow[]): SupabaseClient {
  return { rpc: vi.fn().mockResolvedValue({ data: rows, error: null }) } as unknown as SupabaseClient;
}

describe('actionable channel health issues', () => {
  const rows: IssueRow[] = [
    base,
    { ...base, kind: 'connection_error' },
    { ...base, ref_id: 'instagram' },
  ];

  it('does not report TikTok inactivity when the poll itself has no error', async () => {
    const issues = await collectWorkspaceIssues(database(rows), 'workspace');
    expect(issues.map(issue => `${issue.kind}:${issue.refId}`)).toEqual([
      'connection_error:tiktok_comment', 'channel_silent:instagram',
    ]);
  });

  it('uses the same filter for platform alerts', async () => {
    const issues = await collectPlatformIssues(database(rows));
    expect(issues.get('workspace')).toHaveLength(2);
    expect(issues.get('workspace')?.some(issue =>
      issue.kind === 'channel_silent' && issue.refId === 'tiktok_comment')).toBe(false);
  });
});
